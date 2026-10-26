# Go file-share

Single-owner file browser and expiring file/folder links. Embedded browser UI, bcrypt login, SQLite share storage, streaming and HTTP range requests. No external UI assets or database server.

## Choose an installation

| Path | Guide |
|---|---|
| Docker Engine + Compose, with Caddy HTTPS | [Compose installation](docs/compose.md) |
| Linux binary or Go source, with systemd | [Binary/source installation](docs/systemd.md) |
| NixOS service module | [NixOS installation](docs/nixos.md) |
| Nix package / local CLI | [Requirements and build](#requirements-and-build), then [configure and run](#configure-and-run) |

Start from a reviewed source revision; these guides do not imply published binaries/images exist. All paths require Linux and trusted HTTPS for browser use. Public exposure additionally requires [ingress controls](SECURITY.md#public-ingress-requirements).

After installation: [browse/share/revoke](docs/usage.md), [rotate credentials, back up, restore and upgrade](docs/operations.md), and [security limits](SECURITY.md).

## Requirements and build

Linux 5.6+ with `openat2` support is required; symlinks and special files are excluded. Nix with flakes enabled provides Go 1.27.3 and development tools. Flake targets: x86_64-linux and aarch64-linux; ARM build/runtime requires separate verification, not just evaluation.

```sh
nix develop                 # pinned Go + C compiler (race tests) + Git
nix build                   # result/bin/file-share; includes Go tests
nix run . -- -h
nix flake check
```

`flake.lock` pins nixpkgs/toolchain. `go.mod` and `go.sum` pin Go dependencies; the flake's `vendorHash` fixes their vendored contents for sandboxed builds. The dev shell sets `GOTOOLCHAIN=local` so Go cannot silently download a different compiler. Optional direnv: inspect `.envrc`, then `direnv allow`.

For NixOS, see [NixOS service configuration and VM check](docs/nixos.md). The flake exports `nixosModules.default`; credentials stay in runtime files outside the Nix store, and the module does not configure public ingress.

For installation without Nix, see [Linux binary, Go-source build and systemd](docs/systemd.md). It includes a dedicated service identity, private state, read-only content/config, and manual update/recovery steps; the reference unit is `dist/file-share.service`.

## Configure and run

Keep served files, credentials and writable SQLite state separate. Never put credentials, the database or backups beneath the served root.

```sh
install -d -m 700 config state
cp auth.example.json config/auth.json
chmod 600 config/auth.json
nix run . -- -hash-password
```

The last command reads a password from stdin and prints a bcrypt hash. Finish input with EOF; one trailing LF or CRLF is removed. Password must be 12–72 bytes; oversized input is rejected, not silently truncated. Use a trusted, non-logging terminal/input source; terminal input may echo. Do not put it in command-line arguments or shell history. Edit `config/auth.json` with your username and generated `password_hash`; the example placeholder is not usable authentication. Never commit real credentials or hashes.

```sh
nix run . -- \
  -listen 127.0.0.1:8080 \
  -root /absolute/path/to/shared-files \
  -database "$PWD/state/shares.db" \
  -auth "$PWD/config/auth.json" \
  -origin https://files.example.com
```

Replace the root and HTTPS origin. Put a TLS reverse proxy in front of the loopback listener, routing that origin to `127.0.0.1:8080`. `-origin` is required, with no path or trailing slash. Login uses Secure cookies and exact Origin checks: plain HTTP is not a supported browser setup. The app itself serves HTTP, not TLS.

Defaults: listen `:8080`, root `/data`, database `/state/shares.db`, auth `/config/auth.json`. Prefer explicit loopback binding unless an isolated container network requires otherwise. `-healthcheck` probes HTTP readiness at `127.0.0.1:8080` only; for custom ports query `/healthz` yourself.

SIGTERM or Ctrl-C stops accepting connections and allows active requests up to 30 seconds to finish. After that deadline, remaining connections are closed and the timeout is logged; unfinished downloads are interrupted. Configure any service manager's stop timeout longer than 30 seconds.

For a standalone container installation, use [Compose with Caddy](docs/compose.md), `compose.yaml` and `compose.env.example`. It includes non-root services, read-only files/credentials, writable isolated state, HTTPS and a disposable smoke test. Ingress defaults to loopback; public exposure needs the additional controls in `SECURITY.md`. The image defaults to UID/GID `999:993`; Compose can select another non-root host identity with matching mount permissions. Nix builds do not need Docker.

## Sharing and security

- Owner sessions last 12 hours and live in memory. Restart/password reset logs out all sessions. Global login limit: 10 attempts/minute; at most 32 owner sessions.
- Share regular files or folders for 1 hour, 1 day, 7 days, 30 days, custom duration in whole seconds (1–315360000, up to 10 years), or forever. Owner Shares view copies and revokes links.
- Name, Size and Modified buttons sort the whole directory; repeat to reverse the primary sort. Earlier sort choices break ties. Opening a directory moves focus to the filter.
- Folder shares are live: future children and replacements at the same path become shared. Renames/deletions break paths. Direct links use `/s/<token>/subfolder/file`.
- Anyone holding a link can use or forward it. Expiry/revoke checks apply to new listings, downloads, HEAD and range requests; running transfers may finish. Downloaded copies cannot be recalled.
- Linux `openat2` confines access beneath the root and rejects symlinks, with no unsafe fallback. Writers to the served tree remain trusted to replace content or add mounts.
- Active HTML/SVG content downloads as attachments; media streams normally. Responses set no-store/no-referrer. Browser writes require exact Origin and a custom header. No API CORS or forwarded-IP trust.
- This project adds no VPN, proxy allowlist or public-ingress protection. Configure those separately. Proxies may log bearer URLs: restrict/redact logs.

Large directories have no entry-count cap. The server reads 256 entries at a time and streams the JSON listing, stopping on cancellation or write failure. The browser still loads the whole listing for global filtering/sorting; its memory use grows with directory size. Complete 100,000-entry listings are tested, not a guarantee for every client or filesystem.

The file list scrolls continuously, mounting only visible rows plus a small buffer and one retained focus row. Tab/Shift+Tab reaches offscreen links and actions; on a filename, Arrow Up/Down moves between entries and Home/End jumps to the first/last entry. Filtering and sorting cover the whole directory and reset scroll to the top. Use the filter rather than browser Find for unmounted filenames.

Public ingress must bound active requests/connections and stalled readers; the app has no global transfer cap or response write-idle deadline. See [SECURITY.md](SECURITY.md) for threat boundaries, enforced limits, measured workloads and vulnerability/reporting policy. Do not use a short total response timeout that breaks progressing long downloads.

SQLite stores share bearer tokens. Protect its directory and backups like credentials. Copying an active database file alone is unsafe. Restoring an old database can resurrect revoked links; password changes do not revoke shares. Follow the [stopped backup, isolated restore and upgrade procedure](docs/operations.md), including re-revocation before reopening ingress.

## Development

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

`FILE_SHARE_BROWSER_FIXTURE=1 go test -run '^TestBrowserFixture$' -v` (inside `nix develop`) starts an opt-in temporary HTTPS fixture for manual UI checks. It uses synthetic files and test-only credentials from `server_test.go`. Stop with SIGTERM; never use production files or expose it publicly. Automated tests are not visual/browser evidence.

Run the pinned vulnerability scan described in [CONTRIBUTING.md](CONTRIBUTING.md) before releases and after security updates. Scan errors are not a clean result.

For dependency updates, change `go.mod`/`go.sum`, recompute `vendorHash` using Nix's reported fixed-output hash, and rerun checks. Update `flake.lock` deliberately with `nix flake update`. Keep Go version compatible with `go.mod`.

## Extraction boundary

Source snapshot: `/srv/docker/networks/torrent/file-share` at parent commit `0baa81a3718cde53484add65906bee889efc6f75`. This repository is independent: no runtime path or symlink points back to that installation. Source history was not imported. The installation's credentials, databases, networks, proxy configuration and `stack_test.py` deployment assertions are intentionally excluded. The previous default hostname was replaced by an explicit `-origin` requirement. Existing Go tests and embedded UI are retained.

Creating or building this repository does not migrate, stop or update the existing service. No remote repository or publication is implied.

## License

Project-owned code and UI: [MIT](LICENSE), copyright (c) 2026 xmoforf. See [source provenance and third-party notices](THIRD_PARTY_NOTICES.md) for the owner's imported-code attestation and dependency terms. Redistribute `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/` with source or binary releases. Nix and Docker packages include these notices; plain `go build` requires bundling them separately.
