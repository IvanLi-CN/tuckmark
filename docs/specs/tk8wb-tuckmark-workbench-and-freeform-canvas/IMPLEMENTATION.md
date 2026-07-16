# Implementation Notes

## Current coverage

- Route tree is implemented through a shared app shell with `/`, `/templates`,
  `/canvas`, and `/system`.
- The shared shell now includes:
  - a top navigation header
  - a shared status footer with route/runtime state, GitHub repository link,
    build-time release/build metadata, site rights notice, and print-path
    readiness
  - one right-side device drawer reused across runtime, browser-static, and
    demo surfaces
  - drawer-local feedback state for device actions so browser-direct
    cancellation, browser-direct connection failures, and service-api probe /
    refresh failures stay recoverable in-context without closing the drawer
- The `/system` page now combines existing app / print settings with a route
  owned `SystemDataStorageCard` that surfaces:
  - browser capability state for `File System Access API` + `OPFS`
  - configured directory name, permission state, writer-lease role, last sync,
    and last error
  - attach / switch directory, request permission, sync now, backup now,
    export runtime ZIP, import runtime ZIP, and restore backup actions
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
  `circle`, `triangle`, `line`, `barcode`, `qr`, and `datamatrix`.
- Stage interaction coverage includes:
  - click selection
  - Shift multi-selection
  - marquee selection
  - drag move
  - transformer-based resize and rotation for rectangular, triangular, and
    square elements where rotation is meaningful
  - non-proportional resize handles for `rect`, `triangle`, `text`, and
    `barcode`
  - proportional corner resize handles for `qr`, `datamatrix`, and `circle`
  - direct start/end endpoint handles for single selected `line` elements
  - coarse physical-wheel bursts zoom relative to the pointer without a
    modifier key
  - fine pixel-level two-axis bursts pan, including Logitech Options+
    `CUSTOM_PAN` gestures that reach the browser with `buttons=0`
  - horizontal wheel / tilt-wheel pan
  - `Space + drag` pan
  - the browser does not expose the Logitech gesture source directly, so wheel
    intent is classified and locked for each continuous input burst; this keeps
    a physical wheel's fine leading or trailing events in zoom mode
  - keyboard move, copy, paste, duplicate, delete, undo, redo, and clear
    selection
- Canvas clipboard coverage now includes:
  - window `copy` / `paste` event handling for selected elements when focus is
    outside editable form controls
  - async button `拷贝` / `粘贴` entry points backed by `navigator.clipboard`
    and web custom formats when the browser supports them
  - structured payload round-trips that preserve copied element order and open
    a pending placement preview that follows the latest stage pointer until
    click or `Enter` confirmation
  - plain-text fallback that creates one new `text` element through the same
    pending placement preview flow
  - `Escape` and `Cmd/Ctrl+Z` cancelling pending placement without writing a
    history entry, while confirmation writes exactly one new history snapshot
  - clipboard guidance and outcome copy rendered as overlay toast feedback
    instead of inline notices that reflow the editor pane
  - read-only historical snapshots keeping `拷贝` available while leaving
    paste and all other mutating actions disabled
- Canvas snapping resolves through one pure screen-space magnetic policy behind
  the persistent `snapEnabled` editor flag. It serves ordinary and multi-select
  dragging, pending clipboard placement, line endpoint adjustment, and
  Transformer resize; keyboard nudges remain exact fixed-distance moves.
- Ordinary drag previews still compare grid lines, canvas edges, and visible
  static element bounds independently on each axis. Direct handles now declare
  their active `min|center|max` sources explicitly, so inactive axes never
  participate in snap resolution or guide rendering.
- Direct-handle target resolution now extends the same per-axis resolver with
  canvas/element centerlines and corner metadata while preserving the existing
  axis-line guide contract and `element > canvas > grid` tie-break order. It
  excludes moving preview elements, includes visible locked references, honors
  rotated visible bounds, and keeps low-zoom grid snapping below forty percent
  of grid spacing.
- Ordinary pointer dragging keeps the selected set rigid. Transformer bounds
  snap live through their active source before the draft update, then commit
  that same geometry without a release-time rounding pass. Rotation stays
  freeform, text transforms retain font size, and existing minimum-size and
  proportional shape constraints continue to apply.
- Stage-only guide lines render for canvas and element projection hits, clear
  at the end of each interaction, and do not affect stored draft, printing, or
  export.
- Marquee selection overlay is now projected into stage space rather than
  rendered inside the scaled content group, so its dashed border stays `1
  logical px` across zoom levels while the stored selection box and inclusion
  checks remain in canvas-space units.
- Rectangle authoring now distinguishes element defaults from template design:
  new freeform rectangles default to `radius: 0`, while presets and imported
  templates preserve explicit rounded corners. The inspector exposes `圆角` and
  clamps it to half of the current rectangle's smaller dimension.
- Circle and triangle authoring now flows through the same shared canvas schema,
  SVG renderer, Web draft model, and Storybook coverage as existing shapes:
  circles use `x/y/size` and stay round during resize, while triangles use
  `x/y/width/height` and can resize width and height independently.
- Rotated triangle selection bounds are computed through the same rotated bounds
  path as other rotatable stage objects, so marquee and multi-selection remain
  aligned with visible triangle geometry.
- Checked-in core JavaScript runtime artifacts are synced with the TypeScript
  renderer path, including `svg-renderer`, so callers that import
  `packages/core/src/*.js` render `circle` and `triangle` instead of silently
  dropping them.
- Shared text-font coverage now resolves through `packages/core/src/text-font-registry.ts`:
  - one registry owns schema values, selector labels, font stacks, legacy
    alias resolution, metric profiles, and the default new-text family
  - the bundled self-hosted pool now exceeds `20` named fonts, including
    `archivo`, `barlow`, `barlow-condensed`, `bebas-neue`, `dm-sans`,
    `exo-2`, `ibm-plex-mono`, `ibm-plex-sans`, `ibm-plex-serif`,
    `inconsolata`, `inter`, `inter-tight`, `jetbrains-mono`, `manrope`,
    `noto-sans-sc`, `noto-serif-sc`, `oswald`, `outfit`, `overpass`,
    `public-sans`, `rajdhani`, `roboto`, `roboto-condensed`,
    `source-sans-3`, `source-serif-4`, `space-grotesk`, `space-mono`,
    and `work-sans`
  - explicit named platform-font choices are `arial`, `courier-new`,
    `georgia`, `times-new-roman`, `trebuchet-ms`, and `verdana`
  - legacy values `system-sans`, `system-serif`, and `system-mono` remain
    accepted for existing drafts and templates through alias mapping onto named
    fonts
  - new text defaults now resolve to `noto-sans-sc`
- Barcode, QR, and Data Matrix stage rendering now uses real encoded graphics
  instead of dashed placeholders.
- Data Matrix encoding is normalized through `packages/core/src/data-matrix.ts`:
  - `bwip-js` generates one shared square `ECC200` module matrix used by SVG
    preview, print output, and the Konva stage
  - empty values and rectangular-symbol outputs fail as recoverable validation
    errors instead of silently degrading
- Invalid barcode / QR / Data Matrix content now fails safely inside the
  editor:
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
  - a shared runtime-store abstraction that prefers `@sqlite.org/sqlite-wasm`
    in a worker with `opfs-sahpool`, and falls back to the legacy browser-local
    store when the environment cannot support that path
  - draft field registry and per-element replacement bindings
  - per-layer metadata
  - runtime app settings persisted beside template data, including default print
    render options and the one-shot directory-setup nudge flag
  - runtime mutation events used by background mirror sync and cross-tab status
    refresh
  - runtime-only pending clipboard placement bookkeeping kept outside
    persisted drafts, sync state, saved versions, and autosaves
  - one-time migration of existing browser-local user templates, saved
    versions, autosaves, working copies, and compatible local settings into the
    unified runtime store
  - preset-scoped browser storage persistence for scratch drafts still feeding
    same-device sync, while scratch and preset-template working copies are also
    mirrored into the runtime store for backup / export
  - same-device sync state records shared with `TuckmarkService` for scratch
    drafts, recent templates, and recent prints
  - legacy `IndexedDB` / `localStorage` persistence retained as the compatibility
    backend, with memory fallback in incomplete test/browser environments
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
  - first-save and save-as template naming through a project-owned input dialog
    instead of browser-native `prompt`
  - first successful user-template save raising a one-shot non-blocking
    directory-setup toast when directory workflows are supported but not yet
    configured
  - read-only historical restore creating a new current working copy instead of
    mutating saved history in place
- Canvas dimension editing now covers:
  - scratch drafts, system-template working copies, and browser-local
    user-template working copies through the shared `DimensionPicker`
    mounted in the editor header
  - positive-integer millimeter validation before draft mutation, with canvas
    documents and browser-local user template summaries persisted in
    millimeters
  - `CanvasDraftDocument.unit: "mm"` marks normalized physical-unit documents;
    missing-unit drafts are migrated from dots to millimeters when loaded
  - system template package data is converted from dots to millimeters when it
    becomes an editable canvas draft, and converted back to dots only for
    preview / print compilation
  - undo / redo and viewport refit through the existing draft-history update
    path
  - non-blocking out-of-canvas warnings when shrinking the label boundary
  - browser-local recent dimension history capped to the most recent custom
    dimensions and merged with built-in presets for suggestions
  - suggestions opening from focus / typing / hover without a separate arrow
    toggle, and closing on outside click
  - zoom controls and vertical wheel zoom clamped at 500% maximum scale
  - explicit save / save-as and successful real or demo print as the only
    history-recording events
  - narrow canvas workspaces scrolling vertically so the editor-header
    dimension control remains reachable on phone-sized viewports
  - direct-print capability blocking for canvas and template sources whose
    canvas width exceeds the selected target print width
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
- Structured replacement bindings are limited to `text`, `barcode`, `qr`, and
  `datamatrix`; `rect` and `line` remain static editor-only structure.
- Replaceable-element editing is simplified to:
  - one `名` layer-name field
  - one field-name autocomplete input that can reuse or create a field label
  - no separate `绑定到` selector duplicated beside the field-name editor
- Browser-local user template preview/print reuses the shared canvas artifact
  seam by compiling row values into a concrete `DirectCanvasDefinition` on the
  client before preview or print dispatch.
- Agent-generated user template packages are covered by a shared core schema
  and compiler. CLI commands can validate, preview, generate packets, and print
  packages through the existing canvas artifact seam.
- The template workspace can import a `tuckmark.user-template-package.v1` JSON
  file and save it as a browser-local user template.
- Whole-dataset durability and archive management are implemented through:
  - `data-directory-service.ts` for capability probing, handle persistence,
    attach / switch decisions, permission requests, JSON mirror sync, runtime
    ZIP import / export, manual backup, and restore-protection snapshotting
  - `cross-tab-coordinator.ts` for single-writer lease coordination and
    `BroadcastChannel` status broadcasts across tabs
  - a versioned mirror tree rooted at `manifest.json`, with
    `settings/app-settings.json`, `templates/*`, `drafts/scratch/*`,
    `drafts/preset-template/*`, `backups/manual/*`, and
    `backups/protection/*`
  - one ZIP archive contract reused by manual backup, restore, import, and
    export instead of dumping the underlying SQLite database file
  - protection snapshot retention capped at the most recent `20`
- Directory-backed workflows intentionally stop short of a background helper:
  - no writes happen after the browser process exits
  - no directory watcher or file-system daemon is introduced
  - mirror conflicts resolve by latest timestamp, not by field-level merge
- Repo-local developer and user skills document the source-tree and released
  CLI workflows for agent template generation and printing.
- A high-cost agent practice script can call `codex exec` to generate multiple
  electronics organizer label packages, validate and preview them, and write a
  static HTML self-evaluation report. It does not support physical printing.
- Same-device sync intentionally stops at:
  - recent templates
  - recent prints
  - scratch canvas drafts
- Browser-local user templates, saved versions, autosaves, and user-template
  working copies remain outside the sync contract.
- Shared schema coverage now includes `rotation` on `text`, `rect`, `barcode`,
  `qr`, and `datamatrix`, while `line` remains endpoint-based.
- Text elements now use a fixed container text box model across Web drafts,
  shared core schema validation, Konva stage rendering, SVG preview, direct
  print artifacts, selection geometry, and inline editing:
  - legacy baseline-anchored text is normalized into top-left container
    geometry when drafts and system templates are read
  - saved text carries `height`, `fontFamily`, `verticalAlign`,
    `stretchXGrow`, `stretchXShrink`, `stretchYGrow`, `stretchYShrink`,
    `autoWrap`, `adaptiveFontSize`, and `verticalText`
  - the read path still accepts legacy `stretchX` and `stretchY`; `true` maps
    to both grow and shrink on that axis, while canonical grow/shrink fields
    remain the only write path
  - saved text carries `lineHeight`, which controls multiline baseline spacing
    without changing font size
  - newly inserted freeform text now defaults to `autoWrap=false`, while
    preset-backed and legacy content keeps its explicit or compatibility wrap
    state
  - resizing a text element updates only the container `width` and `height`,
    leaving `fontSize` unchanged unless adaptive sizing is enabled
  - horizontal and vertical grow/shrink scale rendered content only on the
    matching fit condition for that axis and do not write that scale back into
    `fontSize`
  - automatic wrapping breaks text to the container width, including long-token
    character breaks; disabling it keeps explicit lines intact and relies on
    container clipping
  - two-end justification uses the shared text layout to add per-line character
    spacing and SVG `textLength` / `lengthAdjust="spacing"` output without
    writing scale back into `fontSize`
  - the inspector splits text fitting into `水平拉升`, `水平挤压`, `垂直拉升`,
    `垂直挤压`, and `自适应`; `两端对齐` and `水平拉升` clear each other
    automatically, while `水平挤压` remains compatible with either one
  - vertical text resolves top-to-bottom glyph columns, clips them to the text
    container, and uses the same stage and SVG renderer paths as horizontal
    text
  - the shared text layout resolves a natural visible text BBOX, then aligns
    that BBOX inside the element container according to the selected
    horizontal and vertical alignment
  - adaptive sizing forces `effectiveAutoWrap=false`, measures natural text
    height through the shared layout, and writes a corrected `fontSize` back
    after a second measurement pass so Konva, inline editing, SVG preview, and
    print artifacts stay in sync
  - justified horizontal text uses the same Konva ink-box measurement path as
    normal horizontal text for vertical positioning; justification changes
    character spacing only and must not move the visible text BBOX vertically
  - Konva and SVG text rendering both clip text ink to the element container;
    the stage temporarily draws the visible clipped BBOX with a red dashed
    outline for development review
  - the inspector exposes font size, line height, fixed font family choices,
    three-by-three text alignment, automatic wrapping, two-end justification,
    vertical text, integer rotation, adjacent 45-degree rotation increment
    controls, and independent stretch toggles for selected text
  - canvas text design size is stored in millimeters: newly created and
    plain-text pasted layers start at `5.0 mm`, while the output compiler
    converts that value to `40 dots`; existing stored values remain untouched
  - the inspector retains the established `字号` label while the saved value
    continues to use millimeters
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
- Web now self-hosts the bundled canvas text fonts through local Fontsource
  packages instead of depending on browser-default availability:
  - `styles.css` imports the bundled families directly from npm packages
  - `preloadCanvasTextFonts()` waits for the font set used by the current draft
    before final rerender so late font replacement does not leave stale text
    measurement geometry on the stage
  - the same font stacks are reused by the inspector trigger, flat selector,
    Konva measurement path, and SVG export path
- The text inspector font picker is now a dedicated flat selector component:
  - user-facing grouping was removed
  - each option previews itself by rendering its own label with its own font
    stack
  - Latin-first families keep their English family names so the preview
    remains visually trustworthy
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
  - burst-classified physical-wheel zoom, fine two-axis gesture panning,
    horizontal wheel panning, and Space-drag panning
  - marquee selection at `344%` zoom
  - narrow desktop editor
  - selected text
  - flat text-font selector preview with the expanded named-font pool
  - text-font metrics comparison for `Noto Sans SC`
  - selected rect with radius editing
  - selected line with endpoint editing
  - selected barcode
  - output tab
  - draft-restore state
  - grouped browser-local user templates in `/templates`
  - browser-local user template version history in `/canvas`
  - shared shell selectable contract
  - template inline-edit selectable contract
  - default canvas selectable contract
  - text-selected canvas selectable contract
  - DimensionPicker state gallery and filtering interaction
  - full canvas workspace header dimension autocomplete state
  - `/system` data storage card states for unsupported, unconfigured,
    configured healthy, directory-attach choice, backup list, import confirm,
    restore confirm, and permission-required flows

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
  - `bun run --filter @tuckmark/core build` passed
  - `bun run --filter @tuckmark/core test` passed
  - `bun run --filter @tuckmark/web typecheck` passed
  - `bun run --filter @tuckmark/web test` passed
  - `bun run build:web` passed
  - `bun run --filter @tuckmark/web build:pages` passed
  - `bun run build:web:pages` passed
  - `bun run --filter @tuckmark/web build:storybook` passed
  - `bun run test:e2e:web` passed
  - `bun run --filter @tuckmark/web test:e2e -- tests/user-template-flow.spec.ts` passed
  - `bun run --filter @tuckmark/web test:e2e -- user-template-flow.spec.ts` passed
  - `bun run --filter @tuckmark/web test:e2e -- template-table.spec.ts` passed
  - `TUCKMARK_WEB_SURFACE=browser-static bun run --filter @tuckmark/web build` passed
  - `bun run --filter @tuckmark/web test:e2e:sync` passed
  - `bun run build:web:pages` passed
  - `bun run --filter @tuckmark/web test:e2e -- --grep "template large mode"` passed
  - browser verification passed for:
    - `/system` data-storage card state gallery covering unsupported,
      unconfigured, configured healthy, attach-choice, backup-list,
      import-confirm, restore-confirm, and permission-required states
    - first successful user-template save surfacing the one-shot directory
      setup prompt before the user navigates into `/system`
  - `bun run --filter @tuckmark/cli typecheck` passed
  - `bun run --filter @tuckmark/core typecheck` passed
  - `bun run --filter @tuckmark/core test tests/renderer.test.ts` passed
  - browser verification passed for:
    - grid visibility over the white label-paper base
    - canvas pan / zoom remaining decoupled from pointer-only panning
    - output preview generation using the same content semantics as the stage
  - broader package test suites still retain unrelated environment-sensitive
    coverage outside this convergence patch
