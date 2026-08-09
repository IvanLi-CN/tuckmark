use std::{
    env,
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("{0}")]
    Message(String),
    #[error("DEVD IPC request failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("DEVD IPC returned invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug)]
pub struct DevdClient {
    pub instance: String,
    revision: Option<u64>,
}

impl DevdClient {
    pub fn new(instance: String) -> Self {
        Self {
            instance,
            revision: None,
        }
    }

    pub fn status(&mut self) -> Result<Value, IpcError> {
        let result = self.request("GET", "/api/data/status", None, None)?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result)
    }

    pub fn data_directory_config(&mut self) -> Result<Value, IpcError> {
        self.request("GET", "/api/data/config", None, None)
    }

    pub fn set_data_directory(&mut self, data_dir: String) -> Result<Value, IpcError> {
        self.request(
            "PUT",
            "/api/data/config/data-directory",
            Some(json!({ "dataDir": data_dir })),
            None,
        )
    }

    pub fn snapshot(&mut self) -> Result<Value, IpcError> {
        let result = self.request("GET", "/api/data/runtime/snapshot", None, None)?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn list_materials(
        &mut self,
        query: &str,
        include_archived: bool,
    ) -> Result<Value, IpcError> {
        let path = format!(
            "/api/data/inventory/materials?query={}&includeArchived={include_archived}",
            percent_encode(query)
        );
        let result = self.request("GET", &path, None, None)?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn list_adjustments(&mut self, material_id: Option<&str>) -> Result<Value, IpcError> {
        let suffix = material_id
            .map(|id| format!("?materialId={}", percent_encode(id)))
            .unwrap_or_default();
        let result = self.request(
            "GET",
            &format!("/api/data/inventory/adjustments{suffix}"),
            None,
            None,
        )?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn runtime_command(&mut self, command: &str, args: Value) -> Result<Value, IpcError> {
        let expected_revision = self.expected_revision()?;
        let result = self.request(
            "POST",
            &format!("/api/data/runtime/{command}"),
            Some(json!({ "expectedRevision": expected_revision, "args": args })),
            None,
        )?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn inventory_command(&mut self, command: &str, args: Value) -> Result<Value, IpcError> {
        let expected_revision = self.expected_revision()?;
        let result = self.request(
            "POST",
            &format!("/api/data/inventory/{command}"),
            Some(json!({ "expectedRevision": expected_revision, "args": args })),
            None,
        )?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn print_inventory_binding(&mut self, args: Value) -> Result<Value, IpcError> {
        let expected_revision = self.expected_revision()?;
        let result = self.request(
            "POST",
            "/api/data/inventory/print-binding",
            Some(json!({ "expectedRevision": expected_revision, "args": args })),
            None,
        )?;
        self.revision = result.get("revision").and_then(Value::as_u64);
        Ok(result.get("data").cloned().unwrap_or(Value::Null))
    }

    pub fn agent_import(
        &mut self,
        method: &str,
        path: &str,
        body: Option<Value>,
        secret: Option<&str>,
    ) -> Result<Value, IpcError> {
        self.request(method, path, body, secret)
    }

    fn expected_revision(&mut self) -> Result<u64, IpcError> {
        if let Some(revision) = self.revision {
            return Ok(revision);
        }
        self.status()?
            .get("revision")
            .and_then(Value::as_u64)
            .ok_or_else(|| IpcError::Message("DEVD status did not contain a revision.".into()))
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        secret: Option<&str>,
    ) -> Result<Value, IpcError> {
        let encoded_body = body.map(|value| serde_json::to_vec(&value)).transpose()?;
        let mut request = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nX-Tuckmark-Ipc: 1\r\nConnection: close\r\n"
        );
        if let Some(secret) = secret.filter(|value| !value.is_empty()) {
            request.push_str("X-Tuckmark-Agent-Import-Key: ");
            request.push_str(secret);
            request.push_str("\r\n");
        }
        if let Some(payload) = &encoded_body {
            request.push_str("Content-Type: application/json\r\n");
            request.push_str(&format!("Content-Length: {}\r\n", payload.len()));
        }
        request.push_str("\r\n");

        let response = with_stream(&self.instance, |stream| {
            stream.write_all(request.as_bytes())?;
            if let Some(payload) = &encoded_body {
                stream.write_all(payload)?;
            }
            stream.flush()?;
            let mut response = Vec::new();
            stream.read_to_end(&mut response)?;
            Ok(response)
        })?;
        parse_response(&response)
    }
}

pub fn resolve_instance(
    explicit: Option<&str>,
    fallback: Option<&str>,
) -> Result<String, IpcError> {
    reject_legacy_access()?;
    let environment = env::var("TUCKMARK_DEVD_INSTANCE").ok();
    let instance = explicit
        .or(fallback)
        .or(environment.as_deref())
        .ok_or_else(|| {
            IpcError::Message(
                "DEVD instance is required. Pass --instance or set TUCKMARK_DEVD_INSTANCE.".into(),
            )
        })?;
    validate_instance(instance)
}

pub fn reject_legacy_access() -> Result<(), IpcError> {
    if env::args().any(|argument| argument == "--data-dir" || argument == "--devd-url")
        || env::var("TUCKMARK_DEVD_URL")
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    {
        return Err(IpcError::Message(
            "Direct data-directory and HTTP DEVD access were removed. Use --instance or TUCKMARK_DEVD_INSTANCE.".into(),
        ));
    }
    Ok(())
}

pub fn validate_instance(value: &str) -> Result<String, IpcError> {
    let normalized = value.trim().to_ascii_lowercase();
    let valid = (1..=48).contains(&normalized.len())
        && normalized
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && normalized
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && normalized
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric);
    if !valid {
        return Err(IpcError::Message(
            "DEVD instance must be 1-48 lowercase letters, numbers, or hyphens and cannot end with a hyphen.".into(),
        ));
    }
    Ok(normalized)
}

fn user_token() -> String {
    let identity = if cfg!(windows) {
        env::var("USERNAME").unwrap_or_else(|_| "unknown".into())
    } else {
        env::var("USER").unwrap_or_else(|_| "unknown".into())
    };
    let uid = if cfg!(windows) {
        "windows".to_owned()
    } else {
        // SAFETY: getuid has no preconditions and does not mutate process state.
        unsafe { libc::getuid().to_string() }
    };
    digest_prefix(&format!("{identity}:{uid}"))
}

#[cfg(unix)]
fn with_stream<T>(
    instance: &str,
    operation: impl FnOnce(&mut dyn ReadWrite) -> std::io::Result<T>,
) -> Result<T, IpcError> {
    use std::os::unix::net::UnixStream;

    let runtime_root = env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    let address = runtime_root.join(format!(
        "t-{}",
        digest_prefix(&format!("{}:{instance}", user_token()))
    ));
    let mut stream = UnixStream::connect(&address)
        .map_err(|error| IpcError::Message(format!("DEVD IPC request failed: {}", error)))?;
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    operation(&mut stream).map_err(IpcError::from)
}

#[cfg(windows)]
fn with_stream<T>(
    instance: &str,
    operation: impl FnOnce(&mut dyn ReadWrite) -> std::io::Result<T>,
) -> Result<T, IpcError> {
    let address = format!(r"\\.\pipe\tuckmark-{}-{instance}", user_token());
    let mut stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(address)
        .map_err(|error| IpcError::Message(format!("DEVD IPC request failed: {error}")))?;
    operation(&mut stream).map_err(IpcError::from)
}

trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}

fn digest_prefix(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn parse_response(raw: &[u8]) -> Result<Value, IpcError> {
    let delimiter = raw
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or_else(|| IpcError::Message("DEVD IPC returned an invalid HTTP response.".into()))?;
    let headers = std::str::from_utf8(&raw[..delimiter])
        .map_err(|_| IpcError::Message("DEVD IPC returned an invalid HTTP response.".into()))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| IpcError::Message("DEVD IPC returned an invalid HTTP status.".into()))?;
    let is_chunked = headers
        .lines()
        .skip(1)
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"));
    let body = &raw[delimiter + 4..];
    let body = if is_chunked {
        decode_chunked(body)?
    } else {
        body.to_vec()
    };
    let value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body)?
    };
    if !(200..300).contains(&status) {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("DEVD request failed with status {status}."));
        return Err(IpcError::Message(message));
    }
    Ok(value)
}

fn decode_chunked(raw: &[u8]) -> Result<Vec<u8>, IpcError> {
    let mut cursor = 0;
    let mut output = Vec::new();
    loop {
        let line_end = raw[cursor..]
            .windows(2)
            .position(|bytes| bytes == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or_else(|| IpcError::Message("DEVD IPC returned invalid chunked data.".into()))?;
        let length = std::str::from_utf8(&raw[cursor..line_end])
            .ok()
            .and_then(|value| value.split(';').next())
            .and_then(|value| usize::from_str_radix(value, 16).ok())
            .ok_or_else(|| IpcError::Message("DEVD IPC returned invalid chunked data.".into()))?;
        cursor = line_end + 2;
        if length == 0 {
            return Ok(output);
        }
        let end = cursor.saturating_add(length);
        if raw.get(cursor..end).is_none() || raw.get(end..end + 2) != Some(b"\r\n") {
            return Err(IpcError::Message(
                "DEVD IPC returned invalid chunked data.".into(),
            ));
        }
        output.extend_from_slice(&raw[cursor..end]);
        cursor = end + 2;
    }
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}
