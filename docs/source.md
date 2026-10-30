# Build and run with Go

Build a single binary containing the browser interface and SQLite support. Go is needed only on the build machine; the resulting binary needs no external database or shared libraries when built as below.

## Requirements

- Linux for the supported runtime and installation paths.
- Go compatible with `go.mod` (currently 1.27.3).
- A source checkout and network access to download dependencies.

Confinement uses Go `os.Root`, not Linux `openat2`. Selected Darwin/BSD cross-builds are checked as described in [testing](testing.md#portability-checks); native runtime support is not claimed. Unix `O_NONBLOCK` and SIGTERM remain; Windows is not supported.

No C compiler is needed for this build. Use the matching Linux amd64 or arm64 architecture. For an offline build, prepare dependencies with `go mod vendor` on a connected machine and transfer source plus `vendor/`; use `-mod=vendor` below.

## Install

From the repository root:

```sh
go version
GOTOOLCHAIN=local go mod download
GOTOOLCHAIN=local go mod verify
CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=readonly -trimpath -o file-share .
./file-share -h
```

`GOTOOLCHAIN=local` uses the installed compiler rather than downloading another. When distributing the binary, include `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `licenses/` alongside it.

## Configure

Create `config/` and `state/` directories, then create `config/auth.json` following [owner account configuration](configuration.md#owner-account):

```sh
install -d -m 700 config state
cp auth.example.json config/auth.json
chmod 600 config/auth.json
./file-share -hash-password
```

Replace the example username/hash. Choose the served root and external HTTPS origin from the [configuration reference](configuration.md).

## Start and verify

```sh
./file-share \
  -listen 127.0.0.1:8080 \
  -root /srv/shared-files \
  -database "$PWD/state/shares.db" \
  -auth "$PWD/config/auth.json" \
  -origin https://files.example.com
```

Route that HTTPS hostname to `127.0.0.1:8080` through your proxy. In another terminal, run `curl --fail http://127.0.0.1:8080/healthz`, then open the HTTPS URL, log in, and [test a shared link](usage.md#share-files-and-folders). Ctrl-C stops the server with a 30-second request-drain allowance.

## Next steps

- [systemd installation](systemd.md) — run the binary as a service.
- [Operations](operations.md) — credentials, backups, and updates.
- [Contributing](../CONTRIBUTING.md) — development and testing.

### Build a container from source

Build the current checkout explicitly:

```sh
docker build -t go-fileshare:local .
```

The repository-root `compose.yaml` pulls published images; it does not build source. To run your local build, follow the [Compose guide](compose.md), replace the file-share image with `go-fileshare:local`, and omit the application image pull. Keep the same credential/state permissions and verification steps. No separate development stack is required.
