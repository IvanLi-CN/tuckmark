use std::{
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    process::ExitCode,
    time::Duration,
};

use tokio::net::TcpListener;
use tuckmark_devd::{
    AppState, DevdServerOptions,
    config::DevdConfig,
    ipc::resolve_required_instance,
    routes::{TransportContext, app_router_for_transport},
};

#[cfg(unix)]
use tuckmark_devd::ipc::bind_unix_ipc;
#[cfg(windows)]
use tuckmark_devd::ipc::bind_windows_ipc;

const USAGE: &str = "tuckmark-devd serve [--host HOST] [--port PORT] [--instance NAME] [--data-dir PATH] [--web-dist PATH]";

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("tuckmark-devd: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return Ok(());
    }
    let options = parse_options(&args)?;
    if args.first().is_some_and(|arg| arg != "serve") {
        return Err(format!("unknown command {}; expected serve", args[0]).into());
    }
    let instance = resolve_required_instance(options.instance.as_deref())?;
    if !is_loopback_bind_host(&options.host) {
        return Err("DEVD only binds to a loopback host.".into());
    }
    let config = DevdConfig::resolve(options.data_dir.clone())?;
    let state = AppState::open(config, options.web_dist.clone())?;
    let http_router = app_router_for_transport(state.clone(), TransportContext::Http);
    let ipc_router = app_router_for_transport(state, TransportContext::Ipc);
    let tcp = TcpListener::bind((options.host.as_str(), options.port)).await?;
    let actual_address = tcp.local_addr()?;
    println!("tuckmark-devd listening on http://{actual_address}");

    #[cfg(unix)]
    {
        let ipc = bind_unix_ipc(&instance).await?;
        let endpoint = ipc.endpoint().address.clone();
        let (ipc_listener, _cleanup) = ipc.into_parts();
        println!("tuckmark-devd IPC listening on {endpoint}");
        tokio::select! {
            result = axum::serve(tcp, http_router.into_make_service_with_connect_info::<SocketAddr>()) => result?,
            result = axum::serve(ipc_listener, ipc_router.into_make_service()) => result?,
            _ = shutdown_signal() => {}
        }
    }
    #[cfg(windows)]
    {
        let ipc = bind_windows_ipc(&instance)?;
        let endpoint = ipc.endpoint().address.clone();
        println!("tuckmark-devd IPC listening on {endpoint}");
        tokio::select! {
            result = axum::serve(tcp, http_router.into_make_service_with_connect_info::<SocketAddr>()) => result?,
            result = axum::serve(ipc, ipc_router.into_make_service()) => result?,
            _ = shutdown_signal() => {}
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = instance;
        let _ = ipc_router;
        tokio::select! {
            result = axum::serve(tcp, http_router.into_make_service_with_connect_info::<SocketAddr>()) => result?,
            _ = shutdown_signal() => {}
        }
    }
    Ok(())
}

fn is_loopback_bind_host(value: &str) -> bool {
    let host = value.trim().trim_matches(['[', ']']);
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn parse_options(
    args: &[String],
) -> Result<DevdServerOptions, Box<dyn std::error::Error + Send + Sync>> {
    let mut options = DevdServerOptions {
        instance: env::var("TUCKMARK_DEVD_INSTANCE").ok(),
        web_dist: env::var_os("TUCKMARK_WEB_DIST").map(PathBuf::from),
        ..DevdServerOptions::default()
    };
    let mut index = usize::from(args.first().is_some_and(|arg| arg == "serve"));
    while index < args.len() {
        let flag = &args[index];
        let Some(value) = args.get(index + 1) else {
            return Err(format!("{flag} requires a value").into());
        };
        match flag.as_str() {
            "--host" => options.host = value.clone(),
            "--port" => options.port = value.parse()?,
            "--instance" => options.instance = Some(value.clone()),
            "--data-dir" => options.data_dir = Some(PathBuf::from(value)),
            "--web-dist" => options.web_dist = Some(PathBuf::from(value)),
            _ => return Err(format!("unknown option {flag}").into()),
        }
        index += 2;
    }
    Ok(options)
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = signal.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
    tokio::time::sleep(Duration::from_millis(1)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_defaults_require_an_explicit_ipc_instance() {
        assert_eq!(DevdServerOptions::default().instance, None);
    }

    #[test]
    fn daemon_only_accepts_loopback_bind_hosts() {
        for allowed in ["localhost", "127.0.0.1", "::1", "[::1]"] {
            assert!(
                is_loopback_bind_host(allowed),
                "{allowed} should be allowed"
            );
        }
        for rejected in ["0.0.0.0", "192.0.2.67", "example.test"] {
            assert!(
                !is_loopback_bind_host(rejected),
                "{rejected} should be rejected"
            );
        }
    }
}
