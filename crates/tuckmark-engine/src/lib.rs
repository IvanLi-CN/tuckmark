//! Native persistence, import, rendering, artifact, and print primitives.

mod agent_import;
mod archive_codec;
mod artifact_store;
mod authority;
mod print;
mod render;

pub use agent_import::{
    AgentImportCatalog, AgentImportError, AgentImportManager, CreateAgentImportSession,
    SessionCommitResult,
};
pub use archive_codec::{
    ArchiveCodecError, ArchiveZipInput, DirectoryTreeArchive, decode_archive_zip,
    decode_legacy_archive_metadata,
};
pub use artifact_store::{ArtifactStore, ArtifactStoreError};
pub use authority::{
    ArchiveImportMode, ArchiveImportResult, ArchiveInspection, ArchiveSummary, BackupRecord, Clock,
    CommitRequest, DataAuthority, DataAuthorityError, DataAuthorityOptions, ProcessProbe,
    SystemClock, SystemProcessProbe,
};
pub use print::{
    CompatibilityPackets, DetongerPrinterLink, PrintEngine, PrintError, PrintTransport,
};
pub use render::{MonoBitmap, RenderEngine, RenderError, RenderedArtifact, compile_canvas_draft};
pub use tuckmark_contracts::{
    AgentImportProposal, AgentImportSession, ArtifactPackets, DevdDataArchive, JsonWrite,
    RevisionEvent,
};

#[cfg(test)]
mod tests {
    #[test]
    fn production_engine_modules_do_not_spawn_external_processes() {
        let source = [
            include_str!("agent_import.rs"),
            include_str!("archive_codec.rs"),
            include_str!("artifact_store.rs"),
            include_str!("authority.rs"),
            include_str!("print.rs"),
            include_str!("render.rs"),
        ]
        .join("\n");
        let process_command = ["std::process", "::Command"].concat();
        let command_new = ["Command", "::new"].concat();

        assert!(!source.contains(&process_command));
        assert!(!source.contains(&command_new));
    }
}
