"""GitHub Release contracts; synthetic reports and subprocesses, no public writes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
REVISION = "a" * 40
REPO = "xmoforf/go-fileshare"


class GitHubReleaseTests(unittest.TestCase):
    def module(self):
        path = ROOT / "scripts/github_release.py"
        self.assertTrue(path.is_file(), "GitHub Release helper missing")
        spec = importlib.util.spec_from_file_location("github_release", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def reports(self, version="v1.2.3"):
        return [{"image": registry + "/" + REPO, "version": version, "revision": REVISION,
                 "status": "published and authenticated registry verification passed",
                 "digest": "sha256:" + "b" * 64, "tags": [version[1:]],
                 "manifests": {"amd64": "sha256:" + "c" * 64, "arm64": "sha256:" + "d" * 64},
                 "image_ids": {"amd64": "sha256:" + "e" * 64, "arm64": "sha256:" + "f" * 64}}
                for registry in ("ghcr.io", "docker.io")]

    def test_notes_select_exact_section_not_unreleased_or_neighbor(self):
        module = self.module()
        source = "# Release notes\n\n## Unreleased\n\nFuture\n\n## v1.2.3\n\n### Changes\n\nSelected\n\n## v1.2.2\n\nOld\n"
        self.assertEqual(module.release_notes("v1.2.3", source), "### Changes\n\nSelected")
        self.assertEqual(module.release_notes("v1.2.2", source), "Old")

    def test_missing_duplicate_empty_and_invalid_version_notes_fail(self):
        module = self.module()
        for version, source in [("v1.2.3", "## v1.2.30\nWrong"),
                                ("v1.2.3", "## v1.2.3\nOne\n## v1.2.3\nTwo"),
                                ("v1.2.3", "## v1.2.3\n\n## v1.2.2\nOld"),
                                ("v01.2.3", "## v01.2.3\nInvalid"),
                                ("v1.2.3-01", "## v1.2.3-01\nInvalid"),
                                ("v1.2.3+build", "## v1.2.3+build\nInvalid")]:
            with self.subTest(version=version, source=source), self.assertRaises(ValueError):
                module.release_notes(version, source)

    def test_body_uses_both_verified_exact_refs_and_digest_pins(self):
        module = self.module()
        body = module.release_body("v1.2.3", REVISION, "Selected notes", self.reports())
        self.assertTrue(body.startswith("Selected notes\n\n### Container images\n"))
        for registry in ("ghcr.io", "docker.io"):
            self.assertIn(f"`{registry}/{REPO}:1.2.3`", body)
            self.assertIn(f"`{registry}/{REPO}@sha256:{'b' * 64}`", body)
        self.assertIn(f"Source: `{REVISION}`.", body)

    def test_bad_or_partial_reports_fail_before_publication(self):
        module = self.module()
        invalid = [[], self.reports()[:1], self.reports() + self.reports()[:1], [None, None]]
        for key, value in [("status", "publication started; may be partial"),
                           ("image", "ghcr.io/other/project"), ("version", "v1.2.2"),
                           ("revision", "0" * 40), ("digest", "bad"),
                           ("tags", []), ("manifests", {"amd64": "sha256:" + "c" * 64}),
                           ("image_ids", {"amd64": "invalid", "arm64": "invalid"})]:
            for index in (0, 1):
                reports = self.reports()
                reports[index][key] = value
                invalid.append(reports)
        mismatch = self.reports()
        mismatch[1]["manifests"]["arm64"] = "sha256:" + "0" * 64
        invalid.append(mismatch)
        mismatch = self.reports()
        mismatch[1]["image_ids"]["arm64"] = "sha256:" + "0" * 64
        invalid.append(mismatch)
        for reports in invalid:
            with self.subTest(reports=reports), self.assertRaises(ValueError):
                module.release_body("v1.2.3", REVISION, "Notes", reports)

    def test_create_stable_and_prerelease_from_existing_tag(self):
        for version in ("v1.2.3", "v1.2.3-rc.1"):
            for annotated in (False, True):
                with self.subTest(version=version, annotated=annotated):
                    calls = self.exercise_create(version, annotated=annotated)
                    create = calls[-1]
                    self.assertEqual(create.args[0][:4], ["gh", "release", "create", version])
                    self.assertIn("--verify-tag", create.args[0])
                    self.assertIn("github.com/" + REPO, create.args[0])
                    self.assertEqual(create.args[0][create.args[0].index("--target") + 1], REVISION)
                    self.assertEqual("--prerelease" in create.args[0], "-" in version)
                    self.assertEqual("--latest=false" in create.args[0], "-" in version)
                    self.assertNotIn("--latest", create.args[0])
                    self.assertIn("Selected notes", create.kwargs["input"])
                    self.assertIn("docker.io/" + REPO, create.kwargs["input"])
                    self.assertTrue(create.kwargs["check"])
                    self.assertEqual(sum(c.args[0][:3] == ["gh", "release", "create"] for c in calls), 1)

    def test_existing_release_always_stops_without_edit(self):
        for existing in ({"id": 123, "draft": False}, {"id": 123, "draft": True}):
            self.exercise_create(existing=existing, failure="already exists")

    def test_api_failures_never_treated_as_absence(self):
        for status in (401, 403, 429, 500):
            self.exercise_create(api_error=status, failure="GitHub API")
        self.exercise_create(api_error="offline", failure="GitHub API")

    def test_malformed_api_responses_and_unexpected_404_fail_closed(self):
        module = self.module()
        for output in ("offline", "null", "[]", '"text"', "false"):
            with self.subTest(output=output), patch.object(module.subprocess, "run", return_value=
                    subprocess.CompletedProcess([], 0, output, "")):
                with self.assertRaisesRegex(RuntimeError, "GitHub API"):
                    module.github_api("releases/tags/v1.2.3", allow_missing=True)
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 1, '{"status":"404","message":"Not Found"}', "")):
            with self.assertRaisesRegex(RuntimeError, "GitHub API"):
                module.github_api("git/ref/tags/v1.2.3")

    def test_wrong_tag_or_checkout_identity_stops(self):
        self.exercise_create(tag_sha="b" * 40, failure="tag revision")
        self.exercise_create(checkout_sha="b" * 40, failure="checkout revision")
        self.exercise_create(env_changes={"GITHUB_REPOSITORY": "other/project"}, failure="repository and version tag")
        self.exercise_create(env_changes={"GITHUB_REF": "refs/heads/main"}, failure="repository and version tag")
        self.exercise_create(env_changes={"GITHUB_SHA": "invalid"}, failure="repository and version tag")

    def test_failed_create_is_not_retried(self):
        self.exercise_create(create_error=True, failure="exit status")

    def exercise_create(self, version="v1.2.3", annotated=True, existing=None, api_error=None,
                        tag_sha=REVISION, checkout_sha=REVISION, env_changes=None,
                        create_error=False, failure=None):
        module = self.module()
        env = {"GITHUB_REPOSITORY": REPO, "GITHUB_REF": "refs/tags/" + version, "GITHUB_SHA": REVISION}
        env.update(env_changes or {})
        def run(command, **kwargs):
            if command[:3] == ["gh", "release", "create"]:
                if create_error:
                    raise subprocess.CalledProcessError(1, command)
                return subprocess.CompletedProcess(command, 0)
            self.assertEqual(command[:2], ["gh", "api"])
            endpoint = command[2]
            status = 0
            if endpoint.endswith("releases/tags/" + version):
                if api_error:
                    status = 1
                    body = {"message": "failure", "status": str(api_error)}
                elif existing is not None:
                    body = existing
                else:
                    status = 1
                    body = {"message": "Not Found", "status": "404"}
            elif "/git/ref/tags/" in endpoint:
                body = {"object": {"type": "tag" if annotated else "commit",
                                   "sha": "c" * 40 if annotated else tag_sha}}
            elif "/git/tags/" in endpoint:
                body = {"object": {"type": "commit", "sha": tag_sha}}
            else:
                self.fail("unexpected command: " + repr(command))
            return subprocess.CompletedProcess(command, status, json.dumps(body), "synthetic stderr")
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for report in self.reports(version):
                path = directory / ("publication-report-" + report["image"].split("/")[0])
                path.mkdir()
                (path / "publication.json").write_text(json.dumps(report))
            with patch.dict(os.environ, env), patch.object(module.subprocess, "check_output", return_value=checkout_sha), \
                    patch.object(module.subprocess, "run", side_effect=run) as executed:
                if failure:
                    with self.assertRaisesRegex((ValueError, RuntimeError, subprocess.CalledProcessError), failure):
                        module.publish(version, "Selected notes", directory)
                else:
                    module.publish(version, "Selected notes", directory)
            calls = executed.call_args_list
            writes = [c for c in calls if c.args[0][:3] == ["gh", "release", "create"]]
            self.assertEqual(len(writes), 1 if not failure or create_error else 0)
            return calls

    def test_current_notes_have_release_page_safe_links(self):
        source = (ROOT / "RELEASE_NOTES.md").read_text().split("## v1.0.4\n")[1].split("\n## ")[0]
        self.assertNotIn("](docs/", source)
        self.assertNotIn("](SECURITY.md", source)
        self.assertIn("https://github.com/" + REPO + "/blob/v1.0.4/docs/operations.md", source)

    def test_workflow_gates_and_permissions(self):
        source = (ROOT / ".github/workflows/release.yml").read_text()
        self.assertIn("\n  github-release:\n", source, "final GitHub Release job missing")
        before, job = source.split("\n  github-release:\n")
        self.assertIn("    needs: [checks, publish-ghcr, publish-dockerhub]\n", job)
        self.assertNotIn("if:", job, "default success() gate must not be bypassed")
        self.assertIn("    permissions:\n      contents: write\n", job)
        self.assertNotIn("contents: write", before)
        self.assertNotIn("packages: write", job)
        self.assertIn("          persist-credentials: false\n", job)
        self.assertIn("          pattern: publication-report-*\n", job)
        self.assertIn('python3 scripts/github_release.py "$GITHUB_REF_NAME" --publish "$RUNNER_TEMP/reports"', job)
        self.assertIn("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}", job)
        validate = before.split("  checks:\n")[0]
        self.assertIn('python3 scripts/github_release.py "$GITHUB_REF_NAME"', validate)
        checks = (ROOT / ".github/workflows/checks.yml").read_text()
        self.assertNotIn("contents: write", checks)
        self.assertNotIn("secrets.", checks)


if __name__ == "__main__":
    unittest.main()
