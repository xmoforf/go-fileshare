"""Static install contract; actual sandbox/lifecycle needs a disposable systemd host."""
import configparser
from pathlib import Path
import shlex
import unittest


class SystemdContract(unittest.TestCase):
    def test_service_contract(self):
        path = Path(__file__).resolve().parents[1] / "dist/file-share.service"
        self.assertTrue(path.is_file(), "systemd service missing")
        unit = configparser.ConfigParser(interpolation=None)
        unit.read(path)
        service = unit["Service"]
        args = shlex.split(service["ExecStart"].replace("\\\n", ""))
        self.assertEqual(args[0], "/usr/local/bin/file-share")
        self.assertEqual(dict(zip(args[1::2], args[2::2])), {
            "-listen": "127.0.0.1:8080", "-root": "/srv/file-share",
            "-database": "/var/lib/file-share/shares.db",
            "-auth": "/etc/file-share/auth.json", "-origin": "https://files.example.com",
        })
        for key, value in {
            "User": "file-share", "Group": "file-share", "UMask": "0077",
            "StateDirectory": "file-share", "StateDirectoryMode": "0700",
            "ProtectSystem": "strict", "ProtectHome": "true",
            "PrivateTmp": "true", "PrivateDevices": "true",
            "NoNewPrivileges": "true", "CapabilityBoundingSet": "",
            "ReadOnlyPaths": "/srv/file-share /etc/file-share",
            "Restart": "on-failure",
        }.items():
            self.assertEqual(service[key], value, key)
        # systemd 257 implements this filter by rejecting mandatory openat2 with ENOSYS.
        self.assertNotEqual(service.get("RestrictSUIDSGID", "false"), "true")
        self.assertGreater(int(service["TimeoutStopSec"]), 30)
        self.assertEqual(unit["Install"]["WantedBy"], "multi-user.target")


if __name__ == "__main__":
    unittest.main()
