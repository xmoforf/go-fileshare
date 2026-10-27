#!/usr/bin/env python3
"""Rehearse stopped-state operations with synthetic loopback-only subprocesses.

No TLS/browser/service-manager claim. Retains private fixtures, never logs secrets.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import stat
import subprocess
import tempfile
import time


def main():
    if not __debug__:
        raise SystemExit("assertions required; do not use python -O")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--candidate", type=Path, help="defaults to the same binary; no cross-version claim")
    args = parser.parse_args()
    baseline = args.binary.resolve(strict=True)
    candidate = (args.candidate or args.binary).resolve(strict=True)
    assert os.getuid() != 0, "run as non-root"
    os.umask(0o077)
    fixture = Path(tempfile.mkdtemp(prefix="go-fileshare-operations-"))
    print(f"Private synthetic fixture retained: {fixture}", flush=True)
    for name in ("data", "config", "state", "backup"):
        (fixture / name).mkdir(mode=0o700)
    payload = b"synthetic operator rehearsal\n"
    (fixture / "data/example.txt").write_bytes(payload)
    executable = fixture / "file-share"
    shutil.copy2(baseline, executable)
    passwords = [secrets.token_urlsafe(24), secrets.token_urlsafe(24)]
    sensitive = list(passwords)
    auth = fixture / "config/auth.json"
    process = None
    cookie = ""
    log_path = fixture / "server.log"
    origin = "https://operations.invalid"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    def credentials(password):
        result = subprocess.run([str(executable), "-hash-password"], input=password + "\n",
                                text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, "password hashing failed"
        hashed = result.stdout.strip()
        sensitive.append(hashed)
        staged = auth.with_suffix(".new")
        staged.write_text(json.dumps({"username": "rehearsal-owner", "password_hash": hashed}))
        staged.chmod(0o600)
        staged.replace(auth)

    def request(path, expected=200, body=None, method=None, owner=False):
        headers = {"Origin": origin, "X-Requested-With": "file-share"}
        if owner and cookie:
            headers["Cookie"] = cookie
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            connection.request(method or ("POST" if body is not None else "GET"), path,
                               body=None if body is None else json.dumps(body), headers=headers)
            response = connection.getresponse()
            data = response.read()
            assert response.status == expected, "unexpected HTTP status (URL/body suppressed)"
            return data, response.getheader("Set-Cookie", "")
        finally:
            connection.close()

    def login(password, expected=200):
        nonlocal cookie
        _, header = request("/api/login", expected,
                            {"username": "rehearsal-owner", "password": password})
        if expected == 200:
            assert all(flag in header for flag in ("Secure", "HttpOnly", "SameSite=Strict"))
            # Deliberate test-only replay over loopback; not browser/TLS evidence.
            cookie = header.split(";", 1)[0]
            sensitive.append(cookie.split("=", 1)[1])

    def start():
        nonlocal process
        assert process is None, "previous process still tracked"
        with log_path.open("ab") as log:
            process = subprocess.Popen([str(executable), "-listen", f"127.0.0.1:{port}",
                                        "-origin", origin, "-root", str(fixture / "data"),
                                        "-auth", str(auth), "-database", str(fixture / "state/shares.db")],
                                       stdout=log, stderr=log)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            assert process.poll() is None, "server exited; private log retained"
            try:
                request("/healthz")
                return
            except OSError:
                time.sleep(0.05)
        raise AssertionError("readiness deadline exceeded")

    def stop():
        nonlocal process
        if process is not None:
            if process.poll() is None:
                process.terminate()
            assert process.wait(timeout=40) == 0, "server stop failed"
            process = None

    def share(seconds=0, path="example.txt"):
        data, _ = request("/api/shares", 201, {"path": path, "seconds": seconds}, owner=True)
        token = json.loads(data)["token"]
        sensitive.append(token)
        return token

    def download(token, expected=200):
        data, _ = request(f"/s/{token}/example.txt", expected)
        if expected == 200:
            assert data == payload, "content changed"

    def revoke(token):
        request(f"/api/shares?token={token}", 204, method="DELETE", owner=True)
        download(token, 404)

    def inventory():
        data, _ = request("/api/shares", owner=True)
        return json.loads(data)

    def copy_state(source, destination):
        assert process is None, "copy only stopped state"
        shutil.copytree(source, destination, copy_function=shutil.copy2)
        assert (source / "shares.db").read_bytes() == (destination / "shares.db").read_bytes()
        for item in source.rglob("*"):
            copied = destination / item.relative_to(source)
            assert stat.S_IMODE(item.stat().st_mode) == stat.S_IMODE(copied.stat().st_mode)
            assert item.stat().st_uid == copied.stat().st_uid
            if item.is_file():
                assert item.read_bytes() == copied.read_bytes(), "backup differs"

    try:
        credentials(passwords[0])
        start()
        request("/api/list", 401)
        login(passwords[0])
        data, _ = request("/api/list", owner=True)
        assert b"example.txt" in data
        active, revoked = share(), share()
        finite, expired = share(3600, "."), share(1)
        time.sleep(1.1)  # Expiry uses whole Unix seconds; wait past the one-second lifetime.
        download(finite)
        download(expired, 404)
        download(active)
        revoke(revoked)
        expected_inventory = inventory()
        stop()
        copy_state(fixture / "state", fixture / "backup/state")
        shutil.copytree(fixture / "config", fixture / "backup/config")
        shutil.copy2(executable, fixture / "backup/file-share")
        print("PASS setup/share/revoke and whole stopped backup", flush=True)

        start()
        request("/api/shares", 401, owner=True)
        login(passwords[0])
        assert inventory() == expected_inventory
        download(active)
        download(revoked, 404)
        revoke(active)  # This revocation deliberately occurs after the backup.
        stop()
        credentials(passwords[1])
        start()
        request("/api/shares", 401, owner=True)
        login(passwords[0], 401)
        login(passwords[1])
        download(active, 404)
        survivor = share()
        download(survivor)
        stop()
        # Rotate again to prove an existing active share is independent of credentials.
        credentials(passwords[0])
        start()
        request("/api/shares", 401, owner=True)
        login(passwords[1], 401)
        login(passwords[0])
        download(survivor)
        stop()
        print("PASS rotation rejects old login/session; shares remain independent", flush=True)

        copy_state(fixture / "backup/state", fixture / "state.restore")
        (fixture / "state").rename(fixture / "state.before-restore")
        (fixture / "state.restore").rename(fixture / "state")
        start()
        login(passwords[0])
        assert inventory() == expected_inventory
        download(active)  # Known resurrection is contained on loopback.
        download(finite)
        download(expired, 404)
        download(revoked, 404)
        download(survivor, 404)  # Post-backup shares disappear on restore.
        revoke(active)  # Reapply revocations before any hypothetical reopening.
        restored_inventory = inventory()
        stop()
        start()
        login(passwords[0])
        assert inventory() == restored_inventory
        download(active, 404)
        download(revoked, 404)
        upgrade_share = share()
        expected_inventory = inventory()
        stop()
        print("PASS restore exposes known resurrection/lost newer share; re-revocation persists", flush=True)

        for source, label in ((candidate, "candidate"), (fixture / "backup/file-share", "rollback")):
            copy_state(fixture / "state", fixture / f"state.before-{label}")
            staged = fixture / "file-share.new"
            shutil.copy2(source, staged)
            staged.replace(executable)
            for _ in range(2):
                start()
                request("/api/shares", 401, owner=True)
                login(passwords[0])
                assert inventory() == expected_inventory, "update changed inventory"
                download(upgrade_share)
                download(finite)
                download(expired, 404)
                download(active, 404)
                download(revoked, 404)
                stop()
            digest = hashlib.sha256(executable.read_bytes()).hexdigest()
            print(f"PASS {label} replacement/restart: sha256 {digest}", flush=True)

        logs = log_path.read_text()
        assert all(value not in logs for value in sensitive), "sensitive value found in private server log"
        for path in (fixture, fixture / "state", fixture / "backup", auth, fixture / "state/shares.db"):
            assert stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "fixture permissions too broad"
        print("PASS private permissions and no credentials/tokens in server log", flush=True)
    finally:
        stop()


if __name__ == "__main__":
    main()
