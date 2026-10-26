# Go file-share

Single-owner file browser and expiring file/folder links. Embedded browser UI, bcrypt login, SQLite share storage, streaming and HTTP range requests. No external UI assets or database server.

## Requirements and build

Linux 5.6+ with `openat2` support is required; symlinks and special files are excluded. Nix with flakes enabled provides Go 1.27.3 and development tools. Supported flake targets: x86_64-linux and aarch64-linux.

```sh
nix develop                 # pinned Go + C compiler (race tests) + Git
nix build                   # result/bin/file-share; includes Go tests
nix run . -- -h
nix flake check
```

`flake.lock` pins nixpkgs/toolchain. `go.mod` and `go.sum` pin Go dependencies; the flake's `vendorHash` fixes their vendored contents for sandboxed builds. The dev shell sets `GOTOOLCHAIN=local` so Go cannot silently download a different compiler. Optional direnv: inspect `.envrc`, then `direnv allow`.

## Configure and run

Keep served files, credentials and writable SQLite state separate. Never put credentials, the database or backups beneath the served root.

```sh
install -d -m 700 config state
cp auth.example.json config/auth.json
chmod 600 config/auth.json
nix run . -- -hash-password
```

The last command reads a password from stdin until EOF and prints a bcrypt hash. Use a trusted, non-logging terminal/input source; terminal input may echo. Password must be 12–72 bytes. Do not put it in command-line arguments or shell history. Edit `config/auth.json` with your username and generated `password_hash`; the example placeholder is not usable authentication. Never commit real credentials or hashes.

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

The retained `Dockerfile` is an optional standalone image build, not a deployment manifest. It runs as UID/GID `999:993`; mounts must grant that identity access. Mount the served tree and credentials read-only, state writable, pass `-origin`, and restrict ingress. Nix builds do not need Docker.

## Sharing and security

- Owner sessions last 12 hours and live in memory. Restart/password reset logs out all sessions. Global login limit: 10 attempts/minute; at most 32 owner sessions.
- Share regular files or folders for 1 hour, 1 day, 7 days, 30 days, custom duration (1 second–10 years), or forever. Owner Shares view copies and revokes links.
- Folder shares are live: future children and replacements at the same path become shared. Renames/deletions break paths. Direct links use `/s/<token>/subfolder/file`.
- Anyone holding a link can use or forward it. Expiry/revoke checks apply to new listings, downloads, HEAD and range requests; running transfers may finish. Downloaded copies cannot be recalled.
- Linux `openat2` confines access beneath the root and rejects symlinks, with no unsafe fallback. Writers to the served tree remain trusted to replace content or add mounts.
- Active HTML/SVG content downloads as attachments; media streams normally. Responses set no-store/no-referrer. Browser writes require exact Origin and a custom header. No API CORS or forwarded-IP trust.
- This project adds no VPN, proxy allowlist or public-ingress protection. Configure those separately. Proxies may log bearer URLs: restrict/redact logs.

SQLite stores share bearer tokens. Protect its directory and backups like credentials. Back up with SQLite online backup or while stopped, retaining file permissions and credentials. Copying an active database file alone is unsafe. Restoring an old database can resurrect revoked links. Password changes do not revoke shares.

## Development

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

`FILE_SHARE_BROWSER_FIXTURE=1 go test -run '^TestBrowserFixture$' -v` (inside `nix develop`) starts an opt-in temporary HTTPS fixture for manual UI checks. It uses synthetic files and test-only credentials from `server_test.go`. Stop with SIGTERM; never use production files or expose it publicly. Automated tests are not visual/browser evidence.

For dependency updates, change `go.mod`/`go.sum`, recompute `vendorHash` using Nix's reported fixed-output hash, and rerun checks. Update `flake.lock` deliberately with `nix flake update`. Keep Go version compatible with `go.mod`.

## Extraction boundary

Source snapshot: `/srv/docker/networks/torrent/file-share` at parent commit `0baa81a3718cde53484add65906bee889efc6f75`. This repository is independent: no runtime path or symlink points back to that installation. Source history was not imported. The installation's credentials, databases, networks, proxy configuration and `stack_test.py` deployment assertions are intentionally excluded. The previous default hostname was replaced by an explicit `-origin` requirement. Existing Go tests and embedded UI are retained.

Creating or building this repository does not migrate, stop or update the existing service. No remote repository or license grant is implied; choose licensing before external distribution.
