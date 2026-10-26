# Compose with Caddy

Standalone Linux reference for Docker Engine and Compose V2 or newer. Requires Linux 5.6+ and working `openat2` inside containers; keep default seccomp enabled. Docker access is host-level privilege. No existing installation, network, credentials or state is imported.

## Prepare

From this repository at a reviewed commit:

```sh
cp compose.env.example .env
install -d -m 700 config state caddy-data caddy-config
cp auth.example.json config/auth.json
chmod 600 config/auth.json
```

Edit `.env`: all mount paths must be absolute and already exist. Set `FILE_SHARE_DATA` to a separate served directory, never a parent of config/state/certificate storage. Set `FILE_SHARE_UID` and `FILE_SHARE_GID` to a non-root host identity; `id -u` / `id -g` show your current identity. The sample uses 1000:1000; absent overrides, the image/Compose default is 999:993. Do not assume either identity is free or suitable on your host. Both containers use the selected identity. For a dedicated service account, provision ownership through your host's administration process.

That identity needs directory search/read permission on served content, read permission on `auth.json` (mode 600), and ownership/write access to state, caddy-data and caddy-config (mode 700). No privileged init container or automatic recursive chown runs. Missing mount sources fail rather than creating root-owned directories. Rootless Docker/user-namespace mappings and SELinux hosts need host-specific permission/label setup; do not disable confinement to bypass failures.

Set both `FILE_SHARE_SITE` and `FILE_SHARE_ORIGIN` to `https://files.example.com`, replacing the domain. Origin must exactly match the browser URL, without a trailing slash. With a nonstandard external HTTPS port, include that port in **origin only**; Caddy still listens on container port 443. Set `FILE_SHARE_HTTPS_PORT` to the host port. Site is the HTTPS hostname without that mapped port.

Build locally, then generate a bcrypt hash:

```sh
docker compose config --quiet
docker compose build fileshare
docker compose run --rm --no-deps -T fileshare -hash-password
```

Provide the password on stdin from a trusted, non-logging terminal/input source; end with EOF. Input may echo. Put the resulting hash and chosen username into `config/auth.json`; never put the password/hash in shell arguments, `.env`, logs or source control. The shipped placeholder cannot authenticate. The build context excludes local credentials and state.

## Ingress and start

**Default published ports bind only to 127.0.0.1.** Application HTTP port 8080 is never published. Only this project's private Docker network connects Caddy to the app; do not attach unrelated containers. Caddy runs non-root, drops capabilities except `NET_BIND_SERVICE` (needed by its official binary and ports 80/443), and cannot write its root filesystem. The app drops all capabilities. Only explicit state mounts are writable.

For public certificates, public DNS must resolve the site to the intended ingress and ACME challenges must reach Caddy on public port 80 or 443. A loopback-only installation cannot obtain these certificates without upstream forwarding. Do not open ports merely to make startup pass. Configure trusted ingress/VPN/firewall routing deliberately; public exposure is a separate operator action. The disposable test below instead uses a local CA, without changing system trust.

Stock Caddy provides HTTPS and streaming proxying, **not all public-ingress protections** required by [SECURITY.md](../SECURITY.md). Before changing `FILE_SHARE_BIND` to an externally reachable address, provide aggregate active-request/connection limits (including HTTP/2 streams), bounded queueing, per-client abuse/login controls and stalled-reader progress limits at an outer ingress. A connection cap does not bound multiplexed requests. This reference intentionally does not claim to be a complete public DDoS/availability boundary. CPU/memory/PID/file-descriptor limits are containment, not admission control or capacity guarantees; qualify them for your workload.

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

`--wait` checks app readiness, not certificate issuance or browser readiness. Verify HTTPS at your exact origin with a trusted certificate, log in, create a synthetic share, open it anonymously, and revoke it before serving real data. Caddy disables HTTP/3 here (TCP 80/443 only). Access logging is not enabled; runtime/proxy error logs can still contain sensitive URLs. Restrict log access. Docker's `local` log driver rotates logs.

Caddy is pinned by version and digest; refresh deliberately and rerun the smoke after security updates. The application image is built from the current checkout. For upgrades, record the old image ID and source commit, build/test a distinct local tag via `FILE_SHARE_IMAGE`, and retain the prior image plus a consistent state backup. Do not treat the mutable `:local` tag as rollback history.

## State and shutdown

```sh
docker compose stop fileshare   # drain active app requests up to 30 seconds
docker compose stop caddy
```

Stop allowances are 40 seconds, above the app's 30-second drain deadline. Stop the app first when deliberately draining downloads through the proxy. Long remaining transfers can be interrupted at the deadline. Restart logs out owner sessions but preserves shares and revocations in SQLite. `docker compose up -d --wait` starts the same persistent mounts again.

Back up the entire state directory while the app is stopped, preserving permissions; never copy only a live SQLite database. Keep backups outside the served tree. Caddy data holds private certificate keys (and the test CA key in smoke fixtures); protect it like credentials. Do not delete state or Caddy data to fix a startup failure. Restoring old state can resurrect revoked shares. Password rotation requires replacing the auth contents and restarting/recreating the app; if atomically replacing the bind-mounted file, recreate the container so it sees the new inode.

## Other reverse proxies

Keep the raw HTTP listener private. Terminate trusted HTTPS for exactly the configured origin; preserve Host, Origin, cookies and the `X-Requested-With` header. Forward all paths/query strings without rewriting bearer tokens, and preserve Range/HEAD/conditional requests. Do not cache authenticated responses or bearer content; retain no-store/no-referrer headers. Stream without full-response buffering; propagate client disconnects upstream. Use a write-idle/progress policy, not a short total-response timeout that cuts off healthy long downloads. The app ignores forwarded client-IP headers: enforce per-client limits at trusted ingress rather than expecting the app to do so. Avoid logging bearer paths/query strings. Verify these contracts against your chosen proxy; support is not implied by a successful health probe.

## Disposable verification

```sh
python3 tests/compose_smoke.py
```

Requires Python 3 (stdlib only), local Unix-socket Docker access, a non-root invoking user, available Docker network address space and access to build/pinned image inputs. Set at most one of `DOCKER_HOST` and `DOCKER_CONTEXT`; ambiguous targets are rejected and the validated Unix endpoint is pinned for child commands. Uses unique project names, synthetic files/credentials/state, a loopback ephemeral port and Caddy's local CA. Verifies TLS against that CA (no insecure TLS bypass), owner/recipient API flows, Origin rejection, cookie flags, Range/HEAD, effective identity/mount protections, persistence/revocation and an active 16 MiB download across SIGTERM (reading pauses until the app listener closes while the process remains alive). Does not use a browser or public ACME.

The script stops but deliberately retains containers, network and printed fixture directories, even on failure. Inspect them before explicitly removing only that test project's resources; never run a broad prune. Fixtures contain synthetic credentials and private test CA keys. Repeated runs consume network address pools until cleaned up. No production path or global trust configuration is touched.
