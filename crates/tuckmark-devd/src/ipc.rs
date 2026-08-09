use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use thiserror::Error;

const INSTANCE_PATTERN_DESCRIPTION: &str = "DEVD instance must be 1-48 lowercase letters, numbers, or hyphens and cannot end with a hyphen.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IpcTransport {
    Unix,
    Pipe,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IpcEndpoint {
    pub instance: String,
    pub transport: IpcTransport,
    pub address: String,
}

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("{INSTANCE_PATTERN_DESCRIPTION}")]
    InvalidInstance,
    #[error("IPC endpoint is already in use: {0}")]
    EndpointInUse(String),
    #[error("IPC endpoint is occupied by a non-socket path: {0}")]
    OccupiedByNonSocket(String),
    #[error("named-pipe IPC is unavailable on this platform")]
    UnsupportedPlatform,
    #[error("IPC I/O failed: {0}")]
    Io(#[from] io::Error),
}

pub fn validate_instance_name(instance: &str) -> Result<String, IpcError> {
    let normalized = instance.trim().to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    let valid = (1..=48).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-');
    valid.then_some(normalized).ok_or(IpcError::InvalidInstance)
}

pub fn resolve_required_instance(value: Option<&str>) -> Result<String, IpcError> {
    let value = value
        .map(str::to_owned)
        .or_else(|| env::var("TUCKMARK_DEVD_INSTANCE").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(IpcError::InvalidInstance)?;
    validate_instance_name(&value)
}

pub fn resolve_ipc_endpoint(instance: &str) -> Result<IpcEndpoint, IpcError> {
    let instance = validate_instance_name(instance)?;
    #[cfg(windows)]
    {
        let token = user_token();
        let address = format!(r"\\.\pipe\tuckmark-{token}-{instance}");
        Ok(IpcEndpoint {
            instance,
            transport: IpcTransport::Pipe,
            address,
        })
    }
    #[cfg(not(windows))]
    {
        let root = env::var_os("XDG_RUNTIME_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir);
        let endpoint_token = digest_prefix(&format!("{}:{instance}", user_token()));
        Ok(IpcEndpoint {
            instance,
            transport: IpcTransport::Unix,
            address: root
                .join(format!("t-{endpoint_token}"))
                .display()
                .to_string(),
        })
    }
}

fn digest_prefix(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    hex::encode(digest)[..12].to_owned()
}

fn user_token() -> String {
    let identity = if cfg!(windows) {
        env::var("USERNAME").unwrap_or_else(|_| "unknown".into())
    } else {
        env::var("USER").unwrap_or_else(|_| "unknown".into())
    };
    #[cfg(unix)]
    let identity = format!("{identity}:{}", unsafe { libc::geteuid() });
    #[cfg(not(unix))]
    let identity = format!("{identity}:windows");
    digest_prefix(&identity)
}

#[cfg(unix)]
pub struct UnixIpcListener {
    listener: Option<tokio::net::UnixListener>,
    endpoint: IpcEndpoint,
    lock_path: Option<PathBuf>,
}

#[cfg(unix)]
pub struct UnixIpcCleanup {
    endpoint: IpcEndpoint,
    lock_path: PathBuf,
}

#[cfg(unix)]
impl Drop for UnixIpcCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.endpoint.address);
        let _ = fs::remove_file(&self.lock_path);
    }
}

#[cfg(unix)]
impl UnixIpcListener {
    pub fn listener(&self) -> &tokio::net::UnixListener {
        self.listener.as_ref().expect("IPC listener has been moved")
    }

    pub fn endpoint(&self) -> &IpcEndpoint {
        &self.endpoint
    }

    pub fn cleanup(&self) {
        if let Some(lock_path) = &self.lock_path {
            let _ = fs::remove_file(&self.endpoint.address);
            let _ = fs::remove_file(lock_path);
        }
    }

    pub fn into_parts(mut self) -> (tokio::net::UnixListener, UnixIpcCleanup) {
        let listener = self.listener.take().expect("IPC listener has been moved");
        let lock_path = self.lock_path.take().expect("IPC lock has been moved");
        let cleanup = UnixIpcCleanup {
            endpoint: self.endpoint.clone(),
            lock_path,
        };
        (listener, cleanup)
    }
}

#[cfg(unix)]
impl Drop for UnixIpcListener {
    fn drop(&mut self) {
        self.cleanup();
    }
}

#[cfg(unix)]
pub async fn bind_unix_ipc(instance: &str) -> Result<UnixIpcListener, IpcError> {
    use std::os::unix::fs::PermissionsExt;

    let endpoint = resolve_ipc_endpoint(instance)?;
    let address = PathBuf::from(&endpoint.address);
    let directory = address.parent().ok_or_else(|| {
        IpcError::Io(io::Error::new(
            io::ErrorKind::InvalidInput,
            "IPC endpoint has no parent directory",
        ))
    })?;
    let directory_existed = directory.exists();
    fs::create_dir_all(directory)?;
    if !directory_existed {
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }

    let lock_path = PathBuf::from(format!("{}.lock", endpoint.address));
    acquire_endpoint_lock(&lock_path)?;
    if let Err(error) = remove_stale_unix_socket(&address).await {
        let _ = fs::remove_file(&lock_path);
        return Err(error);
    }

    match tokio::net::UnixListener::bind(&address) {
        Ok(listener) => {
            fs::set_permissions(&address, fs::Permissions::from_mode(0o600))?;
            Ok(UnixIpcListener {
                listener: Some(listener),
                endpoint,
                lock_path: Some(lock_path),
            })
        }
        Err(error) => {
            let _ = fs::remove_file(&lock_path);
            Err(error.into())
        }
    }
}

#[cfg(unix)]
fn acquire_endpoint_lock(lock_path: &Path) -> Result<(), IpcError> {
    use std::os::unix::fs::OpenOptionsExt;

    for _ in 0..4 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(lock_path)
        {
            Ok(mut file) => {
                writeln!(file, "{}", std::process::id())?;
                file.sync_all()?;
                return Ok(());
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let live_owner = fs::read_to_string(lock_path)
                    .ok()
                    .and_then(|value| value.trim().parse::<u32>().ok())
                    .is_some_and(process_is_alive);
                if live_owner {
                    return Err(IpcError::EndpointInUse(lock_path.display().to_string()));
                }
                match fs::remove_file(lock_path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(IpcError::EndpointInUse(lock_path.display().to_string()))
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
async fn remove_stale_unix_socket(address: &Path) -> Result<(), IpcError> {
    use std::os::unix::fs::FileTypeExt;

    let metadata = match fs::symlink_metadata(address) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_socket() {
        return Err(IpcError::OccupiedByNonSocket(address.display().to_string()));
    }
    match tokio::net::UnixStream::connect(address).await {
        Ok(_) => Err(IpcError::EndpointInUse(address.display().to_string())),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
            ) =>
        {
            match fs::remove_file(address) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.into()),
            }
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(unix))]
pub async fn bind_unix_ipc(_instance: &str) -> Result<(), IpcError> {
    Err(IpcError::UnsupportedPlatform)
}

#[cfg(windows)]
#[derive(Debug)]
pub struct WindowsIpcListener {
    endpoint: IpcEndpoint,
    pending: tokio::net::windows::named_pipe::NamedPipeServer,
}

#[cfg(windows)]
impl WindowsIpcListener {
    pub fn endpoint(&self) -> &IpcEndpoint {
        &self.endpoint
    }

    fn create_successor(&self) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
        create_windows_pipe(&self.endpoint.address, false)
    }
}

#[cfg(windows)]
pub fn bind_windows_ipc(instance: &str) -> Result<WindowsIpcListener, IpcError> {
    let endpoint = resolve_ipc_endpoint(instance)?;
    let pending = create_windows_pipe(&endpoint.address, true).map_err(|error| {
        if error.kind() == io::ErrorKind::PermissionDenied {
            IpcError::EndpointInUse(endpoint.address.clone())
        } else {
            IpcError::Io(error)
        }
    })?;
    Ok(WindowsIpcListener { endpoint, pending })
}

#[cfg(windows)]
fn create_windows_pipe(
    address: &str,
    first_instance: bool,
) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let mut options = ServerOptions::new();
    options
        .first_pipe_instance(first_instance)
        .reject_remote_clients(true);
    options.create(address)
}

#[cfg(windows)]
impl axum::serve::Listener for WindowsIpcListener {
    type Io = tokio::net::windows::named_pipe::NamedPipeServer;
    type Addr = String;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            if let Err(error) = self.pending.connect().await {
                eprintln!("tuckmark-devd: Windows IPC accept failed: {error}");
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }

            // Keep an unconnected pipe instance available before handing this one to HTTP.
            let successor = loop {
                match self.create_successor() {
                    Ok(successor) => break successor,
                    Err(error) => {
                        eprintln!("tuckmark-devd: Windows IPC listener recreation failed: {error}");
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    }
                }
            };
            let connected = std::mem::replace(&mut self.pending, successor);
            return (connected, self.endpoint.address.clone());
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        Ok(self.endpoint.address.clone())
    }
}

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}
