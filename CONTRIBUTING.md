# Contributing

Use `nix develop` on Linux. See [README.md](README.md) for configuration and security boundaries, and [AGENTS.md](AGENTS.md) for Beads/Pi workflow. Use applicable Pi planning, test-driven-development and verification-before-completion skills. Keep changes small; add regression tests before behavior changes.

## Test Commands

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

Format Go changes with `gofmt`. Do not weaken Linux confinement or HTTPS origin checks to simplify tests. Tests use temporary synthetic data, never live credentials or shares.

Go dependencies live in `go.mod`/`go.sum`; update the Nix `vendorHash` when those change. Toolchain updates belong in `flake.nix`/`flake.lock`. No global Go install is required.

Only task-owned changes belong in commits. Publication, deployment and Git remote operations require separate approval. Do not assign a license without the owner's decision.
