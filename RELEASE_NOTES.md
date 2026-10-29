# Release notes

## v1.0.4

### Changes

- Add independent case-sensitive, literal-substring, and regular-expression filter buttons for owner and shared-folder browsers.
- Compact both browser headers, with an accessible theme palette beside the item count and wrapping controls on narrow screens.
- Clarify failed-login recovery and show a neutral unavailable-link page directing recipients to the sender.
- Reorganize documentation into installation, configuration, usage, operations, testing, and release guides.
- Simplify the Compose example to published images and shared Caddy proxy networking; document hardening separately.
- Show the browser interface and sharing workflow in README media.

### Upgrade

No application state-format or API-format migration is added. Existing shares, expiry times, and revocations retain their meaning. Follow the [update and rollback procedure](https://github.com/xmoforf/go-fileshare/blob/v1.0.4/docs/operations.md#update-and-roll-back), then reload the browser.

The former `/regex/flags` filter shortcut is no longer recognized. Enable **`.*`**, enter the pattern without delimiters or flags, and use **Aa** for case sensitivity. **""** selects one literal substring; otherwise space-separated terms are matched independently. See [filter controls](https://github.com/xmoforf/go-fileshare/blob/v1.0.4/docs/usage.md#browse-files).

**Existing Compose installations must not replace their configuration blindly.** The example now uses mutable published images, public Caddy ports, shared proxy networking, different bind paths, and named Caddy volumes, without the former hardening blocks. Preserve credentials, the whole stopped state directory, and certificate storage; deliberately map existing mounts and permissions. Read [existing deployment guidance](https://github.com/xmoforf/go-fileshare/blob/v1.0.4/docs/compose.md#existing-deployments) before adopting the example.

### Known limitations

Filtering still covers only the current directory. Narrow screens wrap controls; large listings still consume browser memory despite virtualized rows. README media illustrates the sharing workflow but predates the final compact header and filter buttons. No uploads, transcoding, or multi-user permissions are added. HTTPS and public-ingress protections remain operator responsibilities; see [application limits](https://github.com/xmoforf/go-fileshare/blob/v1.0.4/SECURITY.md#application-limits) and [proxy hardening](https://github.com/xmoforf/go-fileshare/blob/v1.0.4/docs/hardening.md).

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
