# Tuckmark Brand Guide

## Brand Positioning

Tuckmark is an agent-native label printing workspace for people and agents.

It sits above the printer transport and device-control layer. Tuckmark is the
product surface for template-driven printing, structured data import, direct
editing, batch workflows, and agent-facing automation.

`detonger` is the underlying printer communication and control layer.
Tuckmark is the user-facing and agent-facing product brand.

## Core Promise

Tuckmark helps users and agents turn structured content into physical labels
through a workspace that feels reliable, organized, and programmable.

## Brand Traits

- Smart, not flashy
- Practical, not toy-like
- Product-led, not driver-led
- Workflow-aware, not message-bus-like
- Friendly to both direct users and agent/tool integration

## Standard Brand Name

- Official product name: `Tuckmark`
- Official technical slug: `tuckmark`

Use `Tuckmark` as the only standard product spelling in titles, UI, marketing
copy, documentation headings, and release notes.

Use `tuckmark` as the standard machine-facing slug in repository names,
packages, config paths, service names, and environment variables.

## Disallowed Variants

Do not use these as the formal product name:

- `TuckMark`
- `TUCKMARK`
- `tuckMark`
- `Tuck-Mark`
- `Tuck Mark`

Uppercase forms such as `TUCKMARK_` are allowed only where platform conventions
require them, such as environment variable prefixes.

## Naming Matrix

- Product: `Tuckmark`
- Web app: `Tuckmark Web`
- Desktop app: `Tuckmark Desktop`
- CLI: `Tuckmark CLI`
- MCP service: `Tuckmark MCP`
- Background daemon: `tuckmarkd`
- Core library: `Tuckmark Core`
- Template system: `Tuckmark Templates`
- Agent skill collection: `Tuckmark Skills`
- Server component: `Tuckmark Server`

## Repository and Package Naming

### Repositories

- Main repository: `tuckmark`
- Related repositories: `tuckmark-*`

Examples:

- `tuckmark-cli`
- `tuckmark-mcp`
- `tuckmark-web`
- `tuckmark-desktop`
- `tuckmark-server`
- `tuckmark-core`
- `tuckmark-templates`

### JavaScript and TypeScript

- Package scope: `@tuckmark/*`

Examples:

- `@tuckmark/core`
- `@tuckmark/mcp`
- `@tuckmark/web`

### Python

- Distribution names: `tuckmark-*`
- Import names: `tuckmark_*`

Examples:

- `tuckmark-cli`
- `tuckmark_mcp`

### Rust

- Crate names: `tuckmark-*`

Examples:

- `tuckmark-core`
- `tuckmark-mcp`

## Runtime and Service Naming

- CLI executable: `tuckmark`
- Daemon executable: `tuckmarkd`
- Default config directory: `~/.config/tuckmark/`
- Default config filename: `tuckmark.toml`
- Environment variable prefix: `TUCKMARK_`
- Container and service prefix: `tuckmark-`

Examples:

- `TUCKMARK_CONFIG`
- `TUCKMARK_PRINTER`
- `tuckmark-api`
- `tuckmark-worker`

## Copy Guidelines

### Primary One-Line Description

`Tuckmark is an agent-native label printing workspace.`

### Short Tagline

`Label printing for people and agents.`

### Expanded Description

Tuckmark combines templates, direct editing, structured import, device control,
and agent-facing automation into one label printing workspace.

### Underlying Technology Attribution

Use this when referring to the printer transport/control layer:

`Powered by detonger.`

Do not present `detonger` as the user-facing product brand when describing
Tuckmark.

## Positioning Boundaries

When describing Tuckmark, emphasize:

- Label printing as a workspace
- Templates and user-designed layouts
- Structured input such as forms and spreadsheets
- Direct printing for users
- Tool and agent integration through CLI and MCP

Avoid describing Tuckmark primarily as:

- A printer driver
- A Bluetooth utility
- A hardware vendor tool
- A generic message dispatch system
- A toy sticker app

## UI and Documentation Rules

- Use `Tuckmark` in page titles, headers, hero sections, and dialog titles.
- Use `tuckmark` in URLs, paths, config keys, IDs, and code-oriented labels.
- Do not invent a Chinese product name unless a separate naming decision is
  made later.
- In Chinese copy, use `Tuckmark` directly as the product name.

## Domain and Handle Strategy

If the exact root name is unavailable, prefer these patterns:

- `gettuckmark.com`
- `tuckmark.app`
- `tuckmark.dev`

Avoid introducing a second public-facing brand just to fit a domain.

## Example Naming

- Good: `Tuckmark Web`
- Good: `Install Tuckmark CLI`
- Good: `Connect Tuckmark MCP to your agent`
- Good: `TUCKMARK_CONFIG`
- Bad: `TuckMark Desktop`
- Bad: `Tuck-Mark Server`
- Bad: `Detonger Studio`
- Bad: `Tuckmark Printer Driver`
