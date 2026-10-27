"""Container tag policy and fail-closed registry preflight; no registry writes."""
import importlib.util
import io
import inspect
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class ImageReleaseTests(unittest.TestCase):
    def module(self):
        path = ROOT / "scripts/image_release.py"
        self.assertTrue(path.is_file(), "container release helper missing")
        spec = importlib.util.spec_from_file_location("image_release", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_stable_tags(self):
        module = self.module()
        self.assertEqual(module.release_tags("v1.0.0", []), ["1.0.0", "1.0", "1", "latest"])
        self.assertEqual(module.release_tags("v1.2.3", ["1.1.9", "1.2.2"]),
                         ["1.2.3", "1.2", "1", "latest"])

    def test_old_release_does_not_move_newer_aliases(self):
        module = self.module()
        self.assertEqual(module.release_tags("v1.0.1", ["1.1.0", "2.0.0"]), ["1.0.1", "1.0"])
        self.assertEqual(module.release_tags("v1.0.1", ["1.0.2"]), ["1.0.1"])
        self.assertEqual(module.release_tags("v1.1.0", ["2.0.0"]), ["1.1.0", "1.1", "1"])

    def test_prerelease_never_moves_aliases(self):
        self.assertEqual(self.module().release_tags("v1.0.0-rc.1", []), ["1.0.0-rc.1"])

    def test_exact_and_partial_versions_cannot_be_republished(self):
        module = self.module()
        for existing in (["1.0.0"], ["1.0.0-amd64"], ["1.0.0-arm64"]):
            with self.assertRaisesRegex(ValueError, "already exists"):
                module.release_tags("v1.0.0", existing)

    def test_invalid_version_is_rejected(self):
        module = self.module()
        for value in ("1.0.0", "v01.0.0", "v1.0.0-01", "v1.0.0-a..b", "v1.0.0+build",
                      "v1.0.0\n", "v1.0.0;echo bad", "v1.0.0-" + "a" * 120):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.release_tags(value, [])

    def test_dockerhub_endpoints_are_fixed_and_paginated(self):
        module = self.module()
        self.assertIn("registry", inspect.signature(module.registry_tags).parameters)
        responses = [io.BytesIO(b'{"token":"synthetic"}'),
                     io.BytesIO(b'{"tags":["1.0.0"]}'), io.BytesIO(b'{"tags":["2.0.0"]}')]
        for response in responses:
            response.headers = {}
        responses[1].headers["Link"] = '</v2/xmoforf/go-fileshare/tags/list?last=1.0.0>; rel="next"'
        with patch.object(module, "open_url", side_effect=responses) as opened:
            self.assertEqual(module.registry_tags("xmoforf", "synthetic", registry="docker.io"),
                             ["1.0.0", "2.0.0"])
        urls = [call.args[0].full_url for call in opened.call_args_list]
        self.assertTrue(urls[0].startswith("https://auth.docker.io/token?"))
        self.assertIn("service=registry.docker.io", urls[0])
        self.assertTrue(all(url.startswith("https://registry-1.docker.io/v2/xmoforf/go-fileshare/tags/list?")
                            for url in urls[1:]))
        with patch.object(module, "open_url") as opened:
            with self.assertRaises(ValueError):
                module.registry_tags("xmoforf", "synthetic", registry="other.invalid")
            opened.assert_not_called()

    def test_registry_pages_and_initial_absence(self):
        module = self.module()
        def response(data, link=None):
            result = io.BytesIO(json.dumps(data).encode())
            result.headers = {} if link is None else {"Link": link}
            return result
        with patch.object(module, "open_url", side_effect=[
            response({"token": "synthetic"}), response({"tags": ["1.0.0"]},
                '</v2/xmoforf/go-fileshare/tags/list?last=1.0.0>; rel="next"'),
            response({"tags": ["2.0.0"]})]):
            self.assertEqual(module.registry_tags("owner", "synthetic"), ["1.0.0", "2.0.0"])
        with patch.object(module, "open_url", side_effect=[
            response({"token": "synthetic"}), HTTPError("url", 404, "missing", {}, None)]):
            self.assertEqual(module.registry_tags("owner", "synthetic"), [])
        for failure in (HTTPError("url", 401, "denied", {}, None),
                        HTTPError("url", 403, "denied", {}, None), URLError("offline")):
            with patch.object(module, "open_url", side_effect=[
                response({"token": "synthetic"}), failure]):
                with self.assertRaises(RuntimeError):
                    module.registry_tags("owner", "synthetic")

    def test_image_identity_must_match_release(self):
        module = self.module()
        self.assertTrue(hasattr(module, "verify_image"), "image identity verifier missing")
        info = {"Id": "sha256:" + "a" * 64, "Architecture": "arm64", "Os": "linux",
                "Config": {"User": "999:993", "Entrypoint": ["/file-share"], "Labels": {
                    "org.opencontainers.image.version": "v1.0.0",
                    "org.opencontainers.image.revision": "b" * 40,
                    "org.opencontainers.image.source": "https://github.com/xmoforf/go-fileshare",
                    "org.opencontainers.image.licenses": "MIT"}}}
        module.verify_image(info, "arm64", "v1.0.0", "b" * 40)
        for key, value in (("Architecture", "amd64"), ("Os", "windows")):
            altered = dict(info, **{key: value})
            with self.assertRaises(ValueError):
                module.verify_image(altered, "arm64", "v1.0.0", "b" * 40)
        for key, value in (("org.opencontainers.image.version", "dev"),
                           ("org.opencontainers.image.revision", "unknown")):
            altered = json.loads(json.dumps(info))
            altered["Config"]["Labels"][key] = value
            with self.assertRaises(ValueError):
                module.verify_image(altered, "arm64", "v1.0.0", "b" * 40)

    def test_existing_release_stops_before_writes(self):
        module = self.module()
        env = {"GITHUB_SHA": "b" * 40, "GITHUB_REPOSITORY": "xmoforf/go-fileshare",
               "GITHUB_REF": "refs/tags/v1.0.0", "REGISTRY_USERNAME": "xmoforf", "REGISTRY_TOKEN": "synthetic"}
        with patch.dict(os.environ, env), \
                patch.object(module.subprocess, "check_output", return_value="b" * 40), \
                patch.object(module, "registry_tags", return_value=["1.0.0"]), \
                patch.object(module.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "already exists"):
                module.publish("v1.0.0", Path("unused"))
            run.assert_not_called()

    def test_publisher_promotes_loaded_ids_and_checks_remote_index(self):
        self.exercise_publisher("ghcr.io")

    def test_dockerhub_publisher_promotes_same_tested_images(self):
        self.exercise_publisher("docker.io")

    def exercise_publisher(self, registry):
        module = self.module()
        self.assertIn("registry", inspect.signature(module.publish).parameters)
        image = registry + "/xmoforf/go-fileshare"
        env = {"GITHUB_SHA": "b" * 40, "GITHUB_REPOSITORY": "xmoforf/go-fileshare",
               "GITHUB_REF": "refs/tags/v1.0.0", "REGISTRY_USERNAME": "xmoforf", "REGISTRY_TOKEN": "synthetic"}
        ids = {"amd64": "sha256:" + "a" * 64, "arm64": "sha256:" + "c" * 64}
        manifests = {"amd64": "sha256:" + "d" * 64, "arm64": "sha256:" + "e" * 64}
        def output(command, **kwargs):
            if command[0] == "git":
                return "b" * 40
            if command[1:3] == ["image", "inspect"]:
                arch = next(a for a, value in ids.items() if value == command[-1])
                return json.dumps([{"Architecture": arch, "Os": "linux", "Config": {
                    "User": "999:993", "Entrypoint": ["/file-share"], "Labels": {
                        "org.opencontainers.image.version": "v1.0.0",
                        "org.opencontainers.image.revision": "b" * 40,
                        "org.opencontainers.image.source": "https://github.com/xmoforf/go-fileshare",
                        "org.opencontainers.image.licenses": "MIT"}}}])
            arch = next((a for a in ids if command[-1].endswith("-" + a)), None)
            if "--raw" in command:
                return json.dumps({"config": {"digest": ids[arch]}} if arch else {
                    "manifests": [{"platform": {"os": "linux", "architecture": a}, "digest": d}
                                  for a, d in manifests.items()]})
            return json.dumps({"digest": manifests[arch] if arch else "sha256:" + "f" * 64})
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for arch, image_id in ids.items():
                bundle = directory / ("image-" + arch)
                bundle.mkdir()
                (bundle / "image-id.txt").write_text(image_id)
            with patch.dict(os.environ, env), patch.object(module, "registry_tags", return_value=[]), \
                    patch.object(module.subprocess, "check_output", side_effect=output), \
                    patch.object(module.subprocess, "run") as run, patch("builtins.print"):
                module.publish("v1.0.0", directory, registry=registry)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertIn(["docker", "login", registry, "--username", "xmoforf", "--password-stdin"], commands)
            self.assertEqual([c for c in commands if c[1] == "push"],
                             [["docker", "push", image + ":1.0.0-" + a] for a in ids])
            self.assertEqual([c for c in commands if c[1] == "tag"],
                             [["docker", "tag", value, image + ":1.0.0-" + a] for a, value in ids.items()])
            create = next(c for c in commands if "create" in c)
            self.assertEqual(create[-2:], [image + "@" + d for d in manifests.values()])
            report = json.loads((directory / "publication.json").read_text())
            self.assertEqual(report["image"], image)
            self.assertEqual(report["digest"], "sha256:" + "f" * 64)
            self.assertEqual(report["tags"], ["1.0.0", "1.0", "1", "latest"])

    def test_registry_cannot_redirect_credentials(self):
        module = self.module()
        reply = io.BytesIO(b'{"token":"synthetic"}')
        reply.headers = {}
        page = io.BytesIO(b'{"tags":[]}')
        page.headers = {"Link": '<https://other.invalid/steal>; rel="next"'}
        with patch.object(module, "open_url", side_effect=[reply, page]):
            with self.assertRaisesRegex(ValueError, "pagination"):
                module.registry_tags("owner", "synthetic")


if __name__ == "__main__":
    unittest.main()
