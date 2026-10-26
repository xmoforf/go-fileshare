# Security and resource boundaries

## Threat model

This is a single-owner, read-only file browser, not a multi-tenant storage service. Protect file confidentiality, owner credentials/sessions, share tokens and revocation state. Treat unauthenticated internet clients and bearer-link recipients as untrusted. The host administrator, reverse proxy, owner and anyone able to write or mount content beneath the served tree are trusted.

- **Filesystem:** Linux `openat2` confines opens beneath the configured root/share anchor and rejects symlinks in every component. Only regular files and directories are exposed. Hard links, mount points and content replacements made by trusted writers are not an isolation boundary. Run unprivileged with read-only file/credential mounts and a separate writable state directory. Never put state, credentials or backups beneath the served root.
- **Owner:** bcrypt verifies the configured password. Cookies are Secure, HttpOnly, SameSite=Strict and host-only. State-changing requests require the exact configured HTTPS Origin and `X-Requested-With: file-share`. These checks prevent cross-origin browser writes, not scripted login attempts. The app does not trust forwarded client-IP headers.
- **Recipients:** links contain random 256-bit bearer tokens. Anyone with a token can read and forward its scope. Folder shares include future descendants and replacements. Expiry and revocation are checked on new requests, including HEAD/ranges; in-flight transfers may finish. Downloaded copies cannot be revoked.
- **Content:** active/unknown content downloads as attachments; file responses carry a sandbox CSP and `nosniff`. The browser uses local embedded assets. This is not malware scanning or codec validation.
- **Persistence:** SQLite contains bearer tokens. Restrict state/backups like credentials. Restoring old state can reactivate revoked links. Password changes/restarts invalidate memory-only sessions, not shares. Revoke unwanted shares separately.
- **Transport/logs:** terminate HTTPS at a trusted reverse proxy; prevent direct public access to the HTTP listener. Proxies, browser history and copied URLs can expose tokens. Avoid logging share URLs/query strings; restrict log access. Response no-store/no-referrer headers do not erase copies already made elsewhere.

## Enforced bounds and remaining limits

| Boundary | App behavior | Remaining requirement |
|---|---|---|
| Login | 10 requests per global one-minute window; malformed attempts also consume budget after Origin checks. Rejected requests return 429 with Retry-After: 60. | Not a rolling rate or per-IP limit: up to 20 admitted attempts can straddle a window boundary. Abuse can deny the owner login. Protect `/api/login` with a VPN/allowlist or trusted ingress rate limits; retain a private recovery path. Existing sessions continue working. |
| Password work | CLI generates cost-12 bcrypt; work is outside the session mutex. | Up to 10 attempts can run together per window. Bcrypt is not cancelable once started. A trusted operator can configure a higher-cost hash; measure its cost before use. |
| Sessions | At most 32; 12-hour expiry; cleanup on successful login and expired-cookie use. | Sessions consume a bounded map, not durable login state. |
| Request input | JSON bodies limited to 8,192 bytes; unknown fields and trailing JSON rejected. HTTP header setting 16 KiB (Go parsing overhead may allow additional bytes); header/read/keep-alive idle timeouts 10/30/120 seconds. | These are not connection limits or response-write deadlines. Ingress must also bound connections and requests. |
| Directory listings | No entry-count cap. Read at most 256 directory entries per batch; stat/encode incrementally into the existing JSON array. Check cancellation between entries/batches; stop on write errors. | Total filesystem work and bytes still scale with directory size. A blocked filesystem syscall cannot be canceled by Go context. Use reliable local storage; qualify network/FUSE mounts separately. |
| Listing clients | UI renders 100 rows per page; filtering/sorting covers the complete directory. | Browser downloads/parses/retains the full array. Browser heap and sorting cost scale with entries. Streaming is not server-side pagination or a directory snapshot. Concurrent changes may omit/change entries. |
| Listing failures | Initial open/read failures return 404. A later read failure aborts the HTTP stream; cancellation/write failure does not finish the JSON array. | Clients must consume and parse the complete response before accepting a listing. Never treat an incomplete array as successful partial results. |
| Downloads | `http.ServeContent` streams regular files with HEAD, conditional and range support. Disconnects release handlers/files. No full-file buffering or total-duration write timeout. | A connected non-reading client can retain a handler, socket and file indefinitely during normal operation. There is no app-wide transfer/request cap. |
| SQL | One connection, context-aware query/pool waits, SQLite busy timeout 5 seconds. Session locks are not held during SQL or streaming. | Queued requests still consume resources; cancellation depends on caller/proxy disconnect. Slow storage can affect health and share authorization. |
| Shares | Owner-only creation/revocation; database persists shares. | No automatic expiry-row purge or share-count cap. Owner Shares view materializes all stored rows. Monitor state size; revoke/delete unwanted rows through the API rather than editing tokens in live state. |
| Shutdown | Stop accepting requests, drain up to 30 seconds, then close remaining connections. | Transfers longer than remaining grace are interrupted; service-manager stop allowance must exceed 30 seconds. |

### Public ingress requirements

**Do not expose the raw listener to untrusted internet traffic.** The app does not provide DDoS resistance. Before public exposure:

1. Configure finite aggregate active-request and connection budgets, including HTTP/2 streams, bounded queueing and per-client abuse controls at ingress. A connection cap alone does not bound multiplexed requests. Ensure canceled downstream requests cancel upstream work.
2. Use a response **write-idle/progress** policy for stalled readers that permits continuously progressing long transfers. Do not substitute a short total response timeout. Verify your actual proxy behavior with slow readers, ranges and a long transfer; deployment examples are separate work.
3. Bound service memory, CPU and file descriptors at the OS/service layer with headroom for control requests and storage. Memory pressure kills may interrupt transfers; resource ceilings are containment, not availability guarantees. Account for sockets, open root/share/file descriptors, kernel buffers, TLS/proxy buffers and concurrent listings.
4. Measure the intended combination of directory sizes, filename lengths, active clients and storage latency on the target host. Monitor RSS, descriptors, CPU, queueing and control-route latency; lower ingress budgets if the tested envelope is exceeded.

### Measured envelope, not universal capacity

Synthetic Linux amd64 / Go 1.27.3 measurements on an Intel i9-14900, 2026-10-26:

- Complete 50,000-entry owner and bearer listings pass. With 64-byte filenames, streaming allocates about 19 MB cumulatively per listing versus 74 MB before the change. This is **total allocated bytes, not peak heap or RSS**; retained enumeration is batch-sized and GC still manages transient allocations.
- Eight simultaneous non-reading 64 MiB downloads stayed active during a 100 ms observation with about 0.9–1.0 MB additional live Go heap. Health/session/share-list requests completed within the test's 2-second deadline. All eight handlers and their file descriptors were released on disconnect. Kernel/proxy memory and prolonged load were not measured.
- Cost-12 bcrypt took about 153 ms per verification in a three-iteration sample; concurrent login tests enforce 10 admitted attempts out of 40 and the 32-session ceiling. The functional burst uses minimum-cost test hashes, not a capacity test of ten simultaneous cost-12 hashes.
- Desktop Chromium loaded a 50,000-entry synthetic directory (about 4.6 MB JSON) with 100 rendered rows; global filter and descending sort passed. One post-load `usedJSHeapSize` sample was about 14 MB and the listing resource transfer took 157 ms on loopback. This approximate browser API is not total browser memory, peak usage or end-to-end render latency.

These independent probes are a reproducible starting point, **not** proof that eight clients, larger directories or this latency are safe on every deployment. No hard directory-size limit is imposed. Million-entry directories, low-memory devices, prolonged saturation, network filesystems, proxies, ARM and non-Chromium engines require their own qualification. See [CONTRIBUTING.md](CONTRIBUTING.md) for commands and `.pi/reviews/go-fileshare-19p.3/` for retained evidence.

## Vulnerability maintenance and reporting

This project is pre-stable; no supported maintenance branches or response-time SLA are promised. Check Go/toolchain and module advisories before each release and after relevant security announcements. Scan source with the pinned Nix `govulncheck`, retain scanner/database dates and full output, and rerun race/vet/build checks after updates. A failed or offline scan is **unverified**, not clean. Do not replace pinned dependencies or the toolchain silently.

The 2026-10-26 scan using govulncheck 1.9.0 and vulnerability database updated 2026-10-21 reported no reachable-symbol or imported-package findings. It reported module-only [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) for the unmaintained `golang.org/x/crypto/openpgp` package, which this application does not import; no fixed version is listed. The application uses `x/crypto/bcrypt`. Retain/reassess this distinction on updates rather than suppressing all module findings. Scanning is not a proof of security and does not assess the Linux kernel, reverse proxy or host configuration.

No private security-reporting channel is published yet. Before publication, the owner must publish a private security contact or enable the hosting platform's private vulnerability reporting. Until then, ask the repository owner for a private channel; do not post credentials, real bearer URLs, databases or sensitive exploit details publicly. Include affected commit/version, synthetic reproduction, expected/actual behavior and impact. Maintainers should reproduce privately, assess reachability, patch with a regression test, rerun scans/gates and publish upgrade guidance when a fix is available.
