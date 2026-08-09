mod ipc;

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, ExitCode},
    thread,
    time::{Duration, SystemTime},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::{Args, Parser, Subcommand, error::ErrorKind};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    DirectCanvasDefinition, RenderOptions, SafeTextLabelRequest, TemplateDefinition,
    TemplateElement,
};
use tuckmark_engine::{
    ArtifactStore, ArtifactStoreError, PrintEngine, PrintError, RenderEngine, RenderError,
};
use uuid::Uuid;

use crate::ipc::{DevdClient, IpcError, reject_legacy_access, resolve_instance};

#[derive(Debug, Error)]
enum CliError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Ipc(#[from] IpcError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Render(#[from] RenderError),
    #[error(transparent)]
    Artifact(#[from] ArtifactStoreError),
    #[error(transparent)]
    Print(#[from] PrintError),
}

type Result<T> = std::result::Result<T, CliError>;

#[derive(Debug, Parser)]
#[command(
    name = "tuckmark",
    disable_help_flag = true,
    disable_help_subcommand = true,
    disable_version_flag = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<CommandTree>,
}

#[derive(Debug, Subcommand)]
enum CommandTree {
    Help,
    Templates,
    Template(TemplateArgs),
    Inventory(InventoryArgs),
    #[command(name = "agent-import")]
    AgentImport(AgentImportArgs),
    Config(ConfigArgs),
    Printers,
    Probe(ProbeArgs),
    Preview(PreviewArgs),
    #[command(name = "batch-preview")]
    BatchPreview(BatchPreviewArgs),
    Print(PrintArgs),
    #[command(name = "template-package")]
    TemplatePackage(TemplatePackageArgs),
}

#[derive(Debug, Args)]
struct TemplateArgs {
    #[command(subcommand)]
    command: Option<TemplateCommand>,
}

#[derive(Debug, Subcommand)]
enum TemplateCommand {
    List(InstanceArgs),
    Show(IdInstanceArgs),
    Import(TemplateImportArgs),
    Update(TemplateUpdateArgs),
    Rename(TemplateRenameArgs),
    Archive(IdInstanceArgs),
    Restore(IdInstanceArgs),
    Delete(IdInstanceArgs),
}

#[derive(Debug, Args)]
struct InstanceArgs {
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long)]
    all: bool,
}

#[derive(Debug, Args)]
struct IdInstanceArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    instance: Option<String>,
}

#[derive(Debug, Args)]
struct TemplateImportArgs {
    #[arg(long)]
    file: Option<PathBuf>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    description: Option<String>,
}

#[derive(Debug, Args)]
struct TemplateUpdateArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long = "recommended-use")]
    recommended_use: Option<String>,
}

#[derive(Debug, Args)]
struct TemplateRenameArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    instance: Option<String>,
}

#[derive(Debug, Args)]
struct InventoryArgs {
    #[command(subcommand)]
    command: Option<InventoryCommand>,
}

#[derive(Debug, Subcommand)]
enum InventoryCommand {
    List(InventoryListArgs),
    Show(IdInstanceArgs),
    Create(InventoryCreateArgs),
    Update(InventoryUpdateArgs),
    Archive(IdInstanceArgs),
    Restore(IdInstanceArgs),
    Delete(IdInstanceArgs),
    Adjust(InventoryAdjustArgs),
    Print(InventoryPrintArgs),
}

#[derive(Debug, Args)]
struct InventoryListArgs {
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    query: Option<String>,
    #[arg(long)]
    all: bool,
}

#[derive(Debug, Args)]
struct InventoryCreateArgs {
    #[arg(long = "full-name")]
    full_name: Option<String>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long = "base-name")]
    base_name: Option<String>,
    #[arg(long = "variant-name")]
    variant_name: Option<String>,
    #[arg(long = "package-name")]
    package_name: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long = "device-details")]
    device_details: Option<String>,
    #[arg(long = "matrix-code")]
    matrix_code: Option<String>,
    #[arg(long = "packaging-remark")]
    packaging_remark: Option<String>,
    #[arg(long)]
    bindings: Option<String>,
}

#[derive(Debug, Args)]
struct InventoryUpdateArgs {
    #[arg(long)]
    id: Option<String>,
    #[command(flatten)]
    fields: InventoryCreateArgs,
}

#[derive(Debug, Args)]
struct InventoryAdjustArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    quantity: Option<String>,
    #[arg(long = "target-quantity")]
    target_quantity: Option<String>,
    #[arg(long)]
    note: Option<String>,
    #[arg(long)]
    actor: Option<String>,
}

#[derive(Debug, Args)]
struct InventoryPrintArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    binding: Option<String>,
    #[arg(long)]
    printer: Option<String>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long = "printer-name")]
    printer_name: Option<String>,
    #[arg(long)]
    quantity: Option<String>,
    #[arg(long = "render-options")]
    render_options: Option<String>,
}

#[derive(Debug, Args)]
struct AgentImportArgs {
    #[command(subcommand)]
    command: Option<AgentImportCommand>,
}

#[derive(Debug, Subcommand)]
enum AgentImportCommand {
    Catalog(InstanceOnlyArgs),
    Inventory(AgentInventoryArgs),
    Create(AgentCreateArgs),
    Open(AgentCredentialArgs),
    Wait(AgentWaitArgs),
    Fulfill(AgentFulfillArgs),
}

#[derive(Debug, Args)]
struct InstanceOnlyArgs {
    #[arg(long)]
    instance: Option<String>,
}

#[derive(Debug, Args)]
struct AgentInventoryArgs {
    #[arg(long)]
    instance: Option<String>,
    #[arg(long)]
    query: Option<String>,
}

#[derive(Debug, Args)]
struct AgentCreateArgs {
    #[arg(long)]
    file: Option<PathBuf>,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long = "web-url")]
    web_url: Option<String>,
    #[arg(long = "no-open")]
    no_open: bool,
    #[arg(long = "credential-file")]
    credential_file: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct AgentCredentialArgs {
    #[arg(long)]
    session: Option<String>,
    #[arg(long = "web-url")]
    web_url: Option<String>,
    #[arg(long = "credential-file")]
    credential_file: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct AgentWaitArgs {
    #[command(flatten)]
    credential: AgentCredentialArgs,
    #[arg(long)]
    instance: Option<String>,
    #[arg(long = "timeout-ms")]
    timeout_ms: Option<String>,
}

#[derive(Debug, Args)]
struct AgentFulfillArgs {
    #[command(flatten)]
    credential: AgentCredentialArgs,
    #[arg(long)]
    event: Option<String>,
    #[arg(long)]
    revision: Option<String>,
    #[arg(long)]
    input: Option<String>,
    #[arg(long)]
    instance: Option<String>,
}

#[derive(Debug, Args)]
struct ConfigArgs {
    #[command(subcommand)]
    command: Option<ConfigCommand>,
}

#[derive(Debug, Subcommand)]
enum ConfigCommand {
    #[command(name = "get-data-dir")]
    GetDataDir(InstanceOnlyArgs),
    #[command(name = "set-data-dir")]
    SetDataDir(ConfigSetDataDirArgs),
}

#[derive(Debug, Args)]
struct ConfigSetDataDirArgs {
    #[arg(long)]
    path: Option<PathBuf>,
    #[arg(long)]
    instance: Option<String>,
}

#[derive(Debug, Args)]
struct ProbeArgs {
    #[arg(long)]
    printer: Option<String>,
    #[arg(long = "printer-name")]
    printer_name: Option<String>,
}

#[derive(Debug, Args)]
struct PreviewArgs {
    #[arg(long)]
    template: Option<String>,
    #[arg(long)]
    input: Option<String>,
    #[arg(long)]
    canvas: Option<String>,
    #[arg(long = "safe-text")]
    safe_text: Option<String>,
    #[arg(long = "render-options")]
    render_options: Option<String>,
}

#[derive(Debug, Args)]
struct BatchPreviewArgs {
    #[arg(long)]
    template: Option<String>,
    #[arg(long)]
    csv: Option<PathBuf>,
    #[arg(long = "render-options")]
    render_options: Option<String>,
}

#[derive(Debug, Args)]
struct PrintArgs {
    #[arg(long)]
    printer: Option<String>,
    #[arg(long = "printer-name")]
    printer_name: Option<String>,
    #[arg(long)]
    artifact: Option<String>,
    #[arg(long)]
    artifacts: Option<String>,
    #[arg(long = "safe-text")]
    safe_text: Option<String>,
    #[arg(long)]
    template: Option<String>,
    #[arg(long)]
    input: Option<String>,
    #[arg(long = "render-options")]
    render_options: Option<String>,
}

#[derive(Debug, Args)]
struct TemplatePackageArgs {
    #[command(subcommand)]
    command: Option<TemplatePackageCommand>,
}

#[derive(Debug, Subcommand)]
enum TemplatePackageCommand {
    Validate(PackageFileArgs),
    Preview(PackageRenderArgs),
    Packets(PackageRenderArgs),
    Print(PackagePrintArgs),
}

#[derive(Debug, Args)]
struct PackageFileArgs {
    #[arg(long)]
    file: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct PackageRenderArgs {
    #[command(flatten)]
    file: PackageFileArgs,
    #[arg(long)]
    input: Option<String>,
    #[arg(long = "render-options")]
    render_options: Option<String>,
}

#[derive(Debug, Args)]
struct PackagePrintArgs {
    #[command(flatten)]
    render: PackageRenderArgs,
    #[arg(long)]
    printer: Option<String>,
    #[arg(long = "printer-name")]
    printer_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplatePackage {
    schema: String,
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    canvas: PackageCanvas,
    #[serde(default)]
    fields: Vec<PackageField>,
    elements: Vec<TemplateElement>,
    #[serde(default)]
    sample_input: BTreeMap<String, String>,
    #[serde(default = "empty_object")]
    render_options: Value,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    recommended_use: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct PackageCanvas {
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageField {
    key: String,
    label: String,
    #[serde(default)]
    default_value: String,
    #[serde(default)]
    multiline: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentCredential {
    session_id: String,
    secret: String,
    instance: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    web_url: Option<String>,
    expires_at: String,
}

fn main() -> ExitCode {
    if let Err(error) = reject_legacy_access() {
        eprintln!("{error}");
        return ExitCode::FAILURE;
    }
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) if error.kind() == ErrorKind::InvalidSubcommand => {
            if let Some(message) = nested_subcommand_error() {
                eprintln!("{message}");
                return ExitCode::FAILURE;
            }
            print_help();
            return ExitCode::FAILURE;
        }
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        None | Some(CommandTree::Help) => print_help(),
        Some(CommandTree::Templates) => output_json(&system_templates()?)?,
        Some(CommandTree::Template(args)) => handle_template(args)?,
        Some(CommandTree::Inventory(args)) => handle_inventory(args)?,
        Some(CommandTree::AgentImport(args)) => handle_agent_import(args)?,
        Some(CommandTree::Config(args)) => handle_config(args)?,
        Some(CommandTree::Printers) => output_json(&list_printers()?)?,
        Some(CommandTree::Probe(args)) => handle_probe(args)?,
        Some(CommandTree::Preview(args)) => handle_preview(args)?,
        Some(CommandTree::BatchPreview(args)) => handle_batch_preview(args)?,
        Some(CommandTree::Print(args)) => handle_print(args)?,
        Some(CommandTree::TemplatePackage(args)) => handle_template_package(args)?,
    }
    Ok(())
}

fn print_help() {
    println!(
        "tuckmark commands:\n  tuckmark templates\n  tuckmark template list --instance <name> [--source <all|system|user>] [--all]\n  tuckmark template show --id <id> --instance <name>\n  tuckmark template import --file <path> --instance <name> [--id <id>] [--name <name>] [--description <text>]\n  tuckmark template update --id <id> --instance <name> [--name <name>] [--description <text>] [--recommended-use <text>]\n  tuckmark template rename --id <id> --name <name> --instance <name>\n  tuckmark template archive --id <id> --instance <name>\n  tuckmark template restore --id <id> --instance <name>\n  tuckmark template delete --id <id> --instance <name>\n  tuckmark inventory list --instance <name> [--query <text>] [--all]\n  tuckmark inventory show --id <id> --instance <name>\n  tuckmark inventory create --full-name <name> --instance <name> [--bindings <json>]\n  tuckmark inventory update --id <id> --instance <name> [--bindings <json>]\n  tuckmark inventory archive --id <id> --instance <name>\n  tuckmark inventory restore --id <id> --instance <name>\n  tuckmark inventory delete --id <id> --instance <name>\n  tuckmark agent-import catalog --instance <name>\n  tuckmark agent-import inventory --instance <name> [--query <text>]\n  tuckmark agent-import create --file <proposal.json> --instance <name> [--web-url <url>] [--no-open] [--credential-file <path>]\n  tuckmark agent-import open --session <id> [--web-url <url>] [--credential-file <path>]\n  tuckmark agent-import wait --session <id> --instance <name> [--timeout-ms <ms>] [--credential-file <path>]\n  tuckmark agent-import fulfill --session <id> --event <id> --revision <n> --input <json> --instance <name> [--credential-file <path>]\n  tuckmark inventory adjust --id <id> --instance <name> --kind <in|out|correction> [--quantity <n>] [--target-quantity <n>] [--note <text>] [--actor <name>]\n  tuckmark inventory print --id <id> --binding <bindingId> --printer <printerId> --instance <name> [--printer-name <name>] [--quantity <n>] [--render-options <json>]\n  tuckmark config get-data-dir --instance <name>\n  tuckmark config set-data-dir --path <dir> --instance <name>\n  tuckmark printers\n  tuckmark probe --printer <id> [--printer-name <name>]\n  tuckmark preview --template <id> --input <json> [--render-options <json>]\n  tuckmark preview --canvas <json> [--render-options <json>]\n  tuckmark preview --safe-text <json> [--render-options <json>]\n  tuckmark batch-preview --template <id> --csv <path> [--render-options <json>]\n  tuckmark print --printer <id> [--printer-name <name>] --artifact <id>\n  tuckmark print --printer <id> [--printer-name <name>] --artifacts <json-array>\n  tuckmark print --printer <id> [--printer-name <name>] --safe-text <json> [--render-options <json>]\n  tuckmark print --printer <id> [--printer-name <name>] --template <id> --input <json> [--render-options <json>]\n  tuckmark template-package validate --file <path>\n  tuckmark template-package preview --file <path> [--input <json>] [--render-options <json>]\n  tuckmark template-package packets --file <path> [--input <json>] [--render-options <json>]\n  tuckmark template-package print --printer <id> [--printer-name <name>] --file <path> [--input <json>] [--render-options <json>]"
    );
}

fn handle_template(args: TemplateArgs) -> Result<()> {
    let command = args.command.ok_or_else(|| {
        CliError::Message(
            "template supports list, show, import, update, rename, archive, restore, and delete."
                .into(),
        )
    })?;
    match command {
        TemplateCommand::List(args) => {
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let snapshot = client.snapshot()?;
            let source = args.source.as_deref().unwrap_or("all");
            let mut templates = Vec::new();
            if source != "user" {
                templates.extend(system_templates()?.into_iter().map(|template| {
                    json!({
                        "source": "system",
                        "id": template.id,
                        "name": template.name,
                        "description": template.description,
                        "fields": template.fields.into_iter().map(|field| field.key).collect::<Vec<_>>(),
                    })
                }));
            }
            if source != "system" {
                let versions = json_array(&snapshot, "versions")?;
                let copies = json_array(&snapshot, "workingCopies")?;
                for template in json_array(&snapshot, "templates")? {
                    if !args.all
                        && template
                            .get("archivedAt")
                            .is_some_and(|value| !value.is_null())
                    {
                        continue;
                    }
                    let id = string_field(template, "id")?;
                    let document = copies
                        .iter()
                        .find(|copy| {
                            copy.get("sourceKey") == Some(&Value::String(format!("user:{id}")))
                        })
                        .and_then(|copy| copy.get("draft"))
                        .or_else(|| {
                            let current_version = template.get("currentVersionId");
                            versions
                                .iter()
                                .find(|version| version.get("id") == current_version)
                                .and_then(|version| version.get("document"))
                        });
                    let fields = document
                        .and_then(|document| document.get("fields"))
                        .and_then(Value::as_array)
                        .map(|fields| {
                            fields
                                .iter()
                                .filter_map(|field| field.get("key").and_then(Value::as_str))
                                .map(|key| Value::String(key.to_owned()))
                                .collect::<Vec<_>>()
                        })
                        .or_else(|| {
                            template
                                .get("fieldOrder")
                                .and_then(Value::as_array)
                                .cloned()
                        })
                        .unwrap_or_default();
                    let mut output = Map::new();
                    output.insert("source".into(), Value::String("user-template".into()));
                    for field in ["id", "name", "description", "archivedAt", "updatedAt"] {
                        output.insert(
                            field.into(),
                            template.get(field).cloned().unwrap_or(Value::Null),
                        );
                    }
                    output.insert("fields".into(), Value::Array(fields));
                    if let Some(recommended) = template.get("recommendedUse") {
                        output.insert("recommendedUse".into(), recommended.clone());
                    }
                    templates.push(Value::Object(output));
                }
            }
            output_json(&json!({ "instance": client.instance, "templates": templates }))?;
        }
        TemplateCommand::Show(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            if let Some(template) = system_templates()?
                .into_iter()
                .find(|template| template.id == id)
            {
                output_json(&json!({ "source": "system", "template": template }))?;
                return Ok(());
            }
            let snapshot = client.snapshot()?;
            let templates = json_array(&snapshot, "templates")?;
            let template = templates
                .iter()
                .find(|template| template.get("id") == Some(&Value::String(id.clone())))
                .ok_or_else(|| CliError::Message(format!("Template {id} was not found.")))?;
            let versions = json_array(&snapshot, "versions")?;
            let working = json_array(&snapshot, "workingCopies")?
                .iter()
                .find(|copy| copy.get("sourceKey") == Some(&Value::String(format!("user:{id}"))));
            let document = working
                .and_then(|copy| copy.get("draft"))
                .or_else(|| {
                    versions
                        .iter()
                        .find(|version| version.get("id") == template.get("currentVersionId"))
                        .and_then(|version| version.get("document"))
                })
                .cloned()
                .unwrap_or(Value::Null);
            let mut detail = template.as_object().cloned().unwrap_or_default();
            detail.insert(
                "fields".into(),
                document
                    .get("fields")
                    .cloned()
                    .or_else(|| template.get("fieldOrder").cloned())
                    .unwrap_or_default(),
            );
            detail.insert("document".into(), document);
            let saved_versions = versions
                .iter()
                .filter(|version| {
                    version.get("templateId") == Some(&Value::String(id.clone()))
                        && version.get("kind") == Some(&Value::String("saved".into()))
                })
                .map(version_summary)
                .collect::<Vec<_>>();
            let autosaves = versions
                .iter()
                .filter(|version| {
                    version.get("templateId") == Some(&Value::String(id.clone()))
                        && version.get("kind") == Some(&Value::String("autosave".into()))
                })
                .map(version_summary)
                .collect::<Vec<_>>();
            output_json(&json!({
                "source": "user-template",
                "template": detail,
                "workingCopyUpdatedAt": working.and_then(|copy| copy.get("updatedAt")).cloned().unwrap_or(Value::Null),
                "savedVersions": saved_versions,
                "autosaves": autosaves,
            }))?;
        }
        TemplateCommand::Import(args) => {
            let package = read_template_package(require_flag(args.file, "--file")?)?;
            let template_id = args.id.unwrap_or_else(|| package.id.clone());
            let name = args.name.unwrap_or_else(|| package.name.clone());
            let description = args
                .description
                .unwrap_or_else(|| package.description.clone());
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let imported = client.runtime_command(
                "save-template",
                json!({
                    "templateId": template_id,
                    "name": name,
                    "description": description,
                    "document": package_to_canvas_draft(&package, &template_id, &name, &description),
                }),
            )?;
            output_json(&json!({ "instance": client.instance, "imported": imported }))?;
        }
        TemplateCommand::Update(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut patch = Map::new();
            for (name, value) in [
                ("name", args.name),
                ("description", args.description),
                ("recommendedUse", args.recommended_use),
            ] {
                if let Some(value) = value {
                    patch.insert(name.into(), Value::String(value));
                }
            }
            if patch.is_empty() {
                return Err(CliError::Message(
                    "template update requires a metadata flag.".into(),
                ));
            }
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let template = client.runtime_command(
                "update-template-metadata",
                json!({ "templateId": id, "patch": patch }),
            )?;
            output_json(&json!({ "instance": client.instance, "template": template }))?;
        }
        TemplateCommand::Rename(args) => {
            let id = require_flag(args.id, "--id")?;
            let name = require_flag(args.name, "--name")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let template = client
                .runtime_command("rename-template", json!({ "templateId": id, "name": name }))?;
            output_json(&json!({ "instance": client.instance, "template": template }))?;
        }
        TemplateCommand::Archive(args) => template_lifecycle("archive-template", args)?,
        TemplateCommand::Restore(args) => template_lifecycle("restore-template", args)?,
        TemplateCommand::Delete(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let data = client.runtime_command("purge-template", json!({ "templateId": id }))?;
            output_json(&json!({ "ok": true, "instance": client.instance, "data": data }))?;
        }
    }
    Ok(())
}

fn template_lifecycle(command: &str, args: IdInstanceArgs) -> Result<()> {
    let id = require_flag(args.id, "--id")?;
    let mut client = devd_client(args.instance.as_deref(), None)?;
    let template = client.runtime_command(command, json!({ "templateId": id }))?;
    output_json(&json!({ "instance": client.instance, "template": template }))
}

fn handle_inventory(args: InventoryArgs) -> Result<()> {
    let command = args.command.ok_or_else(|| CliError::Message(
        "inventory supports list, show, create, update, archive, restore, delete, adjust, and print.".into(),
    ))?;
    match command {
        InventoryCommand::List(args) => {
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let materials = client.list_materials(args.query.as_deref().unwrap_or(""), args.all)?;
            output_json(&json!({ "instance": client.instance, "materials": materials }))?;
        }
        InventoryCommand::Show(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let material = client
                .list_materials("", true)?
                .as_array()
                .and_then(|materials| {
                    materials
                        .iter()
                        .find(|entry| entry.get("id") == Some(&Value::String(id.clone())))
                })
                .cloned()
                .ok_or_else(|| CliError::Message(format!("Material {id} was not found.")))?;
            let adjustments = client.list_adjustments(Some(&id))?;
            output_json(
                &json!({ "instance": client.instance, "material": material, "adjustments": adjustments }),
            )?;
        }
        InventoryCommand::Create(args) => {
            let full_name = require_flag(args.full_name.clone(), "--full-name")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let material = client
                .inventory_command("save-material", inventory_payload(&args, None, full_name)?)?;
            output_json(&json!({ "instance": client.instance, "material": material }))?;
        }
        InventoryCommand::Update(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut client = devd_client(args.fields.instance.as_deref(), None)?;
            let current = client
                .list_materials("", true)?
                .as_array()
                .and_then(|materials| {
                    materials
                        .iter()
                        .find(|entry| entry.get("id") == Some(&Value::String(id.clone())))
                })
                .cloned()
                .ok_or_else(|| CliError::Message(format!("Material {id} was not found.")))?;
            let full_name = args.fields.full_name.clone().or_else(|| {
                current
                    .get("fullName")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
            let mut payload = inventory_payload(
                &args.fields,
                Some(id),
                require_flag(full_name, "--full-name")?,
            )?;
            let payload = payload
                .as_object_mut()
                .expect("inventory payload is an object");
            for (source, target) in [
                ("baseName", "baseName"),
                ("variantName", "variantName"),
                ("packageName", "packageName"),
                ("description", "description"),
                ("deviceDetails", "deviceDetails"),
                ("matrixCode", "matrixCode"),
                ("packagingRemark", "packagingRemark"),
                ("labelBindings", "labelBindings"),
            ] {
                if !payload.contains_key(target)
                    && let Some(value) = current.get(source)
                {
                    payload.insert(target.into(), value.clone());
                }
            }
            let material =
                client.inventory_command("save-material", Value::Object(payload.clone()))?;
            output_json(&json!({ "instance": client.instance, "material": material }))?;
        }
        InventoryCommand::Archive(args) => inventory_lifecycle("archive-material", args)?,
        InventoryCommand::Restore(args) => inventory_lifecycle("restore-material", args)?,
        InventoryCommand::Delete(args) => {
            let id = require_flag(args.id, "--id")?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            client.inventory_command("delete-material", json!({ "materialId": id }))?;
            output_json(&json!({ "ok": true, "instance": client.instance }))?;
        }
        InventoryCommand::Adjust(args) => handle_inventory_adjust(args)?,
        InventoryCommand::Print(args) => {
            let id = require_flag(args.id, "--id")?;
            let binding = require_flag(args.binding, "--binding")?;
            let printer = require_flag(args.printer, "--printer")?;
            let quantity = parse_optional_integer(args.quantity, "--quantity")?;
            let render_options = parse_optional_render_options(args.render_options)?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let result = client.print_inventory_binding(json!({
                "materialId": id,
                "bindingId": binding,
                "printerId": printer,
                "printerName": args.printer_name,
                "quantity": quantity,
                "renderOptions": render_options,
            }))?;
            output_json(&json!({ "instance": client.instance, "result": result }))?;
        }
    }
    Ok(())
}

fn inventory_lifecycle(command: &str, args: IdInstanceArgs) -> Result<()> {
    let id = require_flag(args.id, "--id")?;
    let mut client = devd_client(args.instance.as_deref(), None)?;
    let material = client.inventory_command(command, json!({ "materialId": id }))?;
    output_json(&json!({ "instance": client.instance, "material": material }))
}

fn handle_inventory_adjust(args: InventoryAdjustArgs) -> Result<()> {
    let id = require_flag(args.id, "--id")?;
    let kind = require_flag(args.kind, "--kind")?;
    if !matches!(kind.as_str(), "in" | "out" | "correction") {
        return Err(CliError::Message(format!(
            "Invalid enum value. Expected 'in' | 'out' | 'correction', received '{kind}'"
        )));
    }
    let quantity = parse_optional_integer(args.quantity, "--quantity")?;
    let target_quantity = parse_optional_integer(args.target_quantity, "--target-quantity")?;
    let input = if kind == "correction" {
        let target = target_quantity.filter(|value| *value >= 0).ok_or_else(|| {
            CliError::Message(
                "Correction adjustments require a non-negative --target-quantity.".into(),
            )
        })?;
        json!({ "kind": kind, "targetQuantity": target, "note": args.note.unwrap_or_default().trim(), "actor": args.actor.unwrap_or_else(|| "cli".into()) })
    } else {
        let quantity = quantity.filter(|value| *value >= 1).ok_or_else(|| {
            CliError::Message("In and out adjustments require a positive --quantity.".into())
        })?;
        json!({ "kind": kind, "quantity": quantity, "note": args.note.unwrap_or_default().trim(), "actor": args.actor.unwrap_or_else(|| "cli".into()) })
    };
    let mut client = devd_client(args.instance.as_deref(), None)?;
    let result = client.inventory_command(
        "apply-adjustment",
        json!({ "materialId": id, "input": input }),
    )?;
    output_json(&json!({ "instance": client.instance, "result": result }))
}

fn handle_agent_import(args: AgentImportArgs) -> Result<()> {
    reject_legacy_access()?;
    let command = args.command.ok_or_else(|| {
        CliError::Message(
            "agent-import supports catalog, inventory, create, open, wait, and fulfill.".into(),
        )
    })?;
    match command {
        AgentImportCommand::Catalog(args) => {
            let mut client = devd_client(args.instance.as_deref(), None)?;
            output_json(&client.agent_import("GET", "/api/agent-import/catalog", None, None)?)?;
        }
        AgentImportCommand::Inventory(args) => {
            let mut client = devd_client(args.instance.as_deref(), None)?;
            let path = args
                .query
                .map(|query| {
                    format!(
                        "/api/agent-import/inventory?query={}",
                        percent_encode(&query)
                    )
                })
                .unwrap_or_else(|| "/api/agent-import/inventory".into());
            output_json(&client.agent_import("GET", &path, None, None)?)?;
        }
        AgentImportCommand::Create(args) => handle_agent_import_create(args)?,
        AgentImportCommand::Open(args) => {
            let credential = read_credential(args.session, args.credential_file)?;
            let web_url = resolve_web_url(args.web_url.as_deref(), credential.web_url.as_deref())?;
            launch_confirmation_url(&confirmation_url(&web_url, &credential))?;
            output_json(&json!({ "sessionId": credential.session_id, "opened": true }))?;
        }
        AgentImportCommand::Wait(args) => handle_agent_import_wait(args)?,
        AgentImportCommand::Fulfill(args) => handle_agent_import_fulfill(args)?,
    }
    Ok(())
}

fn handle_agent_import_create(args: AgentCreateArgs) -> Result<()> {
    let proposal_path = require_flag(args.file, "--file")?;
    let proposal = read_json_file(&proposal_path)?;
    let web_url = resolve_web_url(args.web_url.as_deref(), None)?;
    let mut client = devd_client(args.instance.as_deref(), None)?;
    let session_id = format!("agent-import-session-{}", Uuid::new_v4());
    let secret = generated_secret();
    let response = client.agent_import(
        "POST",
        "/api/agent-import/sessions",
        Some(json!({ "sessionId": session_id, "secret": secret, "proposal": proposal })),
        None,
    )?;
    let session = response.get("session").ok_or_else(|| {
        CliError::Message("Agent Import response did not include a session.".into())
    })?;
    let credential = AgentCredential {
        session_id: string_field(session, "id")?,
        secret,
        instance: client.instance,
        web_url: Some(web_url.clone()),
        expires_at: string_field(session, "expiresAt")?,
    };
    let credential_file = args
        .credential_file
        .unwrap_or_else(|| default_credential_path(&credential.session_id));
    let credential_file = absolute_path(&credential_file)?;
    write_credential(&credential_file, &credential)?;
    if !args.no_open {
        launch_confirmation_url(&confirmation_url(&web_url, &credential))?;
    }
    output_json(&json!({
        "sessionId": credential.session_id,
        "expiresAt": credential.expires_at,
        "credentialFile": credential_file,
        "confirmationOrigin": web_url,
        "opened": !args.no_open,
    }))
}

fn handle_agent_import_wait(args: AgentWaitArgs) -> Result<()> {
    let credential = read_credential(args.credential.session, args.credential.credential_file)?;
    let mut client = devd_client(args.instance.as_deref(), Some(&credential.instance))?;
    let timeout_ms = parse_optional_integer(args.timeout_ms, "--timeout-ms")?.unwrap_or(25_000);
    if timeout_ms < 0 {
        return Err(CliError::Message(
            "--timeout-ms must be zero or greater.".into(),
        ));
    }
    let started = SystemTime::now();
    loop {
        let path = format!(
            "/api/agent-import/sessions/{}/events",
            percent_encode(&credential.session_id)
        );
        let response = client.agent_import("GET", &path, None, Some(&credential.secret))?;
        let events = response
            .get("events")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !events.is_empty() {
            return output_json(
                &json!({ "sessionId": credential.session_id, "events": events, "waiting": false }),
            );
        }
        let elapsed = started.elapsed().unwrap_or_default().as_millis() as i64;
        if elapsed >= timeout_ms {
            return output_json(
                &json!({ "sessionId": credential.session_id, "events": [], "waiting": true }),
            );
        }
        thread::sleep(Duration::from_millis(
            (timeout_ms - elapsed).min(1_000) as u64
        ));
    }
}

fn handle_agent_import_fulfill(args: AgentFulfillArgs) -> Result<()> {
    let credential = read_credential(args.credential.session, args.credential.credential_file)?;
    let event = require_flag(args.event, "--event")?;
    let revision = parse_optional_integer(args.revision, "--revision")?
        .ok_or_else(|| CliError::Message("Missing required flag: --revision".into()))?;
    let input = parse_string_record(require_flag(args.input, "--input")?, "--input")?;
    let mut client = devd_client(args.instance.as_deref(), Some(&credential.instance))?;
    let path = format!(
        "/api/agent-import/sessions/{}/events/{}/fulfill",
        percent_encode(&credential.session_id),
        percent_encode(&event)
    );
    let session = client.agent_import(
        "POST",
        &path,
        Some(json!({ "expectedRevision": revision, "input": input })),
        Some(&credential.secret),
    )?;
    output_json(&session)
}

fn handle_config(args: ConfigArgs) -> Result<()> {
    let command = args
        .command
        .ok_or_else(|| CliError::Message("config requires get-data-dir or set-data-dir.".into()))?;
    match command {
        ConfigCommand::GetDataDir(args) => {
            let mut client = devd_client(args.instance.as_deref(), None)?;
            output_json(&client.data_directory_config()?)?;
        }
        ConfigCommand::SetDataDir(args) => {
            let path = absolute_path(&require_flag(args.path, "--path")?)?;
            let mut client = devd_client(args.instance.as_deref(), None)?;
            output_json(&client.set_data_directory(path.to_string_lossy().into_owned())?)?;
        }
    }
    Ok(())
}

fn handle_probe(args: ProbeArgs) -> Result<()> {
    let printer_id = require_flag(args.printer, "--printer")?;
    let printer = resolve_printer(&printer_id, args.printer_name.as_deref())?;
    output_json(&json!({ "printer": printer, "reachable": true }))
}

fn handle_preview(args: PreviewArgs) -> Result<()> {
    let options = parse_optional_render_options(args.render_options)?;
    let store = local_artifact_store();
    let engine = RenderEngine::new();
    let artifact = if let Some(template_id) = args.template {
        let template = get_system_template(&template_id)?;
        let input = parse_string_record(args.input.unwrap_or_else(|| "{}".into()), "--input")?;
        store.write_artifact(&engine.render_template(&template, &input, &options)?)?
    } else if let Some(canvas) = args.canvas {
        let canvas = simple_canvas(canvas)?;
        store.write_artifact(&engine.render_canvas(&canvas, &options)?)?
    } else if let Some(safe_text) = args.safe_text {
        let raw = parse_json(&safe_text, "--safe-text")?;
        let text = string_field(&raw, "text")?;
        let title = raw
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Safe Text Label")
            .to_owned();
        let request = SafeTextLabelRequest {
            text,
            title,
            render_options: options,
            extra: Default::default(),
        };
        store.write_artifact(&engine.render_safe_text(&request)?)?
    } else {
        return Err(CliError::Message(
            "preview requires --template or --canvas".into(),
        ));
    };
    output_json(&json!({ "artifact": artifact }))
}

fn handle_batch_preview(args: BatchPreviewArgs) -> Result<()> {
    let template = get_system_template(&require_flag(args.template, "--template")?)?;
    let csv_path = require_flag(args.csv, "--csv")?;
    let csv_text = fs::read_to_string(csv_path)?;
    let options = parse_optional_render_options(args.render_options)?;
    let store = local_artifact_store();
    let items = RenderEngine::new()
        .render_csv_batch(&template, &csv_text, &options)?
        .into_iter()
        .enumerate()
        .map(|(index, rendered)| {
            let input = rendered.artifact.input.clone();
            let artifact = store.write_artifact(&rendered)?;
            Ok(json!({ "index": index, "input": input, "artifact": artifact }))
        })
        .collect::<Result<Vec<_>>>()?;
    output_json(&json!({ "templateId": template.id, "total": items.len(), "items": items }))
}

fn handle_print(args: PrintArgs) -> Result<()> {
    let printer = require_flag(args.printer, "--printer")?;
    let printer_name = args.printer_name;
    let store = local_artifact_store();
    if let Some(id) = args.artifact {
        let artifact = store
            .get_artifact(&id)?
            .ok_or_else(|| CliError::Message(format!("Artifact {id} was not found.")))?;
        output_json(&print_artifact(
            &store,
            artifact,
            &printer,
            printer_name.as_deref(),
        )?)?;
    } else if let Some(ids) = args.artifacts {
        let ids: Vec<String> = serde_json::from_str(&ids)?;
        let mut jobs = Vec::new();
        for id in ids {
            let artifact = store
                .get_artifact(&id)?
                .ok_or_else(|| CliError::Message(format!("Artifact {id} was not found.")))?;
            jobs.push(print_artifact(
                &store,
                artifact,
                &printer,
                printer_name.as_deref(),
            )?);
        }
        output_json(&json!({ "jobs": jobs }))?;
    } else if let Some(safe_text) = args.safe_text {
        let raw = parse_json(&safe_text, "--safe-text")?;
        let request = SafeTextLabelRequest {
            text: string_field(&raw, "text")?,
            title: raw
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Safe Text Label")
                .to_owned(),
            render_options: parse_optional_render_options(args.render_options)?,
            extra: Default::default(),
        };
        let preview = store.write_artifact(&RenderEngine::new().render_safe_text(&request)?)?;
        let job = print_artifact(&store, preview.clone(), &printer, printer_name.as_deref())?;
        output_json(&json!({ "preview": { "artifact": preview }, "job": job }))?;
    } else if let Some(template_id) = args.template {
        let input = parse_string_record(args.input.unwrap_or_else(|| "{}".into()), "--input")?;
        let rendered = RenderEngine::new().render_template(
            &get_system_template(&template_id)?,
            &input,
            &parse_optional_render_options(args.render_options)?,
        )?;
        let preview = store.write_artifact(&rendered)?;
        let job = print_artifact(&store, preview.clone(), &printer, printer_name.as_deref())?;
        output_json(&json!({ "preview": { "artifact": preview }, "job": job }))?;
    } else {
        return Err(CliError::Message(
            "print requires --artifact, --artifacts, --safe-text, or --template".into(),
        ));
    }
    Ok(())
}

fn handle_template_package(args: TemplatePackageArgs) -> Result<()> {
    let command = args.command.ok_or_else(|| {
        CliError::Message("template-package requires validate, preview, packets, or print.".into())
    })?;
    match command {
        TemplatePackageCommand::Validate(args) => {
            let package = read_template_package(require_flag(args.file, "--file")?)?;
            output_json(&json!({
                "ok": true,
                "id": package.id,
                "name": package.name,
                "width": package.canvas.width,
                "height": package.canvas.height,
                "fields": package.fields.into_iter().map(|field| field.key).collect::<Vec<_>>(),
            }))?;
        }
        TemplatePackageCommand::Preview(args) => {
            output_json(&json!({ "artifact": preview_package(args)?.0 }))?;
        }
        TemplatePackageCommand::Packets(args) => {
            let (preview, store) = preview_package(args)?;
            let packets = packetize_artifact(&store, &preview)?;
            output_json(&json!({ "preview": { "artifact": preview }, "packets": packets }))?;
        }
        TemplatePackageCommand::Print(args) => {
            let printer = require_flag(args.printer, "--printer")?;
            let (preview, store) = preview_package(args.render)?;
            let job = print_artifact(
                &store,
                preview.clone(),
                &printer,
                args.printer_name.as_deref(),
            )?;
            output_json(&json!({ "preview": { "artifact": preview }, "job": job }))?;
        }
    }
    Ok(())
}

fn preview_package(
    args: PackageRenderArgs,
) -> Result<(tuckmark_contracts::PreviewArtifact, ArtifactStore)> {
    let package = read_template_package(require_flag(args.file.file, "--file")?)?;
    let input = args
        .input
        .map(|value| parse_string_record(value, "--input"))
        .transpose()?
        .unwrap_or_else(|| package.sample_input.clone());
    let options = merge_render_options(&package.render_options, args.render_options)?;
    let canvas = package_to_canvas(&package, &input)?;
    let store = local_artifact_store();
    let preview = store.write_artifact(&RenderEngine::new().render_canvas(&canvas, &options)?)?;
    Ok((preview, store))
}

fn system_templates() -> Result<Vec<TemplateDefinition>> {
    Ok(serde_json::from_str(include_str!("system-templates.json"))?)
}

fn get_system_template(id: &str) -> Result<TemplateDefinition> {
    system_templates()?
        .into_iter()
        .find(|template| template.id == id)
        .ok_or_else(|| CliError::Message(format!("Template {id} was not found.")))
}

fn read_template_package(path: PathBuf) -> Result<TemplatePackage> {
    let package: TemplatePackage = serde_json::from_slice(&fs::read(path)?)?;
    validate_template_package(&package)?;
    Ok(package)
}

fn validate_template_package(package: &TemplatePackage) -> Result<()> {
    if package.schema != "tuckmark.user-template-package.v1" {
        return Err(CliError::Message(
            "Invalid user template package schema.".into(),
        ));
    }
    if !valid_identifier(&package.id) {
        return Err(CliError::Message(
            "Invalid user template package identifier.".into(),
        ));
    }
    if package.name.trim().is_empty()
        || package.canvas.width == 0
        || package.canvas.height == 0
        || package.canvas.width > 384
        || package.canvas.height > 640
        || package.elements.is_empty()
    {
        return Err(CliError::Message(
            "User template package is invalid.".into(),
        ));
    }
    let mut keys = BTreeSet::new();
    for field in &package.fields {
        if !valid_identifier(&field.key) || field.label.trim().is_empty() {
            return Err(CliError::Message(
                "User template package field is invalid.".into(),
            ));
        }
        if !keys.insert(field.key.as_str()) {
            return Err(CliError::Message(format!(
                "Duplicate field key: {}",
                field.key
            )));
        }
    }
    if let Some(width) = package
        .render_options
        .get("printWidthDots")
        .and_then(Value::as_u64)
        .filter(|width| package.canvas.width as u64 > *width)
    {
        return Err(CliError::Message(format!(
            "Canvas width {} exceeds render print width {width}",
            package.canvas.width
        )));
    }
    for (index, element) in package.elements.iter().enumerate() {
        let key = match element {
            TemplateElement::Text { key, value, .. }
            | TemplateElement::Barcode { key, value, .. }
            | TemplateElement::Qr { key, value, .. }
            | TemplateElement::DataMatrix { key, value, .. } => Some((key, value)),
            _ => None,
        };
        if let Some((key, value)) = key
            && value.as_deref().unwrap_or_default().is_empty()
            && !keys.contains(key.as_str())
        {
            return Err(CliError::Message(format!(
                "Element {} references unknown field: {key}",
                index + 1
            )));
        }
    }
    Ok(())
}

fn package_to_canvas(
    package: &TemplatePackage,
    input: &BTreeMap<String, String>,
) -> Result<DirectCanvasDefinition> {
    let mut values = package.sample_input.clone();
    values.extend(input.clone());
    for field in &package.fields {
        values
            .entry(field.key.clone())
            .or_insert_with(|| field.default_value.clone());
    }
    let elements = package
        .elements
        .iter()
        .cloned()
        .map(|element| materialize_element(element, &values))
        .collect();
    let canvas = DirectCanvasDefinition {
        id: package.id.clone(),
        name: package.name.clone(),
        width: package.canvas.width.into(),
        height: package.canvas.height.into(),
        elements,
        extra: Default::default(),
    };
    canvas
        .validate()
        .map_err(|error| CliError::Message(error.to_string()))?;
    Ok(canvas)
}

fn materialize_element(
    element: TemplateElement,
    values: &BTreeMap<String, String>,
) -> TemplateElement {
    match element {
        TemplateElement::Text {
            key,
            value,
            x,
            y,
            width,
            height,
            font_size,
            font_family,
            line_height,
            font_weight,
            align,
            justify_align,
            vertical_align,
            stretch_x_grow,
            stretch_x_shrink,
            stretch_y_grow,
            stretch_y_shrink,
            stretch_x,
            stretch_y,
            auto_wrap,
            adaptive_font_size,
            vertical_text,
            max_lines,
            rotation,
            resolved_layout,
            extra,
        } => TemplateElement::Text {
            value: values.get(&key).cloned().or(value),
            key,
            x,
            y,
            width,
            height,
            font_size,
            font_family,
            line_height,
            font_weight,
            align,
            justify_align,
            vertical_align,
            stretch_x_grow,
            stretch_x_shrink,
            stretch_y_grow,
            stretch_y_shrink,
            stretch_x,
            stretch_y,
            auto_wrap,
            adaptive_font_size,
            vertical_text,
            max_lines,
            rotation,
            resolved_layout,
            extra,
        },
        TemplateElement::Barcode {
            key,
            value,
            x,
            y,
            width,
            height,
            format,
            show_value,
            rotation,
            extra,
        } => TemplateElement::Barcode {
            value: values.get(&key).cloned().or(value),
            key,
            x,
            y,
            width,
            height,
            format,
            show_value,
            rotation,
            extra,
        },
        TemplateElement::Qr {
            key,
            value,
            x,
            y,
            size,
            error_correction_level,
            rotation,
            extra,
        } => TemplateElement::Qr {
            value: values.get(&key).cloned().or(value),
            key,
            x,
            y,
            size,
            error_correction_level,
            rotation,
            extra,
        },
        TemplateElement::DataMatrix {
            key,
            value,
            x,
            y,
            size,
            rotation,
            extra,
        } => TemplateElement::DataMatrix {
            value: values.get(&key).cloned().or(value),
            key,
            x,
            y,
            size,
            rotation,
            extra,
        },
        element => element,
    }
}

fn package_to_canvas_draft(
    package: &TemplatePackage,
    template_id: &str,
    name: &str,
    description: &str,
) -> Value {
    let fields = package
        .fields
        .iter()
        .map(|field| {
            json!({
                "key": field.key,
                "label": field.label,
                "defaultValue": field.default_value,
                "sampleValue": package.sample_input.get(&field.key),
                "multiline": field.multiline,
                "bindings": [],
            })
        })
        .collect::<Vec<_>>();
    let elements = package
        .elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            canvas_draft_element(element, index, &package.sample_input, &package.fields)
        })
        .collect::<Vec<_>>();
    json!({
        "version": 1,
        "id": format!("canvas-{template_id}"),
        "presetId": template_id,
        "name": name,
        "description": description,
        "source": { "kind": "user-template", "templateId": template_id },
        "templateId": template_id,
        "width": package.canvas.width,
        "height": package.canvas.height,
        "renderOptions": package.render_options,
        "tags": package.tags,
        "recommendedUse": package.recommended_use,
        "fields": fields,
        "elements": elements,
        "editor": { "gridEnabled": true, "gridSize": 1, "snapEnabled": true, "snapStep": 1 }
    })
}

fn canvas_draft_element(
    element: &TemplateElement,
    index: usize,
    input: &BTreeMap<String, String>,
    fields: &[PackageField],
) -> Value {
    let mut value = serde_json::to_value(element).expect("template element serializes");
    let object = value
        .as_object_mut()
        .expect("template element serializes as object");
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("element")
        .to_owned();
    object.insert(
        "id".into(),
        Value::String(format!("{kind}-draft-{}", index + 1)),
    );
    object.insert(
        "meta".into(),
        json!({ "name": format!("{kind} {}", index + 1), "visible": true, "locked": false }),
    );
    if let Some(key) = object.get("key").and_then(Value::as_str).map(str::to_owned)
        && fields.iter().any(|field| field.key == key)
    {
        object.insert("binding".into(), json!({ "fieldKey": key, "kind": kind }));
        let resolved = input
            .get(&key)
            .cloned()
            .or_else(|| {
                fields
                    .iter()
                    .find(|field| field.key == key)
                    .map(|field| field.default_value.clone())
            })
            .unwrap_or_default();
        object.insert("value".into(), Value::String(resolved));
    }
    value
}

fn devd_client(explicit: Option<&str>, fallback: Option<&str>) -> Result<DevdClient> {
    Ok(DevdClient::new(resolve_instance(explicit, fallback)?))
}

fn output_json(value: &impl Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn require_flag<T>(value: Option<T>, name: &str) -> Result<T> {
    value.ok_or_else(|| CliError::Message(format!("Missing required flag: {name}")))
}

fn parse_json(raw: &str, flag: &str) -> Result<Value> {
    serde_json::from_str(raw)
        .map_err(|error| CliError::Message(format!("Invalid JSON for {flag}: {error}")))
}

fn parse_string_record(raw: String, flag: &str) -> Result<BTreeMap<String, String>> {
    let value = parse_json(&raw, flag)?;
    let object = value
        .as_object()
        .ok_or_else(|| CliError::Message(format!("{flag} must be a JSON object.")))?;
    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or_else(|| CliError::Message(format!("{flag} values must be strings.")))
        })
        .collect()
}

fn parse_optional_integer(raw: Option<String>, name: &str) -> Result<Option<i64>> {
    raw.map(|raw| {
        raw.parse::<i64>()
            .map_err(|_| CliError::Message(format!("Flag {name} must be an integer.")))
    })
    .transpose()
}

fn parse_optional_render_options(raw: Option<String>) -> Result<RenderOptions> {
    match raw {
        Some(raw) => merge_render_options(&Value::Object(Map::new()), Some(raw)),
        None => Ok(RenderOptions::default()),
    }
}

fn merge_render_options(base: &Value, override_json: Option<String>) -> Result<RenderOptions> {
    let mut object = serde_json::to_value(RenderOptions::default())
        .expect("render options serialize")
        .as_object()
        .cloned()
        .expect("render options serialize to an object");
    merge_option_object(&mut object, base)?;
    if let Some(raw) = override_json {
        merge_option_object(&mut object, &parse_json(&raw, "--render-options")?)?;
    }
    serde_json::from_value(Value::Object(object)).map_err(CliError::from)
}

fn merge_option_object(target: &mut Map<String, Value>, source: &Value) -> Result<()> {
    let object = source
        .as_object()
        .ok_or_else(|| CliError::Message("render options must be a JSON object.".into()))?;
    for key in [
        "printerDpi",
        "paperType",
        "threshold",
        "xOffsetDots",
        "printWidthDots",
        "previewScale",
    ] {
        if let Some(value) = object.get(key) {
            target.insert(key.into(), value.clone());
        }
    }
    let options: RenderOptions = serde_json::from_value(Value::Object(target.clone()))?;
    options
        .validate()
        .map_err(|error| CliError::Message(error.to_string()))?;
    Ok(())
}

fn simple_canvas(raw: String) -> Result<DirectCanvasDefinition> {
    let value = parse_json(&raw, "--canvas")?;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Canvas")
        .to_owned();
    let width = value
        .get("width")
        .and_then(Value::as_f64)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| CliError::Message("canvas width must be positive".into()))?;
    let height = value
        .get("height")
        .and_then(Value::as_f64)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| CliError::Message("canvas height must be positive".into()))?;
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Ok(DirectCanvasDefinition {
        id: name.clone(),
        name,
        width,
        height,
        elements: vec![
            TemplateElement::Rect {
                x: 6.0,
                y: 6.0,
                width: width - 12.0,
                height: height - 12.0,
                stroke_width: 2.0,
                fill: "white".into(),
                stroke: "#111111".into(),
                radius: 8.0,
                rotation: 0.0,
                extra: Default::default(),
            },
            TemplateElement::Text {
                key: "body".into(),
                value: Some(text),
                x: 18.0,
                y: 48.0,
                width: Some(width - 36.0),
                height: None,
                font_size: 22.0,
                font_family: None,
                line_height: None,
                font_weight: "normal".into(),
                align: "left".into(),
                justify_align: None,
                vertical_align: None,
                stretch_x_grow: None,
                stretch_x_shrink: None,
                stretch_y_grow: None,
                stretch_y_shrink: None,
                stretch_x: None,
                stretch_y: None,
                auto_wrap: None,
                adaptive_font_size: None,
                vertical_text: None,
                max_lines: Some(8),
                rotation: 0.0,
                resolved_layout: None,
                extra: Default::default(),
            },
        ],
        extra: Default::default(),
    })
}

fn local_artifact_store() -> ArtifactStore {
    let root = env::var_os("TUCKMARK_CLI_ARTIFACT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| env::temp_dir()));
    ArtifactStore::new(root)
}

fn list_printers() -> Result<Value> {
    if mock_printers_enabled() {
        return Ok(json!([{
            "id": "mock-printer",
            "name": "Mock Label Printer",
            "capabilities": {
                "dpi": 203,
                "printWidthDots": 384,
                "supportedPaperTypes": ["gap", "continuous"],
                "colors": ["mono"],
                "notes": ["Mock fallback printer while detonger is unavailable."]
            }
        }]));
    }
    #[cfg(target_os = "macos")]
    {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(|error| {
                CliError::Message(format!("Unable to start printer discovery: {error}"))
            })?;
        let printers = runtime
            .block_on(detonger_printer::scan(Duration::from_secs(2)))
            .map_err(|error| CliError::Message(format!("Unable to discover printers: {error}")))?
            .into_iter()
            .map(|printer| {
                json!({
                    "id": printer.id.0,
                    "name": printer.name.unwrap_or_else(|| "Detonger Label Printer".into()),
                    "capabilities": {
                        "dpi": 203,
                        "printWidthDots": 384,
                        "supportedPaperTypes": ["gap", "continuous"],
                        "colors": ["mono"],
                    }
                })
            })
            .collect::<Vec<_>>();
        Ok(Value::Array(printers))
    }
    #[cfg(not(target_os = "macos"))]
    Ok(json!([]))
}

fn resolve_printer(id: &str, printer_name: Option<&str>) -> Result<Value> {
    let printers = list_printers()?;
    let selected = printers
        .as_array()
        .and_then(|printers| {
            printers
                .iter()
                .find(|printer| printer.get("id").and_then(Value::as_str) == Some(id))
                .or_else(|| {
                    printer_name.and_then(|name| {
                        printers.iter().find(|printer| {
                            printer.get("name").and_then(Value::as_str) == Some(name)
                        })
                    })
                })
        })
        .cloned();
    selected.ok_or_else(|| {
        CliError::Message(format!(
            "Printer is no longer available: {id}{}.",
            printer_name
                .map(|name| format!(" ({name})"))
                .unwrap_or_default()
        ))
    })
}

fn packetize_artifact(
    store: &ArtifactStore,
    artifact: &tuckmark_contracts::PreviewArtifact,
) -> Result<tuckmark_contracts::ArtifactPackets> {
    let png = fs::read(&artifact.png_path)?;
    let packets = PrintEngine::new().detonger_packets(&png, &artifact.render_options, None)?;
    Ok(store.write_packets(&artifact.id, &packets)?)
}

fn print_artifact(
    store: &ArtifactStore,
    artifact: tuckmark_contracts::PreviewArtifact,
    printer_id: &str,
    printer_name: Option<&str>,
) -> Result<Value> {
    let printer = resolve_printer(printer_id, printer_name)?;
    let print_width = printer
        .get("capabilities")
        .and_then(|capabilities| capabilities.get("printWidthDots"))
        .and_then(Value::as_u64)
        .unwrap_or(384);
    if artifact.render_options.print_width_dots as u64 > print_width
        || artifact.width as u64 > artifact.render_options.print_width_dots as u64
    {
        return Err(CliError::Message(
            "Artifact does not fit the selected printer.".into(),
        ));
    }
    let packets = packetize_artifact(store, &artifact)?;
    dispatch_print(printer_id, &artifact)?;
    Ok(json!({
        "id": Uuid::new_v4(),
        "artifactId": artifact.id,
        "printerId": printer.get("id").cloned().unwrap_or_else(|| Value::String(printer_id.into())),
        "createdAt": now_rfc3339(),
        "status": "completed",
        "packetCount": packets.packet_count,
    }))
}

fn mock_printers_enabled() -> bool {
    env::var("TUCKMARK_MOCK_PRINTERS")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true"))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn dispatch_print(printer_id: &str, artifact: &tuckmark_contracts::PreviewArtifact) -> Result<()> {
    if mock_printers_enabled() {
        return Ok(());
    }
    let png = fs::read(&artifact.png_path)?;
    let options = detonger_printer::PrintOptions {
        threshold: artifact.render_options.threshold,
        x_offset_dots: i16::try_from(artifact.render_options.x_offset_dots).map_err(|_| {
            CliError::Message("Print X offset is outside the printer transport range.".into())
        })?,
        paper_type: match artifact.render_options.paper_type {
            tuckmark_contracts::PaperType::Continuous => {
                detonger_printer::protocol::PaperType::Continuous
            }
            tuckmark_contracts::PaperType::Gap => detonger_printer::protocol::PaperType::Gap,
        },
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .map_err(|error| {
            CliError::Message(format!("Unable to start printer transport: {error}"))
        })?;
    runtime
        .block_on(async {
            let mut printer =
                detonger_printer::connect(&detonger_printer::DeviceId(printer_id.into())).await?;
            printer.print_png(&png, &options).await
        })
        .map_err(|error| CliError::Message(format!("Printer transport failed: {error}")))
}

#[cfg(not(target_os = "macos"))]
fn dispatch_print(
    _printer_id: &str,
    _artifact: &tuckmark_contracts::PreviewArtifact,
) -> Result<()> {
    if mock_printers_enabled() {
        return Ok(());
    }
    Err(CliError::Message(
        "Local printer transport is only available on macOS.".into(),
    ))
}

fn inventory_payload(
    args: &InventoryCreateArgs,
    id: Option<String>,
    full_name: String,
) -> Result<Value> {
    let mut payload = Map::new();
    if let Some(id) = id {
        payload.insert("id".into(), Value::String(id));
    }
    payload.insert("fullName".into(), Value::String(full_name));
    for (key, value) in [
        ("baseName", args.base_name.clone()),
        ("variantName", args.variant_name.clone()),
        ("packageName", args.package_name.clone()),
        ("description", args.description.clone()),
        ("deviceDetails", args.device_details.clone()),
        ("matrixCode", args.matrix_code.clone()),
        ("packagingRemark", args.packaging_remark.clone()),
    ] {
        if let Some(value) = value {
            payload.insert(key.into(), Value::String(value));
        }
    }
    if let Some(raw) = &args.bindings {
        let bindings = parse_json(raw, "--bindings")?;
        if !bindings.is_array() {
            return Err(CliError::Message("--bindings must be a JSON array.".into()));
        }
        payload.insert("labelBindings".into(), bindings);
    }
    Ok(Value::Object(payload))
}

fn read_credential(session: Option<String>, path: Option<PathBuf>) -> Result<AgentCredential> {
    let session = require_flag(session, "--session")?;
    let path = path.unwrap_or_else(|| default_credential_path(&session));
    let credential: AgentCredential = serde_json::from_slice(&fs::read(path)?)?;
    validate_credential(&credential)?;
    if credential.session_id != session {
        return Err(CliError::Message(
            "Agent import credential does not match --session.".into(),
        ));
    }
    Ok(credential)
}

fn write_credential(path: &Path, credential: &AgentCredential) -> Result<()> {
    validate_credential(credential)?;
    let parent = path
        .parent()
        .ok_or_else(|| CliError::Message("Credential path has no parent directory.".into()))?;
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(format!("{}\n", serde_json::to_string_pretty(credential)?).as_bytes())?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(credential)?),
        )?;
    }
    Ok(())
}

fn validate_credential(credential: &AgentCredential) -> Result<()> {
    if credential.session_id.trim().is_empty()
        || credential.secret.len() < 32
        || credential.instance.trim().is_empty()
        || credential.expires_at.trim().is_empty()
    {
        return Err(CliError::Message(
            "Agent import credential is invalid.".into(),
        ));
    }
    if let Some(url) = credential.web_url.as_deref() {
        validate_web_url(url)?;
    }
    Ok(())
}

fn default_credential_path(session: &str) -> PathBuf {
    let safe = session
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if !safe {
        return PathBuf::from("invalid-agent-import-session.json");
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    home.join(".cache")
        .join("tuckmark")
        .join("agent-import")
        .join(format!("{session}.json"))
}

fn resolve_web_url(explicit: Option<&str>, fallback: Option<&str>) -> Result<String> {
    let environment = env::var("TUCKMARK_WEB_URL").ok();
    if let Some(value) = explicit.or(environment.as_deref()).or(fallback) {
        validate_web_url(value)?;
        return Ok(value.trim_end_matches('/').to_owned());
    }
    let port = env::var("TUCKMARK_WEB_PORT").unwrap_or_else(|_| "5173".into());
    let host = env::var("TUCKMARK_WEB_HOST")
        .or_else(|_| env::var("TUCKMARK_SERVER_HOST"))
        .unwrap_or_else(|_| "127.0.0.1".into());
    let host = if host.contains(':') {
        format!(
            "[{}]",
            host.trim_matches(|character| character == '[' || character == ']')
        )
    } else {
        host
    };
    Ok(format!("http://{host}:{port}"))
}

fn validate_web_url(value: &str) -> Result<()> {
    let value = value.trim();
    let scheme_end = value
        .find("://")
        .ok_or_else(|| CliError::Message("Web URL must use http or https.".into()))?;
    if !matches!(&value[..scheme_end], "http" | "https") || value[scheme_end + 3..].is_empty() {
        return Err(CliError::Message("Web URL must use http or https.".into()));
    }
    Ok(())
}

fn confirmation_url(web_url: &str, credential: &AgentCredential) -> String {
    format!(
        "{web_url}/agent-import/{}#key={}",
        percent_encode(&credential.session_id),
        percent_encode(&credential.secret)
    )
}

fn launch_confirmation_url(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = ProcessCommand::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = ProcessCommand::new("cmd");
        command.args(["/c", "start", "", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = ProcessCommand::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn()?;
    Ok(())
}

fn generated_secret() -> String {
    let mut bytes = [0_u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn json_array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| CliError::Message(format!("DEVD snapshot is missing {field}.")))
}

fn string_field(value: &Value, field: &str) -> Result<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CliError::Message(format!("Missing required field: {field}")))
}

fn version_summary(value: &Value) -> Value {
    let mut output = Map::new();
    for key in ["id", "version", "kind", "createdAt", "label"] {
        if let Some(value) = value.get(key) {
            output.insert(key.into(), value.clone());
        }
    }
    Value::Object(output)
}

fn read_json_file(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn absolute_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Ok(env::current_dir()?.join(path))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn empty_object() -> Value {
    json!({})
}

fn nested_subcommand_error() -> Option<&'static str> {
    let mut arguments = env::args().skip(1);
    match (arguments.next().as_deref(), arguments.next()) {
        (Some("template"), Some(_)) => Some(
            "template supports list, show, import, update, rename, archive, restore, and delete.",
        ),
        (Some("inventory"), Some(_)) => Some(
            "inventory supports list, show, create, update, archive, restore, delete, adjust, and print.",
        ),
        (Some("agent-import"), Some(_)) => {
            Some("agent-import supports catalog, inventory, create, open, wait, and fulfill.")
        }
        (Some("config"), Some(_)) => Some("config requires get-data-dir or set-data-dir."),
        (Some("template-package"), Some(_)) => {
            Some("template-package requires validate, preview, packets, or print.")
        }
        _ => None,
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['%', '2', '0'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}
