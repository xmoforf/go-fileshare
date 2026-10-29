# Testing

Use temporary synthetic content and credentials. Run commands from the repository root. Keep results tied to the tested commit and distinguish local checks from deployment or native-architecture verification.

## Go checks

Run for application changes:

```sh
nix develop -c sh scripts/check-go.sh
nix build
nix flake check
```

`check-go.sh` runs module verification, Go race tests/vet, and Python contracts. A successful run exits 0. Nix builds the static package and tests the host NixOS service; the VM check needs a VM-capable Linux builder (KVM preferred, slower QEMU TCG fallback available).

## Browser checks

For UI changes, install the pinned test dependencies and run all browser engines at desktop and narrow sizes:

```sh
npm ci --ignore-scripts
node --test tests/browser_options.test.cjs
nix develop -c npm run test:browser
```

Playwright browser binaries and their OS libraries must already be available. On a disposable supported runner, `npx playwright install --with-deps chromium firefox webkit` installs them; this changes host packages. Use the pinned container in `.github/workflows/checks.yml` when host package installation is unsuitable.

`npm run test:browser -- --chromium-only` selects the routine CI subset. The runner checks login, navigation/filtering, themes, share creation, recipient access, download, and revocation. It prints `PASS` per engine/viewport and retains screenshots in the printed temporary directory. Missing engines fail the command. Automated checks do not replace visual inspection or assistive-technology testing.

For interactive inspection or documentation capture:

```sh
nix develop -c env FILE_SHARE_BROWSER_FIXTURE=1 go test -run '^TestBrowserFixture$' -v
```

Open the printed loopback HTTPS URL. Its certificate is self-signed; allow it only for this synthetic fixture. The test-only account is `owner` with the password defined in `server_test.go`. Open `/#/folder/` for 208 synthetic entries. Stop with Ctrl-C or SIGTERM. `ui_browser_test.js` exports the browser checks used by the runner.

## Installation and recovery checks

| Change | Check | Expected result |
|---|---|---|
| Compose/configuration guide | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_compose.py'` | Docs/config parity and rendered images, ports, networks, mounts, lifecycle, and identity contracts pass; rendering requires the Compose CLI, not a daemon, and is explicitly skipped if unavailable |
| GitHub Release workflow/helper | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_github_release.py'` | Version-specific notes, report identities, stable/prerelease flags, existing-release/API failure stops, and workflow gates/permissions pass with synthetic subprocesses; future tag execution requires separate publication approval |
| Restore instructions | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_operations.py'` | Restore chain never promotes a failed or unverified copy |
| systemd unit/guide | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_systemd.py'` | Static unit contract passes; additionally rehearse install/restart/update/permissions on a disposable systemd host |
| NixOS module | `nix build .#checks.x86_64-linux.service --print-build-logs` | Disposable VM checks service startup, permissions, persistence, revocation, and missing-auth failure |
| ARM module evaluation | `nix eval --raw .#checks.aarch64-linux.service.drvPath` | Evaluates successfully; build/runtime verification requires a suitable ARM builder |

Rehearse credential rotation, stopped backup, restore/re-revocation, and code replacement with a built binary:

```sh
nix build
python3 tests/operations_smoke.py result/bin/file-share
# To compare an old binary with a distinct candidate:
python3 tests/operations_smoke.py /path/to/old-file-share --candidate /path/to/candidate
```

Run as non-root with Python 3 and working `openat2`. The rehearsal uses loopback, synthetic data, and private temporary state; it prints and retains its evidence directory. It tests process/API behavior, not public HTTPS. Two builds of the same revision do not prove cross-version state compatibility. Do not use Python optimization flags or `PYTHONOPTIMIZE`: these checks depend on assertions and reject optimization.

## Resource and vulnerability checks

For listing, transfer, or login changes:

```sh
nix develop -c go test -count=1 -v -run '^TestResource' .
nix develop -c go test -run '^$' -bench '^Benchmark(DirectoryListing|LoginCost12)$' -benchtime=3x -benchmem .
```

The resource tests use 100,000-entry directories and sparse files. `B/op` measures cumulative allocation, not peak memory. Profile before changing concurrency; add Go's `-cpuprofile`, `-memprofile`, `-blockprofile`, or `-mutexprofile` flags and inspect with `go tool pprof`.

Use `FILE_SHARE_BROWSER_FIXTURE=large` for 100,000 browser entries. Inspect middle/end scrolling, filter `item-99996`, reversed sorting, focus retention, and dialog focus restoration. Mounted rows should remain bounded by the viewport; browser memory still scales with the complete listing. Record engine, viewport, storage, and measurement limits rather than extrapolating one host's timings.

Before releases and after relevant advisories, build the pinned scanner and scan source inside the development shell:

```sh
scanner=$(nix build --no-link --print-out-paths --impure --expr \
  'let f = builtins.getFlake (toString ./.); in (builtins.getAttr builtins.currentSystem f.inputs.nixpkgs.legacyPackages).govulncheck')
"$scanner/bin/govulncheck" -version
nix develop -c "$scanner/bin/govulncheck" -show verbose ./...
"$scanner/bin/govulncheck" -mode=binary -show verbose /path/to/release/file-share
```

Network access is required for the vulnerability database. Retain scanner/compiler versions, database date, output, and assessment of module-only versus reachable-code findings. An unavailable scanner/database or unresolved reachable vulnerability blocks release.

## Continuous integration

| Trigger | Checks |
|---|---|
| PR / `main` push; manual `full: false` | Native amd64 Go/Python contracts, Nix build, image build/version checks, Chromium desktop/narrow |
| Manual `full: true` (default); release workflow | Native amd64 and arm64 contracts/builds/images, operations rehearsal and binary scans, host NixOS checks and source scan, Chromium/Firefox/WebKit desktop/narrow |

Branch and manual checks do not publish images or GitHub Releases. Full checks retain tested image archives for seven days. Only executed checks establish coverage; see [release procedures](releases.md) for publication.
