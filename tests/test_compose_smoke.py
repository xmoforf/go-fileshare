import os
import unittest
from unittest.mock import patch

import compose_smoke


class DockerTargetTest(unittest.TestCase):
    def test_ambiguous_docker_target_fails_before_commands(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "unix:///var/run/docker.sock",
                                     "DOCKER_CONTEXT": "remote"}), \
                patch.object(os, "getuid", return_value=1000), \
                patch.object(compose_smoke, "run", side_effect=RuntimeError("unexpected command")):
            with self.assertRaisesRegex(AssertionError, "set only one"):
                compose_smoke.main()


if __name__ == "__main__":
    unittest.main()
