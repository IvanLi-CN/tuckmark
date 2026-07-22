# History

This spec records the decision to promote the configured data directory from a
backup-oriented mirror into the optional unified data location for templates
and inventory.

It also records the decision to add `/inventory` as a top-level workbench
route while keeping the plugin boundary built-in rather than introducing a
general plugin discovery framework.

The same round moved directory-backed user-template lifecycle management into
the data-directory contract so Web, CLI, and installed PWA can reuse one
dataset without import / export hops.
