# History

This spec was created to formalize the split between the browser-direct and
service-api print paths.

It records the decision that browser-direct printing is a pure-browser product
path, while service-api printing remains a separately gated runtime path with
startup-fatal readiness checks.

The implementation was later hardened so a transient browser-direct wasm
initialization failure can be retried within the same page session instead of
forcing a full reload before preview or direct print recovers.

The service-api implementation boundary is now frozen through language-neutral
decoded-render and print-packet fixtures. Rust DEVD is the only production
service implementation, while browser-direct remains a distinct Web path and
the existing render and packet contracts remain unchanged.
