#![cfg(unix)]

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_tuckmark")
}

fn run(runtime: &Path, args: &[&str]) -> Output {
    Command::new(binary())
        .args(args)
        .env("XDG_RUNTIME_DIR", runtime)
        .env("TUCKMARK_MOCK_PRINTERS", "1")
        .output()
        .expect("run tuckmark")
}

fn socket_path(runtime: &Path, instance: &str) -> PathBuf {
    let user = env::var("USER").unwrap_or_else(|_| "unknown".into());
    let identity = format!("{}:{}", user, unsafe { libc::getuid() });
    let mut digest = Sha256::new();
    digest.update(identity);
    let token = digest
        .finalize_reset()
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    digest.update(format!("{}:{}", token, instance));
    let hash = digest.finalize();
    let suffix = hash[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    runtime.join(format!("t-{suffix}"))
}

fn bind(runtime: &Path, instance: &str) -> UnixListener {
    let path = socket_path(runtime, instance);
    let _ = fs::remove_file(&path);
    UnixListener::bind(path).expect("bind tuckmark IPC socket")
}

fn read_request(stream: &mut UnixStream) -> (String, Vec<u8>) {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    let header_end = loop {
        let count = stream.read(&mut buffer).expect("read request");
        assert!(count > 0, "request ended before headers");
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
    let content_length = headers
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() < header_end + content_length {
        let count = stream.read(&mut buffer).expect("read request body");
        assert!(count > 0, "request ended before body");
        bytes.extend_from_slice(&buffer[..count]);
    }
    (
        headers.lines().next().unwrap_or_default().to_owned(),
        bytes[header_end..header_end + content_length].to_vec(),
    )
}

fn respond(stream: &mut UnixStream, body: Value) {
    let body = serde_json::to_vec(&body).expect("encode response");
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .expect("write response headers");
    stream.write_all(&body).expect("write response body");
}

#[test]
fn fixture_error_cases_preserve_stdout_stderr_and_exit_codes() {
    let runtime = TempDir::new().expect("runtime dir");
    let missing = run(
        runtime.path(),
        &["inventory", "show", "--instance", "fixture-devd"],
    );
    assert_eq!(missing.status.code(), Some(1));
    assert_eq!(missing.stdout, b"");
    assert_eq!(missing.stderr, b"Missing required flag: --id\n");

    let legacy = run(
        runtime.path(),
        &["template", "list", "--data-dir", "/tmp/tuckmark-fixture"],
    );
    assert_eq!(legacy.status.code(), Some(1));
    assert_eq!(legacy.stdout, b"");
    assert_eq!(
        legacy.stderr,
        b"Direct data-directory and HTTP DEVD access were removed. Use --instance or TUCKMARK_DEVD_INSTANCE.\n"
    );

    let unknown = run(runtime.path(), &["does-not-exist"]);
    assert_eq!(unknown.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&unknown.stdout).contains("tuckmark commands:"));
    assert_eq!(unknown.stderr, b"");

    let nested = run(
        runtime.path(),
        &["template", "bogus", "--instance", "fixture-devd"],
    );
    assert_eq!(nested.status.code(), Some(1));
    assert_eq!(nested.stdout, b"");
    assert_eq!(
        nested.stderr,
        b"template supports list, show, import, update, rename, archive, restore, and delete.\n"
    );
}

#[test]
fn inventory_list_uses_named_ipc_and_matches_frozen_success_fixture() {
    let runtime = TempDir::new().expect("runtime dir");
    let listener = bind(runtime.path(), "fixture-devd");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept inventory request");
        let (request, _) = read_request(&mut stream);
        assert!(request.starts_with(
            "GET /api/data/inventory/materials?query=&includeArchived=false HTTP/1.1"
        ));
        respond(&mut stream, json!({"revision": 2, "data": []}));
    });

    let output = run(
        runtime.path(),
        &["inventory", "list", "--instance", "fixture-devd"],
    );
    server.join().expect("inventory server");
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(output.stderr, b"");
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).expect("inventory JSON"),
        json!({"instance": "fixture-devd", "materials": []})
    );
}

#[test]
fn agent_import_credentials_wait_and_fulfill_are_secret_safe() {
    let runtime = TempDir::new().expect("runtime dir");
    let credential_path = runtime.path().join("credential.json");
    let proposal_path = runtime.path().join("proposal.json");
    fs::write(&proposal_path, r#"{"source":"fixture","items":[]}"#).expect("proposal");
    let listener = bind(runtime.path(), "fixture-devd");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept create");
        let (request, body) = read_request(&mut stream);
        assert!(request.starts_with("POST /api/agent-import/sessions HTTP/1.1"));
        let request: Value = serde_json::from_slice(&body).expect("create body");
        let session_id = request["sessionId"].as_str().expect("session id");
        respond(
            &mut stream,
            json!({"session": {"id": session_id, "expiresAt": "2026-08-10T00:00:00Z"}}),
        );
        drop(stream);

        let (mut stream, _) = listener.accept().expect("accept wait");
        let (request, _) = read_request(&mut stream);
        assert!(request.starts_with("GET /api/agent-import/sessions/"));
        respond(
            &mut stream,
            json!({"events": [{"id": "event-1", "type": "approved"}]}),
        );
        drop(stream);

        let (mut stream, _) = listener.accept().expect("accept fulfill");
        let (request, _) = read_request(&mut stream);
        assert!(request.starts_with("POST /api/agent-import/sessions/"));
        respond(&mut stream, json!({"status": "fulfilled", "imported": 0}));
    });

    let create = run(
        runtime.path(),
        &[
            "agent-import",
            "create",
            "--instance",
            "fixture-devd",
            "--file",
            proposal_path.to_str().unwrap(),
            "--credential-file",
            credential_path.to_str().unwrap(),
            "--no-open",
        ],
    );
    assert_eq!(
        create.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&create.stderr)
    );
    assert_eq!(create.stderr, b"");
    assert!(!String::from_utf8_lossy(&create.stdout).contains("secret"));
    let session_id =
        serde_json::from_slice::<Value>(&create.stdout).expect("create JSON")["sessionId"]
            .as_str()
            .expect("created session id")
            .to_owned();
    let mode = fs::metadata(&credential_path)
        .expect("credential file")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600);

    let wait = run(
        runtime.path(),
        &[
            "agent-import",
            "wait",
            "--session",
            &session_id,
            "--credential-file",
            credential_path.to_str().unwrap(),
            "--timeout-ms",
            "0",
        ],
    );
    assert_eq!(
        wait.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&wait.stderr)
    );
    assert!(String::from_utf8_lossy(&wait.stdout).contains("event-1"));

    let fulfill = run(
        runtime.path(),
        &[
            "agent-import",
            "fulfill",
            "--session",
            &session_id,
            "--credential-file",
            credential_path.to_str().unwrap(),
            "--event",
            "event-1",
            "--revision",
            "2",
            "--input",
            "{}",
        ],
    );
    assert_eq!(fulfill.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&fulfill.stdout).contains("fulfilled"));
    server.join().expect("agent import server");
}

#[test]
fn local_template_package_preview_and_packets_use_native_engine() {
    let runtime = TempDir::new().expect("runtime dir");
    let artifacts = TempDir::new().expect("artifact dir");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/core/fixtures/electronics-component-label.package.json");
    let preview = Command::new(binary())
        .args([
            "template-package",
            "preview",
            "--file",
            fixture.to_str().unwrap(),
        ])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .env("TUCKMARK_CLI_ARTIFACT_DIR", artifacts.path())
        .output()
        .expect("run local preview");
    assert_eq!(preview.status.code(), Some(0));
    let result: Value = serde_json::from_slice(&preview.stdout).expect("preview JSON");
    assert_eq!(result["artifact"]["source"], "canvas");
    assert_eq!(result["artifact"]["width"], 192);
    assert!(Path::new(result["artifact"]["pngPath"].as_str().unwrap()).is_file());

    let packets = Command::new(binary())
        .args([
            "template-package",
            "packets",
            "--file",
            fixture.to_str().unwrap(),
        ])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .env("TUCKMARK_CLI_ARTIFACT_DIR", artifacts.path())
        .output()
        .expect("run local packets");
    assert_eq!(packets.status.code(), Some(0));
    let result: Value = serde_json::from_slice(&packets.stdout).expect("packets JSON");
    assert_eq!(result["preview"]["artifact"]["source"], "canvas");
    assert!(result["packets"]["packetCount"].as_u64().unwrap_or(0) > 0);

    let print = Command::new(binary())
        .args([
            "template-package",
            "print",
            "--file",
            fixture.to_str().unwrap(),
            "--printer",
            "mock-printer",
        ])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .env("TUCKMARK_CLI_ARTIFACT_DIR", artifacts.path())
        .env("TUCKMARK_MOCK_PRINTERS", "1")
        .output()
        .expect("run local print");
    assert_eq!(print.status.code(), Some(0));
    let result: Value = serde_json::from_slice(&print.stdout).expect("print JSON");
    assert_eq!(result["job"]["status"], "completed");
    assert!(result["job"]["packetCount"].as_u64().unwrap_or(0) > 0);
}

#[test]
fn template_package_uses_contract_defaults_and_identifier_rules() {
    let runtime = TempDir::new().expect("runtime dir");
    let package = runtime.path().join("minimal.package.json");
    fs::write(
        &package,
        r##"{
  "schema": "tuckmark.user-template-package.v1",
  "id": "9-valid-package",
  "name": "Valid Package",
  "canvas": { "width": 64, "height": 32 },
  "fields": [{ "key": "name", "label": "Name" }],
  "elements": [{ "kind": "text", "key": "name", "x": 2, "y": 2, "fontSize": 12 }]
}"##,
    )
    .expect("write valid package");
    let valid = run(
        runtime.path(),
        &[
            "template-package",
            "validate",
            "--file",
            package.to_str().unwrap(),
        ],
    );
    assert_eq!(
        valid.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );

    let invalid = runtime.path().join("invalid.package.json");
    fs::write(
        &invalid,
        r##"{
  "schema": "tuckmark.user-template-package.v1",
  "id": "-invalid",
  "name": "Invalid Package",
  "canvas": { "width": 64, "height": 32 },
  "fields": [{ "key": "name", "label": "Name" }],
  "elements": [{ "kind": "text", "key": "name", "x": 2, "y": 2, "fontSize": 12 }]
}"##,
    )
    .expect("write invalid package");
    let invalid = run(
        runtime.path(),
        &[
            "template-package",
            "validate",
            "--file",
            invalid.to_str().unwrap(),
        ],
    );
    assert_eq!(invalid.status.code(), Some(1));
    assert_eq!(
        invalid.stderr,
        b"Invalid user template package identifier.\n"
    );
}
