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

## Resource and security checks

```sh
nix develop -c go test -count=1 -v -run '^TestResource' .
nix develop -c go test -run '^$' -bench '^Benchmark(DirectoryListing|LoginCost12)$' -benchtime=3x -benchmem .
```

Tests create synthetic 50,000-entry directories and sparse 64 MiB files; they verify cancellation, full owner/bearer listings, stalled-reader cleanup, SQL pool waits and login/session budgets. Benchmarks discard response bytes to exclude client-side buffering. `B/op` is cumulative allocation, not peak memory. Do not infer a safe global concurrency limit from one host's timings.

For profiles, add `-cpuprofile=/tmp/file-share-cpu.pprof -memprofile=/tmp/file-share-mem.pprof -blockprofile=/tmp/file-share-block.pprof -mutexprofile=/tmp/file-share-mutex.pprof -o /tmp/file-share.test` to the benchmark/test command, then use `nix develop -c go tool pprof -top /tmp/file-share.test /tmp/file-share-cpu.pprof`. Profiles include fixture setup; use benchmark timings for per-operation cost. Profile before changing concurrency.

Use `FILE_SHARE_BROWSER_FIXTURE=large` instead of `1` for a 50,000-entry browser fixture. Verify 50,000 items / 500 pages, filter for `item-49996`, clear the filter and reverse Name sorting. This fixture is separate from `checkUI(page)`'s fixed 208-entry assertions. Browser memory still scales with the full array; report engine, viewport, heap API limitations and storage/network conditions.

### Pinned vulnerability scan

Inside `nix develop`, build the scanner from the same locked nixpkgs input, without installing a global tool or changing application dependencies:

```sh
scanner=$(nix build --no-link --print-out-paths --impure --expr \
  'let f = builtins.getFlake (toString ./.); in f.inputs.nixpkgs.legacyPackages.${builtins.currentSystem}.govulncheck')
"$scanner/bin/govulncheck" -version
"$scanner/bin/govulncheck" -show verbose ./...
```

Network access is needed for the vulnerability database. Retain tool/compiler versions, database update date and output; an unavailable database/tool is a release-check blocker. Assess module-only findings separately from imported-package/reachable-symbol findings. See [SECURITY.md](SECURITY.md) for the current result and reporting limitations. The scanner covers Go source dependencies, not host/proxy/image vulnerabilities.

Go dependencies live in `go.mod`/`go.sum`; update the Nix `vendorHash` when those change. Toolchain updates belong in `flake.nix`/`flake.lock`. No global Go install is required.

Only task-owned changes belong in commits. Publication, deployment and Git remote operations require separate approval. Do not assign a license without the owner's decision.
