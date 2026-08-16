# Security and privacy model

## Trust boundary

Scoutframe has two processes with a deliberately narrow interface:

1. **Local app (`127.0.0.1:4177`)** — stores product state in SQLite and serves the UI. It has no VSCO network code.
2. **Chrome companion** — receives only `health` and read-only `search` messages from the fixed local app origin, makes the request with `credentials: include`, normalizes a compact result, and returns it to the page.

The local app never receives browser cookies, VSCO authorization headers, or raw credential material. The companion does not call a Scoutframe server.

## Local server protections

- binds to `127.0.0.1`, not all interfaces;
- rejects non-local `Host` headers;
- requires `X-Scoutframe-Client: web` for writes;
- rejects cross-origin writes;
- caps JSON request bodies;
- uses parameterized SQLite statements;
- serves static files from a path-confined public directory;
- sends CSP, frame, referrer, MIME, and permissions headers;
- keeps application data out of the served public directory.

The custom write header is a practical localhost CSRF/DNS-rebinding defense for the MVP. A packaged desktop build could replace it with a per-install random secret.

## Companion protections

- matches only `http://127.0.0.1:4177/*` and `http://localhost:4177/*`;
- accepts only two action names;
- re-checks the sender origin in the service worker;
- requests no `cookies` permission;
- performs only GET requests;
- caps each search at 10,000 requested results;
- returns a compact allowlisted record instead of the raw API response;
- never executes remote code;
- has no analytics or external Scoutframe endpoint.

The companion still has access to the allowed VSCO hosts and must be treated as security-sensitive browser code. Keep its source reviewable and its release diff small.

## License model

License tokens are Ed25519-signed payloads. Distributed apps receive only the public key. The private key belongs on a separate fulfillment machine and must never be committed, bundled, logged, or sent to customers.

Offline verification prevents casual token fabrication but cannot make a fully local JavaScript application tamper-proof. The model is designed for low-friction honest customers, not DRM escalation. Revenue protection should come from product usefulness, support, and updates.

## Data deletion and backup

By default, delete `product/scoutframe-commercial/data` to remove the local database. Back up that directory to preserve collections and watches. Exports intentionally omit browser/session secrets because Scoutframe never stores them.

## Reporting

For a real launch, replace the placeholder support email and publish a private security contact. Do not include customer databases or VSCO session information in bug reports.
