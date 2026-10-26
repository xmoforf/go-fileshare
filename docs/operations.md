# Operate and recover file-share

Use the [Compose](compose.md), [binary/systemd](systemd.md) or [NixOS](nixos.md) guide for installation. This guide covers the same single-owner service, not a migration from another installation. All commands below are **operator actions on a reviewed target**, not permission to deploy. Rehearse with synthetic content first.

## Before serving real files

Keep four things separate: served content, auth JSON, SQLite state, and private backups. Record source revision, binary checksum/image ID or Nix store path, runtime identity, absolute paths, exact HTTPS origin and proxy configuration. Protect that inventory; do not include passwords or bearer URLs in general logs.

Check trusted HTTPS at the exact origin, owner login, synthetic share/download/revoke, restart persistence and permissions. `/healthz` checks application readiness only. The [user walkthrough](usage.md#owner-first-share) describes the browser check. Keep raw HTTP private. Stock Caddy is not the complete [public-ingress protection](../SECURITY.md#public-ingress-requirements); provide those controls before exposure.

| Installation | Stop app and wait | Start after changes | State / credentials |
|---|---|---|---|
| Binary/systemd | `sudo systemctl stop file-share` | `sudo systemctl start file-share` | `/var/lib/file-share` / `/etc/file-share/auth.json` |
| NixOS module | Same systemctl commands | Same; apply reviewed configuration separately | Same state; configured `authFile` |
| Compose | `docker compose stop fileshare` | `docker compose up -d --wait --force-recreate fileshare` | Host `FILE_SHARE_STATE` / `FILE_SHARE_AUTH` |

Run Compose commands with the same project, env file and manifests used at installation. Recreation is required after atomic replacement of the bind-mounted credential file. Confirm the app is stopped (`systemctl is-active` says `inactive`, or Compose container is exited) before copying state. Allow the 30-second drain; inspect unexpected stop failures. Do not force-kill or delete state to make a procedure proceed.

## Rotate credentials or recover owner access

There is no online password-change endpoint. Credentials are read at startup.

1. If compromise is suspected, restrict ingress first and keep it restricted through verification. A password change does not recall downloaded files or revoke bearer shares.
2. Generate a new 12–72-byte password with a password manager. Run the installed binary's `-hash-password` (Compose command in its install guide) using a trusted non-logging stdin source. End with EOF; one final LF/CRLF is stripped. Terminal input may echo. Never put the password in arguments/history, enable shell tracing, or paste it into logs.
3. Prepare a separate private auth JSON file in the existing config directory, with `username` and `password_hash` fields as in `auth.example.json`. Use the generated bcrypt hash, not the plaintext password. Retain the service-readable ownership/mode: systemd `root:file-share` 0640; Compose selected identity and 0600. Do not leave editor backups readable or inside the served tree.
4. Stop the app. Preserve the old auth file in a private recovery directory. Rename the prepared file over the configured auth path on the same filesystem, then start/recreate the app. If startup fails, leave ingress restricted and inspect the config/permissions; do not initialize a fresh database.
5. Verify the old session is rejected, the old password cannot log in, and the new password can. Check an existing synthetic share still works. Separately revoke any compromised shares in **Shares**, and verify new recipient requests fail before restoring ingress.

Forgotten password: a trusted host administrator follows the same procedure; no database change is needed. Restoring old credentials would re-enable the old password, so do not restore them inadvertently with state. Invalid/missing credentials fail startup closed. Keep emergency administrative access independent of the public login endpoint.

## Consistent backup

The supported simple procedure is a stopped backup. Do not copy only an active `shares.db`: SQLite transactions/journal files may be inconsistent. Online backup requires a correctly operated SQLite backup tool and is not the procedure rehearsed here.

1. Schedule downtime and stop the app. Pause trusted writers to served content if you need a matching content snapshot: read-only server access does not stop other writers.
2. Create a **new**, private backup directory outside the served tree. Preserve the whole stopped state directory, credentials, code identity and configuration. Never overwrite the only previous backup.
3. Back up or snapshot served content separately with its relative paths intact. Shares store paths, not file bytes. Include proxy config and, for Compose, private Caddy certificate data/config (stop Caddy before copying its writable data).
4. Verify copies, modes and ownership; record backup time/source revision and the last revocation state it contains. Restart and test readiness, HTTPS login and a synthetic link. Test recovery in an isolated environment before trusting a backup.

Example for the default systemd paths, **after stop has completed**, on a host where `/var/backups` is outside the served root:

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

Also save your proxy configuration and content snapshot reference; these paths are installation-specific. NixOS: save the host configuration/lock and package store path instead of assuming a mutable `/usr/local/bin` or unit. Retain the old closure under your normal Nix GC policy; a recorded path alone does not keep it alive. Compose: retain the exact image, manifests/env and host mount paths instead of the systemd files. Backup archives, auth hashes, databases and certificate private keys require private access and protected off-host storage.

## Restore without surprising recipients

**An old backup can reactivate links revoked since that backup and lose shares created afterwards. Password rotation does not prevent this. Never reopen ingress immediately after restoring state.**

1. Restrict recipient ingress, including direct HTTP, and stop the app. Retain the current state/config/code in a separate new private recovery directory, even if suspected damaged. Do not overwrite or delete the only current copy.
2. Verify backup integrity and compatible code. Stage the **entire** backup state directory next to the live directory, not on top of it. Check expected `shares.db` exists and restore ownership/mode for the runtime identity. Missing/wrong database paths can create an empty database; an empty Shares view is not proof of successful recovery.
3. With app still stopped, rename live state aside and staged state into place on the same filesystem. Never mix old and current SQLite journal files. Keep current rotated credentials unless explicitly recovering credentials too. Restore matching content paths or document missing/replaced files.
4. Start only behind restricted ingress. Use a trusted private HTTPS administrative route preserving the configured origin. Log in and inspect **Shares**. Reapply every revocation since the backup from your protected records. If that history is incomplete, **revoke every restored share** and issue new links only after verification. The UI has no bulk revoke; remove each row, including expired rows. Do not hand-edit the live SQLite file.
5. Check known revoked URLs fail, intended shares behave as expected, and another restart preserves revocation. Then reopen ingress and tell recipients which links must be replaced. Keep recovery copies private until your retention policy allows disposal.

For default systemd state, the rename sequence is below. Choose unused sibling names, replace `/private/backup/state` with the verified backup path, and keep ingress restricted:

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

The single `&&` chain stops on failed copy, content comparison or default ownership/mode checks; do not run later lines separately after a failure. Do not run concurrent restores. If a rename fails, keep the app stopped and inspect both directories before recovery. Verify ownership is `file-share:file-share`, mode 0700 and database readable only by the intended identity before starting. Compose: use equivalent unused host-side siblings and selected UID/GID, then recreate the app so the bind mount points at restored state. Do not reuse stale container mounts. NixOS uses the same fixed state directory as systemd.

## Pre-stable upgrade and rollback

No universal schema downgrade or cross-version compatibility guarantee exists. Before stable release, breaking changes are possible, but silent state loss is not an acceptable upgrade procedure.

1. Read candidate changes/migration notes. Record old and candidate source revisions and artifact identities. Build/test the candidate separately; retain the old artifact. Do not overwrite a mutable image tag or garbage-collect the only old Nix closure and call it a rollback plan.
2. Take a stopped backup. Rehearse the candidate against a **copy** of that state with synthetic content and isolated ingress first; never point two servers at the live database. Compare share inventory, scopes and expiry, test active/revoked links, login and restart persistence. Protect any real copied state like production; this repository's test uses synthetic state only.
3. During a maintenance window, stop the app, take a fresh backup and replace only the code/config required. Binary: stage on the same filesystem and rename as in [systemd update](systemd.md#restart-update-and-recovery). Compose: select the tested distinct image and recreate. NixOS: apply the reviewed pinned generation through your normal deployment process. Do not change state paths to bypass a startup error.
4. Verify new login, old-session invalidation, unchanged share inventory, active synthetic download and revoked-link denial; restart and repeat the revocation check. Only then reopen access.
5. Failure: stop/restrict ingress, retain failed candidate/current state and inspect logs. Roll back code only if compatible with current state. NixOS generation rollback does not roll back SQLite. If state restoration is required, follow the restricted restore procedure above, including re-revocation; never automatically restore a stale database.

The [synthetic rehearsal](../CONTRIBUTING.md#operator-rehearsal) checks code replacement and rollback with selected binaries. Using two builds of the same revision tests the procedure, **not** compatibility with an unknown future release.

## Troubleshooting

| Symptom | Check; do not bypass |
|---|---|
| Startup fails | Auth JSON/bcrypt, readable root, separate writable state, Linux `openat2`, sandbox paths. Keep logs private. Do not delete the database or disable confinement. |
| Health passes, login fails | Trusted HTTPS, exact origin including external port, proxy forwarding, Secure cookies, correct credentials; health is not authentication. |
| 403 on writes | Exact Origin and required custom header; use the supported UI. Do not remove CSRF checks or add permissive CORS. |
| 429 on login | Wait at least one minute; investigate abuse at ingress. Global login budget is shared; avoid repeated password retries. |
| Missing shares after update | Stop and verify database path/mount/identity before creating links. Preserve both old and newly created state. |
| Link unavailable | Expired/revoked/moved file, wrong path, permissions or symlinks; sender can inspect scope. Restore is not a normal fix for a revoked link. |
| Playback/seek fails | [Client codec limits](usage.md#browsers-downloads-and-media), expiry/revoke, proxy Range behavior; no transcoding. |
| Long downloads stop | Service restart/drain deadline, proxy total timeout or resource exhaustion. Use progress limits, not a short blanket response timeout. |

Monitor disk space, private log rotation, state growth and host resource limits. Preserve diagnostic evidence without credentials, auth hashes, cookies, bearer URLs or database dumps in public reports. See [SECURITY.md](../SECURITY.md) for reporting and update policy.
