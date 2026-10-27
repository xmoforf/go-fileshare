# Go file-share

Browse files and create expiring file or folder links from a single owner account. The server includes its browser UI and SQLite storage; no external assets or database server are needed. Downloads support streaming and HTTP range requests. There are no uploads or multi-user accounts.

## Choose an installation

| Path | Guide |
|---|---|
| Linux binary or Go source, with systemd | [Binary/source installation](docs/systemd.md) |
| Docker Engine + Compose, with Caddy HTTPS | [Compose installation](docs/compose.md) |
| Nix package / local CLI | [Optional Nix build](#optional-nix-build) |
| NixOS service module | [NixOS installation](docs/nixos.md) |

Source: [GitHub `xmoforf/go-fileshare`](https://github.com/xmoforf/go-fileshare). **v1.0.0 is published for linux/amd64 and linux/arm64** at `ghcr.io/xmoforf/go-fileshare:1.0.0`. Docker selects the matching architecture. Exact version tags stay fixed; `1.0`, `1`, and `latest` track newer stable releases. See the [verified digest and release policy](docs/releases.md#github-container-releases); pin a digest for deployment. Future Git tags are not proof of publication until their [Container release run](https://github.com/xmoforf/go-fileshare/actions/workflows/release.yml) succeeds.

The older **amd64-only, pre-stable Docker Hub candidate** remains available unchanged; see its [verified digest](docs/releases.md#published-amd64-candidate). GitHub releases do not update Docker Hub or deploy anything.

## Requirements and build

Run on **Linux 5.6+ with working `openat2`**, including inside containers. The server uses it to confine access to the served tree and reject symlinks; startup fails if it is unavailable or blocked. There is no fallback to `openat()` and no macOS/Windows support.

From the repository root, with Go **1.27.3 or newer compatible with `go.mod`**:

```sh
go version
GOTOOLCHAIN=local go mod download
GOTOOLCHAIN=local go mod verify
CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=readonly -trimpath -o file-share .
./file-share -h
```

This build needs no C compiler. The resulting binary needs neither Go nor Nix at runtime, nor a separate SQLite library. The CGO-disabled Linux amd64/arm64 builds have no dynamic loader or shared-library dependency. That does not make them cross-platform: use the matching CPU architecture, a compatible kernel/security policy, readable content/config and writable state. Other build settings may produce different linking requirements. See [systemd installation](docs/systemd.md) for host setup and verification limits.

Browser access requires **trusted HTTPS through a reverse proxy**; the app serves HTTP, not TLS. Keep its listener private. Before public exposure, configure the [required ingress controls](SECURITY.md#public-ingress-requirements).

## Configure and run

Keep served files, credentials and writable SQLite state separate. Never put credentials, state or backups beneath the served root.

```sh
install -d -m 700 config state
cp auth.example.json config/auth.json
chmod 600 config/auth.json
./file-share -hash-password
```

The last command reads a password from stdin and prints a bcrypt hash. End input with EOF; one trailing LF or CRLF is removed. Passwords must be 12–72 bytes; oversized input is rejected. Use a trusted, non-logging input source: terminal input may echo. Never put passwords in command arguments or shell history. Replace the example username and unusable `password_hash` placeholder in `config/auth.json`; never commit credentials or hashes.

```sh
./file-share \
  -listen 127.0.0.1:8080 \
  -root /absolute/path/to/shared-files \
  -database "$PWD/state/shares.db" \
  -auth "$PWD/config/auth.json" \
  -origin https://files.example.com
```

Replace the root and origin. Route that HTTPS origin through your reverse proxy to `127.0.0.1:8080`. The origin must have no path or trailing slash. Secure cookies and exact Origin checks mean plain HTTP browser login is unsupported.

Defaults are listen `:8080`, root `/data`, database `/state/shares.db` and auth `/config/auth.json`; origin is required. Prefer explicit loopback binding outside an isolated container network. `-healthcheck` probes only `127.0.0.1:8080`; query `/healthz` yourself for other ports. `-version` prints build identity (ordinary builds report `dev (unknown)`).

SIGTERM or Ctrl-C allows active requests up to 30 seconds to finish, then closes remaining connections and logs the timeout. Unfinished downloads are interrupted. Give service managers a stop timeout longer than 30 seconds.

Next: [create and revoke a share](docs/usage.md), then review [credential rotation, backups and upgrades](docs/operations.md).

## Sharing and security

- Choose 1 hour, 1 day, 7 days (default), 30 days or Never in the share dialog. Copy and revoke links from **Shares**. [Usage](docs/usage.md) covers sorting, filtering and keyboard navigation.
- Anyone with a link can use or forward it. Folder shares include future children and replacements at the same path; renames/deletions break paths. Revocation/expiry blocks new listings, downloads, HEAD and range requests, not transfers already running or copies already downloaded.
- Owner sessions last 12 hours and live in memory. Restart/password changes log out sessions, **not shares**. Login is limited globally to 10 attempts/minute and 32 sessions. [Password hashing rationale](SECURITY.md#password-hashing) explains bcrypt compatibility.
- Only regular files and directories are served. Symlinks are rejected, but writers to the served tree remain trusted to replace content, create hard links or add mounts. Run unprivileged with read-only content/config.
- Active HTML/SVG content downloads as attachments; media can stream. Responses use no-store/no-referrer. Browser writes require exact Origin and a custom header; there is no API CORS or forwarded-IP trust. Proxies can log bearer URLs: restrict or redact logs.
- Directory size and active transfers have no global cap. The browser retains the whole listing even though only visible rows are mounted. Public ingress must bound active requests/connections and stalled readers without cutting off progressing long downloads. See [security and resource limits](SECURITY.md).
- SQLite stores bearer tokens. Protect state and backups like credentials. Never copy only an active database file. Restoring old state can resurrect revoked links; follow the [stopped backup and restricted restore procedure](docs/operations.md).

## Optional Nix build

Nix supplies a pinned build/development environment; it is not a runtime requirement for the binary. With flakes enabled:

```sh
nix build                  # result/bin/file-share
./result/bin/file-share -h
```

Use `./result/bin/file-share` in place of `./file-share` above. The flake targets x86_64-linux and aarch64-linux; cross-building or evaluation alone does not verify ARM runtime behavior. For a managed NixOS service, use the [module guide](docs/nixos.md); keep credentials outside the Nix store.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests, browser fixtures, reproducible builds, dependency/toolchain updates and vulnerability scans. [Release checks](docs/releases.md) cover packaging and architecture verification. Building this independent repository does not migrate or update an existing installation; [source provenance](THIRD_PARTY_NOTICES.md#project-source) records its extraction boundary.

## Themes

**Choose theme** opens a searchable, keyboard-accessible picker with Light/Dark and ten curated Catppuccin, Nord, Atom One and Rose Pine variants. Apply saves only in this browser, separately for the owner page and each shared-folder URL. Cancel/Escape keeps the current theme; **Use system default** clears the choice. Palettes are bundled, adapted for UI contrast and never fetched at runtime. See [theme controls](docs/usage.md#themes) and [palette provenance](THIRD_PARTY_NOTICES.md#theme-palettes).

## License

Project-owned code and UI: [MIT](LICENSE), copyright (c) 2026 xmoforf. Imported theme palettes retain their authors' MIT notices. Redistribute `LICENSE`, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/` with source or binaries. Nix and Docker packages include these notices; plain `go build` requires bundling them separately.
