# History

This spec was created to formalize the split between the browser-direct and
service-api print paths.

It records the decision that browser-direct printing is a pure-browser product
path, while service-api printing remains a separately gated runtime path with
startup-fatal readiness checks.
