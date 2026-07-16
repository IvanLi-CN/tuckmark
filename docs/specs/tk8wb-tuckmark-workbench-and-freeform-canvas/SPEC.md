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

The local durability model is also route-owned now. Supported Chromium desktop
and installed-PWA surfaces run browser-local persistence on `SQLite Wasm +
OPFS`, while `/system` owns directory authorization, JSON mirror sync, ZIP
backup / restore, and whole-dataset import / export. Unsupported browsers keep
the editor usable with the legacy browser-local fallback, but do not expose
directory-backed workflows.

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
- Device-drawer actions keep their recoverable failure and cancellation
  feedback inside the drawer instead of closing the drawer or escalating to a
  separate blocking surface.
- `StatusFooter` contains:
  - left: active surface, mode, and route path
  - right: GitHub repository link, owner-facing release/build metadata, site
    rights notice, Service API readiness, and browser-direct print readiness
- Footer version and repository metadata must come from build-time metadata with
  environment overrides, not from hard-coded component literals.
- Tagged owner-facing builds show `v<release-version>` only and expose
  `build <shortsha>` in tooltip metadata; untagged owner-facing builds show
  `build <shortsha>` only.
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
  - local data directory status, permission state, writer-lease state, and
    last-sync health
  - directory attach / switch actions plus manual sync, manual backup, whole
    dataset restore, whole dataset import, and whole dataset export
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
  - `datamatrix`
- Barcode scope in v1:
  - only `Code128`
  - generated through `JsBarcode`
- QR scope in v1:
  - generated through `qrcode`
- Data Matrix scope in v1:
  - only generic `ECC200`
  - square symbols only; rectangular extensions are out of scope
  - generated through a shared `bwip-js`-backed module-matrix helper
- Stage rendering uses the same barcode / QR / Data Matrix semantic inputs as
  preview and print. Barcode, QR, and Data Matrix elements must render as real
  encoded graphics inside the editor instead of placeholder boxes.
- Invalid barcode / QR / Data Matrix content must degrade safely inside the
  editor:
  - the stage shows a clear invalid-state placeholder instead of crashing
  - the inspector explains the issue in plain language
  - preview / direct print actions stay blocked until the issue is resolved
- Canvas content is monochrome-only. Editor selection chrome may use product
  accent colors, but printable label elements themselves render only in black
  and white and do not expose color editing.
- Shared schema extensions:
  - `rotation` is supported on `text`, `rect`, `barcode`, `qr`, and
    `datamatrix`
  - `triangle` also supports `rotation`
  - `circle` uses top-left `x/y` plus square `size`; rotation is intentionally
    not user-facing because it has no visible effect
  - `line` keeps endpoint-based geometry and does not add rotation as a first
    class print contract
  - `text` uses top-left `x/y` container geometry with persisted `width`,
    `height`, `fontSize`, `fontFamily`, `lineHeight`, horizontal `align`,
    `verticalAlign`, `stretchXGrow`, `stretchXShrink`, `stretchYGrow`,
    `stretchYShrink`, `autoWrap`, `adaptiveFontSize`, and `verticalText`
  - legacy serialized text values `stretchX` and `stretchY` remain readable:
    `true` maps to both grow and shrink on that axis, while `false` or missing
    leaves both axis-fit flags disabled
  - canvas-draft `fontSize` is the font design size in millimeters, not CSS
    pixels, typographic points, or a normalized visible-ink height; new text
    and plain-text paste start at `5.0 mm`, which compiles to `40 dots` at the
    `8 dots/mm` print boundary
- Stage transform semantics match the element geometry model:
  - new freeform `rect` elements default to square corners; existing templates
    and stored drafts preserve their explicit `radius`
  - single `rect`, `triangle`, `text`, and `barcode` selections expose
    non-proportional resize handles
  - single `qr`, `datamatrix`, and `circle` selections resize proportionally
    so square symbols and round geometry remain intact
  - single `line` selections expose start and end endpoint handles instead of
    a rectangular scale transformer
  - rotated `triangle` elements use their rotated geometry for selection and
    multi-selection bounds
  - multi-selection may still use a group transformer for overall movement and
    batch transforms
- Text transform semantics match a fixed-container text model:
  - resizing a text element changes only the container `width` and `height`
  - resizing alone never writes back a changed `fontSize`
  - without stretch enabled, text keeps its natural glyph size and is laid out
    inside the container according to horizontal and vertical alignment
  - line height is an explicit text property that controls the distance between
    rendered line baselines without changing `fontSize`
  - automatic wrapping is an explicit text property; when enabled, text wraps
    within the container width, including long-token character breaks; when
    disabled, explicit lines stay unwrapped and are clipped by the container
  - adaptive font sizing forces layout through the effective no-wrap path while
    keeping `autoWrap` persisted as the user preference; when adaptive sizing
    is later turned off, the saved `autoWrap` preference becomes effective
    again
  - horizontal `align` supports `justify`; justified text distributes extra
    spacing between visible characters so the line fills the text container
    width without changing `fontSize`
  - `justify` and horizontal grow are mutually exclusive in the inspector:
    enabling either one clears the other, while horizontal shrink remains
    compatible with both
  - vertical text lays out glyphs top-to-bottom in columns and uses the same
    container clipping, BBOX alignment, wrapping, and stretch contracts as
    horizontal text
  - grow and shrink are tracked independently on each axis:
    grow expands natural content only when the container has extra room, and
    shrink compresses it only when the natural content would overflow
  - adaptive font sizing uses the shared measured natural height to write back
    a corrected `fontSize` so the rendered text height matches the element
    height across stage editing, inline editing, preview, and print
- Preview and print normalize editor state into `DirectCanvasDefinition` and
  then flow through shared renderer, preview, and print seams.
- Rotated multiline text in preview and print must rotate around the rendered
  text box center so output stays aligned with the stage editing bounds.
- Multiline text layout uses the same text box model on the Konva stage, SVG
  preview, direct print artifacts, and inline stage editor.
- Text alignment is based on the text's natural visible BBOX rather than the
  looser browser line box. Without stretch, the BBOX keeps the saved font size
  and line height, then moves inside the element container according to the
  selected horizontal and vertical alignment so the BBOX edge can touch the
  matching container edge. Axis grow/shrink changes rendered scale only; it
  does not write scale back into `fontSize`. Adaptive sizing is the only text
  fit mode that intentionally updates the saved `fontSize`.
- Text rendering is clipped to the text element container on the stage and in
  SVG / print output. Text ink must not render outside the element bounds.
- New text elements default to `noto-sans-sc`.
- New manually inserted text defaults to `stretchXShrink=true`,
  `stretchXGrow=false`, `stretchYGrow=false`, `stretchYShrink=false`, and
  `adaptiveFontSize=false`; `自动换行` defaults to off for newly inserted text.
- The text inspector retains the `字号` field label and keeps `0.1 mm` editing
  precision with a `1.0 mm` lower bound.
- When adaptive sizing is enabled, the inspector disables the `字号` input and
  shows `自动换行` as disabled and off while preserving the saved wrap
  preference under the hood.
- Existing templates, saved drafts, and imported elements retain their stored
  font sizes; the new-text default does not migrate or reflow them.
- Text font families resolve through one deterministic contract shared by:
  - draft/schema validation
  - canvas text measurement
  - Konva stage rendering
  - SVG preview and output rendering
  - inspector labels and selector preview
- Bundled fonts are self-hosted and must not depend on remote CDNs or
  user-installed fonts.
- Legacy draft/template values `system-sans`, `system-serif`, `system-mono`,
  and `arial` remain valid serialized inputs and continue to render, edit, and
  export without migration.
- Browser-static, Storybook, Konva stage, and SVG/output preview must wait for
  bundled-font readiness before final measurement-sensitive text rendering so
  late fallback-font replacement does not shift the same sample text across
  surfaces.
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
  - live magnetic snapping when `snapEnabled` is active
  - coarse physical-wheel bursts zoom relative to the pointer without a
    modifier key
  - fine pixel-level two-axis wheel bursts pan the stage, including Logitech
    Options+ `CUSTOM_PAN` gestures that suppress the held-button state
  - horizontal wheel / tilt-wheel stage pan
  - `Space + drag` stage pan
  - `fit to view`
  - transformer-based resize / rotation with real-time active-edge snapping
  - system clipboard `Copy` / `Paste` for selected elements through keyboard
    clipboard events when focus is not inside editable form controls
  - `Delete`, `Duplicate`, `Undo`, `Redo`, and `Escape`
- Clipboard paste behavior:
  - structured Tuckmark clipboard payload restores the copied element set as
    new layers, preserves the copied relative layer order and geometry, and
    enters a pending placement preview that follows the current pointer until
    the user confirms with click or `Enter`
  - plain `text/plain` clipboard content falls back to one new `text` element
    in the same pending placement preview flow
  - pending clipboard placement may be cancelled with `Escape` or `Cmd/Ctrl+Z`
    before it writes a new history entry
  - pending clipboard placement follows the same live magnetic snap contract
    as ordinary element dragging
  - clipboard hints and outcomes render as toast-like weak prompts and must
    not shift the static editor pane document flow
  - historical read-only canvas versions may copy selected elements but must
    not paste or otherwise mutate the draft
- `snapEnabled` governs one shared pointer magnetic-snap policy across ordinary
  and multi-selection dragging, pending clipboard placement, line endpoints,
  and Transformer resize handles. Ordinary and multi-selection dragging keep
  using the `1mm` grid, the four canvas edges, and the visible outer bounds of
  other elements; moving and pending elements are excluded, while visible
  locked elements remain valid references. Rotated elements use their visible
  axis-aligned outer bounds.
- Direct handles resolve snapping from explicit active sources instead of
  implicit box defaults:
  - line endpoints use their active point on both axes
  - Transformer resize handles declare only the active `min|center|max`
    source on each axis, so inactive axes never snap or render guides
  - direct-handle targets additionally include element and canvas centerlines,
    while corner metadata may participate through the same axis projection
    path without changing the guide rendering contract
- Canvas and element edges use an `8px` screen-space threshold. The grid uses
  `min(8px, 40% of the current grid spacing)` so low zoom still leaves a free
  adjustment zone. X and Y resolve independently by screen distance; within
  `0.5px`, element targets win over canvas targets, which win over grid
  targets.
- Dragging a selection applies one rigid snapped translation. Line editing
  snaps only the active endpoint. Transformer resize snaps only the active
  handle source and keeps its opposite edge fixed; transform completion commits
  the current live geometry without a second rounding jump. Rotation remains
  freeform, square-element proportions and minimum sizes remain intact, and
  text resizing preserves saved font-size semantics.
- Snapping to a canvas or element axis projection displays a temporary
  one-pixel guide; grid-only hits do not add a guide. Guides disappear when
  the target is left, the interaction ends, or snapping is disabled, and never
  persist, print, or export.
- The snap toolbar button controls and reports the persistent `snapEnabled`
  flag. No keyboard modifier temporarily overrides snapping; keyboard arrows
  remain exact `1mm` moves, or `10mm` with Shift, outside the pointer-magnetic
  policy.
- Text elements support double-click inline editing on the stage.
- Text inspector controls expose:
  - numeric font size
  - numeric line height
  - one shared font registry that owns text schema values, measurement
    profiles, inspector labels, font stacks, legacy alias resolution, and the
    flat picker list
  - bundled named font family choices exceeding `20`, including
    `archivo`, `barlow`, `barlow-condensed`, `bebas-neue`, `dm-sans`,
    `exo-2`, `ibm-plex-mono`, `ibm-plex-sans`, `ibm-plex-serif`,
    `inconsolata`, `inter`, `inter-tight`, `jetbrains-mono`, `manrope`,
    `noto-sans-sc`, `noto-serif-sc`, `oswald`, `outfit`, `overpass`,
    `public-sans`, `rajdhani`, `roboto`, `roboto-condensed`,
    `source-sans-3`, `source-serif-4`, `space-grotesk`, `space-mono`,
    and `work-sans`
  - explicit named platform-font choices kept for compatibility workflows:
    `arial`, `courier-new`, `georgia`, `times-new-roman`,
    `trebuchet-ms`, and `verdana`
  - a flat font selector with no user-facing grouping
  - each font option previewing itself directly inside the selector; Latin-first
    families keep their English names so the preview stays visually trustworthy
  - a three-by-three alignment control that maps to horizontal `align` and
    `verticalAlign`
  - automatic wrapping, two-end text justification, vertical text, and
    independent horizontal and vertical stretch toggles
- Layer rail supports:
  - copy
  - paste
  - rename
  - reorder
  - lock / unlock
  - show / hide
  - duplicate as `新副本`
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
- Durable runtime storage contract:
  - supported Chromium desktop / installed-PWA surfaces use a worker-backed
    `SQLite Wasm` runtime with the `opfs-sahpool` VFS
  - unsupported or incomplete environments fall back to the existing
    browser-local compatibility path built on `IndexedDB`, `localStorage`, and
    in-memory test fallbacks
  - first startup performs one browser-local migration of existing user
    templates, saved versions, autosaves, working copies, and runtime app
    settings into the unified runtime store
  - post-migration route components read and write through one runtime
    repository / service boundary instead of scattering direct browser storage
    mutations in page components
- Runtime app settings contract:
  - default print render settings and the one-shot directory-permission nudge
    state are persisted beside user template data
  - document-specific draft edits must not silently overwrite the global
    default print settings snapshot
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
  - only `text`, `barcode`, `qr`, and `datamatrix` can bind to structured
    replacement fields
  - field identity is a stable `key`; layer names remain editor-facing labels
  - multiple elements may share one field binding
  - rebinding to an existing field immediately syncs the element value to that
    field default value
  - v1 field metadata is limited to `label`, `key`, `defaultValue`,
    `multiline`, and the current binding list
  - replaceable-element editing only exposes one field-name input with
    autocomplete and dropdown selection over existing fields; it does not add a
    second binding selector
- User data directory mirror contract:
  - the directory-backed mirror is only supported when both `File System Access
    API` directory handles and `OPFS` runtime storage are available
  - `/system` persists one `FileSystemDirectoryHandle` and requests
    `readwrite` permission on demand before sync, backup, restore, or import
  - non-supporting environments and denied-permission states keep the workbench
    usable, but disable directory sync and whole-dataset backup flows with an
    explicit capability message
  - the mirrored tree is versioned JSON:
    - `manifest.json`
    - `settings/app-settings.json`
    - `templates/<templateId>/template.json`
    - `templates/<templateId>/versions/<versionId>.json`
    - `templates/<templateId>/working-copy.json`
    - `drafts/scratch/<presetId>.json`
    - `drafts/preset-template/<presetId>.json`
    - `backups/manual/*.zip`
    - `backups/protection/*.zip`
  - `manifest.json` records the schema version, snapshot timestamps, source,
    and aggregate counts for templates, versions, and working copies
  - directory attach behavior is explicit:
    - an empty directory can be initialized from the current runtime snapshot
    - an existing Tuckmark directory requires an explicit choice between
      importing the directory dataset or overwriting it with the current
      browser-local dataset
  - manual backups write fixed-location ZIP snapshots under `backups/manual/`
  - restore and whole-dataset import write a protection ZIP snapshot under
    `backups/protection/` before replacing current runtime data
  - protection snapshots retain the most recent `20`; manual backups are not
    auto-pruned
  - ZIP export, ZIP import, manual backup, and restore all use the same
    logical archive contract rather than dumping raw SQLite files
  - restore and whole-dataset import replace the active runtime dataset and
    reload the current app state without asking the user to clear browser data
  - mirror conflicts resolve as latest-modified-wins; no field-level merge or
    background daemon is introduced
  - key data mutations flush immediately, working-copy and scratch updates flush
    after a short debounce
  - first successful user-template save may show one non-blocking directory
    setup prompt when the environment supports directory access and the user has
    not already dismissed that prompt
- Cross-tab write coordination contract:
  - directory mirror and archive mutations are coordinated by a single-writer
    lease with `BroadcastChannel` state broadcasts
  - one tab performs directory sync / backup / restore work while other tabs
    surface status refresh and an explicit take-over action
  - the workbench does not attempt concurrent multi-writer directory mutation
    or cross-tab SQLite RPC in this round
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
- Browser-direct chooser cancellation and recoverable device-drawer action
  failures keep the device drawer open, keep the primary retry action in place,
  and clear temporary inline feedback after the drawer is closed.
- `browser-static` supports deep-link refresh through `404.html`.
- Template workspace supports `0`, `1`, and `20` rows without layout breakage.
- Canvas workspace supports create, select, move, resize, rotate, duplicate,
  reorder, visibility toggle, lock toggle, and delete for `text`, `rect`,
  `circle`, `triangle`, `line`, `barcode`, and `qr`.
- Canvas workspace round-trips selected elements through the system clipboard:
  structured Tuckmark payloads and plain-text clipboard fallbacks both enter a
  pointer-following placement preview, then confirm into new layers only after
  the user clicks or presses `Enter`.
- Selected text exposes font size, font family, three-by-three alignment,
  automatic wrapping, two-end justification, horizontal stretch, vertical
  stretch, vertical text, and rotation controls in the property inspector.
- New text defaults to `noto-sans-sc` instead of a system fallback family.
- New text and external plain-text paste default to `5.0 mm` design size, and
  the selected-text inspector labels that value as `字号`.
- Existing template, draft, and imported text font sizes remain unchanged.
- The font selector shows a flat list of explicit named fonts, exposes more
  than `20` bundled choices, and previews each option using the selected font
  stack.
- Existing drafts and templates using `system-sans`, `system-serif`,
  `system-mono`, `arial`, or `noto-sans-sc` continue to deserialize, edit,
  preview, and export without data migration.
- Text rotation is edited as an integer degree value and exposes adjacent
  counterclockwise / clockwise 45-degree increment controls.
- Text resize preserves `fontSize` unless the user explicitly edits the font
  size field; stretch toggles affect rendering only and do not rewrite
  `fontSize`.
- Multiline text first resolves a natural visible BBOX, then aligns that BBOX
  to the container top, middle, bottom, left, center, or right without baseline
  anchoring. Vertical stretch scales that BBOX to the container height while
  keeping the saved `fontSize` unchanged.
- Text ink is clipped to the text element container. With automatic wrapping
  disabled, overflow is cut by the container instead of escaping it.
- Named-font rendering stays aligned across Storybook, browser-static, the
  Konva stage, and SVG/output preview for mixed content such as `20kΩ`, mixed
  Chinese/Latin text, digits, symbols, and mono-width labels.
- Canvas workspace exposes type-correct geometry editing: rectangles can adjust
  corner radius, rectangular elements can resize width and height independently,
  triangles resize width and height independently, QR and circle elements stay
  square/round, and single line elements edit endpoints directly.
- Canvas workspace supports marquee selection, Shift multi-select, stage pan,
  vertical wheel zoom, horizontal wheel pan, and fit-to-view without
  horizontal shell breakage.
- Marquee selection chrome is editor-only stage-space affordance: its border
  remains `1 logical px dashed` at any zoom level while selection bounds and
  hit semantics continue to use canvas-space geometry.
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
- Historical read-only versions keep `拷贝` available for selected elements and
  keep `粘贴` disabled.
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
- Invalid barcode, QR, or Data Matrix payloads surface as user-visible errors.
- `server-http` startup restores recent activity from the merged sync snapshot.
- Scratch canvas drafts can be restored from the merged same-device sync
  snapshot after reload.
- Supported Chromium desktop / installed-PWA surfaces migrate existing
  browser-local template data into the unified runtime store once, then keep
  user templates, saved versions, working copies, scratch drafts, and runtime
  app settings readable after reload.
- `/system` can show unsupported, unconfigured, permission-required, and
  configured-healthy data-directory states without breaking the rest of the
  workbench.
- In a supported environment, `/system` can authorize a data directory, switch
  directories, sync the runtime snapshot, create a fixed-location backup,
  inspect and restore a backup ZIP, inspect and import a runtime ZIP, and
  export the current runtime ZIP.
- Authorized data directories expose the versioned JSON tree and ZIP backup
  layout described in this spec; permission failure or handle loss reports a
  user-visible error instead of silently dropping writes.
- Restore and whole-dataset import create a protection snapshot before
  replacing the active runtime dataset, and the workbench reflects the
  imported/restored data immediately afterward.
- The template-workspace single-template package import continues to handle only
  `tuckmark.user-template-package.v1`; whole-dataset import / export remains a
  `/system`-only workflow.
- First successful save of a user template only shows the directory setup prompt
  once per browser-local profile while the directory remains unconfigured.
- Cross-tab directory workflows keep one active writer lease, broadcast status
  updates to peers, and surface an explicit take-over path instead of
  optimistic concurrent writes.
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

- `1440×900` homepage device drawer keeps inline browser-direct cancellation
  feedback visible while preserving the primary reconnect action.

  PR: include
  ![Device drawer browser-direct cancelled state](./assets/device-drawer-browser-direct-cancelled-1440x900.png)

- `1440×900` homepage device drawer shows the browser-direct connection busy
  state in place without leaving the drawer context.

  PR: include
  ![Device drawer browser-direct busy state](./assets/device-drawer-browser-direct-busy-1440x900.png)

- `1440×900` template list segmented tabs use matching outer, indicator, and button geometry

  PR: include
  ![Template segmented tabs](./assets/templates-segmented-tabs-1440x900.jpg)

- `1280×800` template workspace footer showing GitHub repository, current app version, site rights notice, and runtime diagnostics together

  ![Template footer metadata](./assets/templates-footer-metadata-1280x800.png)

- `1280×800` canvas workspace in professional three-column editor mode

  PR: include
  ![Canvas workspace](./assets/canvas-wide-1280x800.png)

- `1280×800` mock-demo canvas after coarse physical-wheel zoom; the active `296%` scale
  is reflected by the enlarged label content while the three-column workbench
  remains usable.

  ![Canvas wheel zoom](./assets/canvas-wheel-zoom-1280x800.jpg)

- Chrome mock-demo canvas after a horizontal wheel event;
  the label shifts horizontally while its rendered scale remains unchanged.

  PR: include
  ![Canvas horizontal wheel pan](./assets/canvas-m720-horizontal-pan-1765x1168.jpg)

- `1600×1200` canvas clipboard workflow after Storybook `拷贝` + `粘贴`, showing the pending placement toast, stable editor copy, snap-aligned preview movement, and the distinct `拷贝` / `粘贴` / `新副本` actions together.

  PR: include
  ![Canvas clipboard workflow](./assets/canvas-clipboard-story-1600x1200.png)

- `1600×1200` snap-enabled canvas workspace story showing the ordinary selection editing state with the persistent `吸附` toggle enabled for live drag snapping.

  PR: include
  ![Canvas snap-enabled workspace](./assets/canvas-snap-enabled-story-1600x1200.png)

- `1280×800` magnetic-snap Storybook scene while the selected rectangle aligns to a rotated locked reference edge; the temporary blue guide shows the live edge hit.

  PR: include
  ![Canvas magnetic snap guide](./assets/canvas-magnetic-snap-story-1280x800.png)

- `1280×800` demo canvas after expanding the selected rectangle through its top-left Transformer handle; the rectangle grows while the fixed right and bottom edges remain aligned.

  PR: include
  ![Canvas Transformer resize](./assets/canvas-transformer-resize-1280x800.png)

- `1280×800` canvas workspace with a selected text element before inline editing.

  PR: include
  ![Canvas inline text selected before editing](./assets/canvas-inline-text-ready.png)

- `1280×800` canvas workspace after double-clicking the text bounds, showing the focused inline textarea overlay.

  PR: include
  ![Canvas inline text editor overlay](./assets/canvas-inline-text-editing.png)

- `1280×800` canvas workspace with inline text editing preserving two-end justification.

  PR: include
  ![Canvas inline text editor with two-end justification](./assets/canvas-inline-text-justify-editing.png)

- `1280×800` canvas workspace with inline text editing restoring centered alignment inside the text container.

  ![Canvas inline text editor with centered alignment restored](./assets/canvas-inline-text-centered-editing.png)

- `1280×800` canvas workspace after committing inline text changes, with the stage and inspector showing the updated value.

  PR: include
  ![Canvas inline text committed result](./assets/canvas-inline-text-committed.png)

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

- `1280×800` canvas workspace with a marquee selection box at `344%` zoom, keeping a screen-space `1 logical px` dashed border instead of scaling with the canvas content.

  PR: include
  ![Canvas marquee selection at 344 percent zoom](./assets/canvas-marquee-selection-1280x800.png)

- `1280×800` canvas workspace output rail after preview generation, with stage and preview sharing the same monochrome content semantics

  PR: include
  ![Canvas output preview workspace](./assets/canvas-output-preview-1280x800.png)

- `1280×800` template workspace showing grouped `系统模板 / 我的模板` cards with a browser-local user template present

  PR: include
  ![Template grouped user templates](./assets/templates-user-groups-1280x800.png)

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

- `1280×800` canvas workspace text-container state showing multiline text box
  alignment, font controls, line-height control, and stretch toggles in the
  selected element inspector

  PR: include
  ![Canvas text container controls](./assets/canvas-text-container-controls-1280x800.png)

- `1280×800` canvas workspace showing a newly created text layer with the
  selected inspector explicitly displaying `字号` at `5.0`, `自动换行` off,
  and the default `水平挤压` state enabled.

  ![Canvas text default 5 millimeters](./assets/canvas-text-default-5mm-1280x800.png)

- Storybook canvas flat font-selector state showing a long explicit named-font
  list with each option rendered in its own font stack

  PR: include
  ![Canvas flat font selector](./assets/canvas-text-font-family-select-flat-20260708.png)

- `1280×800` canvas workspace text flow controls showing two-end
  justification, wrapping, horizontal grow/shrink, vertical grow/shrink,
  adaptive sizing, vertical text, and rotation split into two inspector
  columns

  PR: include
  ![Canvas text flow controls](./assets/canvas-text-flow-justify-vertical.png)

- `1280×800` canvas workspace text adaptive-sizing state showing `自适应`
  enabled, `自动换行` disabled in the off state, and `字号` locked while the
  shared layout shrinks text to the selected container height.

  PR: include
  ![Canvas adaptive font sizing](./assets/canvas-text-adaptive-font-size-1280x800.png)

- Canvas text rotation controls showing integer-only rotation input and
  adjacent 45-degree counterclockwise / clockwise increment buttons

  PR: include
  ![Canvas text rotation controls](./assets/canvas-text-rotation-integer-buttons.png)

- `1280×800` canvas workspace text BBOX font metrics state showing named-font
  `Noto Sans SC` rendering for `20kΩ` plus mixed
  Chinese/Latin text inside the same measurement-sensitive canvas flow.

  PR: include
  ![Canvas text BBOX font metrics](./assets/canvas-text-font-metrics-flat-pool-20260708.png)

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

- `1600×1200` `/system` page in an unsupported browser state, making the data
  directory capability boundary explicit while the rest of the system settings
  page remains available.

  PR: include
  ![System page unsupported](./assets/system-page-unsupported-1600x1200.png)

- `1600×1200` `/system` page in the unconfigured-but-supported state, with the
  directory actions visible before any handle is attached.

  PR: include
  ![System page unconfigured](./assets/system-page-unconfigured-1600x1200.png)

- `1600×1200` `/system` page in the configured healthy state, showing directory
  manifest counts, granted permission, and last-sync metadata in the full
  settings layout.

  PR: include
  ![System page configured healthy](./assets/system-page-configured-healthy-1600x1200.png)

- `1600×1200` `/system` page with the directory-attach conflict dialog,
  requiring an explicit choice between importing an existing directory dataset
  or overwriting it with the current browser-local runtime snapshot.

  PR: include
  ![System page attach choice](./assets/system-page-attach-choice-1600x1200.png)

- `1600×1200` `/system` page with the fixed-location backup list, combining
  manual backups with restore-protection snapshots.

  PR: include
  ![System page backup list](./assets/system-page-backup-list-1600x1200.png)

- `1600×1200` `/system` page with the whole-dataset ZIP import confirmation
  dialog, showing the archive summary before replacement.

  PR: include
  ![System page import confirm](./assets/system-page-import-confirm-1600x1200.png)

- `1600×1200` `/system` page with the backup-restore confirmation dialog,
  reusing the same archive summary model before replacing runtime data.

  PR: include
  ![System page restore confirm](./assets/system-page-restore-confirm-1600x1200.png)

- `1600×1200` `/system` page in the permission-required state after the browser
  keeps the directory handle but no longer grants read/write access.

  PR: include
  ![System page permission denied](./assets/system-page-permission-denied-1600x1200.png)

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

- `1280×800` canvas workspace Storybook state with persistent snapping enabled
  and the snap toolbar button reporting effective snapping as active.

  PR: include
  ![Canvas snap enabled](./assets/canvas-snap-enabled-1280x800.png)

- `1280×800` Storybook stable capture for the `bottom-center` transformer
  contract, showing that only the snapped bottom guide remains visible while
  the shared left edge stays inactive.

  PR: include
  ![Canvas transformer bottom-center guide state](./assets/canvas-transformer-bottom-center-guide-state-1280x800.png)

- `1280×800` Storybook stable capture for point-handle center snapping,
  showing one selected line endpoint converging on the reference center with
  one winner guide on each axis.

  PR: include
  ![Canvas line endpoint center guide state](./assets/canvas-line-endpoint-center-guide-state-1280x800.png)

- `1280×800` canvas workspace Storybook `storybook_canvas` selected-state
  fallback showing a real square `ECC200` Data Matrix element, proportional
  resize handles, and the minimal inspector contract.

  PR: include
  ![Canvas Data Matrix selected](./assets/canvas-datamatrix-selected-1280x800.png)

- `1280×800` canvas workspace Storybook `storybook_canvas` invalid-state
  fallback showing the recoverable Data Matrix placeholder and inspector error
  message.

  PR: include
  ![Canvas Data Matrix invalid](./assets/canvas-datamatrix-invalid-1280x800.png)
