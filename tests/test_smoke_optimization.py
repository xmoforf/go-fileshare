import os
from pathlib import Path
import subprocess
import sys
import unittest


# Block effects before invoking real entrypoints, including when guards regress.
RUN_SMOKE = """
from contextlib import ExitStack
import importlib
import runpy
import sys
from unittest.mock import patch

module = importlib.import_module(sys.argv[1])
with ExitStack() as stack:
    stack.enter_context(patch("os.getuid", return_value=1000))
    for target in ("argparse.ArgumentParser.parse_args", "os.umask",
                   "tempfile.mkdtemp", "subprocess.run", "subprocess.Popen",
                   "socket.socket"):
        stack.enter_context(patch(target, side_effect=SystemExit("unexpected effect: " + target)))
    if sys.argv[2] == "direct":
        module.main()
    else:
        runpy.run_path(module.__file__, run_name="__main__")
"""


class SmokeOptimizationTest(unittest.TestCase):
    def test_entrypoints_require_assertions_before_effects(self):
        for module, first_effect in (("compose_smoke", "subprocess.run"),
                                     ("operations_smoke", "argparse.ArgumentParser.parse_args")):
            for invocation in ("direct", "script"):
                for flags, optimize in (([], None), (["-O"], None), (["-OO"], None),
                                        ([], "1"), ([], "2")):
                    with self.subTest(module=module, invocation=invocation,
                                      flags=flags, PYTHONOPTIMIZE=optimize):
                        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
                        for key in ("PYTHONOPTIMIZE", "DOCKER_HOST", "DOCKER_CONTEXT"):
                            env.pop(key, None)
                        if optimize is not None:
                            env["PYTHONOPTIMIZE"] = optimize
                        result = subprocess.run(
                            [sys.executable, *flags, "-c", RUN_SMOKE, module, invocation],
                            cwd=Path(__file__).resolve().parent, env=env,
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
                        expected = "assertions required; do not use python -O"
                        if not flags and optimize is None:
                            expected = "unexpected effect: " + first_effect
                        self.assertEqual(result.returncode, 1, result.stderr)
                        self.assertEqual(result.stdout, "")
                        self.assertEqual(result.stderr, expected + "\n")


if __name__ == "__main__":
    unittest.main()
