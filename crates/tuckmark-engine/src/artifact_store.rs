use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tuckmark_contracts::{ArtifactPackets, ContractError, PreviewArtifact, canonical_json_bytes};
use uuid::Uuid;

use crate::RenderedArtifact;

const CONTROL_DIRECTORY: &str = ".tuckmark";
const PREVIEWS_DIRECTORY: &str = "previews";

#[derive(Debug, Error)]
pub enum ArtifactStoreError {
    #[error("artifact store I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("artifact store JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("artifact store contract failed: {0}")]
    Contract(#[from] ContractError),
    #[error("artifact id is invalid")]
    InvalidId,
    #[error("artifact {0} already exists")]
    AlreadyExists(String),
    #[error("artifact {0} does not exist")]
    NotFound(String),
    #[error("artifact packet payload is invalid: {0}")]
    InvalidPackets(String),
}

#[derive(Clone, Debug)]
pub struct ArtifactStore {
    data_root: PathBuf,
    control_root: PathBuf,
}

impl ArtifactStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self::from_data_root(root)
    }

    /// Creates a store rooted at the Tuckmark data directory.
    pub fn from_data_root(data_root: impl Into<PathBuf>) -> Self {
        let data_root = data_root.into();
        Self {
            control_root: data_root.join(CONTROL_DIRECTORY),
            data_root,
        }
    }

    /// Creates a store from an explicit `.tuckmark` control directory.
    pub fn from_control_root(control_root: impl Into<PathBuf>) -> Self {
        let control_root = control_root.into();
        let data_root = control_root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| control_root.clone());
        Self {
            data_root,
            control_root,
        }
    }

    /// Returns the Tuckmark data directory, rather than its control directory.
    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    pub fn root(&self) -> &Path {
        self.data_root()
    }

    pub fn preview_dir(&self) -> PathBuf {
        self.control_root.join(PREVIEWS_DIRECTORY)
    }

    pub fn write_artifact(
        &self,
        rendered: &RenderedArtifact,
    ) -> Result<PreviewArtifact, ArtifactStoreError> {
        validate_id(&rendered.artifact.id)?;
        rendered.artifact.validate()?;
        let preview_dir = self.preview_dir();
        fs::create_dir_all(&preview_dir)?;
        let final_dir = preview_dir.join(&rendered.artifact.id);
        if final_dir.exists() {
            return Err(ArtifactStoreError::AlreadyExists(
                rendered.artifact.id.clone(),
            ));
        }
        let staging_dir = preview_dir.join(format!(
            ".{}-{}.pending",
            rendered.artifact.id,
            Uuid::new_v4()
        ));
        fs::create_dir(&staging_dir)?;
        let write_result = (|| -> Result<PreviewArtifact, ArtifactStoreError> {
            let png_path = staging_dir.join("preview.png");
            let bitmap_path = staging_dir.join("bitmap.bin");
            let svg_path = staging_dir.join("preview.svg");
            let metadata_path = staging_dir.join("artifact.json");
            atomic_file(&png_path, &rendered.png)?;
            atomic_file(&bitmap_path, &rendered.bitmap)?;
            atomic_file(&svg_path, rendered.svg.as_bytes())?;
            let mut artifact = rendered.artifact.clone();
            artifact.png_path = final_dir.join("preview.png").to_string_lossy().into_owned();
            artifact.bitmap_path = final_dir.join("bitmap.bin").to_string_lossy().into_owned();
            artifact.svg_path = final_dir.join("preview.svg").to_string_lossy().into_owned();
            atomic_file(&metadata_path, &canonical_json_bytes(&artifact)?)?;
            sync_directory(&staging_dir)?;
            Ok(artifact)
        })();
        match write_result {
            Ok(artifact) => {
                fs::rename(&staging_dir, &final_dir)?;
                sync_directory(&preview_dir)?;
                Ok(artifact)
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&staging_dir);
                Err(error)
            }
        }
    }

    pub fn get_artifact(&self, id: &str) -> Result<Option<PreviewArtifact>, ArtifactStoreError> {
        validate_id(id)?;
        let path = self.preview_dir().join(id).join("artifact.json");
        match fs::read(path) {
            Ok(bytes) => {
                let artifact: PreviewArtifact = serde_json::from_slice(&bytes)?;
                artifact.validate()?;
                Ok(Some(artifact))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn list_artifacts(&self) -> Result<Vec<PreviewArtifact>, ArtifactStoreError> {
        let preview_dir = self.preview_dir();
        let entries = match fs::read_dir(preview_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let mut artifacts = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .filter_map(|entry| {
                let id = entry.file_name().to_string_lossy().into_owned();
                if id.starts_with('.') {
                    return None;
                }
                self.get_artifact(&id).transpose()
            })
            .collect::<Result<Vec<_>, _>>()?;
        artifacts.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(artifacts)
    }

    /// Returns the standard packets path for an artifact stored under this data root.
    pub fn packets_path(&self, artifact_id: &str) -> Result<PathBuf, ArtifactStoreError> {
        Ok(self.artifact_dir(artifact_id)?.join("packets.json"))
    }

    /// Atomically stores a detonger vendor-message sequence as canonical `packets.json`.
    pub fn write_packets(
        &self,
        artifact_id: &str,
        packets: &[Vec<u8>],
    ) -> Result<ArtifactPackets, ArtifactStoreError> {
        let artifact_dir = self.artifact_dir(artifact_id)?;
        if !artifact_dir.join("artifact.json").is_file() {
            return Err(ArtifactStoreError::NotFound(artifact_id.into()));
        }
        let packets_path = artifact_dir.join("packets.json");
        let artifact_packets =
            artifact_packets_from_vendor_messages(artifact_id, &packets_path, packets)?;
        let payload = PacketsFile {
            packets: artifact_packets.packets.clone(),
        };
        atomic_file(&packets_path, &canonical_json_bytes(&payload)?)?;
        sync_directory(&artifact_dir)?;
        Ok(artifact_packets)
    }

    /// Reads an artifact's `packets.json`, returning `None` when it has not been written.
    pub fn read_packets(
        &self,
        artifact_id: &str,
    ) -> Result<Option<ArtifactPackets>, ArtifactStoreError> {
        let artifact_dir = self.artifact_dir(artifact_id)?;
        if !artifact_dir.join("artifact.json").is_file() {
            return Err(ArtifactStoreError::NotFound(artifact_id.into()));
        }
        let packets_path = artifact_dir.join("packets.json");
        match fs::read(&packets_path) {
            Ok(bytes) => {
                let payload: PacketsFile = serde_json::from_slice(&bytes)?;
                Ok(Some(artifact_packets_from_encoded_messages(
                    artifact_id,
                    &packets_path,
                    payload.packets,
                )?))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn artifact_dir(&self, artifact_id: &str) -> Result<PathBuf, ArtifactStoreError> {
        validate_id(artifact_id)?;
        Ok(self.preview_dir().join(artifact_id))
    }
}

#[derive(Deserialize, Serialize)]
struct PacketsFile {
    packets: Vec<String>,
}

pub(crate) fn artifact_packets_from_vendor_messages(
    artifact_id: impl Into<String>,
    packets_path: impl AsRef<Path>,
    packets: &[Vec<u8>],
) -> Result<ArtifactPackets, ArtifactStoreError> {
    artifact_packets_from_encoded_messages(
        artifact_id,
        packets_path,
        packets
            .iter()
            .map(|packet| STANDARD.encode(packet))
            .collect(),
    )
}

fn artifact_packets_from_encoded_messages(
    artifact_id: impl Into<String>,
    packets_path: impl AsRef<Path>,
    packets: Vec<String>,
) -> Result<ArtifactPackets, ArtifactStoreError> {
    let artifact_id = artifact_id.into();
    if artifact_id.trim().is_empty() {
        return Err(ArtifactStoreError::InvalidPackets(
            "artifact id must not be empty".into(),
        ));
    }
    if packets.is_empty() {
        return Err(ArtifactStoreError::InvalidPackets(
            "at least one packet is required".into(),
        ));
    }

    let mut total_bytes = 0_u64;
    for packet in &packets {
        if packet.is_empty() {
            return Err(ArtifactStoreError::InvalidPackets(
                "packets must not contain empty values".into(),
            ));
        }
        let decoded = STANDARD.decode(packet).map_err(|error| {
            ArtifactStoreError::InvalidPackets(format!("packet is not standard base64: {error}"))
        })?;
        if decoded.is_empty() || STANDARD.encode(&decoded) != *packet {
            return Err(ArtifactStoreError::InvalidPackets(
                "packet must use canonical standard base64".into(),
            ));
        }
        total_bytes = total_bytes
            .checked_add(decoded.len() as u64)
            .ok_or_else(|| {
                ArtifactStoreError::InvalidPackets("decoded packet length overflows u64".into())
            })?;
    }

    let artifact_packets = ArtifactPackets {
        artifact_id,
        packets_json_path: packets_path.as_ref().to_string_lossy().into_owned(),
        packet_count: u64::try_from(packets.len())
            .map_err(|_| ArtifactStoreError::InvalidPackets("packet count overflows u64".into()))?,
        total_bytes,
        packets,
        ..ArtifactPackets::default()
    };
    artifact_packets.validate()?;
    Ok(artifact_packets)
}

fn validate_id(id: &str) -> Result<(), ArtifactStoreError> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(ArtifactStoreError::InvalidId);
    }
    Ok(())
}

fn atomic_file(path: &Path, bytes: &[u8]) -> Result<(), io::Error> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "artifact file has no parent")
    })?;
    let temporary = parent.join(format!(
        ".{}-{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        Uuid::new_v4()
    ));
    let write_result = (|| -> Result<(), io::Error> {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn sync_directory(path: &Path) -> Result<(), io::Error> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
