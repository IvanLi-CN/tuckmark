# Implementation Notes

## Current coverage

- Web capability contract now models `browser-direct print path` and
  `service-api print path` as independent product states.
- Browser-direct print no longer depends on `/api/artifacts/:id/packets`; it
  materializes and encodes print payloads in the browser.
- Browser-direct UI now exposes connection state near the connect action and
  prevents an auto-selected service-api printer from stealing the active print
  path after a successful browser-direct connection.
- Server startup enforces service-api readiness only when the service-api path
  is enabled.
- Product and architecture docs are updated to describe the dual-path contract.
- Real hardware validation completed in Chrome desktop against printer
  `P2-Y404125469`: browser-direct safe-text printing succeeded after the browser
  packet encoder was switched to the detonger-backed path.

## Remaining validation

- Visual evidence should be refreshed against the updated dual-path UI copy.
- Browser-direct restore behavior after hot reload still depends on what the
  current browser runtime exposes for Web Bluetooth device rehydration.
