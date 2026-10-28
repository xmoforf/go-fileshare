# Release procedures

For maintainers publishing container images or building local binary archives. Installation instructions are in the [Compose](compose.md) and [systemd](systemd.md) guides; user-facing changes belong in [release notes](../RELEASE_NOTES.md).

## Release prerequisites

1. Select a reviewed commit on `main` and a version. Record state/API compatibility, upgrade steps, and known issues.
2. Run the full [test matrix](testing.md), including native amd64/arm64 checks, all browser engine/viewport combinations, operations rehearsals, and fresh vulnerability scans.
3. Verify bundled notices and artifact identities. Rehearse old/new binaries when claiming cross-version compatibility.
4. Obtain approval for the exact version-tag push and its GHCR/Docker Hub publication effects. Branch pushes remain check-only; deployment is separate.

Release tags use `vMAJOR.MINOR.PATCH` with an optional prerelease suffix. Build metadata, numeric prerelease identifiers with leading zeros, malformed tags, and Docker-overlength tags are rejected. Validate without publishing using `python3 scripts/image_release.py v1.0.4`.

## Build and verify

The tag-triggered workflow runs `.github/workflows/checks.yml` with `full: true`. Native runners build static binaries and scratch images, check version/source identity, run operations tests, and scan the binaries. The publisher consumes those exact tested image archives rather than rebuilding them.

For local binary/image archives, use Linux, the pinned Nix environment, Python 3.12+, and an archive-capable Docker Buildx builder. Commit the reviewed source first; the packager reads `git archive HEAD`, refuses tracked changes, and excludes untracked files.

```sh
BUILDX_BUILDER=your-existing-builder nix develop -c python3 scripts/release.py v1.0.4 /tmp/file-share-v1.0.4
python3 tests/release_artifacts.py /tmp/file-share-v1.0.4
cd /tmp/file-share-v1.0.4
sha256sum -c SHA256SUMS
```

Choose a new output directory. An existing approved `docker-container` builder can export the Docker archives; creating one starts privileged BuildKit infrastructure and requires separate approval. Do not change host Docker storage settings to make packaging pass.

Outputs include Linux amd64/arm64 binary and Docker archives, complete notices, guides, `build.json`, and checksums. Image payloads contain the binary and notices, run as UID:GID `999:993`, and use `/file-share` as entrypoint. No image is loaded or published. `runtime_verified` starts empty: cross-compilation alone is not native-runtime verification. Partial output remains on failure, without final checksums.

## Publish

An approved version tag on `main` triggers `.github/workflows/release.yml`. After all checks pass, independent jobs publish to:

- `ghcr.io/xmoforf/go-fileshare`, using the job's ephemeral `GITHUB_TOKEN`.
- `docker.io/xmoforf/go-fileshare`, using repository secret `DOCKERHUB_TOKEN` for username `xmoforf`.

Only the GHCR job receives `packages: write`. Build/test jobs receive no registry credentials. Releases are serialized; submit one version at a time because queued GitHub concurrency runs may replace one another. Workflows do not create Git tags, GitHub Releases, or deployments.

### Release tags

For version `v1.0.3`:

| Image tag | Meaning |
|---|---|
| `1.0.3` | Exact multi-platform Linux amd64/arm64 image |
| `1.0.3-amd64`, `1.0.3-arm64` | Exact platform images |
| `1.0` | Highest stable patch in the 1.0 line |
| `1` | Highest stable version in major version 1 |
| `latest` | Highest stable version |

Prereleases receive only exact version/platform tags. Older maintenance releases do not downgrade newer aliases. Docker tags omit the Git `v`; embedded version metadata retains it. Exact tags are protected by publisher policy, not registry immutability; deployments can pin a digest.

For example, use `docker buildx imagetools inspect ghcr.io/xmoforf/go-fileshare:1.0.3` to inspect its platforms and index digest, then pin `ghcr.io/xmoforf/go-fileshare@sha256:...` in Compose. The same version is available from Docker Hub. Check the chosen registry rather than relying on a copied digest table.

## Verify publication

Inspect both publication jobs and reports. Confirm version/source labels, platform manifests, index/config digests, and an anonymous digest pull with the expected `-version`. Initial GHCR visibility can require a separately approved change; do not advertise public availability until anonymous access works.

Retain the commit/tag, native test results, and `publication-report-ghcr.io` / `publication-report-docker.io` artifacts outside expiring CI storage. Image archives expire after seven days; publication reports expire after 90 days. Record native ARM execution separately from emulation or cross-build evidence.

## Handle partial publication

Publication is not transactional across registries. One registry can succeed while the other fails; no automatic rollback occurs. Preflight rejects existing exact/platform tags and fails closed on malformed inventories, network errors, or authentication errors.

Before retrying, inspect both reports and registry digests. A rerun encountering partial tags stops rather than overwriting them. Obtain separate approval for a specific recovery operation; do not delete or overwrite tags to force a rerun through. Restrict other registry writers so they cannot bypass publication policy.
