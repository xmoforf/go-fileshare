# Configuration

The same settings apply to the binary, container, and Nix package. Pass settings as command-line flags; the application does not read a configuration environment file. Compose variables and NixOS options are described in their [installation guides](../README.md#installation).

## Server settings

| Flag | Default | Purpose |
|---|---|---|
| `-listen` | `:8080` | HTTP listen address |
| `-root` | `/data` | Directory to browse and share |
| `-database` | `/state/shares.db` | SQLite database path |
| `-auth` | `/config/auth.json` | Owner credentials file |
| `-origin` | Required | External HTTPS origin, such as `https://files.example.com` |

The origin must match the browser URL exactly, including any nonstandard port, with no path or trailing slash. The application serves HTTP behind an HTTPS proxy; browser login requires HTTPS. Bind to loopback for a host installation or use the container's private network.

```sh
./file-share \
  -listen 127.0.0.1:8080 \
  -root /srv/file-share \
  -database "$PWD/state/shares.db" \
  -auth "$PWD/config/auth.json" \
  -origin https://files.example.com
```

## Files and storage

Keep served content, credentials, database state, and backups in separate locations. The application needs:

| Location | Access |
|---|---|
| Served root | Read files; read/search directories |
| Credentials file | Read |
| State directory | Read/write, including SQLite journal files |

Only regular files and directories are served. Relative symlinks are allowed within the applicable root: the configured tree for owner access, the reopened shared folder for folder tokens, or the reopened parent directory for single-file tokens. Absolute and escaping links are rejected. Saved paths are live references; trusted writers can replace or retarget them, including across restart. See [filesystem boundaries](../SECURITY.md#filesystem-boundaries).

A missing database is initialized automatically, so keep its path stable when updating or restoring an installation.

## Owner account

Credentials are loaded at startup from JSON:

```json
{
  "username": "owner",
  "password_hash": "REPLACE_WITH_BCRYPT_HASH"
}
```

Generate the hash with the installed binary:

```sh
./file-share -hash-password
```

Supply the password on stdin and finish with EOF. One trailing LF or CRLF is removed. Passwords must be 12–72 bytes; the command prints a cost-12 bcrypt hash. Terminal input may echo; use a non-logging input source rather than command arguments. Replace the placeholder with the resulting hash. [Compose](compose.md#configure) shows the container equivalent.

The owner account has a 12-hour session. Restarting the application clears sessions but preserves shared links. See [change credentials](operations.md#change-credentials) to change or recover owner access.

## Utility commands

| Command | Result |
|---|---|
| `file-share -h` | Flags and defaults |
| `file-share -version` | Version and source revision; ordinary source/Nix builds report `dev (unknown)` |
| `file-share -hash-password` | Bcrypt hash of the password supplied on stdin |
| `file-share -healthcheck` | Exit 0 if `http://127.0.0.1:8080/healthz` returns 200; otherwise exit 1 |

For another listen port, query `/healthz` directly. Readiness checks database access, not HTTPS or owner login.
