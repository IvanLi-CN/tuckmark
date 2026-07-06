# History

This spec records the decision to replace the single-page label tool with a
formal multi-page desktop workbench.

It also records the decision that the freeform canvas is an editor surface, not
an independent print truth source, and that preview and print continue to flow
through the shared artifact seam.

This spec also records the follow-up UI convergence decisions that happened
while the workbench was being productized:

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
- The shared footer also became an operator support surface:
  - repository link and site rights notice are visible without opening
    developer tools
  - the displayed app version is injected from build metadata with environment
    overrides
  - Service API and browser-direct readiness stay visible beside the support
    metadata
- The marquee-selection affordance was later tightened to match screen-space
  editor chrome expectations:
  - the drag-selection rectangle is projected into stage space instead of
    living inside the scaled canvas content group
  - its border now stays `1 logical px dashed` at any zoom level
  - selection-box storage and inclusion tests remain in canvas-space geometry
  - follow-on cleanup kept the Storybook scenario and projection tests aligned
    with the same screen-space rendering contract
