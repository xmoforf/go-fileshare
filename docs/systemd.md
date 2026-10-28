# Install with systemd

Run file-share as a dedicated Linux service with persistent state in `/var/lib/file-share`.

## Requirements

- Linux 5.6+ with working `openat2` and systemd.
- A binary for the host architecture, plus `dist/file-share.service` and license notices from the same revision.
- An HTTPS reverse proxy.

[Build from source](source.md) or [with Nix](nix.md). If using a downloaded binary, verify its publisher's checksums; this guide does not imply downloadable release binaries are available.

## Install

These commands use Debian-style account tools and assume a new installation. Check existing `file-share` accounts and destination paths before proceeding.

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

For a Nix-built binary, use `result/bin/file-share` as the source of the binary install command.

## Configure

Run `/usr/local/bin/file-share -hash-password`, then use `sudoedit /etc/file-share/auth.json` to set the username and hash. See [password input rules](configuration.md#owner-account). Retain `root:file-share` ownership and mode `0640`.

Place the files to serve under `/srv/file-share`. The `file-share` group needs read access to files and read/search access to directories. Keep credentials and state outside this directory.

Copy and edit the service unit:

```sh
unit_dir=$(mktemp -d)
cp dist/file-share.service "$unit_dir/file-share.service"
# Edit ExecStart in this file: set your HTTPS origin and any custom paths.
${EDITOR:-vi} "$unit_dir/file-share.service"
sudo install -o root -g root -m 0644 "$unit_dir/file-share.service" /etc/systemd/system/file-share.service
sudo systemd-analyze verify /etc/systemd/system/file-share.service
```

If changing content/config paths, update `ReadOnlyPaths` as well as `ExecStart`. Home directories are hidden by the service sandbox. systemd creates `/var/lib/file-share` with owner `file-share:file-share` and mode `0700`; the service keeps SQLite files private with `UMask=0077`.

Configure the HTTPS proxy to forward your exact `-origin` hostname to `127.0.0.1:8080`. See [configuration](configuration.md) for other settings.

## Start and verify

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now file-share.service
sudo systemctl status file-share.service --no-pager
curl --fail http://127.0.0.1:8080/healthz
```

Open the HTTPS URL, log in, and [test a shared link](usage.md#share-files-and-folders). Inspect startup errors with `sudo journalctl -u file-share.service`.

## Next steps

- [Operations](operations.md) — restart, update, credentials, backup, and restore.
- [Security](../SECURITY.md) — confinement and ingress hardening.
- [Installation tests](testing.md#installation-and-recovery-checks) — validate service-unit changes.
