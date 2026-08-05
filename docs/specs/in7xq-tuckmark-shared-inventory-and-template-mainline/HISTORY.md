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

Runtime-template synchronization was subsequently constrained to preserve the
inventory subtree. Inventory is now included in local and directory-backed
runtime archive flows, and explicit manual print quantities are validated and
executed as actual copies instead of label-field data only.
- The native CLI boundary moved behind named DEVD IPC. Direct CLI data-directory
  reads/writes and HTTP URL fallback were removed; inventory print now resolves
  and renders bindings inside DEVD, and multiple named instances support
  parallel project development.
