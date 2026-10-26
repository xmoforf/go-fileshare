# Linux binary or Go-source install

This reference uses a dedicated `file-share` system user, systemd, and Linux 5.6+ with `openat2`. It does not require Nix or Docker. Commands below change the **target host**; run them only on a host you administer. Do not run them against an existing installation without reviewing paths and preserving state.

## Build or obtain a binary

From a reviewed source checkout, install Go **1.27.3 or newer compatible with `go.mod`** for the target architecture, then:

```sh
go version
GOTOOLCHAIN=local go mod download
GOTOOLCHAIN=local go mod verify
CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=readonly -trimpath -o file-share .
./file-share -h
```

No C compiler is needed for the binary. CGO-disabled builds for Linux amd64/arm64 have no dynamic loader or shared-library dependency; SQLite and the UI are built in. The runtime host needs neither Go, Nix, a C runtime nor a separate database server. It still needs the matching CPU architecture, Linux with permitted `openat2`, readable content/config, writable private state and a separate trusted HTTPS proxy for browser access. Different build flags may change linking requirements. Race tests require CGO and a C compiler. `go.mod`/`go.sum` pin dependencies; `GOTOOLCHAIN=local` fails on an old compiler instead of downloading another. Run these commands from the repository root so embedded `index.html` is included. For an offline build, prepare dependencies on a trusted connected machine with `go mod vendor`, transfer source plus `vendor/`, and use `-mod=vendor` instead of `-mod=readonly`.

Alternatively, obtain a trusted Linux binary for your architecture and verify its publisher's checksums/signatures before installation. This document does not imply that public release binaries have been published. Keep `dist/file-share.service`, `auth.example.json`, `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/` from the same source revision alongside the binary.

## Install files and identity

On a fresh Debian-style host (adapt account-management commands for other distributions), first check whether the `file-share` account/group or target paths already exist. If so, stop and inspect their ownership and purpose; do not reuse an unrelated identity or overwrite an existing installation.

```sh
sudo groupadd --system file-share
sudo useradd --system --gid file-share --home-dir /nonexistent \
  --no-create-home --shell /usr/sbin/nologin file-share
sudo install -o root -g root -m 0755 file-share /usr/local/bin/file-share
sudo install -d -o root -g root -m 0755 /usr/local/share/doc/file-share
sudo cp -R LICENSE THIRD_PARTY_NOTICES.md licenses /usr/local/share/doc/file-share/
sudo chown -R root:root /usr/local/share/doc/file-share
sudo chmod -R u=rwX,go=rX /usr/local/share/doc/file-share
sudo install -d -o root -g file-share -m 0750 /etc/file-share /srv/file-share
sudo install -o root -g file-share -m 0640 auth.example.json /etc/file-share/auth.json
```

The account has no login shell and must not belong to other groups.

Generate a password hash with `/usr/local/bin/file-share -hash-password`, using a trusted non-logging input source. Input may echo; never put passwords in arguments or shell history. See [password input rules](../README.md#configure-and-run). Use `sudoedit /etc/file-share/auth.json` to replace the unusable example with your username/hash. Retain `root:file-share` ownership and mode `0640`; do not store plaintext passwords.

Populate `/srv/file-share` with intended public/shareable files only. For example, install an individual file with `sudo install -o root -g file-share -m 0640 /path/to/intended-file /srv/file-share/filename`. Directories need group read/search (`0750`), files group read (`0640`); the service needs no write permission. Do not recursively change an existing tree's permissions blindly. Symlinks and special files are rejected. Keep config, SQLite state and backups outside this tree. Only trusted administrators should be able to replace served content.

## Configure and start

Copy the reference unit to a working file and edit its `ExecStart` HTTPS origin before installing:

```sh
unit_dir=$(mktemp -d)
cp dist/file-share.service "$unit_dir/file-share.service"
# Edit "$unit_dir/file-share.service": replace https://files.example.com with your origin.
sudo install -o root -g root -m 0644 "$unit_dir/file-share.service" /etc/systemd/system/file-share.service
sudo systemd-analyze verify /etc/systemd/system/file-share.service
sudo systemctl daemon-reload
sudo systemctl enable --now file-share.service
sudo systemctl status file-share.service --no-pager
curl --fail http://127.0.0.1:8080/healthz
```

Keep the origin exact: HTTPS, no path/trailing slash. If changing paths, update both CLI arguments and sandbox paths; content under `/home` is intentionally inaccessible. If changing the port, use a port above 1024 and update readiness/proxy configuration too. The built-in `-healthcheck` only probes port 8080.

The unit binds **loopback HTTP only**. Configure a separate HTTPS reverse proxy to that listener and exact origin. Plain HTTP browser login is unsupported. See [SECURITY.md](../SECURITY.md) for required public-ingress connection/request/stalled-reader controls; this service unit is not an internet-ingress solution. `/healthz` proves readiness, not successful HTTPS login or correct public proxy configuration.

systemd creates `/var/lib/file-share` owned by `file-share:file-share`, mode `0700`; `UMask=0077` keeps SQLite files private. `ProtectSystem=strict` makes the filesystem read-only except managed state and private temporary storage. Served files and config are explicitly read-only; home directories/devices are hidden, capabilities removed and privilege escalation disabled. The service still needs outbound-capable IP sockets for its listener; it is not a network sandbox. Do not weaken sandboxing to work around a path error.

`systemctl stop file-share` sends SIGTERM. The app drains requests for up to 30 seconds; the unit allows 45 seconds before systemd's final kill. Restart/upgrade invalidates owner sessions but preserves share records. Inspect errors with `sudo journalctl -u file-share.service`; treat logs as private and never paste credentials or bearer links into reports. Missing/invalid credentials, inaccessible roots or unsupported `openat2` cause startup failure, not an unsafe fallback.

## Restart, update and recovery

For a configuration change: validate the edited unit, run `daemon-reload` if it changed, then `sudo systemctl restart file-share`. Check readiness, HTTPS owner login and a known synthetic recipient link. For password changes restart the service; this does **not** revoke shares.

For a binary update, first build/verify the candidate and review compatibility/release notes. During an announced maintenance window:

1. Stop the service; confirm `systemctl is-active file-share` reports `inactive` and no file-share process remains. Never copy the live SQLite file alone.
2. In a **new root-owned mode-0700 backup directory outside the served tree**, preserve the old binary, unit, auth config and **whole stopped** `/var/lib/file-share` directory (`cp -a` preserves permissions). Keep this backup private. Do not reuse/overwrite the only previous backup.
3. Stage the new binary on the same filesystem, then rename it into place:

   ```sh
   sudo install -o root -g root -m 0755 file-share /usr/local/bin/file-share.new
   sudo mv /usr/local/bin/file-share.new /usr/local/bin/file-share
   sudo systemctl start file-share
   curl --fail http://127.0.0.1:8080/healthz
   ```

4. Update bundled license/notices from the same revision. Verify HTTPS login, an existing synthetic share, revocation, and expected file permissions. Restart once more and verify revocation persists. Do not infer compatibility from `/healthz` alone.

If startup fails, stop the service and inspect logs; keep the failed candidate and current state for diagnosis. Restore the old binary only when it is compatible with current state. Restoring an old database can **reactivate revoked links** and discard newer changes. Do not restore old state automatically: assess exposure and revoke affected links before reopening access. No automatic schema downgrade or universal rollback compatibility is promised.

See [operator procedures](operations.md) for credential recovery, concrete stopped backups, staged restores and revocation reconciliation, and the [owner/recipient walkthrough](usage.md) for first-use checks.

## Verification scope

Rehearsed on Debian 13 amd64, systemd 257 and Linux 6.12 with the official Go 1.27.3 compiler, without Nix in the guest. Other distributions/architectures still need their own runtime check. `RestrictSUIDSGID` is deliberately omitted: on systemd 257 it rejects mandatory `openat2`; `NoNewPrivileges` and the other sandbox controls remain enabled.

Run `python3 -m unittest discover -s tests -p 'test_systemd.py'` for the static unit contract. On a disposable Linux/systemd host, rehearse the commands above with synthetic content/credentials and prove actual install/start/restart/update, persistent/revoked shares and permission denial. Static checks and direct subprocess tests do not prove systemd sandbox enforcement. Never run installation commands as a test on a production host.
