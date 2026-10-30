"""Offline contracts for the inline palette, contrast and delivered notices."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UI(HTMLParser):
    def __init__(self):
        super().__init__()
        self.catalog = ""
        self.in_catalog = False
        self.comments = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.in_catalog = dict(attrs).get("id") == "themeCatalog"

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_catalog = False

    def handle_data(self, data):
        if self.in_catalog:
            self.catalog += data

    def handle_comment(self, data):
        self.comments.append(data)


def contrast(a, b):
    def luminance(color):
        rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]
        return sum(v * weight for v, weight in zip(linear, (0.2126, 0.7152, 0.0722)))
    x, y = sorted((luminance(a), luminance(b)))
    return (y + 0.05) / (x + 0.05)


class ThemeTests(unittest.TestCase):
    def setUp(self):
        self.ui = UI()
        self.ui.feed((ROOT / "index.html").read_text())

    def test_inline_catalog_and_contrast(self):
        self.assertTrue(self.ui.catalog, "missing bundled theme catalog")
        themes = json.loads(self.ui.catalog)
        self.assertEqual(set(themes), {
            "light", "catppuccin-mocha", "nord", "rose-pine", "rose-pine-dawn",
        })
        self.assertEqual(contrast("#000000", "#ffffff"), 21)
        self.assertEqual(contrast("#123456", "#123456"), 1)
        names = set()
        for id, theme in themes.items():
            with self.subTest(theme=id):
                self.assertIn(theme["scheme"], ("light", "dark"))
                self.assertNotIn(theme["name"], names)
                names.add(theme["name"])
                self.assertRegex(theme["name"], r"^[A-Za-z ]{1,40}$")
                colors = theme["colors"]
                self.assertEqual(set(colors), {"bg", "bg-raised", "bg-input", "text", "text-dim", "border", "accent", "btn-hover-bg", "success", "error"})
                for value in colors.values():
                    self.assertRegex(value, r"^#[0-9a-f]{6}$")
                # Conservative cross-product covers base, row hover, nested copy hover,
                # dialog/input/placeholder, status, breadcrumb, and focus boundaries.
                for surface in ("bg", "bg-raised", "bg-input", "btn-hover-bg"):
                    for text in ("text", "text-dim", "accent", "success", "error"):
                        self.assertGreaterEqual(contrast(colors[text], colors[surface]), 4.5, (id, text, surface))
                    for cue in ("border", "accent"):
                        self.assertGreaterEqual(contrast(colors[cue], colors[surface]), 3, (id, cue, surface))

    def test_notices_delivered_with_verbatim_source_files(self):
        provenance = ROOT / "licenses/themes/provenance.json"
        self.assertTrue(provenance.exists(), "missing palette provenance")
        inventory = json.loads(provenance.read_text())
        self.assertEqual({theme["id"] for theme in inventory["themes"]}, {
            "catppuccin-mocha", "nord", "rose-pine", "rose-pine-dawn",
        })
        comments = "\n".join(self.ui.comments)
        for source in inventory["sources"]:
            self.assertRegex(source["revision"], r"^[0-9a-f]{40}$")
            for file in source["files"]:
                data = (ROOT / "licenses/themes" / file["path"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), file["sha256"])
                if file["path"].endswith("LICENSE"):
                    notice = '\n'.join(line.rstrip() for line in data.decode().strip().splitlines())
                    self.assertIn(notice, comments)
                    self.assertIn("Permission is hereby granted", data.decode())
        themes = json.loads(self.ui.catalog)
        for theme in inventory["themes"]:
            self.assertEqual(themes[theme["id"]]["name"], theme["name"])
            self.assertTrue(theme["mapping"])


if __name__ == "__main__":
    unittest.main()
