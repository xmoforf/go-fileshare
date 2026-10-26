"""Release packaging contracts; no daemon or compiler required."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseTests(unittest.TestCase):
    def test_release_validation(self):
        script = ROOT / "scripts/release.py"
        self.assertTrue(script.is_file(), "local release packager missing")
        spec = importlib.util.spec_from_file_location("release", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for version in ["v0.1.0", "v1.2.3-rc.1"]:
            self.assertEqual(module.validate_version(version), version)
        for version in ["", "../bad", "1.2.3", "v1.2.3 extra", "v01.2.3", "v1.2.3\n"]:
            with self.assertRaises(ValueError):
                module.validate_version(version)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out"
            module.prepare_output(path)
            (path / "keep").write_text("do not replace")
            with self.assertRaises(FileExistsError):
                module.prepare_output(path)
            self.assertEqual((path / "keep").read_text(), "do not replace")


if __name__ == "__main__":
    unittest.main()
