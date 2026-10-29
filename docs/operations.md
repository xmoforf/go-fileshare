# Operate and recover file-share

Use the installation guide for [Compose](compose.md), [systemd](systemd.md), or [NixOS](nixos.md) to locate your files and settings. Examples below use the default systemd paths unless stated otherwise.

## Start, stop, and check status

| Task | systemd / NixOS | Compose |
|---|---|---|
| Stop application | `sudo systemctl stop file-share` | `docker compose stop fileshare` |
| Start application | `sudo systemctl start file-share` | `docker compose up -d --wait fileshare` |
| Restart after credential/mount changes | `sudo systemctl restart file-share` | `docker compose up -d --wait --force-recreate fileshare` |
| Status | `sudo systemctl status file-share` | `docker compose ps --all` |
| Logs | `sudo journalctl -u file-share` | `docker compose logs fileshare` |

Run Compose commands from the deployment directory with the same project name and files used for installation. Recreate the application after atomically replacing a bind-mounted auth file or state directory so it sees the new mount target.

Shutdown lets active requests finish for up to 30 seconds, then interrupts remaining transfers. The example service-manager timeouts exceed that deadline. To drain through Caddy, stop file-share before Caddy. Restarting clears owner sessions but preserves shares and revocations.

`/healthz` checks readiness. After installation or configuration changes, also check HTTPS login, a shared download, and revocation. Monitor disk space, state growth, logs, and resource use for your workload.

## Change credentials

Credentials are read at startup. Changing a password does not revoke shared links.

1. Generate a hash with `file-share -hash-password` as described in [configuration](configuration.md#owner-account).
2. Prepare a new auth JSON file beside the current one. Retain service-readable ownership/mode: `root:file-share` and `0640` for systemd/NixOS; UID `999`, GID `993`, and `0600` for the default Compose image (use host-mapped IDs with user namespaces).
3. Stop the application. Preserve the old auth file privately, rename the new file over the configured path, and start/recreate the application.
4. Verify that the new login works, the old password/session fails, and an existing share still works. Revoke compromised links separately through **Shares**.

A host administrator uses the same procedure to recover a forgotten owner password; no database change is needed. If compromise is suspected, restrict ingress during recovery. Retain current credentials when restoring older state unless credential recovery is intended too.

## Back up

Use a stopped backup so the SQLite database and journal files remain consistent.

1. Stop the application and confirm it is inactive/exited.
2. Copy the whole state directory, credentials, configuration, and application version into a new private backup directory outside the served tree.
3. Back up served content separately with its relative paths intact. Pause content writers if a matching snapshot is needed; shares store paths, not file bytes.
4. Verify the copies and permissions, record the backup time and revocation state, then start the application and check a shared link.

Example, after the service has stopped:

```sh
backup=$(sudo mktemp -d /var/backups/file-share.XXXXXXXX) &&
sudo chmod 0700 "$backup" &&
sudo cp -a /var/lib/file-share "$backup/state" &&
sudo cp -a /etc/file-share "$backup/config" &&
sudo cp -a /usr/local/bin/file-share "$backup/file-share" &&
sudo cp -a /etc/systemd/system/file-share.service "$backup/file-share.service" &&
sudo cmp /var/lib/file-share/shares.db "$backup/state/shares.db" &&
sudo stat -c '%a %U:%G %n' "$backup" "$backup/state" "$backup/config/auth.json"
```

Also preserve proxy configuration and the content snapshot reference. For Compose, preserve both image identities, `compose.yaml`, `caddy/Caddyfile`, `fileshare/auth.json`, and the whole `fileshare/state/` directory. Caddy's named volumes contain certificate/config data; stop Caddy before backing those up using your volume-backup process. For NixOS, preserve the host configuration/lock and retain the package closure under your Nix GC policy rather than copying a mutable binary/unit.

Test restoration in an isolated environment before relying on a backup. Copying only a running `shares.db` is not a consistent backup; online backups require a SQLite-aware backup tool.

## Restore

Restoring an older database restores its share permissions too: links revoked since that backup may become active again, and newer shares may be absent.

1. Restrict recipient ingress, including direct HTTP, and stop the application. Preserve current state/configuration/code in a separate recovery directory.
2. Verify the backup and compatible application version. Stage the entire backup state directory beside the live directory; confirm `shares.db` exists and permissions match the service identity.
3. With the application stopped, rename current state aside and staged state into place on the same filesystem. Keep current rotated credentials and restore the intended content paths.
4. Start behind restricted ingress. Use a private HTTPS administrative route preserving the configured origin. Open **Shares** and reapply revocations made since the backup. If that history is incomplete, revoke every restored share before reopening access. There is no bulk-revoke control; revoke each row.
5. Verify revoked links fail, intended links work, and revocation persists after another restart. Reopen ingress and send replacement links where needed.

For default systemd paths, replace `/private/backup/state` with the backup path and choose unused sibling names:

```sh
# App already stopped. Both sibling paths must not exist; stop if either exists.
sudo test ! -e /var/lib/file-share.restore &&
sudo test ! -e /var/lib/file-share.before-restore &&
sudo cp -a /private/backup/state /var/lib/file-share.restore &&
sudo test -f /var/lib/file-share.restore/shares.db &&
sudo diff -qr /private/backup/state /var/lib/file-share.restore &&
sudo test "$(sudo stat -c '%a %U:%G' /var/lib/file-share.restore)" = '700 file-share:file-share' &&
sudo test "$(sudo stat -c '%a %U:%G' /var/lib/file-share.restore/shares.db)" = '600 file-share:file-share' &&
sudo test ! -e /var/lib/file-share.before-restore &&
sudo mv -T /var/lib/file-share /var/lib/file-share.before-restore &&
sudo mv -T /var/lib/file-share.restore /var/lib/file-share
```

The `&&` chain stops on a failed copy or check. If any step fails, keep the application stopped and inspect the directories; do not run later steps separately. Run one restore at a time. Do not mix old and current SQLite journals or initialize a new database to bypass an error.

For Compose, use equivalent sibling host directories with the configured UID/GID, then recreate the application. NixOS uses the same state path as systemd. An empty Shares panel can indicate a wrong database path rather than a successful restore.

## Update and roll back

1. Read [release notes](../RELEASE_NOTES.md) and record current/candidate artifact identities. Retain the old binary, image, or Nix closure.
2. Take a stopped backup. Rehearse the candidate against a copy of state with isolated ingress; compare share inventory, expiry, downloads, revocation, and restart persistence.
3. Stop the application and take a fresh backup before switching versions:
   - **systemd:** install the candidate as `/usr/local/bin/file-share.new`, then rename it over `/usr/local/bin/file-share`. Update license notices from the same revision.
   - **Compose:** select the candidate image tag/digest, pull it, and recreate `fileshare` without changing state mounts.
   - **NixOS:** update the pinned input and apply the reviewed host generation.
4. Verify login, existing shares, revoked-link denial, and restart persistence before restoring normal access.

If verification fails, stop the application and retain the failed candidate/current state for diagnosis. Roll back code only if compatible with that state. NixOS generation rollback does not roll back SQLite. If state restoration is needed, use the [restore procedure](#restore), including revocation reconciliation. Cross-version downgrade compatibility is not automatic.

## Troubleshoot

| Symptom | Check |
|---|---|
| Startup fails | Valid auth JSON/bcrypt, readable root, writable state, working `openat2`, and service sandbox paths |
| Readiness passes, login fails | Trusted HTTPS, exact origin/port, credentials, and browser cookies |
| 403 on writes | Proxy preserves Origin and `X-Requested-With`; use the supported UI |
| 429 on login | Wait at least one minute; the global login budget is shared |
| Missing shares after update | Stop and check database path, mounts, and ownership before creating new links |
| Link unavailable | Expiry, revocation, moved paths, permissions, or symlinks |
| Playback or seeking fails | [Client format support](usage.md#open-shared-links), link expiry, and proxy range handling |
| Long downloads stop | Restart deadline, proxy response timeout, storage, or resource exhaustion |

For ingress controls and vulnerability reporting, see [Security](../SECURITY.md).
