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
- Template browser now weak-groups cards into:
  - `系统模板`
  - `我的模板`
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
  - card click entering structured print-entry on both system and
    browser-local user templates
  - one explicit `编辑模板` secondary action on both groups
  - one-line title truncation with fade masking
  - a widened triple-pane left rail so `>=1280px` large-card mode keeps a
    readable two-up grid instead of collapsing card width under shell pressure
- Browser-local user template cards render real SVG previews compiled from the
  saved draft instead of placeholder chrome.
- Template table supports:
  - row add, duplicate, delete, and select
  - adaptive column widths with min/max limits
  - horizontal scroll when columns overflow
  - vertical scroll for longer row sets
  - compact inline editing without cell reflow
  - auto-preview on row focus/click
  - debounced preview refresh after edits
  - browser-local user template fields sourced from the draft field registry
    rather than the system template catalog
- Canvas workspace is now implemented as an editor-first professional label
  tool with:
  - a stable three-column desktop layout at `>=1280px`
  - a route-local narrow desktop mode at `960-1279px`
  - a toolbar dedicated to zoom, fit-to-view, grid, snap, undo/redo, and
    reset
  - lower-noise panel framing and a cooler stage surface so the editable label
    stays visually dominant
  - a right-side inspector split into `属性` and `输出`
  - a toolbar-entry version-history drawer instead of a permanently visible
    right-rail history panel
  - terminology aligned to product-facing Chinese labels instead of mixed
    engineering English
  - a workbench-wide selectable contract that suppresses accidental text
    selection on static chrome while keeping editable and copy-relevant values
    explicitly selectable
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
  - source-aware working copies for `scratch`, `preset-template`, and
    `user-template`
  - draft field registry and per-element replacement bindings
  - per-layer metadata
  - preset-scoped browser storage persistence for scratch drafts
  - same-device sync state records shared with `TuckmarkService` for scratch
    drafts, recent templates, and recent prints
  - IndexedDB-backed browser-local user template persistence with memory
    fallback in incomplete test/browser environments
  - in-memory undo/redo history capped to `50`
- Browser-local user template model coverage includes:
  - `UserTemplateRecord`
  - `UserTemplateVersionSnapshot`
  - `CanvasWorkingCopyIndexEntry`
  - saved-version retention capped at `20`
  - autosave retention capped at `10`
  - autosave interval fixed at `5` minutes
- Canvas save semantics now cover:
  - first save from scratch/system-template creating a browser-local user
    template
  - save on an existing browser-local template creating a new saved version
  - save as creating a new template from the current draft or read-only version
  - read-only historical restore creating a new current working copy instead of
    mutating saved history in place
- System-template import keeps static template keys such as `__title` as fixed
  elements instead of exposing them as structured replacement fields.
- System-template canvas working copies now recover safely from earlier
  browser-local drafts that persisted empty bound values:
  - canvas-only placeholder rendering seeds visible label text for empty bound
    text / QR elements so imported layers stay visible on first open
  - browser-local legacy preset-template drafts with empty field defaults are
    normalized back into the same visible-placeholder state on reload
  - template-workspace batch rows still keep empty input defaults instead of
    inheriting those canvas-only placeholders
- Structured replacement bindings are limited to `text`, `barcode`, and `qr`;
  `rect` and `line` remain static editor-only structure.
- Replaceable-element editing is simplified to:
  - one `名` layer-name field
  - one field-name autocomplete input that can reuse or create a field label
  - no separate `绑定到` selector duplicated beside the field-name editor
- Browser-local user template preview/print reuses the shared canvas artifact
  seam by compiling row values into a concrete `DirectCanvasDefinition` on the
  client before preview or print dispatch.
- Same-device sync intentionally stops at:
  - recent templates
  - recent prints
  - scratch canvas drafts
- Browser-local user templates, saved versions, autosaves, and user-template
  working copies remain outside the sync contract.
- Shared schema coverage now includes `rotation` on `text`, `rect`, `barcode`,
  and `qr`, while `line` remains endpoint-based.
- Line rotation remains an editor-side endpoint transform only:
  - transformer rotation rewrites the line endpoints immediately
  - shared draft/core schemas do not persist a separate `line.rotation` field
  - printed output therefore stays aligned to the stored endpoint geometry
- Browser-static preview and print seams are wired through the shared canvas
  normalization path instead of a separate editor-only print path.
- Canvas stage and output preview now share one SVG-backed content seam:
  - the white label paper is rendered as a stage-only base layer
  - the editor grid is rendered above that paper and never enters print output
  - printable content is rendered from the same normalized SVG semantics used
    by preview generation
- Shared output rendering was tightened again during PR convergence:
  - rotated multiline SVG text now uses the rendered text-box center as its
    rotation origin instead of a looser baseline-derived midpoint
  - CLI direct-canvas preview samples now provide explicit `rotation: 0` fields
    so the expanded schema stays type-safe in CI
  - the new canvas draft monochrome tests now provide a stable in-memory
    storage fallback so package-level test runners without an ambient browser
    global still execute the same draft persistence assertions
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
  - grouped browser-local user templates in `/templates`
  - browser-local user template version history in `/canvas`
  - shared shell selectable contract
  - template inline-edit selectable contract
  - default canvas selectable contract
  - text-selected canvas selectable contract

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
  - `bun run --filter @tuckmark/web build:pages` passed
  - `bun run --filter @tuckmark/web build:storybook` passed
  - `bun run --filter @tuckmark/web test:e2e -- tests/user-template-flow.spec.ts` passed
  - `bun run --filter @tuckmark/web test:e2e -- user-template-flow.spec.ts` passed
  - `bun run --filter @tuckmark/web test:e2e -- template-table.spec.ts` passed
  - `TUCKMARK_WEB_SURFACE=browser-static bun run --filter @tuckmark/web build` passed
  - `bun run --filter @tuckmark/web test:e2e:sync` passed
  - `bun run build:web:pages` passed
  - `bun run --filter @tuckmark/web test:e2e -- --grep "template large mode"` passed
  - `bun run --filter @tuckmark/cli typecheck` passed
  - `bun run --filter @tuckmark/core typecheck` passed
  - `bun run --filter @tuckmark/core test tests/renderer.test.ts` passed
  - browser verification passed for:
    - grid visibility over the white label-paper base
    - canvas pan / zoom remaining decoupled from pointer-only panning
    - output preview generation using the same content semantics as the stage
  - broader package test suites still retain unrelated environment-sensitive
    coverage outside this convergence patch
