# Release notes

## Unreleased

### Changes

- Reorganize documentation into installation, configuration, usage, operations, testing, and release guides.
- Add a minimal published-image Compose example using shared Caddy proxy networking.
- Show the browser interface and sharing workflow in README media.

## v1.0.3

### Changes

- Fix release verification for Docker manifest image identities.

### Upgrade

No application or state-format changes from v1.0.2. Matching Linux amd64/arm64 images are available from GHCR and Docker Hub.

## v1.0.2

### Changes

- Make the file browser more compact and reset copy feedback when opening a new share dialog.
- Show an error for invalid filename-filter regular expressions.
- Separate routine CI from full release checks and isolate registry publication permissions.

### Upgrade

No database migration is added. Reload the browser after updating to use the new interface.

## v1.0.1

### Changes

- Publish the same native-tested amd64/arm64 images to GHCR and Docker Hub through separate gated jobs.
- Reject malformed registry tag inventories before publication.

### Upgrade

This release-tooling patch does not change application state or API formats. Release binaries carry updated version/source metadata; no database migration is added.

## v1.0.0

### Changes

- Single-owner Linux file browser with read-only file/folder links, expiry, and revocation.
- Keyboard navigation, filtering, sorting, and HTTP range downloads.
- Container images for Linux amd64 and arm64, available from GHCR and Docker Hub.
- Source, systemd, Compose, and Nix/NixOS installation options.

### Upgrade

Back up the whole stopped state directory before replacing the application. Compatibility with every pre-release database is not guaranteed; rehearse upgrades against a copy of state. Restoring an older database restores its share permissions, including links revoked since that backup. Follow [operations](docs/operations.md#update-and-roll-back) for updates and recovery.

### Known limitations

No uploads, transcoding, or multi-user permissions. HTTPS terminates at a reverse proxy. See [application limits](SECURITY.md#application-limits) for resource and security boundaries.
