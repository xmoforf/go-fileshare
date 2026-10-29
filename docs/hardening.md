# Proxy hardening

The [Compose guide](compose.md) provides basic Caddy HTTPS routing. This guide covers additional ingress behavior for public deployments; choose limits for your workload rather than treating example values as capacity guarantees.

## Proxy requirements

Preserve Host, Origin, cookies, `X-Requested-With`, paths, and query strings. Support HEAD, range, and conditional requests. Stream without full-response buffering, preserve no-store/no-referrer, and avoid caching authenticated or shared content.

Configure aggregate active-request and connection limits, including HTTP/2 streams, bounded queues, per-client abuse controls, and response write-idle/progress limits. Verify stalled readers, long progressing downloads, Range/HEAD, and disconnect propagation against the actual proxy. Keep a private owner-access route if public login budgets can be exhausted.

When another proxy sits in front, trust forwarded client addresses only from explicitly configured proxy addresses. The application itself ignores forwarded client-IP headers. See [application limits](../SECURITY.md#application-limits).

## Optional Caddy request-rate limits

Stock Caddy does not include a rate-limit directive. The third-party [mholt/caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) module supplies request-rate limits; its v0.1.0 documentation labels it work in progress. This recipe limits arrivals, not concurrent downloads or stalled readers.

Save `Dockerfile.caddy` beside the Compose file:

```dockerfile
FROM public.ecr.aws/docker/library/caddy:2.11.7-builder-alpine@sha256:d718a1d1431403c4a46698f33ad1c0f9dd5dd7fe2bae654d1027d275b6fb5fd7 AS builder
RUN xcaddy build v2.11.7 \
    --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM public.ecr.aws/docker/library/caddy:2.11.7-alpine@sha256:24ec7b05bc532c7bb57f727030c5056e257ff7138b4b50460306819ff79362bd
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Save `compose.ratelimit.yaml`:

```yaml
services:
  caddy:
    image: go-fileshare-caddy:2.11.7-ratelimit-0.1.0
    build:
      context: .
      dockerfile: Dockerfile.caddy
```

Replace the hostname block in `caddy/Caddyfile` with:

```caddyfile
files.example.com {
    route {
        rate_limit {
            zone public_standard {
                key {remote_host}
                events 100
                window 4s
            }
        }
        @login path /api/login
        rate_limit @login {
            zone login_limit {
                key {remote_host}
                events 5
                window 1m
            }
        }
        reverse_proxy fileshare:8080
    }
}
```

Replace the hostname with yours. Each directly connected IP gets 100 requests per four seconds overall and five login requests per minute. Excess requests receive 429 with Retry-After. Shared NAT clients share a budget; every range request counts. The application's global login budget still applies. Limiter state grows with distinct clients.

Build and validate without starting the serving stack:

```sh
docker compose -f compose.yaml -f compose.ratelimit.yaml config --quiet
docker compose -f compose.yaml -f compose.ratelimit.yaml build caddy
docker compose -f compose.yaml -f compose.ratelimit.yaml run --rm --no-deps -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Use both `-f` arguments for later Compose operations. Retain previous image/configuration for rollback and refresh the pinned Caddy/module versions deliberately. Request-rate controls supplement, rather than replace, the concurrency and stalled-reader limits above.
