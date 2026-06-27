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
- Template workspace now adds a narrow route-owned fallback:
  - `960-1279px` keeps a two-pane shell: the initial state shows the template
    list beside a disabled preview/print rail, then swaps the left pane from
    list to batch table after selection while keeping the right rail visible
    and exposing a return action
  - below `960px`, preview and print stack below the batch table instead of
    staying in a side rail
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
- Canvas workspace is now implemented as an editor-first professional label
  tool with:
  - a stable three-column desktop layout at `>=1280px`
  - a route-local narrow desktop mode at `960-1279px`
  - a toolbar dedicated to zoom, fit-to-view, grid, snap, undo/redo, and
    reset
  - lower-noise panel framing and a cooler stage surface so the editable label
    stays visually dominant
  - a right-side inspector split into `属性` and `输出`
  - terminology aligned to product-facing Chinese labels instead of mixed
    engineering English
- Canvas stage is implemented with `react-konva` editing for `text`, `rect`,
  `line`, `barcode`, and `qr`.
- Stage interaction coverage includes:
  - click selection
  - Shift multi-selection
  - marquee selection
  - drag move
  - transformer-based resize and rotation
  - wheel zoom relative to pointer
  - `Space + drag` pan
  - keyboard move, duplicate, delete, undo, redo, and clear selection
- Barcode and QR stage rendering now uses real encoded graphics instead of
  dashed placeholders.
- Invalid barcode / QR content now fails safely inside the editor:
  - the stage swaps to an explicit invalid placeholder
  - inspector and output panels surface plain-language recovery guidance
  - preview / direct print are blocked until the invalid content is fixed
- Canvas content is now normalized to a monochrome print contract:
  - new rect and line defaults are black-on-white
  - restored preset-scoped drafts are sanitized back to monochrome
  - editor selection affordances stay outside printable content semantics
- Web draft model coverage includes:
  - versioned `CanvasDraftDocument`
  - per-layer metadata
  - preset-scoped `localStorage` persistence
  - in-memory undo/redo history capped to `50`
- Shared schema coverage now includes `rotation` on `text`, `rect`, `barcode`,
  and `qr`, while `line` remains endpoint-based.
- Browser-static preview and print seams are wired through the shared canvas
  normalization path instead of a separate editor-only print path.
- Canvas stage and output preview now share one SVG-backed content seam:
  - the white label paper is rendered as a stage-only base layer
  - the editor grid is rendered above that paper and never enters print output
  - printable content is rendered from the same normalized SVG semantics used
    by preview generation
- Home page recent templates and recent prints are backed by browser-local
  recent-activity storage.
- `404.html` SPA fallback is present for static Pages deep links.
- Storybook coverage includes stable canvas scenarios for:
  - wide editor
  - narrow desktop editor
  - selected text
  - selected barcode
  - output tab
  - draft-restore state

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
- Current validation status for this round:
  - `bun run --filter @tuckmark/web typecheck` passed
  - `bun run --filter @tuckmark/web test` passed
  - `bun run build:web` passed
  - `bun run build:web:pages` passed
  - `bun run --filter @tuckmark/web build:storybook` passed
  - browser verification passed for:
    - grid visibility over the white label-paper base
    - canvas pan / zoom remaining decoupled from pointer-only panning
    - output preview generation using the same content semantics as the stage
  - `bun run test:e2e:web` not run in this round
