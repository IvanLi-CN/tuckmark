//! Native local DEVD transport adapters for Tuckmark.

pub mod config;
pub mod data;
pub mod ipc;
pub mod routes;
pub mod service;
pub mod templates;

pub use service::{ArtifactAsset, NativeService, NativeServiceError};

pub use routes::{AppState, DevdServerOptions, app_router};
