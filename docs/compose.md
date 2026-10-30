# Install with Docker Compose

Run the published application image behind Caddy. The repository-root stack and this guide use the same shared-proxy layout: Caddy joins `proxy`; file-share joins `proxy` and `fileserver`. Other applications can join `proxy` and receive their own Caddy routes.

## Requirements

- Linux, Docker Engine, and Docker Compose V2 or newer.
- A hostname pointing to the host, with public TCP ports 80/443 and UDP port 443 available for Caddy. UDP 443 enables HTTP/3; TCP serves HTTP/1.1 and HTTP/2.
- A directory of files to serve.

The image supports Linux amd64 and arm64. This guide uses mutable `latest` and `caddy:2` tags; pulling later can change either image. For repeatable deployments, select verified release tags or registry digests and record both image identities before updating. See [release tags](releases.md#release-tags).

## Install

Create a new deployment directory. Copy the repository's `compose.yaml` and `caddy/Caddyfile`, preserving their relative paths, or save the examples below. No `.env` file is required.

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    stop_grace_period: 40s
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - type: bind
        source: ./caddy/Caddyfile
        target: /etc/caddy/Caddyfile
        read_only: true
        bind: {create_host_path: false}
      - caddy_data:/data
      - caddy_config:/config
    networks: [proxy]

  fileshare:
    image: ghcr.io/xmoforf/go-fileshare:latest
    command: ["-origin", "https://files.example.com"]
    restart: unless-stopped
    stop_grace_period: 40s
    healthcheck:
      test: ["CMD", "/file-share", "-healthcheck"]
      interval: 5s
      timeout: 4s
      retries: 6
      start_period: 5s
    volumes:
      - type: bind
        source: ./fileshare/data
        target: /data
        read_only: true
        bind: {create_host_path: false}
      - type: bind
        source: ./fileshare/auth.json
        target: /config/auth.json
        read_only: true
        bind: {create_host_path: false}
      - type: bind
        source: ./fileshare/state
        target: /state
        bind: {create_host_path: false}
    networks: [proxy, fileserver]

networks:
  proxy:
    name: proxy
  fileserver:

volumes:
  caddy_data:
  caddy_config:
```

Only Caddy publishes host ports, on all host interfaces. `fileserver` is project-scoped; `proxy` has a stable name so other stacks can join it. In those stacks declare `proxy` with `external: true`. If a shared `proxy` network already exists, use `external: true` here too instead of having this project manage it. Services on `proxy` can reach file-share directly; attach only trusted services. Avoid duplicate `fileshare` DNS aliases across stacks. Caddy has no startup dependency on file-share so other proxy routes remain independent.

The same application image is available from `docker.io/xmoforf/go-fileshare:latest`.

## Configure

Replace `files.example.com` in both `compose.yaml` and `caddy/Caddyfile` with your hostname. The application still requires the explicit `-origin` CLI argument; no origin environment variable is used.

The application inherits the image's UID `999`, GID `993`. It needs read/search access to served content, read access to credentials, and write access to state. Keep the state bind mount: the image does not initialize named-volume ownership. Create all bind sources before starting; missing sources fail rather than becoming empty directories.

For a **new deployment**, create directories:

```sh
install -d -m 755 caddy fileshare
sudo install -d -o 999 -g 993 -m 750 fileshare/data
sudo install -d -o 999 -g 993 -m 700 fileshare/state
```

Place only intended shared content in `fileshare/data`, readable by UID 999 or GID 993, with search access on directories. Alternatively, change that bind's source to an existing content directory without changing its ownership indiscriminately. Never put credentials, state, or backups under the served root.

Save this as `fileshare/auth.json` with private permissions:

```json
{
  "username": "owner",
  "password_hash": "REPLACE_WITH_BCRYPT_HASH"
}
```

```sh
chmod 600 fileshare/auth.json
docker compose pull
```

Save this as `caddy/Caddyfile`, using the same hostname as `-origin`:

```caddyfile
{
	admin off
	grace_period 35s
}

files.example.com {
	reverse_proxy fileshare:8080
}
```

Generate the password hash:

```sh
docker compose run --rm --no-deps -T fileshare -hash-password
```

Supply the password on stdin, finish with EOF, and replace the placeholder with the generated hash. Input may echo; see [password input rules](configuration.md#owner-account). Choose your username in the same file, then give the container access:

```sh
sudo chown 999:993 fileshare/auth.json
sudo chmod 600 fileshare/auth.json
```

These ownership commands assume rootful Docker without user-namespace remapping. Rootless/remapped Docker requires the corresponding host-mapped IDs; verify access before starting. Keep credentials and state out of version control. Restart/recreate file-share after credential changes; see [operations](operations.md#change-credentials).

Caddy obtains and renews HTTPS certificates and stores certificate data in `caddy_data`; `caddy_config` persists its configuration data. Default Caddy protocols include HTTP/3. Further applications use additional hostname blocks and their service names. For other application settings, see [configuration](configuration.md).

## Start and verify

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

Open `https://files.example.com`, log in, and [create a share](usage.md#share-files-and-folders). Open the link without the owner session, then revoke it. The app healthcheck and `--wait` check local readiness, not Caddy certificate issuance, HTTP/3 reachability, or browser access. Both services restart unless stopped and allow 40 seconds for shutdown.

This minimal stack deliberately omits container hardening and resource-limit blocks. Operators must choose host/firewall policy, container restrictions, resource budgets, bounded log retention, backups, and ingress abuse/concurrency limits for their workload. See [proxy hardening](hardening.md) and [security](../SECURITY.md#deployment-hardening); basic HTTPS alone is not complete public-deployment hardening.

## Existing deployments

Do not apply this layout blindly over an older stack. It changes public port exposure, image selection, identity, network membership, and mount sources. Stop and back up the existing application first; retain its Compose/config files, image identities, credentials, whole state directory, and Caddy certificate storage. Deliberately map existing data/auth/state into the new layout and verify UID 999:GID 993 access. Preserve Caddy's certificate/config data when moving from host directories to named volumes; do not discard old storage. Keep the prior configuration and storage available for rollback. Follow [backup and restore](operations.md#back-up), then verify existing shares and revocations before reopening ingress.

## Next steps

- [Operations](operations.md) — stop, restart, update, back up, and restore.
- [Security](../SECURITY.md#deployment-hardening) — ingress limits and hardening.
- [Source build](source.md) — build the application yourself instead of using a published image.
