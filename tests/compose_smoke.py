#!/usr/bin/env python3
"""Disposable Compose HTTPS contract check; retains stopped resources for inspection."""
import concurrent.futures
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout


def main():
    if not __debug__:
        raise SystemExit("assertions required; do not use python -O")
    assert (ROOT / "compose.yaml").is_file(), "missing supported compose.yaml"
    assert os.getuid() != 0, "run as non-root with local Docker access"
    assert not (os.environ.get("DOCKER_HOST") and os.environ.get("DOCKER_CONTEXT")), \
        "set only one of DOCKER_HOST and DOCKER_CONTEXT"
    endpoint = os.environ.get("DOCKER_HOST") or run(
        "docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").strip()
    assert endpoint.startswith("unix://"), "smoke requires a local Unix-socket Docker daemon"
    # Pin validated target for all child commands, regardless of current-context changes.
    os.environ.pop("DOCKER_CONTEXT", None)
    os.environ["DOCKER_HOST"] = endpoint
    fixture = Path(tempfile.mkdtemp(prefix="go-fileshare-compose-"))
    project = "fileshare-smoke-" + secrets.token_hex(5)
    print(f"Fixture: {fixture}; Compose project: {project}", flush=True)
    for name in ("data", "config", "state", "caddy-data", "caddy-config"):
        (fixture / name).mkdir(mode=0o700)
    payload = b"synthetic file-share fixture\n"
    (fixture / "data/example.txt").write_bytes(payload)
    with (fixture / "data/large.bin").open("wb") as f:
        f.truncate(16 * 1024 * 1024)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"https://localhost:{port}"
    image = project + ":local"
    env = dict(os.environ, FILE_SHARE_IMAGE=image, FILE_SHARE_ORIGIN=origin,
               FILE_SHARE_SITE="https://localhost", FILE_SHARE_BIND="127.0.0.1",
               FILE_SHARE_HTTPS_PORT=str(port), FILE_SHARE_HTTP_PORT="0",
               FILE_SHARE_UID=str(os.getuid()), FILE_SHARE_GID=str(os.getgid()),
               FILE_SHARE_DATA=str(fixture / "data"), FILE_SHARE_AUTH=str(fixture / "config/auth.json"),
               FILE_SHARE_STATE=str(fixture / "state"), CADDY_DATA=str(fixture / "caddy-data"),
               CADDY_CONFIG=str(fixture / "caddy-config"))
    # Local CA only; production Caddyfile uses public ACME certificates.
    override = fixture / "override.json"
    override.write_text(json.dumps({"services": {"caddy": {"environment": {"FILE_SHARE_TLS": "tls internal"}}}}))
    command = ["docker", "compose", "--project-name", project, "--env-file", "/dev/null",
               "-f", str(ROOT / "compose.yaml"), "-f", str(override)]

    def compose(*args):
        return run(*command, *args, env=env)

    compose("config", "--quiet")
    config = json.loads(compose("config", "--format", "json"))
    assert not config["services"]["fileshare"].get("ports"), "raw HTTP published"
    assert all(p["host_ip"] == "127.0.0.1" for p in config["services"]["caddy"]["ports"])
    print("Building application image", flush=True)
    compose("build", "fileshare")
    password = secrets.token_urlsafe(24)
    hashed = run("docker", "run", "--rm", "--network", "none", "-i", image,
                 "-hash-password", input=password + "\n").strip()
    auth = fixture / "config/auth.json"
    auth.write_text(json.dumps({"username": "smoke-owner", "password_hash": hashed}))
    auth.chmod(0o600)
    try:
        compose("up", "-d", "--wait", "--wait-timeout", "60")
        ca = fixture / "caddy-data/caddy/pki/authorities/local/root.crt"
        deadline = time.monotonic() + 30
        while not ca.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        context = ssl.create_default_context(cafile=str(ca))
        jar = http.cookiejar.CookieJar()
        owner = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                           urllib.request.HTTPSHandler(context=context),
                                           urllib.request.HTTPCookieProcessor(jar))
        recipient = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                               urllib.request.HTTPSHandler(context=context))

        def request(path, data=None, method=None, client=owner, headers=None):
            h = {"Origin": origin, "X-Requested-With": "file-share"}
            h.update(headers or {})
            body = None if data is None else json.dumps(data).encode()
            if body is not None:
                h["Content-Type"] = "application/json"
            req = urllib.request.Request(origin + path, data=body, method=method, headers=h)
            try:
                return client.open(req, timeout=40)
            except urllib.error.HTTPError as error:
                return error

        for _ in range(100):
            try:
                with request("/healthz", client=recipient) as r:
                    if r.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.1)
        else:
            raise AssertionError("HTTPS readiness failed")
        with request("/", client=recipient) as r:
            assert r.status == 200 and b"<!DOCTYPE html>" in r.read()
        with request("/api/list", client=recipient) as r:
            assert r.status == 401
        with request("/api/login", {"username": "smoke-owner", "password": password},
                     headers={"Origin": "https://wrong.example"}) as r:
            assert r.status == 403
        with request("/api/login", {"username": "smoke-owner", "password": password}) as r:
            assert r.status == 200
            cookie = r.headers["Set-Cookie"]
            assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Strict"))
        with request("/api/list") as r:
            assert r.status == 200 and b"example.txt" in r.read()
        with request("/api/shares", {"path": "", "seconds": 3600}) as r:
            assert r.status == 201
            token = json.load(r)["token"]
        with request(f"/api/list?token={token}", client=recipient) as r:
            assert r.status == 200 and b"example.txt" in r.read()
        share = f"/s/{token}/example.txt"
        with request(share, client=recipient) as r:
            assert r.status == 200 and r.read() == payload
        with request(share, client=recipient, headers={"Range": "bytes=0-8"}) as r:
            assert r.status == 206 and r.read() == payload[:9]
        with request(share, client=recipient, method="HEAD") as r:
            assert r.status == 200 and int(r.headers["Content-Length"]) == len(payload)
        for service in ("fileshare", "caddy"):
            cid = compose("ps", "-q", service).strip()
            info = json.loads(run("docker", "inspect", cid))[0]
            assert info["Config"]["User"] == f"{os.getuid()}:{os.getgid()}"
            assert info["HostConfig"]["ReadonlyRootfs"]
            assert "no-new-privileges:true" in info["HostConfig"]["SecurityOpt"]
            if service == "fileshare":
                mounts = {m["Destination"]: m for m in info["Mounts"]}
                assert not mounts["/data"]["RW"] and not mounts["/config/auth.json"]["RW"]
                assert mounts["/state"]["RW"]
                assert not info["HostConfig"]["PortBindings"]
                probe = subprocess.run(["docker", "exec", cid, "/file-share", "-origin", origin,
                                        "-database", "/data/write-probe.db"], capture_output=True)
                assert probe.returncode != 0 and b"startup failed" in probe.stderr
                assert not (fixture / "data/write-probe.db").exists()
        assert (fixture / "state/shares.db").stat().st_uid == os.getuid()
        cid = compose("ps", "-q", "fileshare").strip()
        # Pause reading until the app closes its listener but is still draining.
        with request(f"/s/{token}/large.bin", client=recipient) as response:
            first = response.read(65536)
            with concurrent.futures.ThreadPoolExecutor() as pool:
                stopped = pool.submit(compose, "stop", "fileshare")
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    health = subprocess.run(["docker", "exec", cid, "/file-share", "-healthcheck"],
                                            capture_output=True)
                    if health.returncode != 0:
                        break
                    time.sleep(0.05)
                else:
                    raise AssertionError("SIGTERM did not close app listener")
                assert run("docker", "inspect", "--format", "{{.State.Running}}", cid).strip() == "true", \
                    "app exited before active download drained"
                total = len(first)
                while chunk := response.read(65536):
                    total += len(chunk)
                    time.sleep(0.002)
                stopped.result(timeout=40)
            assert total == 16 * 1024 * 1024
        cid = compose("ps", "-aq", "fileshare").strip()
        state = json.loads(run("docker", "inspect", "--format", "{{json .State}}", cid))
        assert state["ExitCode"] == 0 and not state["OOMKilled"]
        compose("up", "-d", "--wait", "fileshare")
        with request(share, client=recipient) as r:
            assert r.status == 200 and r.read() == payload
        with request("/api/shares") as r:
            assert r.status == 401, "owner session survived restart"
        with request("/api/login", {"username": "smoke-owner", "password": password}) as r:
            assert r.status == 200
        with request(f"/api/shares?token={token}", method="DELETE") as r:
            assert r.status == 204
        compose("restart", "fileshare")
        compose("up", "-d", "--wait", "fileshare")
        with request(share, client=recipient) as r:
            assert r.status == 404
        print("PASS: verified TLS, owner/recipient, Origin, range/HEAD, permissions, persistence, revocation, shutdown")
    finally:
        compose("stop")
        print(f"Stopped resources retained: {project}; synthetic state/CA: {fixture}", flush=True)


if __name__ == "__main__":
    main()
