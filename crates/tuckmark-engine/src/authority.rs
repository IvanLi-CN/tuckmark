use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{
    Serialize, Serializer,
    ser::{SerializeMap, SerializeSeq},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    ContractError, DATA_DIRECTORY_MANIFEST_SCHEMA, DEVD_DATA_TRANSACTION_SCHEMA,
    DEVD_LIVE_LOCK_SCHEMA, DEVD_OWNER_SCHEMA, DataDirectoryManifest, DevdDataArchive,
    DevdDataState, DevdDataTransaction, DevdLiveLock, DevdOwner, InventoryAdjustment,
    InventoryMaterial, InventorySnapshot, JsonWrite, RevisionEvent, RuntimeSnapshot,
    TemplateRecord, TemplateVersion, WorkingCopyRecord, canonical_json_bytes,
    normalize_legacy_tree_value, validate_referential_integrity, validate_relative_path,
};
use uuid::Uuid;

use crate::archive_codec::{
    ArchiveCodecError, ArchiveZipInput, DirectoryTreeArchive, decode_archive_zip,
};

const CONTROL_DIRECTORY: &str = ".tuckmark";
const LIVE_LOCK_NAME: &str = "devd-live.lock";
const OWNER_NAME: &str = "devd-owner.json";
const STATE_NAME: &str = "state.json";
const TRANSACTIONS_DIRECTORY: &str = "transactions";

#[derive(Debug, Error)]
pub enum DataAuthorityError {
    #[error("data authority I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("data authority contract failed: {0}")]
    Contract(#[from] ContractError),
    #[error("data directory is already owned by a live process")]
    LiveOwner,
    #[error("data directory live lock is malformed")]
    InvalidLiveLock,
    #[error("stale-lock recovery is already in progress")]
    RecoveryInProgress,
    #[error("revision conflict: expected {expected}, actual {actual}")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("data authority lock was poisoned")]
    Poisoned,
    #[error("invalid archive or data path: {0}")]
    InvalidPath(String),
    #[error("JSON decoding failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("archive merge conflicts: {0}")]
    ArchiveConflicts(String),
    #[error("data authority journal is corrupt: {0}")]
    CorruptTransaction(String),
    #[error("archive content changed after inspection")]
    ArchiveContentChanged,
    #[error("archive ZIP codec failed: {0}")]
    ArchiveCodec(#[from] ArchiveCodecError),
}

pub trait ProcessProbe: Send + Sync {
    fn is_alive(&self, pid: u32) -> bool;
    fn start_identity(&self, pid: u32) -> Option<String>;
}

#[derive(Debug, Default)]
pub struct SystemProcessProbe;

impl ProcessProbe for SystemProcessProbe {
    fn is_alive(&self, pid: u32) -> bool {
        #[cfg(unix)]
        {
            // kill(pid, 0) does not signal the process. EPERM still proves a live process.
            let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
            if result == 0 {
                return true;
            }
            io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
        }
        #[cfg(not(unix))]
        {
            pid == std::process::id()
        }
    }

    fn start_identity(&self, pid: u32) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| process_start_identity_from_stat(&stat))
        }
        #[cfg(target_os = "macos")]
        {
            macos_process_start_identity(pid)
        }
        #[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
        {
            let _ = pid;
            None
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            None
        }
    }
}

pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> String {
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
    }
}

#[derive(Clone)]
pub struct DataAuthorityOptions {
    pub process_probe: Arc<dyn ProcessProbe>,
    pub clock: Arc<dyn Clock>,
}

impl Default for DataAuthorityOptions {
    fn default() -> Self {
        Self {
            process_probe: Arc::new(SystemProcessProbe),
            clock: Arc::new(SystemClock),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CommitRequest {
    pub expected_revision: u64,
    pub writes: Vec<JsonWrite>,
    pub deletes: Vec<String>,
    pub domains: Vec<String>,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveImportMode {
    Merge,
    Replace,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveSummary {
    pub templates: usize,
    pub versions: usize,
    pub working_copies: usize,
    pub materials: usize,
    pub adjustments: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveInspection {
    pub archive_hash: String,
    pub summary: ArchiveSummary,
    pub conflicts: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct BackupRecord {
    pub name: String,
    pub path: PathBuf,
    pub revision: u64,
}

#[derive(Clone, Debug)]
pub struct ArchiveImportResult {
    pub revision: u64,
    pub inspection: ArchiveInspection,
}

struct AuthorityInner {
    root: PathBuf,
    lock_path: PathBuf,
    lock: DevdLiveLock,
    options: DataAuthorityOptions,
    mutation: Mutex<()>,
}

impl Drop for AuthorityInner {
    fn drop(&mut self) {
        let Ok(raw) = fs::read_to_string(&self.lock_path) else {
            return;
        };
        let Ok(current) = serde_json::from_str::<DevdLiveLock>(&raw) else {
            return;
        };
        if same_lock(&current, &self.lock) {
            let _ = fs::remove_file(&self.lock_path);
        }
    }
}

/// The single writer for a Tuckmark data directory.
///
/// Clones share one live lock and one in-process mutation queue. The last clone
/// releases only the lock token it originally claimed.
#[derive(Clone)]
pub struct DataAuthority {
    inner: Arc<AuthorityInner>,
}

impl DataAuthority {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, DataAuthorityError> {
        Self::open_with_options(root, DataAuthorityOptions::default())
    }

    pub fn open_with_options(
        root: impl AsRef<Path>,
        options: DataAuthorityOptions,
    ) -> Result<Self, DataAuthorityError> {
        create_dir_all_durable(root.as_ref())?;
        let root = fs::canonicalize(root.as_ref())?;
        let transactions = resolve_path_within_root(
            &root,
            &format!("{CONTROL_DIRECTORY}/{TRANSACTIONS_DIRECTORY}"),
        )?;
        create_dir_all_durable(&transactions)?;

        let owner_path =
            resolve_path_within_root(&root, &format!("{CONTROL_DIRECTORY}/{OWNER_NAME}"))?;
        ensure_owner(&owner_path, &options)?;
        let lock_path =
            resolve_path_within_root(&root, &format!("{CONTROL_DIRECTORY}/{LIVE_LOCK_NAME}"))?;
        let lock = claim_live_lock(&lock_path, &options)?;
        let authority = Self {
            inner: Arc::new(AuthorityInner {
                root,
                lock_path,
                lock,
                options,
                mutation: Mutex::new(()),
            }),
        };
        authority.recover_transactions()?;
        Ok(authority)
    }

    pub fn root(&self) -> &Path {
        &self.inner.root
    }

    pub fn revision(&self) -> Result<u64, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        self.read_revision_locked()
    }

    pub fn read_json(&self, relative_path: &str) -> Result<Option<Value>, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        let path = self.resolve_relative(relative_path)?;
        read_json_optional(&path)
    }

    pub fn recover_transactions(&self) -> Result<(), DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()
    }

    pub fn commit(&self, request: CommitRequest) -> Result<RevisionEvent, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.commit_locked(request)
    }

    pub fn export_archive(&self) -> Result<DevdDataArchive, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        self.build_archive_locked()
    }

    /// Exports the portable `tuckmark.runtime-export-archive.v1` directory-tree ZIP.
    ///
    /// The DEVD JSON archive remains available through [`Self::export_archive`] for
    /// in-process consumers; durable manual and protection snapshots are portable ZIPs.
    pub fn export_archive_zip(&self) -> Result<Vec<u8>, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        let archive = self.build_archive_locked()?;
        Ok(DirectoryTreeArchive::from_devd_data_archive(&archive)?.encode_zip()?)
    }

    pub fn inspect_archive(
        &self,
        archive: &DevdDataArchive,
    ) -> Result<ArchiveInspection, DataAuthorityError> {
        archive.validate()?;
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        self.inspect_archive_locked(archive)
    }

    /// Inspects a portable directory-tree or legacy single-snapshot ZIP archive.
    pub fn inspect_archive_zip(
        &self,
        archive_zip: &[u8],
    ) -> Result<ArchiveInspection, DataAuthorityError> {
        let archive = archive_from_zip(archive_zip)?;
        self.inspect_archive(&archive)
    }

    pub fn create_backup(
        &self,
        expected_revision: u64,
    ) -> Result<BackupRecord, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        let archive = self.build_archive_locked()?;
        let actual = self.read_revision_locked()?;
        if actual != expected_revision {
            return Err(DataAuthorityError::RevisionConflict {
                expected: expected_revision,
                actual,
            });
        }
        let name = format!("{}-{}.zip", self.inner.options.clock.now(), Uuid::new_v4());
        let relative_path = format!("backups/manual/{name}");
        write_archive_zip(&self.resolve_relative(&relative_path)?, &archive)?;
        let event = self.commit_locked(CommitRequest {
            expected_revision,
            writes: vec![],
            deletes: vec![],
            domains: vec!["archive".into()],
            reason: "backup-created".into(),
        })?;
        Ok(BackupRecord {
            name,
            path: self.resolve_relative(&relative_path)?,
            revision: event.revision,
        })
    }

    pub fn import_archive(
        &self,
        archive: &DevdDataArchive,
        expected_archive_hash: &str,
        mode: ArchiveImportMode,
        expected_revision: u64,
    ) -> Result<ArchiveImportResult, DataAuthorityError> {
        archive.validate()?;
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        let actual = self.read_revision_locked()?;
        if actual != expected_revision {
            return Err(DataAuthorityError::RevisionConflict {
                expected: expected_revision,
                actual,
            });
        }
        let inspection = self.inspect_archive_locked(archive)?;
        if inspection.archive_hash != expected_archive_hash {
            return Err(DataAuthorityError::ArchiveContentChanged);
        }
        if mode == ArchiveImportMode::Merge && !inspection.conflicts.is_empty() {
            return Err(DataAuthorityError::ArchiveConflicts(
                inspection.conflicts.join(", "),
            ));
        }
        let current = self.build_archive_locked()?;
        let next = match mode {
            ArchiveImportMode::Replace => archive.clone(),
            ArchiveImportMode::Merge => merge_archives(&current, archive),
        };
        next.validate()?;
        let writes = archive_writes(&next)?;
        let protection_relative_path = format!(
            "backups/protection/{}-{}.zip",
            self.inner.options.clock.now(),
            Uuid::new_v4()
        );
        let deletes = match mode {
            ArchiveImportMode::Merge => vec![],
            ArchiveImportMode::Replace => {
                let desired = writes
                    .iter()
                    .map(|write| write.relative_path.as_str())
                    .collect::<std::collections::BTreeSet<_>>();
                self.known_data_paths_locked()?
                    .into_iter()
                    .filter(|path| !desired.contains(path.as_str()))
                    .collect()
            }
        };
        let mut deletes = deletes;
        deletes.extend(self.protection_snapshot_deletions_locked()?);
        write_archive_zip(&self.resolve_relative(&protection_relative_path)?, &current)?;
        let event = self.commit_locked(CommitRequest {
            expected_revision,
            writes,
            deletes,
            domains: vec!["templates".into(), "inventory".into(), "archive".into()],
            reason: match mode {
                ArchiveImportMode::Merge => "archive-merge".into(),
                ArchiveImportMode::Replace => "archive-replace".into(),
            },
        })?;
        Ok(ArchiveImportResult {
            revision: event.revision,
            inspection,
        })
    }

    /// Imports a portable directory-tree or legacy single-snapshot ZIP archive after
    /// verifying the inspection hash returned by [`Self::inspect_archive_zip`].
    pub fn import_archive_zip(
        &self,
        archive_zip: &[u8],
        expected_archive_hash: &str,
        mode: ArchiveImportMode,
        expected_revision: u64,
    ) -> Result<ArchiveImportResult, DataAuthorityError> {
        let archive = archive_from_zip(archive_zip)?;
        self.import_archive(&archive, expected_archive_hash, mode, expected_revision)
    }

    fn commit_locked(&self, request: CommitRequest) -> Result<RevisionEvent, DataAuthorityError> {
        self.recover_transactions_locked()?;
        let actual = self.read_revision_locked()?;
        if actual != request.expected_revision {
            return Err(DataAuthorityError::RevisionConflict {
                expected: request.expected_revision,
                actual,
            });
        }

        let revision = actual + 1;
        let event = RevisionEvent::new(revision, request.domains, request.reason);
        let transaction =
            DevdDataTransaction::new(revision, request.writes, request.deletes, event);
        transaction.validate()?;
        validate_managed_transaction_paths(&transaction)?;
        self.validate_transaction_integrity_locked(&transaction)?;
        let journal_path = self
            .transactions_dir()?
            .join(format!("{revision}-{}.json", Uuid::new_v4()));
        atomic_write_json(&journal_path, &transaction)?;
        self.apply_transaction_locked(&transaction)?;
        fs::remove_file(journal_path)?;
        Ok(transaction.event)
    }

    pub fn list_json_files(
        &self,
        relative_directory: &str,
    ) -> Result<Vec<PathBuf>, DataAuthorityError> {
        let _guard = self.lock_mutation()?;
        self.recover_transactions_locked()?;
        list_json_files(
            &self.inner.root,
            &self.resolve_relative(relative_directory)?,
        )
    }

    fn lock_mutation(&self) -> Result<MutexGuard<'_, ()>, DataAuthorityError> {
        self.inner
            .mutation
            .lock()
            .map_err(|_| DataAuthorityError::Poisoned)
    }

    fn transactions_dir(&self) -> Result<PathBuf, DataAuthorityError> {
        self.resolve_relative(&format!("{CONTROL_DIRECTORY}/{TRANSACTIONS_DIRECTORY}"))
    }

    fn resolve_relative(&self, relative_path: &str) -> Result<PathBuf, DataAuthorityError> {
        resolve_path_within_root(&self.inner.root, relative_path)
    }

    fn read_revision_locked(&self) -> Result<u64, DataAuthorityError> {
        let state_path = self.resolve_relative(&format!("{CONTROL_DIRECTORY}/{STATE_NAME}"))?;
        let Some(value) = read_json_optional(&state_path)? else {
            return Ok(0);
        };
        let state: DevdDataState = serde_json::from_value(value)?;
        if state.schema != tuckmark_contracts::DEVD_DATA_STATE_SCHEMA {
            return Ok(0);
        }
        state.validate()?;
        Ok(state.revision)
    }

    fn recover_transactions_locked(&self) -> Result<(), DataAuthorityError> {
        let transactions_dir = self.transactions_dir()?;
        create_dir_all_durable(&transactions_dir)?;
        let state_path = self.resolve_relative(&format!("{CONTROL_DIRECTORY}/{STATE_NAME}"))?;
        let state_was_missing = !state_path.exists();
        let mut journals = Vec::new();
        for journal_path in list_json_files(&self.inner.root, &transactions_dir)? {
            let value = read_json_required(&journal_path)?;
            let transaction: DevdDataTransaction = serde_json::from_value(value)?;
            if transaction.schema != DEVD_DATA_TRANSACTION_SCHEMA {
                return Err(DataAuthorityError::Contract(ContractError::Validation(
                    "invalid DEVD transaction schema".into(),
                )));
            }
            transaction.validate()?;
            validate_managed_transaction_paths(&transaction)?;
            journals.push((journal_path, transaction));
        }
        journals.sort_by(|(left_path, left), (right_path, right)| {
            left.revision
                .cmp(&right.revision)
                .then_with(|| left_path.cmp(right_path))
        });
        for pair in journals.windows(2) {
            if pair[0].1.revision == pair[1].1.revision {
                return Err(DataAuthorityError::CorruptTransaction(format!(
                    "duplicate revision {}",
                    pair[0].1.revision
                )));
            }
        }
        let allow_isolated_legacy_gap = state_was_missing
            && journals.len() == 1
            && self.known_data_paths_locked()?.is_empty()
            && journal_revision_matches_filename(&journals[0].0, journals[0].1.revision);
        for (journal_path, transaction) in journals {
            let current = self.read_revision_locked()?;
            match current.cmp(&transaction.revision) {
                std::cmp::Ordering::Greater => {}
                // The state write is the transaction commit point. A matching journal is
                // therefore already applied and only needs durable cleanup.
                std::cmp::Ordering::Equal => {}
                std::cmp::Ordering::Less => {
                    let expected = current.saturating_add(1);
                    if transaction.revision != expected && !allow_isolated_legacy_gap {
                        return Err(DataAuthorityError::CorruptTransaction(format!(
                            "revision {} follows {current}, expected {expected}",
                            transaction.revision
                        )));
                    }
                    self.validate_transaction_integrity_locked(&transaction)?;
                    self.apply_transaction_locked(&transaction)?;
                }
            }
            fs::remove_file(journal_path)?;
        }
        Ok(())
    }

    fn apply_transaction_locked(
        &self,
        transaction: &DevdDataTransaction,
    ) -> Result<(), DataAuthorityError> {
        for write in &transaction.writes {
            let path = self.resolve_relative(&write.relative_path)?;
            atomic_write_json(&path, &write.value)?;
        }
        for relative_path in &transaction.deletes {
            let path = self.resolve_relative(relative_path)?;
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        let state = DevdDataState::new(transaction.revision, self.inner.options.clock.now());
        let state_path = self.resolve_relative(&format!("{CONTROL_DIRECTORY}/{STATE_NAME}"))?;
        atomic_write_json(&state_path, &state)?;
        self.refresh_manifest_locked()
    }

    fn validate_transaction_integrity_locked(
        &self,
        transaction: &DevdDataTransaction,
    ) -> Result<(), DataAuthorityError> {
        let mut files = BTreeMap::new();
        for directory in [
            "templates",
            "drafts",
            "inventory/materials",
            "inventory/adjustments",
        ] {
            collect_json_tree(&self.inner.root, directory, &mut files)?;
        }
        for relative_path in &transaction.deletes {
            files.remove(relative_path);
        }
        for write in &transaction.writes {
            files.insert(write.relative_path.clone(), write.value.clone());
        }

        let mut templates = Vec::new();
        let mut versions = Vec::new();
        let mut working_copies = Vec::new();
        let mut materials = Vec::new();
        let mut adjustments = Vec::new();
        for (path, value) in files {
            let value = normalize_legacy_tree_value(value);
            if path.starts_with("templates/") && path.ends_with("/template.json") {
                templates.push(serde_json::from_value::<TemplateRecord>(value)?);
            } else if path.starts_with("templates/") && path.contains("/versions/") {
                versions.push(serde_json::from_value::<TemplateVersion>(value)?);
            } else if (path.starts_with("templates/") && path.ends_with("/working-copy.json"))
                || path.starts_with("drafts/")
            {
                working_copies.push(serde_json::from_value::<WorkingCopyRecord>(value)?);
            } else if path.starts_with("inventory/materials/") {
                materials.push(serde_json::from_value::<InventoryMaterial>(value)?);
            } else if path.starts_with("inventory/adjustments/") {
                adjustments.push(serde_json::from_value::<InventoryAdjustment>(value)?);
            }
        }
        validate_referential_integrity(
            &templates,
            &versions,
            &working_copies,
            &materials,
            &adjustments,
        )?;
        Ok(())
    }

    fn build_archive_locked(&self) -> Result<DevdDataArchive, DataAuthorityError> {
        let mut files = BTreeMap::new();
        for directory in [
            "templates",
            "drafts",
            "inventory/materials",
            "inventory/adjustments",
        ] {
            collect_json_tree(&self.inner.root, directory, &mut files)?;
        }
        let mut templates = Vec::new();
        let mut versions = Vec::new();
        let mut working_copies = Vec::new();
        let mut materials = Vec::new();
        let mut adjustments = Vec::new();
        for (path, value) in files {
            let value = normalize_legacy_tree_value(value);
            if path.starts_with("templates/") && path.ends_with("/template.json") {
                templates.push(serde_json::from_value::<TemplateRecord>(value)?);
            } else if path.starts_with("templates/") && path.contains("/versions/") {
                versions.push(serde_json::from_value::<TemplateVersion>(value)?);
            } else if (path.starts_with("templates/") && path.ends_with("/working-copy.json"))
                || path.starts_with("drafts/")
            {
                working_copies.push(serde_json::from_value::<WorkingCopyRecord>(value)?);
            } else if path.starts_with("inventory/materials/") {
                materials.push(serde_json::from_value::<InventoryMaterial>(value)?);
            } else if path.starts_with("inventory/adjustments/") {
                adjustments.push(serde_json::from_value::<InventoryAdjustment>(value)?);
            }
        }
        templates.sort_by(|left, right| left.id.cmp(&right.id));
        versions.sort_by(|left, right| left.id.cmp(&right.id));
        working_copies.sort_by(|left, right| left.source_key.cmp(&right.source_key));
        materials.sort_by(|left, right| left.id.cmp(&right.id));
        adjustments.sort_by(|left, right| left.id.cmp(&right.id));
        let snapshot_updated_at = read_json_optional(&self.resolve_relative("manifest.json")?)?
            .and_then(|value| serde_json::from_value::<DataDirectoryManifest>(value).ok())
            .and_then(|manifest| manifest.snapshot_updated_at);
        let exported_at = self.inner.options.clock.now();
        let archive = DevdDataArchive {
            schema: tuckmark_contracts::DEVD_DATA_ARCHIVE_SCHEMA.into(),
            exported_at: exported_at.clone(),
            runtime: RuntimeSnapshot {
                schema: tuckmark_contracts::RUNTIME_EXPORT_SCHEMA.into(),
                exported_at,
                snapshot_updated_at,
                settings: read_json_optional(
                    &self.resolve_relative("settings/app-settings.json")?,
                )?
                .unwrap_or_else(|| Value::Object(Default::default())),
                templates,
                versions,
                working_copies,
                extra: Default::default(),
            },
            inventory: InventorySnapshot {
                materials,
                adjustments,
                extra: Default::default(),
            },
            extra: Default::default(),
        };
        archive.validate()?;
        Ok(archive)
    }

    fn inspect_archive_locked(
        &self,
        archive: &DevdDataArchive,
    ) -> Result<ArchiveInspection, DataAuthorityError> {
        let current = self.build_archive_locked()?;
        Ok(ArchiveInspection {
            archive_hash: archive_hash(archive)?,
            summary: archive_summary(archive),
            conflicts: archive_conflicts(archive, &current),
        })
    }

    fn known_data_paths_locked(&self) -> Result<Vec<String>, DataAuthorityError> {
        let mut files = BTreeMap::new();
        for directory in [
            "settings",
            "templates",
            "drafts",
            "inventory/materials",
            "inventory/adjustments",
        ] {
            collect_json_tree(&self.inner.root, directory, &mut files)?;
        }
        Ok(files.into_keys().collect())
    }

    fn protection_snapshot_deletions_locked(&self) -> Result<Vec<String>, DataAuthorityError> {
        const MAX_PROTECTION_SNAPSHOTS: usize = 20;
        let directory = self.inner.root.join("backups/protection");
        let mut snapshots = list_backup_files(&self.inner.root, &directory)?
            .into_iter()
            .map(|path| {
                let modified = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                (path, modified)
            })
            .collect::<Vec<_>>();
        snapshots.sort_by(|(left_path, left_time), (right_path, right_time)| {
            right_time
                .cmp(left_time)
                .then_with(|| right_path.cmp(left_path))
        });
        Ok(snapshots
            .into_iter()
            .skip(MAX_PROTECTION_SNAPSHOTS.saturating_sub(1))
            .filter_map(|(path, _)| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| format!("backups/protection/{name}"))
            })
            .collect())
    }

    fn refresh_manifest_locked(&self) -> Result<(), DataAuthorityError> {
        let manifest_path = self.resolve_relative("manifest.json")?;
        let existing = read_json_optional(&manifest_path)?
            .and_then(|value| serde_json::from_value::<DataDirectoryManifest>(value).ok());
        let mut manifest = existing.unwrap_or_else(|| {
            DataDirectoryManifest::new("runtime-sync", self.inner.options.clock.now())
        });
        manifest.schema = DATA_DIRECTORY_MANIFEST_SCHEMA.into();
        manifest.generated_at = self.inner.options.clock.now();
        manifest.snapshot_updated_at = snapshot_updated_at(&self.inner.root)?;
        manifest.counts.templates = count_template_records(&self.inner.root)?;
        manifest.counts.versions = count_template_versions(&self.inner.root)?;
        manifest.counts.working_copies = count_working_copies(&self.inner.root)?;
        manifest.counts.materials = list_json_files(
            &self.inner.root,
            &self.inner.root.join("inventory/materials"),
        )?
        .len() as u64;
        manifest.counts.adjustments = list_json_files(
            &self.inner.root,
            &self.inner.root.join("inventory/adjustments"),
        )?
        .len() as u64;
        manifest.validate()?;
        atomic_write_json(&manifest_path, &manifest)
    }
}

fn resolve_path_within_root(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, DataAuthorityError> {
    if relative_path.contains('\\') {
        return Err(DataAuthorityError::InvalidPath(relative_path.into()));
    }
    validate_relative_path(relative_path)?;
    let candidate = root.join(relative_path);
    if !candidate.starts_with(root) {
        return Err(DataAuthorityError::InvalidPath(relative_path.into()));
    }

    // Canonicalize the deepest existing ancestor before creating or reading a
    // descendant. This catches an in-tree symlink that would otherwise direct
    // a managed operation outside the authority root.
    let mut ancestor = candidate.as_path();
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(_) => {
                let resolved = fs::canonicalize(ancestor)
                    .map_err(|_| DataAuthorityError::InvalidPath(relative_path.into()))?;
                if !resolved.starts_with(root) {
                    return Err(DataAuthorityError::InvalidPath(relative_path.into()));
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| DataAuthorityError::InvalidPath(relative_path.into()))?;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn journal_revision_matches_filename(path: &Path, revision: u64) -> bool {
    path.file_stem()
        .and_then(|name| name.to_str())
        .and_then(|name| name.split_once('-'))
        .is_some_and(|(prefix, _)| prefix == revision.to_string())
}

#[cfg(target_os = "linux")]
fn process_start_identity_from_stat(stat: &str) -> Option<String> {
    // `/proc/<pid>/stat` fields one and two are pid and a parenthesized command.
    // Field 22 is process start time, which remains stable while CPU/state fields change.
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(19)
        .map(str::to_owned)
}

#[cfg(target_os = "macos")]
const PROC_PIDTBSDINFO: libc::c_int = 3;

#[cfg(target_os = "macos")]
#[repr(C)]
struct ProcBsdInfo {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: libc::uid_t,
    pbi_gid: libc::gid_t,
    pbi_ruid: libc::uid_t,
    pbi_rgid: libc::gid_t,
    pbi_svuid: libc::uid_t,
    pbi_svgid: libc::gid_t,
    pbi_rfu_1: u32,
    pbi_comm: [libc::c_char; 16],
    pbi_name: [libc::c_char; 32],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidinfo(
        pid: libc::c_int,
        flavor: libc::c_int,
        arg: u64,
        buffer: *mut libc::c_void,
        buffersize: libc::c_int,
    ) -> libc::c_int;
}

#[cfg(target_os = "macos")]
fn macos_process_start_identity(pid: u32) -> Option<String> {
    let mut info = std::mem::MaybeUninit::<ProcBsdInfo>::zeroed();
    let expected_size = std::mem::size_of::<ProcBsdInfo>();
    let written = unsafe {
        proc_pidinfo(
            pid as libc::c_int,
            PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            expected_size.try_into().ok()?,
        )
    };
    if written < expected_size.try_into().ok()? {
        return None;
    }
    let info = unsafe { info.assume_init() };
    macos_lstart_identity(info.pbi_start_tvsec)
}

#[cfg(target_os = "macos")]
fn macos_lstart_identity(seconds: u64) -> Option<String> {
    let seconds: libc::time_t = seconds.try_into().ok()?;
    let mut local_time = std::mem::MaybeUninit::<libc::tm>::zeroed();
    if unsafe { libc::localtime_r(&seconds, local_time.as_mut_ptr()) }.is_null() {
        return None;
    }
    let local_time = unsafe { local_time.assume_init() };
    let mut output = [0_i8; 64];
    let written = unsafe {
        libc::strftime(
            output.as_mut_ptr(),
            output.len(),
            c"%a %b %e %T %Y".as_ptr(),
            &local_time,
        )
    };
    if written == 0 {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.as_ptr().cast::<u8>(), written) };
    String::from_utf8(bytes.to_vec()).ok()
}

fn ensure_owner(path: &Path, options: &DataAuthorityOptions) -> Result<(), DataAuthorityError> {
    match create_new_json(
        path,
        &DevdOwner {
            schema: DEVD_OWNER_SCHEMA.into(),
            claimed_at: options.clock.now(),
            extra: Default::default(),
        },
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn create_lock(options: &DataAuthorityOptions) -> DevdLiveLock {
    let pid = std::process::id();
    DevdLiveLock {
        schema: DEVD_LIVE_LOCK_SCHEMA.into(),
        pid,
        token: Uuid::new_v4().to_string(),
        claimed_at: options.clock.now(),
        process_start_identity: options.process_probe.start_identity(pid),
        extra: Default::default(),
    }
}

fn claim_live_lock(
    lock_path: &Path,
    options: &DataAuthorityOptions,
) -> Result<DevdLiveLock, DataAuthorityError> {
    let requested = create_lock(options);
    for _ in 0..4 {
        let recovery_path = lock_path.with_extension("lock.recovery");
        if recovery_path.exists() && !reclaim_stale_recovery_lock(&recovery_path, options)? {
            return Err(DataAuthorityError::RecoveryInProgress);
        }
        match create_new_json(lock_path, &requested) {
            Ok(()) => return Ok(requested),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let existing = read_lock(lock_path)?;
        if lock_owned_by_live_process(&existing, options) {
            return Err(DataAuthorityError::LiveOwner);
        }
        if !retire_stale_lock(lock_path, &existing, options)? {
            continue;
        }
    }
    Err(DataAuthorityError::RecoveryInProgress)
}

fn read_lock(path: &Path) -> Result<DevdLiveLock, DataAuthorityError> {
    let value = read_json_required(path).map_err(|error| match error {
        DataAuthorityError::Json(_) => DataAuthorityError::InvalidLiveLock,
        error => error,
    })?;
    let lock: DevdLiveLock =
        serde_json::from_value(value).map_err(|_| DataAuthorityError::InvalidLiveLock)?;
    lock.validate()
        .map_err(|_| DataAuthorityError::InvalidLiveLock)?;
    Ok(lock)
}

fn lock_owned_by_live_process(lock: &DevdLiveLock, options: &DataAuthorityOptions) -> bool {
    if !options.process_probe.is_alive(lock.pid) {
        return false;
    }
    match (
        lock.process_start_identity.as_deref(),
        options.process_probe.start_identity(lock.pid),
    ) {
        (Some(expected), Some(actual)) => expected == actual,
        _ => true,
    }
}

fn same_lock(left: &DevdLiveLock, right: &DevdLiveLock) -> bool {
    left.pid == right.pid
        && left.token == right.token
        && left.claimed_at == right.claimed_at
        && left.process_start_identity == right.process_start_identity
}

fn reclaim_stale_recovery_lock(
    recovery_path: &Path,
    options: &DataAuthorityOptions,
) -> Result<bool, DataAuthorityError> {
    let recovery = read_lock(recovery_path)?;
    if lock_owned_by_live_process(&recovery, options) {
        return Ok(false);
    }
    let retired = recovery_path.with_extension(format!("recovery.stale-{}", Uuid::new_v4()));
    match fs::rename(recovery_path, &retired) {
        Ok(()) => {
            let _ = fs::remove_file(retired);
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn retire_stale_lock(
    lock_path: &Path,
    expected: &DevdLiveLock,
    options: &DataAuthorityOptions,
) -> Result<bool, DataAuthorityError> {
    let recovery_path = lock_path.with_extension("lock.recovery");
    let recovery = create_lock(options);
    match create_new_json(&recovery_path, &recovery) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error.into()),
    }
    let result = (|| {
        let current = match read_lock(lock_path) {
            Ok(lock) => lock,
            Err(DataAuthorityError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(true);
            }
            Err(error) => return Err(error),
        };
        if !same_lock(&current, expected) || lock_owned_by_live_process(&current, options) {
            return Ok(false);
        }
        let retired = lock_path.with_extension(format!("lock.stale-{}", Uuid::new_v4()));
        fs::rename(lock_path, &retired)?;
        fs::remove_file(retired)?;
        Ok(true)
    })();
    if let Ok(current) = read_lock(&recovery_path)
        && same_lock(&current, &recovery)
    {
        let _ = fs::remove_file(&recovery_path);
    }
    result
}

fn create_new_json<T: serde::Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        create_dir_all_durable(parent)?;
    }
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(&canonical_json_bytes(value).map_err(contract_to_io)?)?;
    file.sync_all()?;
    sync_parent_directory(path)?;
    Ok(())
}

fn atomic_write_json<T: serde::Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), DataAuthorityError> {
    let parent = path
        .parent()
        .ok_or_else(|| DataAuthorityError::InvalidPath(path.display().to_string()))?;
    create_dir_all_durable(parent)?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("value"),
        Uuid::new_v4()
    ));
    let result = (|| -> Result<(), DataAuthorityError> {
        let mut file = File::create(&temporary)?;
        file.write_all(&canonical_json_bytes(value)?)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), DataAuthorityError> {
    let parent = path
        .parent()
        .ok_or_else(|| DataAuthorityError::InvalidPath(path.display().to_string()))?;
    create_dir_all_durable(parent)?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("value"),
        Uuid::new_v4()
    ));
    let result = (|| -> Result<(), DataAuthorityError> {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn create_dir_all_durable(directory: &Path) -> io::Result<()> {
    let mut missing = Vec::new();
    let mut current = directory;
    loop {
        match fs::metadata(current) {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(current);
                current = current.parent().ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!(
                            "directory has no existing ancestor: {}",
                            directory.display()
                        ),
                    )
                })?;
            }
            Err(error) => return Err(error),
        }
    }

    fs::create_dir_all(directory)?;
    for created in missing {
        sync_directory(created)?;
        sync_parent_directory(created)?;
    }
    Ok(())
}

fn sync_parent_directory(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(parent) => sync_directory(parent),
        None => Ok(()),
    }
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> io::Result<()> {
    Ok(())
}

fn contract_to_io(error: ContractError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

fn read_json_optional(path: &Path) -> Result<Option<Value>, DataAuthorityError> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(serde_json::from_str(&raw)?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_json_required(path: &Path) -> Result<Value, DataAuthorityError> {
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

fn list_json_files(root: &Path, directory: &Path) -> Result<Vec<PathBuf>, DataAuthorityError> {
    ensure_scan_directory_safe(root, directory)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (entry.file_type().ok()?.is_file() && path.extension().is_some_and(|ext| ext == "json"))
                .then_some(path)
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn list_backup_files(root: &Path, directory: &Path) -> Result<Vec<PathBuf>, DataAuthorityError> {
    ensure_scan_directory_safe(root, directory)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (entry.file_type().ok()?.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension == "zip" || extension == "json"))
            .then_some(path)
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn list_directories(root: &Path, directory: &Path) -> Result<Vec<PathBuf>, DataAuthorityError> {
    ensure_scan_directory_safe(root, directory)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut directories = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_type().ok()?.is_dir().then_some(entry.path()))
        .collect::<Vec<_>>();
    directories.sort();
    Ok(directories)
}

fn ensure_scan_directory_safe(root: &Path, directory: &Path) -> Result<(), DataAuthorityError> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| DataAuthorityError::InvalidPath(directory.display().to_string()))?;
    let relative = relative.to_string_lossy();
    let resolved = resolve_path_within_root(root, &relative)?;
    match fs::symlink_metadata(&resolved) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(DataAuthorityError::InvalidPath(relative.into_owned()))
        }
        Ok(metadata) if !metadata.is_dir() => {
            Err(DataAuthorityError::InvalidPath(relative.into_owned()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn collect_json_tree(
    root: &Path,
    relative_prefix: &str,
    files: &mut BTreeMap<String, Value>,
) -> Result<(), DataAuthorityError> {
    let directory = resolve_path_within_root(root, relative_prefix)?;
    if fs::symlink_metadata(&directory)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(DataAuthorityError::InvalidPath(relative_prefix.into()));
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative_path = format!("{relative_prefix}/{name}");
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_json_tree(root, &relative_path, files)?;
        } else if file_type.is_file() && entry.path().extension().is_some_and(|ext| ext == "json") {
            let path = resolve_path_within_root(root, &relative_path)?;
            files.insert(relative_path, read_json_required(&path)?);
        }
    }
    Ok(())
}

fn snapshot_updated_at(root: &Path) -> Result<Option<String>, DataAuthorityError> {
    let mut timestamps = Vec::new();
    let settings_path = resolve_path_within_root(root, "settings/app-settings.json")?;
    if let Some(settings) = read_json_optional(&settings_path)? {
        collect_timestamp(&settings, "updatedAt", &mut timestamps);
    }
    let mut files = BTreeMap::new();
    for directory in ["templates", "drafts"] {
        collect_json_tree(root, directory, &mut files)?;
    }
    for (path, value) in files {
        let timestamp_field = if path.starts_with("templates/") && path.contains("/versions/") {
            Some("createdAt")
        } else if (path.starts_with("templates/") && path.ends_with("/template.json"))
            || (path.starts_with("templates/") && path.ends_with("/working-copy.json"))
            || path.starts_with("drafts/")
        {
            Some("updatedAt")
        } else {
            None
        };
        if let Some(timestamp_field) = timestamp_field {
            collect_timestamp(&value, timestamp_field, &mut timestamps);
        }
    }
    Ok(timestamps.into_iter().max())
}

fn collect_timestamp(value: &Value, field: &str, timestamps: &mut Vec<String>) {
    if let Some(timestamp) = value
        .as_object()
        .and_then(|object| object.get(field))
        .and_then(Value::as_str)
        .filter(|timestamp| !timestamp.is_empty())
    {
        timestamps.push(timestamp.into());
    }
}

fn validate_managed_transaction_paths(
    transaction: &DevdDataTransaction,
) -> Result<(), DataAuthorityError> {
    for path in transaction
        .writes
        .iter()
        .map(|write| write.relative_path.as_str())
        .chain(transaction.deletes.iter().map(String::as_str))
    {
        if !is_managed_data_path(path) {
            return Err(DataAuthorityError::InvalidPath(path.into()));
        }
    }
    Ok(())
}

fn is_managed_data_path(path: &str) -> bool {
    [
        "settings/",
        "templates/",
        "drafts/",
        "inventory/materials/",
        "inventory/adjustments/",
        "backups/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
}

fn archive_from_zip(archive_zip: &[u8]) -> Result<DevdDataArchive, DataAuthorityError> {
    match decode_archive_zip(archive_zip)? {
        ArchiveZipInput::DirectoryTree(archive) => Ok(archive.to_devd_data_archive()?),
        ArchiveZipInput::LegacySnapshot(archive) => Ok(archive),
    }
}

fn write_archive_zip(path: &Path, archive: &DevdDataArchive) -> Result<(), DataAuthorityError> {
    let bytes = DirectoryTreeArchive::from_devd_data_archive(archive)?.encode_zip()?;
    atomic_write_bytes(path, &bytes)
}

fn archive_hash(archive: &DevdDataArchive) -> Result<String, DataAuthorityError> {
    let mut hasher = Sha256::new();
    // The existing runtime hashes JSON.stringify() after its Zod schemas rebuild
    // the archive objects. These serializers reproduce that schema field order;
    // durable file JSON remains independently canonical and pretty-printed.
    hasher.update(serde_json::to_vec(&TypeScriptArchive(archive))?);
    Ok(format!("{:x}", hasher.finalize()))
}

struct TypeScriptArchive<'a>(&'a DevdDataArchive);

impl Serialize for TypeScriptArchive<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let archive = self.0;
        let mut map = serializer.serialize_map(Some(4))?;
        map.serialize_entry("schema", &archive.schema)?;
        map.serialize_entry("exportedAt", &archive.exported_at)?;
        map.serialize_entry("runtime", &TypeScriptRuntime(&archive.runtime))?;
        map.serialize_entry("inventory", &TypeScriptInventory(&archive.inventory))?;
        map.end()
    }
}

struct TypeScriptRuntime<'a>(&'a RuntimeSnapshot);

impl Serialize for TypeScriptRuntime<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let runtime = self.0;
        let mut map = serializer.serialize_map(Some(7))?;
        map.serialize_entry("schema", &runtime.schema)?;
        map.serialize_entry("exportedAt", &runtime.exported_at)?;
        map.serialize_entry("snapshotUpdatedAt", &runtime.snapshot_updated_at)?;
        map.serialize_entry("settings", &JavaScriptValue(&runtime.settings))?;
        map.serialize_entry("templates", &TypeScriptTemplates(&runtime.templates))?;
        map.serialize_entry("versions", &TypeScriptVersions(&runtime.versions))?;
        map.serialize_entry(
            "workingCopies",
            &TypeScriptWorkingCopies(&runtime.working_copies),
        )?;
        map.end()
    }
}

struct TypeScriptInventory<'a>(&'a InventorySnapshot);

impl Serialize for TypeScriptInventory<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let inventory = self.0;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("materials", &TypeScriptMaterials(&inventory.materials))?;
        map.serialize_entry(
            "adjustments",
            &TypeScriptAdjustments(&inventory.adjustments),
        )?;
        map.end()
    }
}

struct TypeScriptTemplates<'a>(&'a [TemplateRecord]);

impl Serialize for TypeScriptTemplates<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for record in self.0 {
            sequence.serialize_element(&TypeScriptTemplate(record))?;
        }
        sequence.end()
    }
}

struct TypeScriptVersions<'a>(&'a [TemplateVersion]);

impl Serialize for TypeScriptVersions<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for record in self.0 {
            sequence.serialize_element(&TypeScriptVersion(record))?;
        }
        sequence.end()
    }
}

struct TypeScriptWorkingCopies<'a>(&'a [WorkingCopyRecord]);

impl Serialize for TypeScriptWorkingCopies<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for record in self.0 {
            sequence.serialize_element(&TypeScriptWorkingCopy(record))?;
        }
        sequence.end()
    }
}

struct TypeScriptMaterials<'a>(&'a [InventoryMaterial]);

impl Serialize for TypeScriptMaterials<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for record in self.0 {
            sequence.serialize_element(&TypeScriptMaterial(record))?;
        }
        sequence.end()
    }
}

struct TypeScriptAdjustments<'a>(&'a [InventoryAdjustment]);

impl Serialize for TypeScriptAdjustments<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for record in self.0 {
            sequence.serialize_element(&TypeScriptAdjustment(record))?;
        }
        sequence.end()
    }
}

struct TypeScriptTemplate<'a>(&'a TemplateRecord);

impl Serialize for TypeScriptTemplate<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let record = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &record.id)?;
        map.serialize_entry("name", &record.name)?;
        map.serialize_entry("description", &record.description.as_deref().unwrap_or(""))?;
        map.serialize_entry("width", &JavaScriptNumber(record.width.unwrap_or_default()))?;
        map.serialize_entry(
            "height",
            &JavaScriptNumber(record.height.unwrap_or_default()),
        )?;
        map.serialize_entry("createdAt", &record.created_at.as_deref().unwrap_or(""))?;
        map.serialize_entry("updatedAt", &record.updated_at.as_deref().unwrap_or(""))?;
        if let Some(archived_at) = &record.archived_at {
            map.serialize_entry("archivedAt", archived_at)?;
        }
        map.serialize_entry(
            "currentVersionId",
            &record.current_version_id.as_deref().unwrap_or(""),
        )?;
        map.serialize_entry("fieldOrder", &record.field_order)?;
        if let Some(recommended_use) = type_script_recommended_use(&record.extra) {
            map.serialize_entry("recommendedUse", &recommended_use)?;
        }
        map.end()
    }
}

struct JavaScriptNumber(f64);

impl Serialize for JavaScriptNumber {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0 == 0.0 {
            serializer.serialize_u8(0)
        } else if self.0.fract() == 0.0 && self.0 >= i64::MIN as f64 && self.0 <= i64::MAX as f64 {
            serializer.serialize_i64(self.0 as i64)
        } else {
            serializer.serialize_f64(self.0)
        }
    }
}

struct JavaScriptValue<'a>(&'a Value);

impl Serialize for JavaScriptValue<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self.0 {
            Value::Null => serializer.serialize_unit(),
            Value::Bool(value) => serializer.serialize_bool(*value),
            Value::Number(value) => {
                if let Some(value) = value.as_i64() {
                    serializer.serialize_i64(value)
                } else if let Some(value) = value.as_u64() {
                    serializer.serialize_u64(value)
                } else {
                    JavaScriptNumber(value.as_f64().unwrap_or_default()).serialize(serializer)
                }
            }
            Value::String(value) => serializer.serialize_str(value),
            Value::Array(values) => {
                let mut sequence = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    sequence.serialize_element(&JavaScriptValue(value))?;
                }
                sequence.end()
            }
            Value::Object(values) => {
                let mut map = serializer.serialize_map(Some(values.len()))?;
                for (key, value) in values {
                    map.serialize_entry(key, &JavaScriptValue(value))?;
                }
                map.end()
            }
        }
    }
}

struct TypeScriptCanvasDocument<'a>(&'a Value);

impl Serialize for TypeScriptCanvasDocument<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(document) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(None)?;
        for field in ["version", "unit", "id", "presetId", "name"] {
            serialize_document_value(&mut map, document, field)?;
        }
        if let Some(source) = document.get("source") {
            map.serialize_entry("source", &TypeScriptCanvasSource(source))?;
        }
        for field in [
            "templateId",
            "baseVersionId",
            "lastSavedAt",
            "width",
            "height",
            "renderOptions",
        ] {
            serialize_document_value(&mut map, document, field)?;
        }
        let has_recommended_use = document.contains_key("recommendedUse");
        let legacy_recommended_use = (!has_recommended_use)
            .then(|| {
                document
                    .get("recommendedUses")
                    .and_then(Value::as_array)
                    .and_then(|values| {
                        let values = values
                            .iter()
                            .filter_map(normalize_recommended_use)
                            .collect::<Vec<_>>();
                        (!values.is_empty()).then(|| values.join("；"))
                    })
            })
            .flatten();
        if let Some(recommended_use) = document
            .get("recommendedUse")
            .and_then(normalize_recommended_use)
        {
            map.serialize_entry("recommendedUse", &recommended_use)?;
        }
        if let Some(fields) = document.get("fields") {
            map.serialize_entry("fields", &TypeScriptCanvasFields(fields))?;
        }
        if let Some(elements) = document.get("elements") {
            map.serialize_entry("elements", &TypeScriptCanvasElements(elements))?;
        }
        if let Some(editor) = document.get("editor") {
            map.serialize_entry("editor", &TypeScriptCanvasEditor(editor))?;
        }
        for (key, value) in document {
            if !matches!(
                key.as_str(),
                "version"
                    | "unit"
                    | "id"
                    | "presetId"
                    | "name"
                    | "source"
                    | "templateId"
                    | "baseVersionId"
                    | "lastSavedAt"
                    | "width"
                    | "height"
                    | "renderOptions"
                    | "recommendedUse"
                    | "recommendedUses"
                    | "fields"
                    | "elements"
                    | "editor"
            ) {
                map.serialize_entry(key, &JavaScriptValue(value))?;
            }
        }
        if let Some(recommended_use) = legacy_recommended_use {
            map.serialize_entry("recommendedUse", &recommended_use)?;
        }
        map.end()
    }
}

fn serialize_document_value<M>(
    map: &mut M,
    document: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<(), M::Error>
where
    M: SerializeMap,
{
    if let Some(value) = document.get(field) {
        map.serialize_entry(field, &JavaScriptValue(value))?;
    }
    Ok(())
}

struct TypeScriptCanvasSource<'a>(&'a Value);

impl Serialize for TypeScriptCanvasSource<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(source) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(2))?;
        if let Some(kind) = source.get("kind") {
            map.serialize_entry("kind", &JavaScriptValue(kind))?;
        }
        let identifier = match source.get("kind").and_then(Value::as_str) {
            Some("user-template") => "templateId",
            _ => "presetId",
        };
        if let Some(value) = source.get(identifier) {
            map.serialize_entry(identifier, &JavaScriptValue(value))?;
        }
        map.end()
    }
}

struct TypeScriptCanvasFields<'a>(&'a Value);

impl Serialize for TypeScriptCanvasFields<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(fields) = self.0.as_array() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut sequence = serializer.serialize_seq(Some(fields.len()))?;
        for field in fields {
            sequence.serialize_element(&TypeScriptCanvasField(field))?;
        }
        sequence.end()
    }
}

struct TypeScriptCanvasField<'a>(&'a Value);

impl Serialize for TypeScriptCanvasField<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(field) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(None)?;
        for key in ["key", "label"] {
            if let Some(value) = field.get(key) {
                map.serialize_entry(key, &JavaScriptValue(value))?;
            }
        }
        for (key, value) in field {
            if !matches!(key.as_str(), "key" | "label") {
                map.serialize_entry(key, &JavaScriptValue(value))?;
            }
        }
        map.end()
    }
}

struct TypeScriptCanvasElements<'a>(&'a Value);

impl Serialize for TypeScriptCanvasElements<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(elements) = self.0.as_array() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut sequence = serializer.serialize_seq(Some(elements.len()))?;
        for element in elements {
            sequence.serialize_element(&TypeScriptCanvasElement(element))?;
        }
        sequence.end()
    }
}

struct TypeScriptCanvasElement<'a>(&'a Value);

impl Serialize for TypeScriptCanvasElement<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(element) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(None)?;
        if let Some(id) = element.get("id") {
            map.serialize_entry("id", &JavaScriptValue(id))?;
        }
        if let Some(meta) = element.get("meta") {
            map.serialize_entry("meta", &TypeScriptCanvasMeta(meta))?;
        }
        if let Some(binding) = element.get("binding") {
            map.serialize_entry("binding", &TypeScriptCanvasBinding(binding))?;
        }
        let kind = element
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(value) = element.get("kind") {
            map.serialize_entry("kind", &JavaScriptValue(value))?;
        }
        for field in canvas_element_fields(kind) {
            if let Some(value) = element.get(*field) {
                map.serialize_entry(*field, &JavaScriptValue(value))?;
            }
        }
        map.end()
    }
}

fn canvas_element_fields(kind: &str) -> &'static [&'static str] {
    match kind {
        "text" => &[
            "x",
            "y",
            "width",
            "height",
            "fontSize",
            "fontFamily",
            "lineHeight",
            "fontWeight",
            "align",
            "justifyAlign",
            "verticalAlign",
            "stretchXGrow",
            "stretchXShrink",
            "stretchYGrow",
            "stretchYShrink",
            "stretchX",
            "stretchY",
            "autoWrap",
            "adaptiveFontSize",
            "verticalText",
            "value",
            "maxLines",
            "rotation",
        ],
        "rect" => &[
            "x",
            "y",
            "width",
            "height",
            "strokeWidth",
            "fill",
            "stroke",
            "radius",
            "rotation",
        ],
        "circle" => &["x", "y", "size", "strokeWidth", "fill", "stroke"],
        "triangle" => &[
            "x",
            "y",
            "width",
            "height",
            "strokeWidth",
            "fill",
            "stroke",
            "rotation",
        ],
        "line" => &["x", "y", "x2", "y2", "strokeWidth", "stroke"],
        "barcode" => &[
            "x",
            "y",
            "width",
            "height",
            "value",
            "format",
            "showValue",
            "rotation",
        ],
        "qr" => &[
            "x",
            "y",
            "size",
            "value",
            "errorCorrectionLevel",
            "rotation",
        ],
        "datamatrix" => &["x", "y", "size", "value", "rotation"],
        _ => &[],
    }
}

struct TypeScriptCanvasMeta<'a>(&'a Value);

impl Serialize for TypeScriptCanvasMeta<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(meta) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(3))?;
        for key in ["name", "visible", "locked"] {
            if let Some(value) = meta.get(key) {
                map.serialize_entry(key, &JavaScriptValue(value))?;
            }
        }
        map.end()
    }
}

struct TypeScriptCanvasBinding<'a>(&'a Value);

impl Serialize for TypeScriptCanvasBinding<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(binding) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(2))?;
        for key in ["fieldKey", "kind"] {
            if let Some(value) = binding.get(key) {
                map.serialize_entry(key, &JavaScriptValue(value))?;
            }
        }
        map.end()
    }
}

struct TypeScriptCanvasEditor<'a>(&'a Value);

impl Serialize for TypeScriptCanvasEditor<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let Some(editor) = self.0.as_object() else {
            return JavaScriptValue(self.0).serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(4))?;
        if let Some(value) = editor.get("gridEnabled") {
            map.serialize_entry("gridEnabled", &JavaScriptValue(value))?;
        }
        if let Some(value) = editor.get("gridSize") {
            map.serialize_entry("gridSize", &JavaScriptNumber(normalize_grid_size(value)))?;
        }
        if let Some(value) = editor.get("snapEnabled") {
            map.serialize_entry("snapEnabled", &JavaScriptValue(value))?;
        }
        if let Some(value) = editor.get("snapStep") {
            map.serialize_entry("snapStep", &JavaScriptNumber(normalize_snap_step(value)))?;
        }
        map.end()
    }
}

fn normalize_grid_size(value: &Value) -> f64 {
    let value = value.as_f64().unwrap_or(1.0);
    if [1.0, 2.0, 5.0].contains(&value) {
        value
    } else {
        1.0
    }
}

fn normalize_snap_step(value: &Value) -> f64 {
    let value = value.as_f64().unwrap_or(1.0);
    if [0.25, 0.5, 1.0].contains(&value) {
        value
    } else {
        1.0
    }
}

struct TypeScriptVersion<'a>(&'a TemplateVersion);

impl Serialize for TypeScriptVersion<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let record = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &record.id)?;
        map.serialize_entry("templateId", &record.template_id)?;
        map.serialize_entry("version", &record.version.unwrap_or_default())?;
        map.serialize_entry("kind", &record.kind.as_deref().unwrap_or(""))?;
        map.serialize_entry("createdAt", &record.created_at.as_deref().unwrap_or(""))?;
        map.serialize_entry("label", &record.label.as_deref().unwrap_or(""))?;
        if let Some(source_version_id) = &record.source_version_id {
            map.serialize_entry("sourceVersionId", source_version_id)?;
        }
        map.serialize_entry(
            "document",
            &record.document.as_ref().map(TypeScriptCanvasDocument),
        )?;
        map.end()
    }
}

struct TypeScriptWorkingCopy<'a>(&'a WorkingCopyRecord);

impl Serialize for TypeScriptWorkingCopy<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let record = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("sourceKey", &record.source_key)?;
        map.serialize_entry(
            "source",
            &record.source.as_ref().map(TypeScriptCanvasSource),
        )?;
        if let Some(template_id) = &record.template_id {
            map.serialize_entry("templateId", template_id)?;
        }
        map.serialize_entry(
            "draft",
            &record.draft.as_ref().map(TypeScriptCanvasDocument),
        )?;
        map.serialize_entry("updatedAt", &record.updated_at.as_deref().unwrap_or(""))?;
        if let Some(base_version_id) = &record.base_version_id {
            map.serialize_entry("baseVersionId", base_version_id)?;
        }
        map.end()
    }
}

struct TypeScriptMaterial<'a>(&'a InventoryMaterial);

impl Serialize for TypeScriptMaterial<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let material = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &material.id)?;
        map.serialize_entry("fullName", &material.full_name)?;
        for field in ["baseName", "variantName", "packageName"] {
            if let Some(value) = material.extra.get(field) {
                map.serialize_entry(field, &JavaScriptValue(value))?;
            }
        }
        for field in ["description", "deviceDetails"] {
            let value = material
                .extra
                .get(field)
                .and_then(Value::as_str)
                .unwrap_or("");
            map.serialize_entry(field, value)?;
        }
        if let Some(matrix_code) = &material.matrix_code {
            map.serialize_entry("matrixCode", matrix_code)?;
        }
        let packaging_remark = material
            .extra
            .get("packagingRemark")
            .and_then(Value::as_str)
            .unwrap_or("");
        map.serialize_entry("packagingRemark", packaging_remark)?;
        map.serialize_entry("currentQuantity", &material.current_quantity)?;
        map.serialize_entry("createdAt", &material.created_at.as_deref().unwrap_or(""))?;
        map.serialize_entry("updatedAt", &material.updated_at.as_deref().unwrap_or(""))?;
        if let Some(archived_at) = &material.archived_at {
            map.serialize_entry("archivedAt", archived_at)?;
        }
        map.serialize_entry(
            "labelBindings",
            &TypeScriptBindings(&material.label_bindings),
        )?;
        serialize_material_passthrough(&mut map, material)?;
        map.end()
    }
}

struct TypeScriptBindings<'a>(&'a [tuckmark_contracts::LabelBinding]);

impl Serialize for TypeScriptBindings<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for binding in self.0 {
            sequence.serialize_element(&TypeScriptBinding(binding))?;
        }
        sequence.end()
    }
}

struct TypeScriptBinding<'a>(&'a tuckmark_contracts::LabelBinding);

impl Serialize for TypeScriptBinding<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let binding = self.0;
        let default_print_quantity = Value::from(1);
        let default_field_overrides = Value::Object(Default::default());
        let mut map = serializer.serialize_map(Some(8))?;
        map.serialize_entry("id", &binding.id)?;
        map.serialize_entry("templateSource", &binding.template_source)?;
        map.serialize_entry("templateId", &binding.template_id)?;
        map.serialize_entry(
            "templateName",
            binding
                .extra
                .get("templateName")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )?;
        map.serialize_entry(
            "printQuantity",
            &JavaScriptValue(
                binding
                    .extra
                    .get("printQuantity")
                    .unwrap_or(&default_print_quantity),
            ),
        )?;
        map.serialize_entry(
            "fieldOverrides",
            &JavaScriptValue(
                binding
                    .extra
                    .get("fieldOverrides")
                    .unwrap_or(&default_field_overrides),
            ),
        )?;
        map.serialize_entry(
            "createdAt",
            binding
                .extra
                .get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )?;
        map.serialize_entry(
            "updatedAt",
            binding
                .extra
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )?;
        map.end()
    }
}

struct TypeScriptAdjustment<'a>(&'a InventoryAdjustment);

impl Serialize for TypeScriptAdjustment<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let adjustment = self.0;
        let mut map = serializer.serialize_map(Some(9))?;
        map.serialize_entry("id", &adjustment.id)?;
        map.serialize_entry("materialId", &adjustment.material_id)?;
        map.serialize_entry("kind", &adjustment.kind)?;
        map.serialize_entry(
            "quantityDelta",
            &adjustment.quantity_delta.unwrap_or_default(),
        )?;
        map.serialize_entry("targetQuantity", &adjustment.target_quantity)?;
        map.serialize_entry(
            "quantityAfter",
            &adjustment.quantity_after.unwrap_or_default(),
        )?;
        map.serialize_entry("note", &adjustment.note.as_deref().unwrap_or(""))?;
        map.serialize_entry("actor", &adjustment.actor.as_deref().unwrap_or("unknown"))?;
        map.serialize_entry("createdAt", &adjustment.created_at.as_deref().unwrap_or(""))?;
        map.end()
    }
}

fn serialize_material_passthrough<M>(
    map: &mut M,
    material: &InventoryMaterial,
) -> Result<(), M::Error>
where
    M: SerializeMap,
{
    for (key, value) in &material.extra {
        if !matches!(
            key.as_str(),
            "baseName"
                | "variantName"
                | "packageName"
                | "description"
                | "deviceDetails"
                | "packagingRemark"
        ) {
            map.serialize_entry(key, &JavaScriptValue(value))?;
        }
    }
    Ok(())
}

fn type_script_recommended_use(extra: &tuckmark_contracts::ExtraFields) -> Option<String> {
    extra
        .get("recommendedUse")
        .and_then(normalize_recommended_use)
        .or_else(|| {
            extra
                .get("recommendedUses")
                .and_then(Value::as_array)
                .and_then(|values| {
                    let values = values
                        .iter()
                        .filter_map(normalize_recommended_use)
                        .collect::<Vec<_>>();
                    (!values.is_empty()).then(|| values.join("；"))
                })
        })
}

fn normalize_recommended_use(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => {
            let value = value.trim();
            (!value.is_empty()).then(|| value.into())
        }
        Value::Object(value) => value
            .get("scope")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        _ => None,
    }
}

fn archive_summary(archive: &DevdDataArchive) -> ArchiveSummary {
    ArchiveSummary {
        templates: archive.runtime.templates.len(),
        versions: archive.runtime.versions.len(),
        working_copies: archive.runtime.working_copies.len(),
        materials: archive.inventory.materials.len(),
        adjustments: archive.inventory.adjustments.len(),
    }
}

fn archive_conflicts(incoming: &DevdDataArchive, current: &DevdDataArchive) -> Vec<String> {
    let current_template_ids = current
        .runtime
        .templates
        .iter()
        .map(|template| template.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let current_version_ids = current
        .runtime
        .versions
        .iter()
        .map(|version| version.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let current_working_keys = current
        .runtime
        .working_copies
        .iter()
        .map(|copy| copy.source_key.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let current_material_ids = current
        .inventory
        .materials
        .iter()
        .map(|material| material.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let current_material_names = current
        .inventory
        .materials
        .iter()
        .map(|material| material.full_name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let current_matrix_codes = current
        .inventory
        .materials
        .iter()
        .filter_map(|material| {
            material
                .matrix_code
                .as_deref()
                .filter(|value| !value.is_empty())
        })
        .collect::<std::collections::BTreeSet<_>>();
    let current_adjustment_ids = current
        .inventory
        .adjustments
        .iter()
        .map(|adjustment| adjustment.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut conflicts = BTreeMap::new();
    for item in &incoming.runtime.templates {
        if current_template_ids.contains(item.id.as_str()) {
            conflicts.insert(format!("template:{}", item.id), ());
        }
    }
    for item in &incoming.runtime.versions {
        if current_version_ids.contains(item.id.as_str()) {
            conflicts.insert(format!("version:{}", item.id), ());
        }
    }
    for item in &incoming.runtime.working_copies {
        if current_working_keys.contains(item.source_key.as_str()) {
            conflicts.insert(format!("working-copy:{}", item.source_key), ());
        }
    }
    for item in &incoming.inventory.materials {
        if current_material_ids.contains(item.id.as_str()) {
            conflicts.insert(format!("material:{}", item.id), ());
        }
        if current_material_names.contains(item.full_name.as_str()) {
            conflicts.insert(format!("material-name:{}", item.full_name), ());
        }
        if let Some(matrix_code) = item
            .matrix_code
            .as_deref()
            .filter(|value| !value.is_empty())
            && current_matrix_codes.contains(matrix_code)
        {
            conflicts.insert(format!("matrix-code:{matrix_code}"), ());
        }
    }
    for item in &incoming.inventory.adjustments {
        if current_adjustment_ids.contains(item.id.as_str()) {
            conflicts.insert(format!("adjustment:{}", item.id), ());
        }
    }
    conflicts.into_keys().collect()
}

fn merge_archives(current: &DevdDataArchive, incoming: &DevdDataArchive) -> DevdDataArchive {
    let mut merged = current.clone();
    merged.exported_at = incoming.exported_at.clone();
    merged
        .runtime
        .templates
        .extend(incoming.runtime.templates.clone());
    merged
        .runtime
        .versions
        .extend(incoming.runtime.versions.clone());
    merged
        .runtime
        .working_copies
        .extend(incoming.runtime.working_copies.clone());
    merged
        .inventory
        .materials
        .extend(incoming.inventory.materials.clone());
    merged
        .inventory
        .adjustments
        .extend(incoming.inventory.adjustments.clone());
    merged
}

fn archive_writes(archive: &DevdDataArchive) -> Result<Vec<JsonWrite>, DataAuthorityError> {
    let mut writes = vec![JsonWrite::new(
        "settings/app-settings.json",
        archive.runtime.settings.clone(),
    )];
    for template in &archive.runtime.templates {
        writes.push(JsonWrite::new(
            format!("templates/{}/template.json", safe_segment(&template.id)?),
            serde_json::to_value(template)?,
        ));
    }
    for version in &archive.runtime.versions {
        writes.push(JsonWrite::new(
            format!(
                "templates/{}/versions/{}.json",
                safe_segment(&version.template_id)?,
                safe_segment(&version.id)?
            ),
            serde_json::to_value(version)?,
        ));
    }
    for copy in &archive.runtime.working_copies {
        writes.push(JsonWrite::new(
            working_copy_path(copy)?,
            serde_json::to_value(copy)?,
        ));
    }
    for material in &archive.inventory.materials {
        writes.push(JsonWrite::new(
            format!("inventory/materials/{}.json", safe_segment(&material.id)?),
            serde_json::to_value(material)?,
        ));
    }
    for adjustment in &archive.inventory.adjustments {
        writes.push(JsonWrite::new(
            format!(
                "inventory/adjustments/{}.json",
                safe_segment(&adjustment.id)?
            ),
            serde_json::to_value(adjustment)?,
        ));
    }
    writes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(writes)
}

fn working_copy_path(copy: &WorkingCopyRecord) -> Result<String, DataAuthorityError> {
    if let Some(template_id) = copy.source_key.strip_prefix("user:") {
        return Ok(format!(
            "templates/{}/working-copy.json",
            safe_segment(template_id)?
        ));
    }
    let source = copy.source.as_ref().and_then(Value::as_object);
    let kind = source
        .and_then(|source| source.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("scratch");
    let identifier = source
        .and_then(|source| source.get("presetId"))
        .or_else(|| source.and_then(|source| source.get("id")))
        .and_then(Value::as_str)
        .or_else(|| copy.source_key.split_once(':').map(|(_, value)| value))
        .unwrap_or(&copy.source_key);
    Ok(format!(
        "drafts/{}/{}.json",
        safe_segment(kind)?,
        safe_segment(identifier)?
    ))
}

fn safe_segment(value: &str) -> Result<&str, DataAuthorityError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(DataAuthorityError::InvalidPath(value.into()));
    }
    Ok(value)
}

fn count_template_records(root: &Path) -> Result<u64, DataAuthorityError> {
    let mut count = 0;
    for directory in list_directories(root, &root.join("templates"))? {
        if is_regular_file_within_root(root, &directory.join("template.json"))? {
            count += 1;
        }
    }
    Ok(count)
}

fn count_template_versions(root: &Path) -> Result<u64, DataAuthorityError> {
    let mut count = 0;
    for directory in list_directories(root, &root.join("templates"))? {
        count += list_json_files(root, &directory.join("versions"))?.len() as u64;
    }
    Ok(count)
}

fn count_working_copies(root: &Path) -> Result<u64, DataAuthorityError> {
    let mut template_copies = 0;
    for directory in list_directories(root, &root.join("templates"))? {
        if is_regular_file_within_root(root, &directory.join("working-copy.json"))? {
            template_copies += 1;
        }
    }
    let mut drafts = if is_regular_file_within_root(root, &root.join("drafts/scratch.json"))? {
        1
    } else {
        0
    };
    for kind in ["scratch", "preset-template"] {
        drafts += list_json_files(root, &root.join("drafts").join(kind))?.len() as u64;
    }
    Ok(template_copies + drafts)
}

fn is_regular_file_within_root(root: &Path, path: &Path) -> Result<bool, DataAuthorityError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| DataAuthorityError::InvalidPath(path.display().to_string()))?;
    let resolved = resolve_path_within_root(root, &relative.to_string_lossy())?;
    match fs::symlink_metadata(resolved) {
        Ok(metadata) => Ok(metadata.file_type().is_file()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::process_start_identity_from_stat;
    use serde_json::json;

    #[cfg(target_os = "linux")]
    #[test]
    fn extracts_the_stable_linux_process_start_time_field() {
        let fields = [
            "S", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
            "16", "17", "18", "987654", "20",
        ];
        let stat = format!("42 (render worker) {}", fields.join(" "));

        assert_eq!(
            process_start_identity_from_stat(&stat).as_deref(),
            Some("987654")
        );
    }

    #[test]
    fn authority_lock_checks_do_not_spawn_external_processes() {
        let source = include_str!("authority.rs");
        let process_command = ["std::process", "::Command"].concat();
        let command_new = ["Command", "::new"].concat();

        assert!(!source.contains(&process_command));
        assert!(!source.contains(&command_new));
    }

    #[test]
    fn atomic_writes_sync_the_parent_directory_after_rename() {
        let source = include_str!("authority.rs");

        for (function, following_function) in [
            ("atomic_write_json", "atomic_write_bytes"),
            ("atomic_write_bytes", "contract_to_io"),
        ] {
            let start = source
                .find(&format!("fn {function}"))
                .expect("atomic write helper exists");
            let after_start = &source[start..];
            let end = after_start
                .find(&format!("\nfn {following_function}"))
                .expect("following helper exists");
            let body = &after_start[..end];
            let rename = body
                .find("fs::rename(&temporary, path)?;")
                .expect("atomic write renames its prepared file");
            let sync = body[rename..]
                .find("sync_directory(parent)?;")
                .expect("atomic write syncs the parent directory after rename");

            assert!(sync > 0, "{function} must sync after the rename");
        }
    }

    #[test]
    fn archive_hash_serialization_uses_the_existing_schema_field_order() {
        let archive = serde_json::from_value(json!({
            "schema": "tuckmark.devd-data-archive.v1",
            "exportedAt": "2026-01-02T03:04:05Z",
            "runtime": {
                "schema": "tuckmark.runtime-export.v1",
                "exportedAt": "2026-01-02T03:04:05Z",
                "snapshotUpdatedAt": null,
                "settings": { "threshold": 144 },
                "templates": [{
                    "id": "template-one",
                    "name": "Template One",
                    "description": "",
                    "width": 100,
                    "height": 50,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "currentVersionId": "version-one",
                    "fieldOrder": []
                }],
                "versions": [{
                    "id": "version-one",
                    "templateId": "template-one",
                    "version": 1,
                    "kind": "saved",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "label": "",
                    "document": {
                        "version": 1,
                        "id": "template-one",
                        "presetId": "shipping-compact",
                        "name": "Template One",
                        "source": { "kind": "scratch", "presetId": "shipping-compact" },
                        "width": 100,
                        "height": 50,
                        "fields": [],
                        "elements": [],
                        "editor": {
                            "gridEnabled": true,
                            "gridSize": 1,
                            "snapEnabled": true,
                            "snapStep": 1
                        }
                    }
                }],
                "workingCopies": []
            },
            "inventory": {
                "materials": [{
                    "id": "material-one",
                    "fullName": "Material One",
                    "description": "A material",
                    "deviceDetails": "Device detail",
                    "matrixCode": "MATRIX-1",
                    "packagingRemark": "Boxed",
                    "currentQuantity": 3,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "labelBindings": []
                }],
                "adjustments": []
            }
        }))
        .unwrap();

        assert_eq!(
            serde_json::to_string(&super::TypeScriptArchive(&archive)).unwrap(),
            r#"{"schema":"tuckmark.devd-data-archive.v1","exportedAt":"2026-01-02T03:04:05Z","runtime":{"schema":"tuckmark.runtime-export.v1","exportedAt":"2026-01-02T03:04:05Z","snapshotUpdatedAt":null,"settings":{"threshold":144},"templates":[{"id":"template-one","name":"Template One","description":"","width":100,"height":50,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","currentVersionId":"version-one","fieldOrder":[]}],"versions":[{"id":"version-one","templateId":"template-one","version":1,"kind":"saved","createdAt":"2026-01-01T00:00:00Z","label":"","document":{"version":1,"id":"template-one","presetId":"shipping-compact","name":"Template One","source":{"kind":"scratch","presetId":"shipping-compact"},"width":100,"height":50,"fields":[],"elements":[],"editor":{"gridEnabled":true,"gridSize":1,"snapEnabled":true,"snapStep":1}}}],"workingCopies":[]},"inventory":{"materials":[{"id":"material-one","fullName":"Material One","description":"A material","deviceDetails":"Device detail","matrixCode":"MATRIX-1","packagingRemark":"Boxed","currentQuantity":3,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","labelBindings":[]}],"adjustments":[]}}"#
        );
    }

    #[test]
    fn archive_hash_document_projection_matches_legacy_zod_transforms() {
        let document = json!({
            "version": 1,
            "id": "legacy-template",
            "presetId": "shipping-compact",
            "name": "Legacy template",
            "source": { "kind": "scratch", "presetId": "shipping-compact" },
            "width": 100,
            "height": 50,
            "recommendedUses": [{ "scope": "electronics" }],
            "fields": [],
            "elements": [],
            "editor": {
                "gridEnabled": true,
                "gridSize": 7,
                "snapEnabled": true,
                "snapStep": 2
            },
            "legacyFlag": "retained"
        });

        assert_eq!(
            serde_json::to_string(&super::TypeScriptCanvasDocument(&document)).unwrap(),
            r#"{"version":1,"id":"legacy-template","presetId":"shipping-compact","name":"Legacy template","source":{"kind":"scratch","presetId":"shipping-compact"},"width":100,"height":50,"fields":[],"elements":[],"editor":{"gridEnabled":true,"gridSize":1,"snapEnabled":true,"snapStep":1},"legacyFlag":"retained","recommendedUse":"electronics"}"#
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reads_a_start_identity_through_libproc() {
        assert_eq!(std::mem::size_of::<super::ProcBsdInfo>(), 136);
        let identity = super::macos_process_start_identity(std::process::id()).unwrap();
        // Match `ps -o lstart=` without spawning `ps`: `Thu Feb  6 07:45:41 2026`.
        assert_eq!(identity.len(), 24);
        assert_eq!(identity.split_whitespace().count(), 5);
    }
}
