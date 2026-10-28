# Install on NixOS

The flake exports `nixosModules.default` and `services.file-share`. The module creates a dedicated account and persistent state; your host configuration supplies HTTPS and networking.

## Requirements

- NixOS on x86_64-linux or aarch64-linux with working `openat2`.
- A flake-based host configuration and an HTTPS reverse proxy.

## Install

Add the repository as an input and import its module. Your host's `flake.lock` pins the revision.

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.file-share.url = "github:xmoforf/go-fileshare";

  outputs = { nixpkgs, file-share, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        file-share.nixosModules.default
        {
          services.file-share = {
            enable = true;
            root = "/srv/file-share";
            authFile = "/etc/file-share/auth.json";
            listen = "127.0.0.1:8080";
            origin = "https://files.example.com";
          };
        }
      ];
    };
  };
}
```

## Configure

| Option under `services.file-share` | Default |
|---|---|
| `enable` | `false` |
| `root` | `/srv/file-share` |
| `authFile` | `/etc/file-share/auth.json` |
| `listen` | `127.0.0.1:8080` |
| `origin` | Required HTTPS origin |
| `package` | This input's package for the host platform |

Provision credentials through your secret-management system or install a prepared auth file after the module's `file-share` account exists:

```sh
sudo install -d -o root -g file-share -m 0750 /etc/file-share /srv/file-share
sudo install -o root -g file-share -m 0640 /path/to/private/auth.json /etc/file-share/auth.json
```

See [owner account configuration](configuration.md#owner-account) for the file format and hashing command. `authFile` is a quoted runtime path, not a Nix path literal; credentials do not belong in the Nix store.

Place served files under `root`, readable by the `file-share` group. The module does not populate or change ownership of the content directory. Its sandbox hides `/home`, `/root`, and `/run/user`.

State is fixed at `/var/lib/file-share/shares.db`, owned by `file-share:file-share`; the directory mode is `0700`. Configure your HTTPS proxy to reach the chosen listener. The module does not open firewall ports.

## Start and verify

Apply your host configuration through your normal NixOS deployment process. On a first manual installation, the service may fail until the credential file and served root are provisioned. Then:

```sh
sudo systemctl restart file-share
sudo systemctl status file-share --no-pager
curl --fail http://127.0.0.1:8080/healthz
```

Adjust the readiness port if needed. Open the configured HTTPS URL, log in, and [test a shared link](usage.md#share-files-and-folders).

## Next steps

- [Operations](operations.md) — update the pinned input, back up, and restore. NixOS generation rollback changes code/configuration, not SQLite state.
- [Security](../SECURITY.md) — application boundaries and deployment hardening.
- [Installation tests](testing.md#installation-and-recovery-checks) — NixOS VM checks and architecture coverage.
