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
