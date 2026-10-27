# v1.0.0 release notes

Initial stable container release of the existing application behavior, with matching version/source metadata and native Linux amd64/arm64 verification gates. Publication is established by a successful [Container release run](https://github.com/xmoforf/go-fileshare/actions/workflows/release.yml) and verified registry digests, not by this document. GHCR and Docker Hub now serve identical v1.0.0 images; the [Docker Hub mirror](docs/releases.md#docker-hub-mirror) reused the native-tested release without rebuilding. Future Git tags trigger CI publication to both registries; the separate local packager remains local-only.

- Single-owner Linux file browser and read-only bearer file/folder links; no uploads, transcoding or multi-user permissions.
- Compose/Caddy, binary/systemd, Go-source and Nix/NixOS installation references.
- Keyboard-accessible continuous listing, expiring/revocable links, bounded login/session state, Linux openat2 confinement and graceful shutdown.
- MIT project license; required dependency notices accompany archives and scratch images.

## Upgrade and security

Back up the entire stopped state directory before replacing binaries. Restoring an old database can resurrect revoked links and discard newer shares; reconcile/re-revoke before reopening ingress. See [operations](docs/operations.md). Code replacement of the same revision does not establish cross-version database compatibility.

Require Linux 5.6+ with openat2, trusted HTTPS and separately configured public-ingress controls. There is no global transfer cap or response write-idle deadline in the app. See [SECURITY.md](SECURITY.md). The v1.0.0 designation does not establish compatibility with every pre-stable database or promise automatic migrations. Future releases must describe state/API compatibility and migration/rollback limits here; never assume a stopped backup is safe to restore without reconciling revoked links.

## Evidence required per candidate

Use [release gates](docs/releases.md). Cross-built amd64/arm64 artifacts are not native runtime proof. Record actual architecture, compiler, browser versions, scanner/database freshness, install/operations results and exclusions against the exact candidate commit. GitHub workflow configuration is not an executed CI result. No codecs, real mobile devices or screen readers are certified by the browser smoke matrix.
