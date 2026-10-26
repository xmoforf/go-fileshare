# Release candidate notes

Pre-stable source candidate; no published version is implied. The local packager assigns an explicit version and records the source commit in `build.json` and `file-share -version`.

- Single-owner Linux file browser and read-only bearer file/folder links; no uploads, transcoding or multi-user permissions.
- Compose/Caddy, binary/systemd, Go-source and Nix/NixOS installation references.
- Keyboard-accessible continuous listing, expiring/revocable links, bounded login/session state, Linux openat2 confinement and graceful shutdown.
- MIT project license; required dependency notices accompany archives and scratch images.

## Upgrade and security

Back up the entire stopped state directory before replacing binaries. Restoring an old database can resurrect revoked links and discard newer shares; reconcile/re-revoke before reopening ingress. See [operations](docs/operations.md). Code replacement of the same revision does not establish cross-version database compatibility.

Require Linux 5.6+ with openat2, trusted HTTPS and separately configured public-ingress controls. There is no global transfer cap or response write-idle deadline in the app. See [SECURITY.md](SECURITY.md). Pre-stable format/API changes remain possible; future candidates must describe their migration and rollback limits here.

## Evidence required per candidate

Use [release gates](docs/releases.md). Cross-built amd64/arm64 artifacts are not native runtime proof. Record actual architecture, compiler, browser versions, scanner/database freshness, install/operations results and exclusions against the exact candidate commit. GitHub workflow configuration is not an executed CI result. No codecs, real mobile devices or screen readers are certified by the browser smoke matrix.
