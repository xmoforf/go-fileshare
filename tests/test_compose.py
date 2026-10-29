"""Public Compose contracts; config rendering never contacts the Docker daemon."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ComposeDocsTest(unittest.TestCase):
    def test_install_guide_matches_shipped_configs(self):
        guide = (ROOT / "docs/compose.md").read_text()
        self.assertEqual(re.findall(r"```yaml\n(.*?)```", guide, re.S),
                         [(ROOT / "compose.yaml").read_text()])
        self.assertTrue((ROOT / "caddy/Caddyfile").is_file())
        self.assertEqual(re.findall(r"```caddyfile\n(.*?)```", guide, re.S),
                         [(ROOT / "caddy/Caddyfile").read_text()])
        self.assertIn("docker compose up -d --wait", guide)

    def test_obsolete_setup_removed(self):
        self.assertFalse((ROOT / "compose.env.example").exists())
        self.assertFalse((ROOT / "Caddyfile").exists())
        for path in (ROOT / "docs").glob("*.md"):
            with self.subTest(path=path.name):
                self.assertNotIn("compose.env.example", path.read_text())
                self.assertNotIn("docker compose build fileshare", path.read_text())

    def test_runtime_paths_ignored(self):
        paths = ["fileshare/auth.json", "fileshare/state/shares.db-journal",
                 "fileshare/data/private.txt"]
        result = subprocess.run(["git", "check-ignore", "--stdin"], cwd=ROOT,
                                input="\n".join(paths) + "\n", text=True,
                                capture_output=True, check=False)
        self.assertEqual(result.stdout.splitlines(), paths)


class ComposeRenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("docker"):
            raise unittest.SkipTest("Docker Compose CLI required (no daemon needed)")
        version = subprocess.run(["docker", "compose", "version"],
                                 capture_output=True, check=False)
        if version.returncode:
            raise unittest.SkipTest("Docker Compose CLI unavailable")

    def test_public_stack_contract(self):
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("COMPOSE_", "FILE_SHARE_", "CADDY_"))}
        result = subprocess.run(
            ["docker", "compose", "--env-file", "/dev/null", "--project-name",
             "contract", "-f", str(ROOT / "compose.yaml"), "config", "--format", "json"],
            cwd=ROOT, env=env, text=True, capture_output=True, check=False, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        services = config["services"]
        self.assertEqual(set(services), {"caddy", "fileshare"})
        app, caddy = services["fileshare"], services["caddy"]
        self.assertEqual(app["image"], "ghcr.io/xmoforf/go-fileshare:latest")
        self.assertEqual(caddy["image"], "caddy:2")
        self.assertEqual(app["command"], ["-origin", "https://files.example.com"])
        self.assertIn("USER 999:993", (ROOT / "Dockerfile").read_text())
        for name, service in services.items():
            with self.subTest(service=name):
                self.assertEqual(service["restart"], "unless-stopped")
                self.assertEqual(service["stop_grace_period"], "40s")
                for key in ("build", "user", "depends_on", "environment", "read_only",
                            "cap_drop", "cap_add", "security_opt", "mem_limit", "cpus",
                            "pids_limit", "ulimits", "deploy"):
                    self.assertNotIn(key, service)
        self.assertEqual(app["healthcheck"], {
            "test": ["CMD", "/file-share", "-healthcheck"], "interval": "5s",
            "timeout": "4s", "retries": 6, "start_period": "5s"})
        self.assertNotIn("ports", app)
        self.assertCountEqual(
            [(port.get("host_ip", "0.0.0.0"), port["published"], port["target"],
              port["protocol"]) for port in caddy["ports"]],
            [("0.0.0.0", "80", 80, "tcp"), ("0.0.0.0", "443", 443, "tcp"),
             ("0.0.0.0", "443", 443, "udp")])
        self.assertEqual(set(caddy["networks"]), {"proxy"})
        self.assertEqual(set(app["networks"]), {"proxy", "fileserver"})
        self.assertEqual(config["networks"]["proxy"]["name"], "proxy")
        self.assertEqual(config["networks"]["fileserver"]["name"], "contract_fileserver")
        self.assertEqual(set(config["volumes"]), {"caddy_data", "caddy_config"})
        for name, expected in {
            "fileshare": [("bind", str(ROOT / "fileshare/data"), "/data", True),
                          ("bind", str(ROOT / "fileshare/auth.json"), "/config/auth.json", True),
                          ("bind", str(ROOT / "fileshare/state"), "/state", False)],
            "caddy": [("bind", str(ROOT / "caddy/Caddyfile"), "/etc/caddy/Caddyfile", True),
                      ("volume", "caddy_data", "/data", False),
                      ("volume", "caddy_config", "/config", False)],
        }.items():
            with self.subTest(mounts=name):
                mounts = services[name]["volumes"]
                self.assertCountEqual(
                    [(v["type"], v["source"], v["target"], v.get("read_only", False))
                     for v in mounts], expected)
                for mount in mounts:
                    if mount["type"] == "bind":
                        self.assertFalse(mount.get("bind", {}).get("create_host_path", False))
        caddyfile = (ROOT / "caddy/Caddyfile").read_text()
        self.assertIn("files.example.com {", caddyfile)
        self.assertIn("reverse_proxy fileshare:8080", caddyfile)
        self.assertNotIn("protocols", caddyfile)
        self.assertNotIn("{$", caddyfile)


if __name__ == "__main__":
    unittest.main()
