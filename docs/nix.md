# Build and run with Nix

Nix provides a pinned build without requiring Go on the host. The resulting binary runs without Nix on a compatible Linux system.

## Requirements

- Linux 5.6+ with working `openat2`.
- Nix with flakes enabled and a source checkout.
- An x86_64-linux or aarch64-linux build host, or a suitable configured builder.

## Install

From the repository root:

```sh
nix build
./result/bin/file-share -h
```

The package includes license notices under `result/share/doc/file-share/`. Keep them with the binary when redistributing it.

## Configure

```sh
install -d -m 700 config state
cp auth.example.json config/auth.json
chmod 600 config/auth.json
./result/bin/file-share -hash-password
```

Replace the example username/hash using [owner account configuration](configuration.md#owner-account). Choose your content directory and HTTPS origin.

## Start and verify

```sh
./result/bin/file-share \
  -listen 127.0.0.1:8080 \
  -root /srv/shared-files \
  -database "$PWD/state/shares.db" \
  -auth "$PWD/config/auth.json" \
  -origin https://files.example.com
```

Configure your HTTPS proxy to reach `127.0.0.1:8080`. Check `curl --fail http://127.0.0.1:8080/healthz`, then log in through HTTPS and [test a shared link](usage.md#share-files-and-folders). Ctrl-C stops the server with a 30-second request-drain allowance.

## Next steps

- [NixOS service](nixos.md) — manage the application through your host configuration.
- [Configuration](configuration.md) — flags and defaults.
- [Operations](operations.md) — updates and recovery. Retain a GC root for any previous Nix package needed for rollback.
