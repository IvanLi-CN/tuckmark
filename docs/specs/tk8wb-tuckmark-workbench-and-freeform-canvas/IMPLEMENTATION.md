# Implementation Notes

## Current coverage

- Route tree is implemented through a shared app shell with `/`, `/templates`,
  `/canvas`, and `/system`.
- The shared shell now includes:
  - a top navigation header
  - a shared status footer
  - one right-side device drawer reused across runtime, browser-static, and
    demo surfaces
- Template workspace is implemented as a left template browser, center batch
  table, and right preview/print rail.
- Template list supports:
  - large grid mode
  - compact list mode
  - preview thumbnail, name, and size metadata
  - one-line title truncation with fade masking
- Template table supports:
  - row add, duplicate, delete, and select
  - adaptive column widths with min/max limits
  - horizontal scroll when columns overflow
  - vertical scroll for longer row sets
  - compact inline editing without cell reflow
  - auto-preview on row focus/click
  - debounced preview refresh after edits
- Canvas workspace is implemented with `react-konva` editing for `text`,
  `rect`, `line`, `barcode`, and `qr`.
- Browser-static preview and print seams are wired through the shared canvas
  normalization path instead of a separate editor-only print path.
- Home page recent templates and recent prints are backed by browser-local
  recent-activity storage.
- `404.html` SPA fallback is present for static Pages deep links.

## Remaining validation

- Full verification matrix must stay green for:
  - `bun run --filter @tuckmark/web typecheck`
  - `bun run --filter @tuckmark/web test`
  - `bun run build:web`
  - `bun run build:web:pages`
  - `bun run --filter @tuckmark/web build:storybook`
  - `bun run test:e2e:web`
- Benchmark viewport evidence must stay aligned with the latest UI SHA whenever
  navigation, list density, or workspace layout changes.
