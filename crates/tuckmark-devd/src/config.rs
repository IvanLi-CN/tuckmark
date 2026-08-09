use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

const CONFIG_SCHEMA: &str = "tuckmark.devd-config.v1";
const DATA_MANIFEST_SCHEMA: &str = "tuckmark.data-dir-manifest.v1";
const DATA_STATE_SCHEMA: &str = "tuckmark.devd-data-state.v1";
const DATA_OWNER_SCHEMA: &str = "tuckmark.devd-owner.v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DataDirectorySource {
    Environment,
    Saved,
    Default,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryStatus {
    pub active_data_dir: String,
    pub active_source: DataDirectorySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_data_dir: Option<String>,
    pub default_data_dir: String,
    pub config_path: String,
    pub restart_required: bool,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("DEVD configuration I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("DEVD configuration JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("saved DEVD data directory is not absolute")]
    SavedDataDirectoryNotAbsolute,
    #[error("DEVD data directory must be an absolute path")]
    DataDirectoryNotAbsolute,
    #[error("DEVD data directory must be a directory")]
    DataDirectoryNotDirectory,
    #[error("DEVD data directory is non-empty and is not a recognized Tuckmark data directory")]
    UnrecognizedDataDirectory,
    #[error("DEVD configuration file has an invalid schema")]
    InvalidSchema,
}

#[derive(Clone, Debug)]
pub struct DevdConfig {
    active_data_dir: PathBuf,
    active_source: DataDirectorySource,
    config_path: PathBuf,
    default_data_dir: PathBuf,
}

impl DevdConfig {
    /// Resolves the active directory using the persistent DEVD precedence.
    /// An explicit process argument behaves like the non-persistent environment override.
    pub fn resolve(explicit_data_dir: Option<PathBuf>) -> Result<Self, ConfigError> {
        let config_path = resolve_config_path();
        let default_data_dir = resolve_default_data_directory();
        let selected = if let Some(data_dir) = explicit_data_dir {
            (absolute_path(data_dir)?, DataDirectorySource::Environment)
        } else if let Some(data_dir) =
            env::var_os("TUCKMARK_DATA_DIR").filter(|value| !value.is_empty())
        {
            (
                absolute_path(PathBuf::from(data_dir))?,
                DataDirectorySource::Environment,
            )
        } else if let Some(data_dir) = read_saved_data_directory(&config_path)? {
            (data_dir, DataDirectorySource::Saved)
        } else {
            (default_data_dir.clone(), DataDirectorySource::Default)
        };

        prepare_data_directory(&selected.0)?;
        let config = Self {
            active_data_dir: selected.0,
            active_source: selected.1,
            config_path,
            default_data_dir,
        };
        if config.active_source == DataDirectorySource::Default {
            config.persist_data_directory(&config.active_data_dir)?;
        }
        Ok(config)
    }

    pub fn active_data_dir(&self) -> &Path {
        &self.active_data_dir
    }

    pub fn status(&self) -> Result<DataDirectoryStatus, ConfigError> {
        let saved_data_dir = read_saved_data_directory(&self.config_path)?;
        Ok(DataDirectoryStatus {
            active_data_dir: self.active_data_dir.display().to_string(),
            active_source: self.active_source,
            restart_required: saved_data_dir
                .as_ref()
                .is_some_and(|saved| saved != &self.active_data_dir),
            saved_data_dir: saved_data_dir.map(|path| path.display().to_string()),
            default_data_dir: self.default_data_dir.display().to_string(),
            config_path: self.config_path.display().to_string(),
        })
    }

    pub fn save_data_directory(&self, data_dir: &str) -> Result<DataDirectoryStatus, ConfigError> {
        let path = PathBuf::from(data_dir);
        if !path.is_absolute() {
            return Err(ConfigError::DataDirectoryNotAbsolute);
        }
        let path = normalize_path(path)?;
        prepare_data_directory(&path)?;
        self.persist_data_directory(&path)?;
        self.status()
    }

    fn persist_data_directory(&self, data_dir: &Path) -> Result<(), ConfigError> {
        let payload = serde_json::json!({
            "schema": CONFIG_SCHEMA,
            "dataDir": data_dir.display().to_string(),
        });
        atomic_write_json(&self.config_path, &payload)
    }
}

fn absolute_path(path: PathBuf) -> Result<PathBuf, ConfigError> {
    if !path.is_absolute() {
        return Err(ConfigError::DataDirectoryNotAbsolute);
    }
    normalize_path(path)
}

fn normalize_path(path: PathBuf) -> Result<PathBuf, ConfigError> {
    if path.exists() {
        Ok(fs::canonicalize(path)?)
    } else {
        Ok(path)
    }
}

fn resolve_default_data_directory() -> PathBuf {
    resolve_documents_directory().join("Tuckmark")
}

fn resolve_documents_directory() -> PathBuf {
    let home = home_directory();
    #[cfg(target_os = "linux")]
    {
        if let Some(path) = linux_documents_directory(&home) {
            return path;
        }
    }
    home.join("Documents")
}

#[cfg(target_os = "linux")]
fn linux_documents_directory(home: &Path) -> Option<PathBuf> {
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let content = fs::read_to_string(config_home.join("user-dirs.dirs")).ok()?;
    let line = content
        .lines()
        .find_map(|line| line.strip_prefix("XDG_DOCUMENTS_DIR="))?;
    let value = line.trim().trim_matches('"').trim_matches('\'');
    if value.is_empty() {
        return None;
    }
    let value = value
        .strip_prefix("${HOME}")
        .or_else(|| value.strip_prefix("$HOME"))
        .map(|suffix| home.join(suffix.trim_start_matches('/')))
        .unwrap_or_else(|| PathBuf::from(value));
    Some(value)
}

fn resolve_config_path() -> PathBuf {
    let home = home_directory();
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join("Tuckmark")
            .join("devd.json")
    }
    #[cfg(target_os = "windows")]
    {
        env::var_os("APPDATA")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("Tuckmark")
            .join("devd.json")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("tuckmark")
            .join("devd.json")
    }
}

fn home_directory() -> PathBuf {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn read_saved_data_directory(config_path: &Path) -> Result<Option<PathBuf>, ConfigError> {
    let content = match fs::read_to_string(config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let value: Value = serde_json::from_str(&content)?;
    if value.get("schema").and_then(Value::as_str) != Some(CONFIG_SCHEMA) {
        return Err(ConfigError::InvalidSchema);
    }
    let Some(data_dir) = value.get("dataDir").and_then(Value::as_str) else {
        return Err(ConfigError::InvalidSchema);
    };
    let path = PathBuf::from(data_dir);
    if !path.is_absolute() {
        return Err(ConfigError::SavedDataDirectoryNotAbsolute);
    }
    Ok(Some(normalize_path(path)?))
}

fn prepare_data_directory(path: &Path) -> Result<(), ConfigError> {
    if !path.is_absolute() {
        return Err(ConfigError::DataDirectoryNotAbsolute);
    }
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    if !path.is_dir() {
        return Err(ConfigError::DataDirectoryNotDirectory);
    }
    if !recognized_data_directory(path)? {
        return Err(ConfigError::UnrecognizedDataDirectory);
    }
    Ok(())
}

fn recognized_data_directory(path: &Path) -> Result<bool, ConfigError> {
    let mut entries = fs::read_dir(path)?;
    if entries.next().is_none() {
        return Ok(true);
    }
    for (candidate, schema) in [
        (path.join("manifest.json"), DATA_MANIFEST_SCHEMA),
        (path.join(".tuckmark").join("state.json"), DATA_STATE_SCHEMA),
        (
            path.join(".tuckmark").join("devd-owner.json"),
            DATA_OWNER_SCHEMA,
        ),
    ] {
        if let Ok(content) = fs::read_to_string(candidate)
            && serde_json::from_str::<Value>(&content)
                .ok()
                .and_then(|value| {
                    value
                        .get("schema")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .as_deref()
                == Some(schema)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), ConfigError> {
    let parent = path.parent().ok_or(ConfigError::DataDirectoryNotAbsolute)?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("devd"),
        Uuid::new_v4()
    ));
    let result = (|| -> Result<(), ConfigError> {
        fs::write(
            &temporary,
            format!("{}\n", serde_json::to_string_pretty(value)?),
        )?;
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
