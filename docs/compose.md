# Install with Docker Compose

Run the published application image behind Caddy. This example uses the common shared-proxy layout: Caddy joins `proxy`; file-share joins `proxy` and `fileserver`. Other applications can join `proxy` and receive their own Caddy routes.

## Requirements

- Linux 5.6+ with working `openat2`, Docker Engine, and Docker Compose V2 or newer.
- A hostname pointing to the host, with ports 80 and 443 available for Caddy.
- A directory of files to serve.

The image supports Linux amd64 and arm64. This guide uses the published `1.0.3` image; select a release deliberately when updating.

## Install

Create a new deployment directory. Save the following as `compose.yaml` there; this is a standalone example, not the source-building stack at the repository root.

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    stop_grace_period: 40s
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [proxy]

  fileshare:
    image: ghcr.io/xmoforf/go-fileshare:1.0.3
    user: "1000:1000"
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
      - /srv/shared-files:/data:ro
      - ./config/auth.json:/config/auth.json:ro
      - ./state:/state
    networks: [proxy, fileserver]

networks:
  proxy:
    name: proxy
  fileserver:

volumes:
  caddy_data:
  caddy_config:
```

Only Caddy publishes host ports. `fileserver` is project-scoped; `proxy` has a stable name so other stacks can join it. In those stacks declare `proxy` with `external: true`. If a shared `proxy` network already exists, use `external: true` here too instead of having this project manage it. Services on `proxy` can communicate directly.

The same application image is available from `docker.io/xmoforf/go-fileshare:1.0.3`. For an immutable deployment, replace the version tag with a verified registry digest. See [release tags](releases.md#release-tags).

## Configure

Replace `/srv/shared-files`, `1000:1000`, and `files.example.com` with your content path, host UID/GID, and hostname. `id -u` and `id -g` show your current identity. The selected identity needs read/search access to content, read access to credentials, and write access to state.

Create the directories as that identity:

```sh
install -d -m 700 config state
```

Save this as `config/auth.json` and set mode 600:

```json
{
  "username": "owner",
  "password_hash": "REPLACE_WITH_BCRYPT_HASH"
}
```

```sh
chmod 600 config/auth.json
docker compose pull
docker compose run --rm --no-deps -T fileshare -hash-password
```

Supply the password on stdin, finish with EOF, and replace the placeholder with the generated hash. Input may echo; see [password input rules](configuration.md#owner-account). Choose your username in the same file.

Save this as `Caddyfile`, using the same hostname as `-origin`:

```caddyfile
files.example.com {
    reverse_proxy fileshare:8080
}
```

Caddy obtains and renews its HTTPS certificate and stores certificate data in `caddy_data`. Further applications use additional hostname blocks and their service names. For other application settings, see [configuration](configuration.md).

## Start and verify

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

Open `https://files.example.com`, log in, and [create a share](usage.md#share-files-and-folders). Open the link without the owner session, then revoke it. Container health alone does not check certificate issuance or browser access.

## Next steps

- [Operations](operations.md) — stop, restart, update, back up, and restore.
- [Security](../SECURITY.md#deployment-hardening) — ingress limits and hardening.
- [Source build](source.md) — build the application yourself instead of using a published image.

The repository-root Compose stack is a separate source-build reference. It uses `compose.env.example`, `FILE_SHARE_*` mount/identity/origin variables, loopback-bound Caddy ports, and explicit resource controls. Do not mix its environment-file instructions with this standalone example.
