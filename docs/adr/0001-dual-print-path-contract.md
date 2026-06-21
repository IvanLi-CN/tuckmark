# Dual print-path contract

Tuckmark Web formally exposes two product print paths: `browser-direct print
path` and `service-api print path`. We keep the browser-direct path pure-browser
so it stays viable when runtime server helpers are absent, while the service-api
path remains independently gated and startup-fatal when enabled without a ready
detonger runtime.
