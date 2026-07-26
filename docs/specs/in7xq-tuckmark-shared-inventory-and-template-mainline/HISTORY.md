# History

This spec records the decision to promote the configured data directory from a
backup-oriented mirror into the optional unified data location for templates
and inventory.

It also records the decision to add `/inventory` as a top-level workbench
route while keeping the plugin boundary built-in rather than introducing a
general plugin discovery framework.

The same round made the data directory an optional cross-surface location:
browser-local user templates and inventory remain usable without it, while an
attached directory gives Web, CLI, and installed PWA one dataset without
import / export hops.
