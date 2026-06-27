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
