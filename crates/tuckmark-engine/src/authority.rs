use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use serde_json::Value;
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    ContractError, DATA_DIRECTORY_MANIFEST_SCHEMA, DEVD_DATA_TRANSACTION_SCHEMA,
    DEVD_LIVE_LOCK_SCHEMA, DEVD_OWNER_SCHEMA, DataDirectoryManifest, DevdDataState,
    DevdDataTransaction, DevdLiveLock, DevdOwner, InventoryAdjustment, InventoryMaterial,
    JsonWrite, RevisionEvent, TemplateRecord, TemplateVersion, WorkingCopyRecord,
    canonical_json_bytes, validate_referential_integrity, validate_relative_path,
};
use uuid::Uuid;

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
            return io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        }
        #[cfg(not(unix))]
        {
            pid == std::process::id()
        }
    }

    fn start_identity(&self, pid: u32) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            return fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| stat.rsplit(')').next().map(str::trim).map(str::to_owned));
        }
        #[cfg(not(target_os = "linux"))]
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
        fs::create_dir_all(root.as_ref())?;
        let root = fs::canonicalize(root.as_ref())?;
        let control = root.join(CONTROL_DIRECTORY);
        fs::create_dir_all(control.join(TRANSACTIONS_DIRECTORY))?;

        let owner_path = control.join(OWNER_NAME);
        ensure_owner(&owner_path, &options)?;
        let lock_path = control.join(LIVE_LOCK_NAME);
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
        self.validate_transaction_integrity_locked(&transaction)?;
        let journal_path = self
            .transactions_dir()
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
        list_json_files(&self.resolve_relative(relative_directory)?)
    }

    fn lock_mutation(&self) -> Result<MutexGuard<'_, ()>, DataAuthorityError> {
        self.inner
            .mutation
            .lock()
            .map_err(|_| DataAuthorityError::Poisoned)
    }

    fn control_dir(&self) -> PathBuf {
        self.inner.root.join(CONTROL_DIRECTORY)
    }

    fn transactions_dir(&self) -> PathBuf {
        self.control_dir().join(TRANSACTIONS_DIRECTORY)
    }

    fn resolve_relative(&self, relative_path: &str) -> Result<PathBuf, DataAuthorityError> {
        if relative_path.contains('\\') {
            return Err(DataAuthorityError::InvalidPath(relative_path.into()));
        }
        validate_relative_path(relative_path)?;
        let candidate = self.inner.root.join(relative_path);
        if !candidate.starts_with(&self.inner.root) {
            return Err(DataAuthorityError::InvalidPath(relative_path.into()));
        }
        Ok(candidate)
    }

    fn read_revision_locked(&self) -> Result<u64, DataAuthorityError> {
        let state_path = self.control_dir().join(STATE_NAME);
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
        fs::create_dir_all(self.transactions_dir())?;
        for journal_path in list_json_files(&self.transactions_dir())? {
            let value = read_json_required(&journal_path)?;
            let transaction: DevdDataTransaction = serde_json::from_value(value)?;
            if transaction.schema != DEVD_DATA_TRANSACTION_SCHEMA {
                return Err(DataAuthorityError::Contract(ContractError::Validation(
                    "invalid DEVD transaction schema".into(),
                )));
            }
            transaction.validate()?;
            let current = self.read_revision_locked()?;
            if current <= transaction.revision {
                self.apply_transaction_locked(&transaction)?;
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
        atomic_write_json(&self.control_dir().join(STATE_NAME), &state)?;
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
            collect_json_tree(&self.inner.root.join(directory), directory, &mut files)?;
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

    fn refresh_manifest_locked(&self) -> Result<(), DataAuthorityError> {
        let manifest_path = self.inner.root.join("manifest.json");
        let existing = read_json_optional(&manifest_path)?
            .and_then(|value| serde_json::from_value::<DataDirectoryManifest>(value).ok());
        let mut manifest = existing.unwrap_or_else(|| {
            DataDirectoryManifest::new("runtime-sync", self.inner.options.clock.now())
        });
        manifest.schema = DATA_DIRECTORY_MANIFEST_SCHEMA.into();
        manifest.generated_at = self.inner.options.clock.now();
        manifest.counts.templates = count_template_records(&self.inner.root)?;
        manifest.counts.versions = count_template_versions(&self.inner.root)?;
        manifest.counts.working_copies = count_working_copies(&self.inner.root)?;
        manifest.counts.materials =
            list_json_files(&self.inner.root.join("inventory/materials"))?.len() as u64;
        manifest.counts.adjustments =
            list_json_files(&self.inner.root.join("inventory/adjustments"))?.len() as u64;
        manifest.validate()?;
        atomic_write_json(&manifest_path, &manifest)
    }
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
    if let Ok(current) = read_lock(&recovery_path) {
        if same_lock(&current, &recovery) {
            let _ = fs::remove_file(&recovery_path);
        }
    }
    result
}

fn create_new_json<T: serde::Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(&canonical_json_bytes(value).map_err(contract_to_io)?)?;
    file.sync_all()?;
    Ok(())
}

fn atomic_write_json<T: serde::Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), DataAuthorityError> {
    let parent = path
        .parent()
        .ok_or_else(|| DataAuthorityError::InvalidPath(path.display().to_string()))?;
    fs::create_dir_all(parent)?;
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
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
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

fn list_json_files(directory: &Path) -> Result<Vec<PathBuf>, DataAuthorityError> {
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

fn list_directories(directory: &Path) -> Result<Vec<PathBuf>, DataAuthorityError> {
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

fn collect_json_tree(
    directory: &Path,
    relative_prefix: &str,
    files: &mut BTreeMap<String, Value>,
) -> Result<(), DataAuthorityError> {
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
            collect_json_tree(&entry.path(), &relative_path, files)?;
        } else if file_type.is_file() && entry.path().extension().is_some_and(|ext| ext == "json") {
            files.insert(relative_path, read_json_required(&entry.path())?);
        }
    }
    Ok(())
}

fn count_template_records(root: &Path) -> Result<u64, DataAuthorityError> {
    Ok(list_directories(&root.join("templates"))?
        .iter()
        .filter(|directory| directory.join("template.json").is_file())
        .count() as u64)
}

fn count_template_versions(root: &Path) -> Result<u64, DataAuthorityError> {
    let mut count = 0;
    for directory in list_directories(&root.join("templates"))? {
        count += list_json_files(&directory.join("versions"))?.len() as u64;
    }
    Ok(count)
}

fn count_working_copies(root: &Path) -> Result<u64, DataAuthorityError> {
    let template_copies = list_directories(&root.join("templates"))?
        .iter()
        .filter(|directory| directory.join("working-copy.json").is_file())
        .count() as u64;
    let mut drafts = if root.join("drafts/scratch.json").is_file() {
        1
    } else {
        0
    };
    for kind in ["scratch", "preset-template"] {
        drafts += list_json_files(&root.join("drafts").join(kind))?.len() as u64;
    }
    Ok(template_copies + drafts)
}
