# Contributing

Develop on Linux. Keep changes focused, add regression tests for behavior changes, and use synthetic files and credentials in tests.

## Development environment

`nix develop` provides the pinned Go compiler, GCC for race tests, and Git. Alternatively, use Go compatible with `go.mod` and a C compiler for race tests. Nix is not required to run the application.

```sh
nix develop
```

The shell uses `GOTOOLCHAIN=local`. Optional direnv users can inspect `.envrc`, then run `direnv allow`.

## Build and run

Use the [source](docs/source.md) or [Nix](docs/nix.md) guide. Application settings are in the [configuration reference](docs/configuration.md).

For UI development, the [browser fixture](docs/testing.md#browser-checks) provides a temporary HTTPS server with synthetic data.

## Make a change

- Format Go with `gofmt`; preserve filesystem confinement, origin checks, and error handling.
- Update the relevant task guide when commands, settings, or behavior change. Keep README focused on evaluation and installation choices.
- For Go/module updates, update `go.mod`/`go.sum`, refresh `flake.nix`'s `vendorHash` using the hash reported by Nix, and verify modules. Update `flake.lock` deliberately; refresh affected [license notices](THIRD_PARTY_NOTICES.md).
- New third-party code or assets need recorded provenance and compatible terms. Keep required notices in packaged outputs.

### Updating themes

The theme catalog and application code live in `index.html`. Preserve stable IDs and saved-preference fallback. Record source revisions, hashes, licenses, role mapping, and adaptations in `licenses/themes/provenance.json`; retain exact author notices and HTML license comments. Import reviewed color literals, not upstream executable generators or runtime network dependencies.

Run the Python theme contracts and browser theme checks after changes. Check light/dark text contrast, focus, dialogs, narrow layout, and forced-color behavior. See [testing](docs/testing.md).

### Updating documentation media

Keep `docs/images/overview.png` and `docs/images/sharing.gif` grounded in the current UI using synthetic local content. Show browsing/filtering/sorting, an expiring share, recipient access, revocation, and a theme change. Capture real states rather than mockups; keep a readable still image and text instructions alongside animation. Stop the fixture after capture. See [browser checks](docs/testing.md#browser-checks) for fixture startup.

## Run checks

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'
```

Keep root `compose.yaml`, `caddy/Caddyfile`, and the Compose guide examples in sync. Python contracts render Compose when its CLI is installed (no daemon needed); without it, rendered-config checks are skipped. Run them with Compose available before submitting stack changes.

[Testing](docs/testing.md) covers browser, installation, recovery, resource, and vulnerability checks. Cross-compilation or evaluation alone does not establish native ARM runtime coverage.

## Submit a contribution

Describe the behavior changed, checks run, and remaining limitations. Keep unrelated files out of commits. Branch/PR CI is check-only; release publication is described in [release procedures](docs/releases.md).

For agent-assisted work, follow [AGENTS.md](https://github.com/xmoforf/go-fileshare/blob/main/AGENTS.md): Beads tracks work, task-owned changes are verified and committed, and deployment, pushes, and publication require separate approval. A version-tag push triggers registry publication; approval must include those effects.
