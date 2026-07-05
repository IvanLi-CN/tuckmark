# Tuckmark Workbench and Freeform Canvas

- Spec ID: `tk8wb`
- Status: `active`
- Owner: `Codex`

## Summary

Tuckmark Web is a four-page desktop workbench with a shared artifact seam.

The canonical route tree is `/`, `/templates`, `/canvas`, and `/system`. The
shell uses a top-middle-bottom layout with a shared header, shared footer, and
one right-side device drawer across `server-http`, `browser-static`, and
`demo`.

The `templates` and `canvas` routes are formal workspaces that preserve the
shared shell while specializing their inner tool surfaces. `templates` keeps
its route-owned narrow fallback. `/canvas` is now an editor-first label tool
with a stable three-column desktop layout and a route-local narrow desktop
mode that keeps the stage visible while switching one contextual side rail.

The freeform canvas uses `react-konva` for interactive editing only. Preview
and print continue to normalize back into the shared canvas schema and the
existing artifact pipeline through `toCanvasPrintSource`.

The stage now separates three layers explicitly:

- a white label-paper base
- a non-printing editor grid above the paper
- printable SVG content above the grid

This keeps label boundaries readable inside the editor while preserving visible
grid guidance and a single shared content truth between stage preview and final
output.

## Requirements

### Route and shell contract

- The canonical route tree is:
  - `/`
  - `/templates`
  - `/canvas`
  - `/system`
- The shell layout is:
  - top: `AppHeader`
  - middle: routed content outlet
  - bottom: `StatusFooter`
- `AppHeader` contains:
  - left: product mark and primary navigation
  - right: device entry button
- The device entry button opens a right-side `device drawer`.
- `StatusFooter` contains:
  - left: active surface, mode, and route path
  - right: GitHub repository link, current app version, site rights notice,
    Service API readiness, and browser-direct print readiness
- Footer version and repository metadata must come from build-time metadata with
  environment overrides, not from hard-coded component literals.
- `browser-static`, `server-http`, and `demo` reuse the same route tree and the
  same page components.
- Static Pages keeps browser history routing semantics and ships a `404.html`
  SPA fallback. Hash routing is not allowed.

### Visual direction

- The shell, overview cards, drawer, and primary actions use the restrained
  clay surface language.
- Dense work areas such as tables, property panels, and print rails keep a
  restrained professional tool appearance with stronger information density and
  lower decorative noise.
- Typography contract:
  - brand and large titles: `Nunito`
  - body, controls, tables, and property panels: `DM Sans`
- The desktop support range is:
  - width: `1024-1920`
  - height: `720-1280`
- Benchmark viewports:
  - `1024×768`
  - `1280×800`
  - `1440×900`
  - `1600×1024`

### Workspace contract

- `templates` workspace layout:
  - left: weak-grouped system templates and browser-local user templates
  - center: multi-row batch-entry table
  - right: preview, print parameters, and print actions
- `canvas` workspace layout:
  - left: document presets, quick-add actions, and layer management
  - center: stage, editor toolbar, zoom state, and stage hints
  - right: `属性 / 输出` inspector with explicit tab switching
  - version history opens from the save-action area into a right-side drawer
- `system` page contains:
  - app settings
  - default print settings
  - device management and probe actions
- `home` page contains:
  - recent templates
  - recent prints
  - quick entry points to template and canvas workspaces

### Responsive workspace contract

- At `>=1280px`, template and canvas workspaces remain three-column layouts.
- At `>=1280px`, template workspace keeps the left template rail wide enough to
  preserve a readable two-up large-card grid instead of collapsing card width
  as a side effect of the three-pane shell.
- Template workspace keeps its existing route-owned narrow behavior.
- Canvas workspace does not reuse template-style `focus-paired dual-pane`.
  Instead it uses a route-local narrow desktop editor mode.
- Template workspace switches to a route-owned narrow fallback:
  - at `960-1279px`, the list stage shows `template list + disabled
    preview/print rail`; selecting a template swaps the left pane into the
    batch table while keeping the right preview/print rail visible and
    interactive, and the table view exposes an explicit return action back to
    the template list
  - below `960px`, preview and print move below the batch table instead of
    remaining in a side rail
- Canvas narrow desktop rules:
  - active range is `960-1279px`
  - the center stage stays visible at all times
  - the user explicitly switches between `工具与图层` and `属性与输出`
  - the inactive side rail is fully hidden instead of collapsing to decorative
    micro-rails
  - below `960px`, `/canvas` is outside the first-pass professional editor
    support target

### Canvas and artifact seam contract

- The freeform editor uses `react-konva + konva` for interaction only.
- Shared printable canvas schema supports:
  - `text`
  - `rect`
  - `circle`
  - `triangle`
  - `line`
  - `barcode`
  - `qr`
- Barcode scope in v1:
  - only `Code128`
  - generated through `JsBarcode`
- QR scope in v1:
  - generated through `qrcode`
- Stage rendering uses the same barcode / QR semantic inputs as preview and
  print. Barcode and QR elements must render as real encoded graphics inside
  the editor instead of placeholder boxes.
- Invalid barcode / QR content must degrade safely inside the editor:
  - the stage shows a clear invalid-state placeholder instead of crashing
  - the inspector explains the issue in plain language
  - preview / direct print actions stay blocked until the issue is resolved
- Canvas content is monochrome-only. Editor selection chrome may use product
  accent colors, but printable label elements themselves render only in black
  and white and do not expose color editing.
- Shared schema extensions:
  - `rotation` is supported on `text`, `rect`, `barcode`, and `qr`
  - `triangle` also supports `rotation`
  - `circle` uses top-left `x/y` plus square `size`; rotation is intentionally
    not user-facing because it has no visible effect
  - `line` keeps endpoint-based geometry and does not add rotation as a first
    class print contract
- Stage transform semantics match the element geometry model:
  - new freeform `rect` elements default to square corners; existing templates
    and stored drafts preserve their explicit `radius`
  - single `rect`, `triangle`, `text`, and `barcode` selections expose
    non-proportional resize handles
  - single `qr` and `circle` selections resize proportionally so square symbols
    and round geometry remain intact
  - single `line` selections expose start and end endpoint handles instead of
    a rectangular scale transformer
  - rotated `triangle` elements use their rotated geometry for selection and
    multi-selection bounds
  - multi-selection may still use a group transformer for overall movement and
    batch transforms
- Preview and print normalize editor state into `DirectCanvasDefinition` and
  then flow through shared renderer, preview, and print seams.
- Rotated multiline text in preview and print must rotate around the rendered
  text box center so output stays aligned with the stage editing bounds.
- `browser-static` must support canvas preview and print without `/api` packet
  helpers.

### Canvas interaction and draft contract

- The editor state is versioned as a Web draft document with:
  - document metadata
  - per-layer metadata (`name`, `visible`, `locked`)
  - editor metadata (`gridEnabled`, `snapEnabled`)
- Scratch-draft persistence uses preset-scoped browser storage keys and also
  participates in same-device sync with `TuckmarkService` when the
  `server-http` surface is live.
- Browser-local user templates use an IndexedDB-backed registry with a memory
  fallback in nonconforming environments.
- Refresh restores the latest working copy for the active document source.
- Resetting a scratch draft clears the stored scratch working copy for that
  preset, records a sync tombstone, and rebuilds from the built-in preset.
- Resetting a preset-template draft rebuilds from the system template source.
- Resetting a user-template draft restores the current saved version of that
  browser-local template.
- Undo / redo keeps an in-memory history stack capped at `50` snapshots and
  does not restore history across refreshes.
- Canvas interaction baseline:
  - single selection
  - Shift multi-selection
  - marquee selection
  - drag move
  - wheel zoom relative to pointer
  - `Space + drag` stage pan
  - `fit to view`
  - transformer-based resize / rotation
  - `Delete`, `Duplicate`, `Undo`, `Redo`, and `Escape`
- Text elements support double-click inline editing on the stage.
- Layer rail supports:
  - rename
  - reorder
  - lock / unlock
  - show / hide
  - duplicate
  - delete
- Multi-select inspector behavior:
  - zero selection shows a focused onboarding hint
  - multi-selection shows batch actions and does not silently edit the first
    selected element as if it were a single-selection state
- Workbench selectable contract:
  - shared shell chrome, workspace chrome, static notices, and list-card
    metadata are non-selectable by default
  - editable fields, textareas, inline text editing, and structured table
    inputs preserve normal text selection and editing behavior
  - copy-relevant read-only values such as canvas size, zoom value, selection
    status, and layer names remain selectable through explicit read-only field
    surfaces instead of plain static text
  - canvas drag, marquee select, pan, zoom, and layer switching must not leave
    behind stray browser text-highlight artifacts

### Recent activity and persistence contract

- Recent templates and recent prints are persisted in a shared same-device sync
  state that merges browser-local storage with `TuckmarkService`.
- The browser snapshot remains the first-write surface and is reconciled with
  the service snapshot during startup and after key mutations.
- No remote history service or `/api/history` endpoint is introduced.
- Scratch canvas drafts participate in the same same-device sync state. No
  cross-device account sync or remote document service is introduced.
- Browser-local user templates, saved versions, autosaves, and user-template
  working copies stay browser-local only and do not sync through the service.
- Browser-local user template persistence contract:
  - source kinds are `scratch`, `preset-template`, and `user-template`
  - first save from `scratch` or `preset-template` creates a browser-local user
    template and its first saved version
  - save on a connected user template appends a new saved version
  - save as creates a new browser-local template from the current draft or
    read-only version and does not inherit the source template's history
  - saved versions retain the most recent `20`
  - autosaved unsaved versions retain the most recent `10`
  - autosave rolls every `5` minutes for named browser-local templates
- Browser-local user template field contract:
  - only `text`, `barcode`, and `qr` can bind to structured replacement fields
  - field identity is a stable `key`; layer names remain editor-facing labels
  - multiple elements may share one field binding
  - rebinding to an existing field immediately syncs the element value to that
    field default value
  - v1 field metadata is limited to `label`, `key`, `defaultValue`,
    `multiline`, and the current binding list
  - replaceable-element editing only exposes one field-name input with
    autocomplete and dropdown selection over existing fields; it does not add a
    second binding selector
- Template list contract:
  - `/templates` groups cards into `系统模板` and `我的模板`
  - clicking a system-template card enters the structured print-entry flow
  - clicking a browser-local user-template card enters the structured
    print-entry flow
  - both groups keep an explicit `编辑模板` route into `/canvas`
  - browser-local user template rows compile client-side into a concrete canvas
    definition before preview or print, so `browser-static` and `server-http`
    reuse the existing canvas artifact seam without a new template persistence
    API
  - agent-generated user template packages use the
    `tuckmark.user-template-package.v1` JSON contract and compile into the same
    canvas artifact seam
  - package import saves into browser-local user templates only; it does not
    introduce a remote template library or service-owned template history
  - Tuckmark CLI and Web validate, preview, import, packetize, and print
    template packages deterministically; they do not embed an LLM for template
    generation
- Canvas editor contract:
  - system template elements with fixed keys such as `__title` stay static when
    imported into the editor
  - scratch drafts, system-template working copies, and browser-local
    user-template working copies all expose editable canvas dimensions unless
    a historical saved version is open read-only
  - canvas dimension editing accepts positive integer millimeter width and
    height values in the UI, persists `CanvasDraftDocument.width` / `height`
    and browser-local user template summaries in millimeters, participates in
    undo / redo, and refits the stage viewport
  - legacy canvas drafts and user templates without `unit: "mm"` are treated as
    dots-era documents and converted to millimeters on read
  - system template source definitions remain dots-era device-neutral package
    data and are converted into millimeter canvas drafts when opened in the
    editor
  - preview and print compilation convert millimeter canvas drafts to dots only
    at the output boundary
  - changing canvas dimensions changes only the label boundary; existing
    elements are not scaled, cropped, or rearranged
  - elements that fall outside the current canvas boundary remain in the draft
    and surface non-blocking editor warnings
  - canvas dimension suggestions combine browser-local recent dimensions with
    built-in presets, dedupe by millimeter `width × height`, and present
    width/height as a single selectable suggestion
  - recent dimension history is browser-local only, global across canvas
    sources, ordered by successful explicit save / save-as / print use, and
    stays outside same-device sync state
  - editor and preview do not block on printer width capability; direct print
    checks the selected target `printWidthDots` and rejects canvas/template
    sources whose canvas width exceeds that target, with user-facing messages in
    millimeters
  - the toolbar save-action cluster exposes a `版本历史` entry that opens a
    right-side drawer
  - the version-history drawer lists saved versions and a collapsed autosave
    section
  - opening a historical version makes the stage read-only
  - read-only historical mode only exposes `恢复`, `另存为`, and `返回当前草稿`
  - restoring a historical version creates a new current working copy instead
    of mutating saved history in place
  - first-save and save-as template naming use the project-owned input dialog;
    the canvas workspace must not call browser-native `prompt`

## Acceptance

- All four formal routes are reachable in `runtime`, `demo`, and
  `browser-static`.
- The device drawer opens from any page, supports keyboard close, and restores
  focus to the trigger.
- `browser-static` supports deep-link refresh through `404.html`.
- Template workspace supports `0`, `1`, and `20` rows without layout breakage.
- Canvas workspace supports create, select, move, resize, rotate, duplicate,
  reorder, visibility toggle, lock toggle, and delete for `text`, `rect`,
  `circle`, `triangle`, `line`, `barcode`, and `qr`.
- Canvas workspace exposes type-correct geometry editing: rectangles can adjust
  corner radius, rectangular elements can resize width and height independently,
  triangles resize width and height independently, QR and circle elements stay
  square/round, and single line elements edit endpoints directly.
- Canvas workspace supports marquee selection, Shift multi-select, stage pan,
  wheel zoom, and fit-to-view without horizontal shell breakage.
- Text supports inline stage editing via double click.
- Shared shell, templates, canvas, and system pages prevent accidental text
  selection on non-editable chrome while preserving selection and copy
  behavior in editable or read-only value fields.
- Refresh restores the latest preset-scoped draft and reset clears it.
- `/canvas` can load system templates, scratch drafts, and browser-local user
  templates through route query parameters.
- First save from a system template or scratch draft creates a browser-local
  user template.
- Save on a connected browser-local user template appends a new saved version.
- Save as creates a distinct browser-local template without inheriting the
  source history.
- First-save and save-as naming use the project-owned template-name dialog,
  including cancel and empty-name validation paths.
- Opening a historical version switches the stage into read-only mode and
  restore returns that version into the current working copy.
- Canvas dimensions can be freely edited on scratch, system-template copy, and
  user-template working-copy sources; historical read-only versions keep the
  control disabled.
- Dimension autocomplete filters by the numeric prefix of any filled dimension:
  an empty width or height is a wildcard, and choosing a suggestion applies
  width and height together. The suggestion panel opens from input focus,
  typing, or hover; it has no separate arrow toggle, and clicking outside the
  picker closes the panel.
- Successful explicit save / save-as and successful real or demo print update
  browser-local recent dimension history; autosave and scratch persistence do
  not.
- Shrinking the canvas keeps existing elements unchanged and visible in the
  draft, with non-blocking out-of-canvas warnings.
- Preview remains available when the canvas width exceeds the current print
  target, but direct print is blocked with a width mismatch error.
- `/templates` displays both `系统模板` and `我的模板`; browser-local templates
  support structured row editing, preview, print, and an edit jump back to
  `/canvas`.
- Invalid barcode or QR payloads surface as user-visible errors.
- `server-http` startup restores recent activity from the merged sync snapshot.
- Scratch canvas drafts can be restored from the merged same-device sync
  snapshot after reload.
- `1100×820` keeps the `/canvas` stage visible while one contextual side rail
  is hidden.
- `1280×800`, `1440×900`, and `1600×1024` keep the professional three-column
  editor without horizontal overflow.

## Visual Evidence

- `1440×900` homepage shell

  PR: include
  ![Homepage shell](./assets/home-1440x900.png)

- `1100×820` template workspace in narrow single-outlet mode with a disabled preview/print rail before template selection

  PR: include
  ![Template workspace](./assets/templates-1100x820-disabled-rail.png)

- `1440×900` template large-card grid keeps same-row cards equal height and exposes add-template entry points in both the list header and empty user-template group

  PR: include
  ![Template large grid with add-template actions](./assets/templates-large-grid-add-button-1440x900.png)

- `1440×900` template list segmented tabs use matching outer, indicator, and button geometry

  PR: include
  ![Template segmented tabs](./assets/templates-segmented-tabs-1440x900.jpg)

- `1280×800` template workspace footer showing GitHub repository, current app version, site rights notice, and runtime diagnostics together

  ![Template footer metadata](./assets/templates-footer-metadata-1280x800.png)

- `1280×800` canvas workspace in professional three-column editor mode

  PR: include
  ![Canvas workspace](./assets/canvas-wide-1280x800.png)

- `1100×820` canvas workspace in narrow desktop single-side mode with stage always visible

  PR: include
  ![Canvas narrow workspace](./assets/canvas-narrow-1100x820.png)

- `1280×800` canvas workspace with real barcode selection and inspector editing state

  PR: include
  ![Canvas barcode workspace](./assets/canvas-barcode-selected-1280x800.png)

- `1280×800` canvas workspace with a selected square-corner rectangle, non-proportional resize handles, and the exposed `圆角` inspector field at `0`.

  PR: include
  ![Canvas selected rectangle editing](./assets/canvas-rect-selected-1280x800.png)

- `1280×800` canvas workspace with a selected circle, proportional corner resize handles, and a `边长` inspector field.

  PR: include
  ![Canvas selected circle editing](./assets/canvas-circle-selected-1280x800.png)

- `1280×800` canvas workspace with a selected triangle, non-proportional resize handles, and independent width / height inspector fields.

  PR: include
  ![Canvas selected triangle editing](./assets/canvas-triangle-selected-1280x800.png)

- `1280×800` canvas workspace with a selected line using endpoint handles instead of a rectangular transformer.

  PR: include
  ![Canvas selected line endpoint editing](./assets/canvas-line-selected-1280x800.png)

- `1280×800` canvas workspace output rail after preview generation, with stage and preview sharing the same monochrome content semantics

  PR: include
  ![Canvas output preview workspace](./assets/canvas-output-preview-1280x800.png)

- `1280×800` template workspace showing grouped `系统模板 / 我的模板` cards with a browser-local user template present

- `1440×900` homepage shell with non-selectable shared chrome and selectable status/value fields preserved where copying matters

  PR: include
  ![Home selectable contract](./assets/selectable/home-selectable-1440x900.png)

- `1280×800` template workspace with non-selectable list/table chrome and selectable inline editing field behavior

  PR: include
  ![Templates selectable contract](./assets/selectable/templates-selectable-1280x800.png)

- `1280×800` canvas workspace default state with non-selectable toolbar/stage chrome and selectable read-only metadata fields

  PR: include
  ![Canvas selectable default](./assets/selectable/canvas-selectable-default-1280x800.png)

- `1280×800` canvas workspace text-selected state with selectable property editor fields preserved inside the hardened chrome contract

  PR: include
  ![Canvas selectable text state](./assets/selectable/canvas-selectable-text-1280x800.png)

  PR: include
  ![Template grouped user templates](./assets/templates-user-groups-1280x800.png)

- `1280×800` canvas workspace on a browser-local user template with the version-history drawer open and saved/autosave history visible

  PR: include
  ![Canvas version history workspace](./assets/canvas-version-history-1280x800.png)

- Project-owned dialog states replacing browser-native script dialogs, including confirmation, input, and validation states

  ![Project dialog state gallery](./assets/dialogs/dialog-state-gallery.png)

- Canvas first-save and save-as naming dialog opened from the workspace instead of browser-native `prompt`

  ![Canvas template name dialog](./assets/dialogs/canvas-template-name-dialog.png)

- `1600×1024` system page in wide three-column mode

  PR: include
  ![System workspace](./assets/system-1600x1024.png)

- DimensionPicker autocomplete filters millimeter suggestions by width prefix
  while height is empty, and selecting a row applies width and height together.

  ![Free canvas dimension picker filtering](./assets/free-canvas-dimension-picker-filtering-20260704.png)

- `1440×960` canvas workspace shows the free dimension inputs in the editor
  header, with millimeter recent-size autocomplete available in the full
  editor.

  ![Free canvas workspace wide](./assets/free-canvas-workspace-wide-20260704.png)

- `390×900` canvas workspace keeps the same free dimension control available in
  the narrow responsive editor surface after normal vertical scrolling, with
  width and height displayed in millimeters.

  ![Free canvas workspace narrow](./assets/free-canvas-workspace-narrow-20260704.png)
