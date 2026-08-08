# Rust CLI and DEVD single authority

## Context

Tuckmark exposes one CLI surface and one local service surface over HTTP, SSE,
and named IPC. DEVD also owns the active data directory, transaction recovery,
archives, rendering, and service-side print dispatch. Multiple production
implementations would allow observable behavior and persisted data handling to
diverge.

The implementation replacement must preserve existing data. Current
`tuckmark.*.v1` shapes, directory paths, archive layouts, recovery behavior,
decoded render output, print packets, and release artifacts are compatibility
boundaries rather than redesign opportunities.

## Decision

Rust CLI is the only production implementation of the `tuckmark` command
surface. Rust DEVD is the only production implementation of HTTP, SSE, and named
IPC service surfaces and is the single authority for the active data directory.
HTTP and IPC listeners in one process share that authority; no legacy runtime
may open the directory as a second writer.

`compatibility/manifest.v1.json` and nine categories of synthetic golden
fixtures are the language-neutral oracle. Contract validation imports no
TypeScript CLI or server modules and remains runnable after those sources are
removed.

The replacement makes no persisted schema change. Future schema evolution
requires an owner-approved Spec, migration path, and compatibility decision.

## Consequences

- Release artifacts contain Rust CLI and Rust DEVD as the production command
  and service implementations.
- TypeScript CLI/server code may remain temporarily only as migration reference
  material.
- A Rust implementation that differs from a frozen command, route, error,
  recovery, archive, render, packet, or release fixture is incompatible until
  the governing contract is deliberately changed.
