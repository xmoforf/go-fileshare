# Contributing

Develop on Linux with Go compatible with `go.mod`; `nix develop` supplies the pinned toolchain. See [README.md](README.md) for configuration and security boundaries, and [AGENTS.md](AGENTS.md) for Beads/Pi workflow. Keep changes small; add regression tests before behavior changes.

## Reproducible builds and updates

`flake.lock` pins nixpkgs and the Go 1.27.3 toolchain. `go.mod`/`go.sum` select and verify Go dependencies; the flake's `vendorHash` fixes vendored contents for sandboxed builds. Pinning build inputs does not impose Nix on the runtime host or prove byte-for-byte reproducibility across arbitrary build settings.

```sh
nix develop                 # pinned Go + GCC (race tests) + Git
nix build                   # CGO-disabled package, including Go tests and notices
nix run . -- -h
```

The shell sets `GOTOOLCHAIN=local` to prevent silent compiler downloads. Optional direnv: inspect `.envrc`, then `direnv allow`. Direct source builds need neither Nix nor a C compiler; race tests require CGO and a C compiler.

For dependency updates, change `go.mod`/`go.sum`, recompute `flake.nix`'s `vendorHash` using Nix's reported fixed-output hash, and rerun checks. Update `flake.lock` deliberately with `nix flake update`; keep Go compatible with `go.mod`. The flake targets x86_64-linux and aarch64-linux. Evaluation and cross-compilation are not native ARM runtime checks.

## Test Commands

[CI and release gates](docs/releases.md) separate routine feedback from release qualification. PRs and `main` pushes run amd64 Go race/vet/module/Python checks, a Nix build, one native image/Compose smoke test, and Chromium at desktop and narrow sizes. `nix develop -c sh scripts/check-go.sh` runs the same Go/Python contracts locally.

Manual **Checks** defaults to `full: true`: both native architectures, all six browser combinations, Nix flake checks, vulnerability scans, operator rehearsals and seven-day tested image artifacts. Set `full: false` to exercise the routine path. Both modes are check-only; an approved `v*` tag requests full checks before publication. Release gates and test assertions are not weakened by the lighter PR mode.

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

Container/reference changes also require `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'` and `python3 tests/compose_smoke.py`; see [Compose verification](docs/compose.md#disposable-verification) for prerequisites, coverage and retained disposable resources. The script tests the actual Compose/Caddy configuration over verified local HTTPS; it is not browser or public-ingress load evidence. Use `python3 tests/compose_smoke.py --image LOCAL_IMAGE` to test an already-built image without rebuilding (check-only CI and releases use this path).

Binary/systemd reference changes also require `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_systemd.py'` and a disposable real-systemd install/start/restart/update/permissions rehearsal; see [systemd installation](docs/systemd.md). Static checks alone are not runtime acceptance. Direct source builds need Go compatible with `go.mod`, not Nix.

NixOS module changes require `nix build .#checks.x86_64-linux.service --print-build-logs` (also included in host `nix flake check`) on a VM-capable Linux builder (KVM recommended; QEMU TCG fallback is slower). The disposable VM uses only synthetic data and checks actual service permissions and persistence; see [NixOS installation and verification](docs/nixos.md). Evaluate ARM with `nix eval --raw .#checks.aarch64-linux.service.drvPath`; claim ARM build/runtime only after executing on a suitable builder. Do not apply a host configuration as a test.

Format Go changes with `gofmt`. Do not weaken Linux confinement or HTTPS origin checks to simplify tests. Tests use temporary synthetic data, never live credentials or shares.

`node --test tests/browser_options.test.cjs` checks browser selection without launching a browser. `npm run test:browser` runs all engines; `npm run test:browser -- --chromium-only` runs the PR subset with the same assertions and both viewport sizes.

For UI regressions, run `FILE_SHARE_BROWSER_FIXTURE=1 go test -run '^TestBrowserFixture$' -v` inside `nix develop`. This starts an opt-in temporary HTTPS fixture with test-only credentials from `server_test.go`; stop it with SIGTERM. Never use production files or expose it publicly. Log in with its test-only owner account, then open `/#/folder/`. It contains 208 synthetic entries. `ui_browser_test.js` defines `checkUI(page)` for a Playwright-compatible browser session; no package install is needed. In Pi's browser tool, submit the function from this file followed by `return await checkUI(page);`. Do not evaluate fetched code; the browser sandbox disables string-based code generation.

It exercises native Enter/Space, forward/backward Tab across virtual rows, Home/End, distant-scroll focus retention, full-list filtering, preset-only expiry controls and creation of shares with all four finite presets. The cross-engine runner also checks Never, recipient access and revocation. `tests/theme_browser.cjs` checks all twelve themes, rendered text/control contrast, keyboard search/apply/cancel/Escape/reset, focus restoration, pathname isolation, malformed/legacy/denied storage, first rendered frames and same-origin requests. Its native `size=6` listbox has no separate popup to dismiss. A temporary test-only button after the list checks Tab exit without relying on engine-specific browser-chrome focus behavior. Repeat at desktop and narrow viewport sizes; inspect focus visibility, layout and accessible names separately. This is not a screen-reader certification or a cross-engine pass.

## Updating themes

`index.html` contains one JSON catalog and an early application script; no runtime/import service or network dependency is needed. Keep the ten-theme scope and stable IDs. `licenses/themes/provenance.json` records pinned collection/author URLs, revisions, source hashes, role mapping and deliberate adaptations. Full author sources and MIT notices are retained for audit; only reviewed token literals enter the browser catalog.

For a deliberate refresh, resolve the collection master revision, inspect only the selected names and verify each author's applicable palette license at an exact revision. Collection MIT alone is insufficient. Compare source colors/terms, preserve exact notices and hashes, and replace or omit unresolved candidates. Never execute upstream generators or automatically fetch in builds. Keep names bounded and colors six-digit hex; record every UI override. If removing an ID, exercise saved-ID fallback rather than silently remapping it. Retain notices in the HTML comment and package notice tree.

Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_themes.py` for catalog/schema, source hashes, delivered notices and conservative text/surface contrast checks, plus the full Python contracts. Run the cross-engine browser matrix and inspect light/dark picker, selected options, focus, hover/status states, dialogs and narrow layout. Preserve forced-color overrides; automated contrast checks are not screen-reader or native-device certification. Finish with fresh Go race/vet, Nix build/flake checks and notice inclusion checks in Nix/container/release outputs. No automatic synchronization, deployment or publication.

## Operator rehearsal

```sh
nix build
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_operations.py'
python3 tests/operations_smoke.py result/bin/file-share
# Optional: rehearse another locally built candidate without changing installed services.
python3 tests/operations_smoke.py result/bin/file-share --candidate /absolute/path/to/candidate
```

Run as non-root with Python 3 and Linux `openat2`. The stdlib-only script starts the supplied binaries on loopback, generates synthetic credentials/content, and retains a printed private temporary directory. It asserts setup/share/revoke, whole stopped-state backup, rotation/session invalidation, restore inventory, known revoked-link resurrection and re-revocation, code replacement/rollback, finite-expiry preservation, expired-link denial and restart persistence. A command-stub test also proves the published restore recipe never promotes a failed copy. It checks server logs for generated credentials/tokens without printing them. Assertions are the checks. Both smoke scripts reject optimized Python (`-O`, `-OO` or optimization enabled by `PYTHONOPTIMIZE`) before argument handling, commands, fixture creation or process launch. Unset `PYTHONOPTIMIZE` and omit optimization flags.

No live config/state, host service, Docker, proxy or public listener is touched. Secure cookies are deliberately replayed over loopback HTTP: this is API/process evidence, not HTTPS/browser evidence. Default candidate is the same binary; two builds of one revision test replacement, not cross-version schema compatibility. A future release needs its own old/new candidate rehearsal. Fixtures remain private for inspection, not automatic deletion. See [operator procedures](docs/operations.md) and [user walkthrough](docs/usage.md).

## Resource and security checks

```sh
nix develop -c go test -count=1 -v -run '^TestResource' .
nix develop -c go test -run '^$' -bench '^Benchmark(DirectoryListing|LoginCost12)$' -benchtime=3x -benchmem .
```

Tests create synthetic 100,000-entry directories and sparse 64 MiB files; they verify cancellation, full owner/bearer listings, stalled-reader cleanup, SQL pool waits and login/session budgets. Benchmarks discard response bytes to exclude client-side buffering. `B/op` is cumulative allocation, not peak memory. Do not infer a safe global concurrency limit from one host's timings.

For profiles, add `-cpuprofile=/tmp/file-share-cpu.pprof -memprofile=/tmp/file-share-mem.pprof -blockprofile=/tmp/file-share-block.pprof -mutexprofile=/tmp/file-share-mutex.pprof -o /tmp/file-share.test` to the benchmark/test command, then use `nix develop -c go tool pprof -top /tmp/file-share.test /tmp/file-share-cpu.pprof`. Profiles include fixture setup; use benchmark timings for per-operation cost. Profile before changing concurrency.

Use `FILE_SHARE_BROWSER_FIXTURE=large` instead of `1` for a 100,000-entry browser fixture. Verify 100,000 items, scroll to the middle/end, filter for `item-99996`, clear the filter and reverse Name sorting. Mounted rows should stay within `ceil(scrollWrap.clientHeight / 36) + 12` (visible rows, overscan and one pinned row), not scale with directory size. Focus a link/copy/share action, scroll far away, resize, then verify the same node retains focus; also close a row's share dialog after scrolling and verify focus restoration. This fixture is separate from `checkUI(page)`'s fixed 208-entry assertions. Browser memory still scales with the full array; report engine, viewport, heap API limitations and storage/network conditions. Fixed-height single-line rows are tested at 100k, not beyond browser scroll-height limits or with every assistive technology.

### Pinned vulnerability scan

Inside `nix develop`, build the scanner from the same locked nixpkgs input, without installing a global tool or changing application dependencies:

```sh
scanner=$(nix build --no-link --print-out-paths --impure --expr \
  'let f = builtins.getFlake (toString ./.); in f.inputs.nixpkgs.legacyPackages.${builtins.currentSystem}.govulncheck')
"$scanner/bin/govulncheck" -version
"$scanner/bin/govulncheck" -show verbose ./...
```

Network access is needed for the vulnerability database. Retain tool/compiler versions, database update date and output; an unavailable database/tool is a release-check blocker. Assess module-only findings separately from imported-package/reachable-symbol findings. See [SECURITY.md](SECURITY.md) for the current result and reporting limitations. The scanner covers Go source dependencies, not host/proxy/image vulnerabilities.

Only task-owned changes belong in commits. Publication, deployment and Git remote operations require separate approval. Version-tag push approval must explicitly cover the automatic GHCR and Docker Hub writes it triggers; branch pushes remain check-only. The owner approved MIT for project-owned code; third-party terms remain separate. When upgrading Go or modules, refresh the exact upstream notices and inventory in `THIRD_PARTY_NOTICES.md` and `licenses/`, run `go mod verify`, and check notices are included in package/release outputs. New imported code/assets need explicit provenance and compatible terms; do not infer rights from availability.
