import inspect
import os
import tempfile
import unittest
from unittest.mock import patch

import compose_smoke


class DockerTargetTest(unittest.TestCase):
    def test_prebuilt_image_is_inspected_not_built(self):
        self.assertIn("image", inspect.signature(compose_smoke.main).parameters)
        commands = []
        def command(*args, **kwargs):
            commands.append(args)
            if args[1:3] == ("context", "inspect"):
                return "unix:///var/run/docker.sock"
            if args[-2:] == ("config", "--format"):
                raise AssertionError("unexpected format")
            if args[-3:] == ("config", "--format", "json"):
                return '{"services":{"fileshare":{},"caddy":{"ports":[]}}}'
            if "-hash-password" in args:
                raise RuntimeError("stop before starting containers")
            return ""
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, {}, clear=True), \
                patch.object(os, "getuid", return_value=1000), \
                patch.object(compose_smoke.tempfile, "mkdtemp", return_value=tmp), \
                patch.object(compose_smoke, "run", side_effect=command):
            with self.assertRaisesRegex(RuntimeError, "stop before"):
                compose_smoke.main("release:tested")
        self.assertIn(("docker", "image", "inspect", "release:tested"), commands)
        self.assertFalse(any("build" in args for args in commands))

    def test_ambiguous_docker_target_fails_before_commands(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "unix:///var/run/docker.sock",
                                     "DOCKER_CONTEXT": "remote"}), \
                patch.object(os, "getuid", return_value=1000), \
                patch.object(compose_smoke, "run", side_effect=RuntimeError("unexpected command")):
            with self.assertRaisesRegex(AssertionError, "set only one"):
                compose_smoke.main()


if __name__ == "__main__":
    unittest.main()
