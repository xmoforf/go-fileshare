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

For UI regressions, start the opt-in HTTPS fixture described in README, log in with its test-only owner account, then open `/#/folder/`. It contains 208 synthetic entries. `ui_browser_test.js` defines `checkUI(page)` for a Playwright-compatible browser session; no package install is needed. In Pi's browser tool, submit the function from this file followed by `return await checkUI(page);`. Do not evaluate fetched code; the browser sandbox disables string-based code generation.

It exercises native Enter/Space/Tab, scrolling focus, pagination/filter boundaries, duration validation and creation of a one-second synthetic share. Repeat at desktop and narrow viewport sizes; inspect focus visibility, layout and accessible names separately. This is not a screen-reader certification or a cross-engine pass.

Go dependencies live in `go.mod`/`go.sum`; update the Nix `vendorHash` when those change. Toolchain updates belong in `flake.nix`/`flake.lock`. No global Go install is required.

Only task-owned changes belong in commits. Publication, deployment and Git remote operations require separate approval. Do not assign a license without the owner's decision.
