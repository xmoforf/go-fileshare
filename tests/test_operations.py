"""Check the published restore recipe without touching any host paths."""
from pathlib import Path
import re
import subprocess
import unittest


class RestoreRecipeTest(unittest.TestCase):
    def test_promotion_requires_complete_verified_copy(self):
        text = (Path(__file__).resolve().parents[1] / "docs/operations.md").read_text()
        blocks = [block for block in re.findall(r"```sh\n(.*?)```", text, re.S)
                  if "sudo mv -T /var/lib/file-share" in block]
        self.assertEqual(len(blocks), 1)
        stub = r'''
sudo() {
    if [ "$1" = "$FAIL_COMMAND" ]; then return 1; fi
    case "$1" in
        cp|diff) return 0 ;;
        test)
            shift
            case "$1" in
                '!'|-f) return 0 ;;  # Simulate a present, possibly partial shares.db.
                *) builtin test "$@" ;;
            esac ;;
        stat)
            case "$4" in
                */shares.db) printf '%s\n' '600 file-share:file-share' ;;
                *) printf '%s\n' '700 file-share:file-share' ;;
            esac ;;
        mv) printf '%s\n' MOVE ;;
        *) return 99 ;;
    esac
}
'''
        for failure in ("cp", "diff", "stat", "none"):
            with self.subTest(failure=failure):
                result = subprocess.run(["/bin/bash", "-c", stub + blocks[0]],
                                        env={"PATH": "/nonexistent", "FAIL_COMMAND": failure},
                                        text=True, capture_output=True, timeout=5)
                self.assertEqual(result.stderr, "")
                if failure == "none":
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(result.stdout.splitlines(), ["MOVE", "MOVE"])
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn("MOVE", result.stdout)


if __name__ == "__main__":
    unittest.main()
