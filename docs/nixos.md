# NixOS service

The flake exports `nixosModules.default` and `services.file-share`. This module runs the same Linux-only server as the [binary/systemd reference](systemd.md), with a dedicated `file-share` system user/group and private persistent state. It does not configure TLS, a proxy, DNS or firewall openings.

## Configure

Add this source as a flake input pinned to a reviewed revision in your host's `flake.lock`. Until a public repository is published, use a local reviewed checkout:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.file-share.url = "path:/absolute/path/to/go-fileshare";

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

Keep the source checkout free of credentials/state: a `path:` input can copy checkout contents into the world-readable Nix store. Refresh and review the host lock deliberately when updating that checkout. The service package defaults to the input's package for the host platform; override `services.file-share.package` only with a compatible `file-share` package.

`origin` has no default and must be an exact HTTPS origin, without a path or trailing slash. Other options above show their defaults. The application validates the origin at startup. Use an unprivileged listener port; port changes also require proxy/readiness changes. The built-in `-healthcheck` only probes port 8080.

## Provision runtime files

On a host you administer, review existing accounts/paths before applying configuration. Never repurpose an unrelated `file-share` identity or existing state directory. Provision credentials through your existing secret-management system, or manually after the configured user/group exists:

```sh
sudo install -d -o root -g file-share -m 0750 /etc/file-share /srv/file-share
sudo install -o root -g file-share -m 0640 /path/to/private/auth.json /etc/file-share/auth.json
```

Use the JSON format and password-hashing instructions in [README.md](../README.md#configure-and-run). The source file above must contain your username and bcrypt hash, not the example placeholder. Never put real credentials into `environment.etc.*.text`, `builtins.readFile`, a Nix path literal, the source checkout, or a derivation. `authFile` is a **quoted runtime path string**, not `./auth.json`; direct `/nix/store/` credential paths are rejected. The module cannot prevent operators from copying secrets into the store elsewhere.

Populate the served root with intended content only. Grant `file-share` group read/search on directories and read access on files; do not grant write access. Keep credentials, `/var/lib/file-share` and backups outside the served root. Do not use `/home`, `/root` or `/run/user`: the sandbox hides home directories. The module does not create, populate, chown or migrate the served tree or credential file. Missing files fail startup closed. On a first manual install, the service may fail until provisioning finishes; then restart it.

Apply the reviewed host configuration using your normal NixOS deployment process; these instructions do not authorize a deployment. Afterwards:

```sh
sudo systemctl restart file-share
sudo systemctl status file-share --no-pager
curl --fail http://127.0.0.1:8080/healthz
```

Configure a separate HTTPS proxy to the loopback listener. Plain HTTP browser login is unsupported. Public exposure needs the ingress controls in [SECURITY.md](../SECURITY.md); readiness alone does not prove public HTTPS operation.

## State and hardening

systemd creates `/var/lib/file-share` as `file-share:file-share`, mode `0700`, with database `shares.db`; `UMask=0077` keeps new state files private. State/identity paths are fixed intentionally. Disabling the service does not delete state or revoke links.

The service has no capabilities, cannot gain privileges, hides home directories/devices, uses private temporary storage, and makes the system read-only except managed state/private temporary storage. Served content and auth are explicitly read-only, including custom paths. `RestrictSUIDSGID` is omitted because systemd 257 blocks mandatory `openat2` with that filter. The module does not provide network isolation or make other host processes untrusted-content-safe.

SIGTERM drains requests for up to 30 seconds; systemd allows 45 seconds. Restart/update clears owner sessions but retains shares and revocations. Password changes require restart and do not revoke shares. For updates, review compatibility, stop the service and privately back up credentials plus the **whole stopped state directory** before applying a new pinned input. Follow [backup/recovery cautions](systemd.md#restart-update-and-recovery). NixOS generation rollback switches code/config, not SQLite state; restoring an old database can reactivate revoked links. No automatic schema downgrade is promised.

See [operator procedures](operations.md) for credential recovery, stopped backup, restricted restore and revocation reconciliation, and the [owner/recipient walkthrough](usage.md) for first-use verification. Retain the previous package closure as well as the host configuration/lock; generation rollback alone is not a state backup.

## Verification and architecture scope

```sh
nix build .#checks.x86_64-linux.service --print-build-logs
nix flake check
nix eval --raw .#checks.aarch64-linux.service.drvPath
```

The VM check uses synthetic content/credentials in a disposable NixOS guest, never host services or production data. It checks boot/start, a custom loopback port/root/auth path, actual read-only mounts, non-root identity, private credentials/state, login/share/download, restart/session reset, persistent revocation, clean stop and missing-auth failure. It deliberately replays a synthetic Secure cookie over guest-loopback HTTP; this is API/service evidence, not browser, TLS or public-ingress proof.

Flake targets are `x86_64-linux` and `aarch64-linux`. Evaluation is not build/runtime evidence: the x86_64 VM check needs a VM-capable Linux builder (KVM recommended; QEMU TCG fallback also works); ARM requires its own native/appropriately configured builder. The x86_64 package and VM runtime passed with the locked nixpkgs (systemd 262); ARM was evaluated only, not built or run. See [verification evidence](../.pi/reviews/go-fileshare-19p.6/report.md). Do not interpret the host-only `nix flake check` skipping ARM as an ARM pass.
