"""Release packaging contracts; no daemon or compiler required."""
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class ReleaseTests(unittest.TestCase):
    def test_release_validation(self):
        script = ROOT / "scripts/release.py"
        self.assertTrue(script.is_file(), "local release packager missing")
        spec = importlib.util.spec_from_file_location("release", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for version in ["v0.1.0", "v1.2.3-rc.1", "v1.2.3-0", "v1.2.3-" + "a" * 116]:
            self.assertEqual(module.validate_version(version), version)
        for version in ["", "../bad", "1.2.3", "v1.2.3 extra", "v01.2.3", "v1.2.3\n",
                        "v1.2.3-01", "v1.2.3-a..b", "v1.2.3-rc.", "v1.2.3+build",
                        "v1.2.3-" + "a" * 117]:
            with self.subTest(version=version, check="validator"), self.assertRaises(ValueError):
                module.validate_version(version)
            with self.subTest(version=version, check="cli"), \
                    patch.object(sys, "argv", [str(script), version, "unused-output"]), \
                    patch.object(sys, "stderr", io.StringIO()), \
                    patch.object(module, "run", side_effect=AssertionError("validation must precede commands")) as run, \
                    patch.object(module, "prepare_output") as prepare:
                with self.assertRaises(SystemExit) as stopped:
                    module.main()
                self.assertEqual(stopped.exception.code, 2)
                run.assert_not_called()
                prepare.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out"
            module.prepare_output(path)
            (path / "keep").write_text("do not replace")
            with self.assertRaises(FileExistsError):
                module.prepare_output(path)
            self.assertEqual((path / "keep").read_text(), "do not replace")


if __name__ == "__main__":
    unittest.main()
