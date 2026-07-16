# History

This spec records the decision to replace the single-page label tool with a
formal multi-page desktop workbench.

It also records the decision that the freeform canvas is an editor surface, not
an independent print truth source, and that preview and print continue to flow
through the shared artifact seam.

This spec also records the follow-up UI convergence decisions that happened
while the workbench was being productized:

- The browser-local durability model was later widened again so the installed
  PWA can own durable data without a companion desktop helper:
  - supported Chromium desktop surfaces now prefer `SQLite Wasm + OPFS` for the
    runtime store instead of relying on scattered ad-hoc browser keys
  - `/system` became the owner-facing surface for directory authorization,
    JSON mirror health, manual backup, restore, and whole-dataset import /
    export
  - fixed-location backups and ad-hoc exports now share the same ZIP archive
    contract, while restore / import create a protection snapshot first
  - directory writes are coordinated by a single-writer cross-tab lease, and
    first-save only nudges for directory setup once per profile
- template browsing keeps two explicit modes, but compactness is controlled at
  the item level instead of shrinking the whole pane indiscriminately
- list-mode thumbnails keep a readable minimum preview size instead of being
  reduced as a side effect of density tuning
- template cards no longer use decorative chevron arrows
- top navigation uses a clearer active state because current-page orientation is
  a primary product affordance, not a subtle decorative hint
- template workspace narrow fallback was refined again: the `960-1279px` list
  stage keeps a disabled preview/print rail visible instead of leaving that
  side empty, while the batch table still takes over the left pane after
  template selection; only the narrower `<960px` state stacks preview/print
  below the table
- `/canvas` was later re-scoped from a branded demo-like canvas into a
  professional label editor:
  - the shared shell stayed intact
  - the route-local inner workspace was rebuilt around tools, stage, and
    inspector
  - printing moved behind an explicit `输出` tab instead of permanently sharing
    the same rail as editing controls
- Canvas document semantics were also upgraded in the same round:
  - Web now owns a versioned draft document with per-preset local persistence
  - shared printable schema gained `rotation` for `text`, `rect`, `barcode`,
    and `qr`
  - barcode and QR became first-class stage renderers instead of preview-only
    output artifacts
- The canvas editor was later tightened again around the actual printer
  capability boundary:
  - printable label content is monochrome-only
  - snap-to-grid was unified across drag, transformer handles, line endpoints,
    and keyboard movement so handle-based editing no longer bypasses the grid
  - snap remains controlled only by the persistent toolbar preference so
    operating-system modifier shortcuts do not conflict with canvas editing
  - warm brand accents remain editor chrome only and do not bleed into canvas
    content or restored drafts
- The editor shell was then distilled again to remove demo-like noise:
  - inner workspace cards were flattened into denser tool sections
  - layer actions moved back to the layer rail instead of competing with the
    property inspector
  - output terminology was rewritten into product-facing Chinese labels
  - invalid barcode / QR content became an explicit recoverable editor state
- The canvas convergence round also clarified stage-versus-preview semantics:
  - the editor now renders a distinct white label-paper base instead of making
    the full stage surface look like printable paper
  - the alignment grid stays visible above the paper base but outside printable
    content
  - stage content and output preview now read from the same normalized SVG
    content seam so visual drift no longer depends on separate editor-only
    drawing logic
- A later PR convergence pass corrected follow-on regressions from that editor
  tightening:
  - the template triple-pane layout restored enough left-rail width for the
    `大图` two-up grid at standard desktop widths
  - rotated multiline SVG text now uses the rendered text-box center so preview
    and print stay aligned with stage geometry
  - CLI direct-canvas preview fixtures were updated to include explicit
    `rotation` fields after the shared canvas schema expansion
- The browser-local template round was then simplified again around actual
  desktop usage:
  - template cards now enter structured print flow directly on click, while
    template editing stays as the secondary explicit action
  - version history moved out of the always-visible inspector rail into a
    save-adjacent right-side drawer
  - replaceable field editing collapsed into a single field-name autocomplete
    input instead of separate binding and naming controls
- A later same-device persistence round was folded back into the same topic:
  - recent templates and recent prints now reconcile browser and service
    snapshots under a shared same-device sync contract
  - scratch canvas drafts now restore through that merged sync state on
    `server-http`
  - browser-local user templates and their version history remain intentionally
    outside that sync contract
- A later interaction-hardening round tightened text-selection behavior across
  the entire workbench:
  - shared shell and workspace chrome now default to non-selectable behavior
  - copy-relevant status and metadata values moved onto explicit read-only
    field surfaces instead of inheriting browser default text selection
  - canvas drag, marquee, pan, and zoom flows now avoid stray page-level text
    highlights while preserving inline text editing and structured-input copy
    paths
- Agent template package support was then added as the deterministic bridge
  between LLM-assisted template authoring and Tuckmark's local-first printing
  model:
  - agents generate `tuckmark.user-template-package.v1` JSON instead of relying
    on a runtime LLM inside Tuckmark
  - CLI validates and renders packages through the same canvas artifact seam
  - Web import saves packages as browser-local user templates without changing
    the service sync boundary
- Free canvas dimensions were later generalized from scratch presets into a
  shared document editing affordance:
  - dimensions became explicit positive-integer draft properties on scratch,
    system-template copies, and browser-local user-template working copies
  - recent dimensions stayed browser-local because they are an editor
    convenience, not sync truth
  - resizing the canvas deliberately changes only the document boundary so
    existing elements remain user-owned draft content
  - printer width capability remains an output-time constraint, which keeps
    editing and preview non-blocking while still preventing invalid direct
    print submission
- The canvas shape-editing model was then aligned with common vector editor
  expectations:
  - rectangles no longer inherit a hidden rounded-corner default when created
    from the toolbar
  - rectangle radius became an explicit inspector property
  - rectangular elements use non-proportional resize handles by default
  - QR elements remain proportional
  - single line elements use endpoint handles instead of rectangular scaling
- The same shape-model pass was extended to first-class circle and triangle
  elements:
  - the shared printable schema and SVG renderer now support `circle` and
    `triangle`
  - circles use square `size` geometry and proportional resize handles
  - triangles use width/height geometry and non-proportional resize handles
  - review convergence tightened rotated triangle selection bounds and synced
    checked-in core JavaScript renderer artifacts with the expanded shape
    schema
- Text editing was then converted from baseline-anchored scalable glyphs into
  fixed container typography:
  - drafts and printable schema persist text box height, font family, vertical
    alignment, and stretch flags
  - resizing a text element changes the container rather than the saved font
    size
  - line height became a saved text property
  - stage, inline editing, SVG preview, and print artifacts share the same
    visible-glyph alignment, line-height, and stretch behavior
  - text alignment now moves the natural visible text BBOX inside the element
    container, with a temporary red dashed stage-only BBOX shown for review
  - automatic wrapping became an explicit text property, and stage / SVG
    rendering now clips text ink to the element container so overflow cannot
    escape the bounds
  - text flow controls include two-end justification, which adds spacing
    between visible characters, and vertical text, which lays glyphs
    top-to-bottom in columns
- The text-font contract was later hardened again from a small mixed list into
  a deterministic named-font registry:
  - the Web bundle now self-hosts more than `20` explicit font families
  - platform-resident choices are limited to explicit shared names such as
    `Arial`, `Courier New`, `Georgia`, `Times New Roman`, `Trebuchet MS`, and
    `Verdana`
  - legacy `system-*` draft values remain readable through alias mapping onto
    named fonts instead of surviving as user-facing picker choices
  - new text defaults to `Noto Sans SC` instead of a system fallback
  - the inspector font selector previews each option in its own font through a
    flat list with no user-facing grouping
  - Storybook, browser-static, the Konva stage, and SVG export now wait for
    the same draft-scoped font readiness path before final
    measurement-sensitive text rendering
- The shared footer also became an operator support surface:
  - repository link and site rights notice are visible without opening
    developer tools
  - the displayed owner-facing release/build metadata is injected from build
    metadata with environment overrides
  - tagged builds show `v<release-version>` and keep `build <shortsha>` in
    tooltip metadata, while untagged owner-facing builds fall back to
    `build <shortsha>` only
  - Service API and browser-direct readiness stay visible beside the support
    metadata
- The text-fitting contract was later split from one coarse stretch toggle into
  axis-specific grow, shrink, and adaptive behaviors:
  - canonical text state now persists `stretchXGrow`, `stretchXShrink`,
    `stretchYGrow`, `stretchYShrink`, and `adaptiveFontSize`
  - legacy drafts that only carry `stretchX` / `stretchY` still restore by
    mapping `true` to grow-plus-shrink on that axis
  - new manually inserted text defaults only `水平挤压` on, while preset and
    imported content preserves its stored fit state
  - `两端对齐` now clears `水平拉升`, but remains compatible with `水平挤压`
  - adaptive sizing disables effective auto-wrap, locks the `字号` field in the
    inspector, and writes back corrected font sizes through one shared layout
    path used by the stage, inline editor, preview, and print
- The marquee-selection affordance was later tightened to match screen-space
  editor chrome expectations:
  - the drag-selection rectangle is projected into stage space instead of
    living inside the scaled canvas content group
  - its border now stays `1 logical px dashed` at any zoom level
  - selection-box storage and inclusion tests remain in canvas-space geometry
  - follow-on cleanup kept the Storybook scenario and projection tests aligned
    with the same screen-space rendering contract
- The shared symbol contract was later expanded to include first-class Data
  Matrix support:
  - the printable schema, Web draft model, and user-template package contract
    now accept `kind: "datamatrix"` beside existing barcode and QR elements
  - Data Matrix is intentionally scoped to generic square `ECC200` symbols and
    does not introduce GS1, FNC1, or rectangular-extension behavior
  - one shared `bwip-js`-backed encoder now feeds stage rendering, SVG preview,
    and print output so all surfaces use the same module matrix and error
    semantics
  - Storybook fallback evidence now covers both selected and invalid Data
    Matrix states to keep the new symbol inside the same visual review path as
    other first-class canvas elements
- A later canvas interaction pass separated clipboard semantics from immediate
  duplicate semantics:
  - layer actions and multi-select actions now expose `拷贝`, `粘贴`, and
    `新副本` as distinct affordances instead of overloading duplicate as copy
  - selected elements can round-trip through the system clipboard using a
    structured Tuckmark payload, while plain external text pastes back as one
    new text layer
  - historical read-only versions keep copy available but continue to block
    paste and every other draft mutation path
- The clipboard placement flow was then refined to better match common editor
  expectations:
  - clipboard paste now enters a pending placement preview instead of applying
    an immediate repeated offset
  - the preview follows the mouse position, confirms on click or `Enter`, and
    cancels on `Escape` or `Cmd/Ctrl+Z`
  - confirmation writes one history entry, while cancellation restores the
    previous selection without mutating persisted draft state
  - clipboard hints were then lifted into toast-style overlay feedback so the
    center pane keeps a stable document flow while the user places content
  - a follow-up snap pass then aligned both ordinary element dragging and
    pending clipboard placement to the existing live `1mm` grid so movement no
    longer waits until drop to show snap behavior
  - ordinary pointer dragging was then refined again so dragging any member of
    the current selection carries the whole selected set through that same live
    snap path instead of moving only the directly grabbed node
  - the normal Konva drag-bound path now converts stage-space pointer
    coordinates back into canvas-space millimeter geometry before snapping, so
    zoomed or panned canvases keep the same strong live snap feel instead of
    producing offset or barely perceptible movement
- The snap contract was then unified around a proximity-based resolver:
  - wheel input is classified per burst: coarse physical-wheel deltas zoom
    around the pointer, while fine pixel-level two-axis bursts pan the stage;
    this preserves ordinary wheel zoom while supporting Logitech Options+
    `CUSTOM_PAN`, whose synthesized browser events carry `buttons=0` and no
    vendor-specific gesture identity
  - grid, canvas edges, and visible element edges share one screen-space
    magnetic policy across drag, paste placement, line endpoints, and resize
  - Transformer handles now resolve their active edge during movement and no
    longer jump onto a rounded geometry only after release
  - Transformer preview now leaves the Konva node scale intact until transform
    end, then normalizes and commits it once so a resize handle cannot resolve
    as a translation-only edit
  - rotated reference bounds, low-zoom grid tolerance, temporary edge guides,
    and fixed keyboard nudges were made explicit so the editor has one
    predictable snapping vocabulary
- Canvas typography later made its physical design-size contract explicit:
  - new text and plain external-text paste use a `5.0 mm` design size
  - `fontSize` remains a font-em measurement rather than a normalized ink
    height, and compiles through the existing `8 dots/mm` output boundary
  - existing templates, drafts, and imported layers preserve their saved
    font-size values without migration
- A later direct-handle snap pass narrowed guide ownership to editable degrees
  of freedom:
  - Transformer resize and line endpoints now declare active snap sources per
    axis instead of inheriting implicit bounding-box edges
  - direct-handle snapping may use element and canvas centers without changing
    ordinary drag, which stays on the existing edge-only target set
  - active-axis guide rendering now matches the actual interaction source, so
    `bottom-center` text resize no longer emits unrelated side guides
