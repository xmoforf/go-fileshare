# Security

## Report a vulnerability

Ask the repository owner for a private reporting channel before sending sensitive details; this repository does not document a dedicated security contact. Include the affected version/commit, impact, and a reproduction using synthetic data. Do not include credentials, real share links, or databases in public reports.

No response-time SLA or supported maintenance-branch policy is published. Maintainers should reproduce privately, add a regression test, verify the fix, and publish upgrade guidance.

## Security model

File-share is a single-owner, read-only service. The host administrator, owner, reverse proxy, and writers to the served tree are trusted. Recipients and unauthenticated clients are not.

| Boundary | Behavior |
|---|---|
| Filesystem | Go `os.Root` confines paths to the applicable root and allows relative symlinks within it. Only regular files and directories are served. Saved paths are live references, not pinned objects; trusted writers can replace or retarget content, or add hard links and mounts. |
| Owner | Bcrypt password verification; Secure, HttpOnly, SameSite=Strict, host-only cookies. Browser writes require the exact HTTPS Origin and `X-Requested-With: file-share`. |
| Recipients | Random 256-bit bearer links grant access to a file or live folder subtree. Anyone with a link can forward it. Expiry/revocation applies to new requests, not downloaded copies or transfers already underway. |
| Content | Active/unknown content downloads as attachments. File responses use sandbox CSP and `nosniff`; responses use no-store/no-referrer. No malware scanning or transcoding is provided. |
| State | SQLite stores share tokens and permissions. Restarting or changing credentials clears owner sessions, not shares. Restoring older state can restore revoked links. |

The separate `__Host-file-share-theme` cookie stores only a validated theme ID, never authentication or share permissions. It is JS-readable, host-only, Secure, SameSite=Lax, `Path=/`, with a one-year lifetime; reset expires it. It crosses owner/share paths within a browser profile, not hosts or subdomains.

The CLI generates cost-12 bcrypt hashes from passwords of 12–72 bytes. Imported higher-cost hashes increase login work; bcrypt is not cancelable once verification starts. Credentials are read at startup and are not rewritten automatically.

## Filesystem boundaries

Owner browsing uses the configured root. Each folder-token request reopens its saved folder beneath that root, then confines navigation and link resolution to the reopened folder. A single-file token reopens its saved parent directory beneath the configured root and permits only its fixed basename, not sibling navigation or listings. Creation checks the same boundary as access; a file link that escapes its parent cannot be shared individually even if the owner can read it.

Relative symlinks must resolve without leaving the applicable root. Absolute links (even those pointing inside), escaping links, broken links and loops are rejected or omitted from listings. Allowed links appear with target metadata. Concurrent changes are not a snapshot.

Saved paths are resolved anew, including after restart. Trusted writers can redirect a saved folder or ancestor to another directory within the configured tree, changing what an existing token exposes. Replacing a shared folder with a relative link to the configured root can expose that entire tree. A shared file's basename can likewise become a link to another file within its reopened parent. Revoke affected tokens before making changes that should not reach existing recipients. Root confinement does not prevent hard links, mounts or malicious changes by trusted writers.

File opens use Unix `O_NONBLOCK` so FIFOs can be rejected without waiting for a writer; this is not a general device or slow-filesystem sandbox. Packaging and runtime support remain Linux; cross-compilation alone does not establish support for other Unix systems. Windows is outside scope: no runtime claims, tests, or compatibility shims.

## Deployment hardening

- Keep the HTTP listener behind trusted HTTPS ingress. The app does not terminate TLS or trust forwarded client-IP headers.
- Use an unprivileged runtime identity, read-only content/configuration, and private writable state. Keep credentials, state, and backups outside the served root.
- Set aggregate active-request and connection budgets at ingress, accounting for HTTP/2 streams, bounded queues, and per-client abuse/login controls. A connection cap alone does not bound multiplexed requests.
- Use response write-idle/progress limits for stalled readers rather than a short total-response timeout that cuts off progressing downloads. Propagate client disconnects upstream.
- Size OS/container CPU, memory, PID, and descriptor limits for the workload. Measure storage latency, listing size, active transfers, and control-route responsiveness before choosing limits.
- Restrict or redact proxy logs containing share URLs; no-store/no-referrer does not erase URLs already copied or logged.

The [basic Compose example](docs/compose.md) provides HTTPS routing, not a complete availability boundary. See [proxy hardening](docs/hardening.md) for proxy requirements and an optional Caddy request-rate recipe. Follow [restricted restore](docs/operations.md#restore) when recovering state.

## Application limits

| Area | Enforced behavior | Deployment consideration |
|---|---|---|
| Login | 10 admitted attempts per global one-minute window after Origin checks; rejected attempts return 429 and Retry-After: 60 | Not per-client or rolling: up to 20 attempts can straddle a boundary. Protect owner access from shared-budget exhaustion. |
| Sessions | Maximum 32; 12-hour lifetime; in memory | Restart invalidates every owner session. |
| Input | JSON bodies limited to 8,192 bytes; unknown fields/trailing JSON rejected. HTTP header setting 16 KiB, plus Go parsing overhead. Header/read/keep-alive idle timeouts: 10/30/120 seconds | No app-wide request/connection cap or response write-idle deadline. |
| Listings | Enumerate in batches of at most 256; stop between batches/entries on cancellation or write failure | No entry-count cap. Filesystem calls may block; full browser listing and sorting consume memory proportional to directory size. |
| Listing errors | Initial open/read errors return 404; later errors abort the response | Clients must parse a complete JSON array before accepting a listing. Concurrent filesystem changes are not a snapshot. |
| Downloads | Streaming GET/HEAD, conditional and range requests; disconnects release handlers/files | Stalled readers can retain resources indefinitely during normal operation. No global transfer cap. |
| Database | One connection; context-aware pool/query waits; 5-second SQLite busy timeout | Queued requests still consume resources; slow storage can affect readiness and share access. |
| Shares | Persistent records; owner-only creation/revocation | No automatic expired-row purge or share-count cap; Shares loads all records. Revoke unwanted entries through the UI/API. |
| Shutdown | Up to 30 seconds to drain requests, then remaining connections close | Service-manager stop timeout must exceed 30 seconds. |

## Security updates

Review Go, dependency, base-image, proxy, and host advisories regularly. Before releases, run the [source and binary vulnerability checks](docs/testing.md#resource-and-vulnerability-checks), record scanner/database dates, and assess reachable-code findings separately from module-only findings. A failed or unavailable scan is unverified, not clean.

Go vulnerability scans do not cover the kernel, proxy, container host, or deployment configuration. Current scan results belong with the tested release, not as a permanent assurance in this document.
