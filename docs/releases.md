# Checks and local release candidates

GitHub Actions is the chosen CI host under the owner's `xmoforf` account. `.github/workflows/checks.yml` runs checks only: read-only repository permission, no saved Git credentials, registry login, artifact upload, tag, release or deployment. Repository creation, remotes and push still require separate approval. No registry is selected.

## Check source

Use Linux with `openat2`, Nix, Python 3.11+, Node 24 and Docker Buildx for local image export. Go comes from the locked flake. Python 3.12+ is required by the packager's safe tar extraction filter. Do not use `python -O`: artifact verification relies on assertions.

```sh
nix develop -c sh scripts/check-go.sh
nix build
nix flake check
npm ci --ignore-scripts
# On a supported disposable Ubuntu runner; --with-deps installs OS packages.
npx playwright install --with-deps chromium firefox webkit
nix develop -c npm run test:browser
```

Do not run `--with-deps` on a managed host without permission. The browser runner compiles the existing synthetic HTTPS fixture, starts it on loopback, and runs all three engines at 1280×800 and 390×844. Missing engines fail the command. It checks owner login, keyboard traversal/focus/filtering, preset-only expiry controls and all four finite expiry values plus Never, folder-share creation, anonymous listing/download and revocation. Screenshots remain in the printed temporary directory. The fixture stops in `finally`; self-signed TLS exceptions apply only to synthetic browser contexts. No live credentials/state are used. Playwright and its browser binaries are development tools, not application dependencies or release payloads.

For hosts without browser libraries, use a disposable pinned Playwright container instead of changing host packages:

```sh
npm ci --ignore-scripts
nix develop -c env CGO_ENABLED=0 go test -c -o /tmp/file-share-browser-fixture .
docker run --name file-share-browser-check --network none --cap-drop ALL \
  --security-opt no-new-privileges --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$PWD",dst=/work,readonly \
  --mount type=bind,src=/tmp/file-share-browser-fixture,dst=/fixture,readonly \
  -e BROWSER_FIXTURE_BINARY=/fixture -w /work \
  mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48 \
  node tests/browser_smoke.cjs
```

The stopped container retains screenshots; copy the printed directory with `docker cp`. Choose a new container name for another run. No automatic removal, privileged mode, daemon socket, host networking or public ports are needed.

Run the pinned [vulnerability scan](../CONTRIBUTING.md#pinned-vulnerability-scan); unavailable scanner/database or unresolved reachable vulnerabilities block release. Run the [operator rehearsal](../CONTRIBUTING.md#operator-rehearsal) with the candidate binary. Installation changes also need their documented Compose/systemd/NixOS rehearsals. The CI matrix requests native amd64 and arm64 Go tests/builds; only executed jobs count as architecture evidence. Host NixOS VM checks run on amd64; ARM VM execution is separate.

## Build local artifacts

Commit reviewed source first. The packager refuses tracked changes and existing output paths. Use an archive-capable Buildx builder: the default Docker driver with a classic image store cannot export archive files. Select an existing approved builder with `BUILDX_BUILDER`; do not change host Docker storage settings to make the check pass. Creating a `docker-container` builder starts a privileged BuildKit container and cache volume and requires explicit local approval. After approval, `docker buildx create --name file-share-release --driver docker-container` creates one without switching the global default. Retain it until cleanup is separately approved. Untracked files are excluded by `git archive HEAD`, so local secrets and unrelated review artifacts cannot enter the build. Use a new output directory outside the checkout:

```sh
BUILDX_BUILDER=file-share-release nix develop -c python3 scripts/release.py v0.1.0-rc.1 /tmp/file-share-v0.1.0-rc.1
python3 tests/release_artifacts.py /tmp/file-share-v0.1.0-rc.1
cd /tmp/file-share-v0.1.0-rc.1
sha256sum -c SHA256SUMS
```

For each of Linux amd64 and arm64 this writes a `.tar.gz` archive and `.docker.tar` image archive (Docker save format). Images are built from the same static binary in the matching archive; no foreign executable runs during image assembly. Buildx must support Docker archive export; the named `docker-container` builder does. No image is loaded, pushed or tagged in a registry. Archives include binary, notices, install/operations guides and release notes. Images contain binary and notices, non-root UID/GID `999:993`, and `/file-share` entrypoint. Build workspace and partial output remain on failure; no `SHA256SUMS` is written until all builds succeed. Fix failures and use a new output path, rather than treating partial output as a candidate.

`build.json` records explicit version, commit, compiler and target platforms. `runtime_verified` deliberately starts empty: successful cross-compilation is not runtime evidence. Plain source/Nix/Compose builds report `dev (unknown)` unless linker metadata is explicitly set. Version names do not create Git tags or promise reproducible byte-identical archives.

## Release gate (human review required)

Before any separately authorized publication:

1. Bind every result to the candidate commit/version. Verify archive checksums, embedded `-version`, ELF machine type and image config/payload/notices for both architectures.
2. Run binaries on native amd64 and arm64 hosts with openat2; run Go contracts and install/operations checks there. Cross-build, ELF inspection or emulation alone cannot mark native runtime verified.
3. Require passing Go race/vet/contracts, Python contracts, Nix checks, all six browser runs, and fresh vulnerability scan. Review results rather than presence of a workflow file.
4. Confirm MIT provenance attestation and exact Go/module notice inventory remain current; include all notices. Review release notes for known limits and upgrade/rollback behavior. Rehearse old/new versions if claiming compatibility.
5. Record pending public-ingress/install/security work. Packaging success does not authorize public exposure or close separate readiness blockers.
6. Obtain approval for concrete destination, artifacts and publication operation. Hosting choice is not publication authority; registry remains undecided.

No automated command turns local candidate builds into release approval. Keep evidence alongside the candidate; do not edit generated metadata to imply checks ran.
