# Tuckmark Product Contract

## Product Definition

Tuckmark is an agent-native label printing product register.

It is the owner-facing and agent-facing product surface that sits above
`detonger`, the transport and device-control layer. Tuckmark owns:

- template-driven label authoring
- preview and artifact lifecycle
- structured input and batch flows
- HTTP, CLI, MCP, and Web surfaces
- release and demo contracts exposed from this repository

`detonger` remains a lower-level dependency. It is not the product brand and
not the product contract boundary.

## Product Surfaces

- `apps/web`: the canonical Web surface and the canonical owner-facing Web demo
- `packages/server`: the HTTP runtime surface that serves `/api`
- `packages/cli`: the CLI surface that ships in the release bundle
- `packages/mcp`: the MCP surface for agent integration
- `packages/core`: the shared domain and rendering layer

## Canonical Web Experience

The canonical owner-facing Web surface is a desktop workbench with four formal
pages:

- `home`
- `templates`
- `canvas`
- `system`

The shell uses a single route tree and a single layout contract:

- top: shared header with product mark, navigation, and device entry
- middle: routed workspace content
- bottom: shared status footer

The `templates` and `canvas` pages are the formal production workspaces. They
share the same print artifact seam even though they expose different editing
models.

`templates` remains the structured print-entry workspace. It now groups
read-only system templates and browser-local user templates in one list.
Selecting a template card enters structured row entry directly, while template
editing remains an explicit secondary action.

`canvas` is the template editor workspace. It supports scratch drafts, editable
copies of system templates, and browser-local user templates with save, save
as, and version history semantics. Version history is opened from the save
actions instead of occupying the main inspector rail full time.

Browser-local user templates are intentionally local to the current browser.
There is no account sync, remote template library, or server-owned template
history surface in v1.

## Print Path Contract

The Web product exposes two formal print paths:

- `browser-direct print path`
- `service-api print path`

These are product-level capabilities with independent switches and independent
dependency boundaries.

The browser-direct path is a pure-browser path. In supported secure-context
browsers, it renders, encodes, and sends print payloads without runtime server
packet helpers.

The service-api path is the runtime path that delegates hardware control to the
service program API. When enabled, it must fail fast at startup if detonger or
its required runtime assets are not ready.

## Web Runtime Contract

The owner-facing Web app reuses one route tree, one component tree, and one
artifact seam across every runtime surface.

The product exposes two explicit Web surfaces:

- `browser-static`: static browser runtime for GitHub Pages and custom-domain
  root deployment
- `server-http`: server-backed runtime that exposes `/api`

The product exposes two explicit Web modes:

- `runtime`: the formal product path
- `demo`: Mock API behavior with real hardware capability disabled

Mode selection is explicit:

- `?demo=true`: enter `demo`
- `?demo=false`: stay on `runtime`
- no query parameter: stay on `runtime`

`browser-static` and `server-http` keep the same formal route structure. Demo
behavior must never fork into a separate demo-only page tree.

Static deployments keep browser history routing semantics and must ship a
`404.html` fallback for deep-link recovery.

GitHub Pages is an owner-facing static Web runtime. It is not a Storybook
replacement, not a docs site, and not a second product surface.

## Release Contract

This repository releases a single product line.

- canonical release target: GitHub Releases
- version model: one SemVer line for the whole product
- channels: `stable` and `preview`
- bundled artifacts: `runtime bundle` and `CLI bundle`

There is no `component:*` version line in this repository.

## Repository Truth

Repository-local declarations are the source of truth for:

- release intent and label policy
- required checks and branch protection expectations
- Pages behavior and base path assumptions
- bootstrap and worktree setup expectations

GitHub repository settings must be aligned to those checked-in declarations.
