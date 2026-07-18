# History

This spec was created to formalize the split between the browser-direct and
service-api print paths.

It records the decision that browser-direct printing is a pure-browser product
path, while service-api printing remains a separately gated runtime path with
startup-fatal readiness checks.

The implementation was later hardened so a transient browser-direct wasm
initialization failure can be retried within the same page session instead of
forcing a full reload before preview or direct print recovers.
