#!/usr/bin/env python3
"""Print version-specific notes; --publish creates a Release after both image publications."""
import argparse
import json
from pathlib import Path
import re
import subprocess

from image_release import REGISTRIES, REPOSITORY, checked_release_revision, release_tags


def release_notes(version, source):
    release_tags(version, [])
    # shortcut: level-two headings delimit releases; use a Markdown parser if examples need them.
    sections = ("\n" + source).split("\n## ")
    matches = [section.partition("\n")[2].strip() for section in sections[1:]
               if section.partition("\n")[0] == version]
    if len(matches) != 1 or not matches[0]:
        raise ValueError("expected one nonempty release-notes section for " + version)
    return matches[0]


def release_body(version, revision, notes, reports):
    release_tags(version, [])
    if len(reports) != len(REGISTRIES):
        raise ValueError("both registry publication reports required")
    body = notes + "\n\n### Container images\n\nNative-tested Linux amd64 and arm64 images:\n\n"
    for registry, report in zip(REGISTRIES, reports):
        image = registry + "/" + REPOSITORY
        if (not isinstance(report, dict) or report.get("image") != image
                or report.get("version") != version or report.get("revision") != revision
                or report.get("status") != "published and authenticated registry verification passed"
                or not isinstance(report.get("tags"), list) or version[1:] not in report["tags"]
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(report.get("digest")))):
            raise ValueError("invalid or incomplete registry publication report")
        for key in ("manifests", "image_ids"):
            values = report.get(key)
            if (not isinstance(values, dict) or set(values) != {"amd64", "arm64"}
                    or not all(re.fullmatch(r"sha256:[0-9a-f]{64}", str(v)) for v in values.values())
                    or values != reports[0].get(key)):
                raise ValueError("registry reports disagree with tested platform identities")
        body += f"- `{image}:{version[1:]}`\n  - Digest pin: `{image}@{report['digest']}`\n"
    return body + f"\nSource: `{revision}`.\n"


def github_api(endpoint, allow_missing=False):
    result = subprocess.run(["gh", "api", f"repos/{REPOSITORY}/{endpoint}", "--hostname", "github.com"],
                            capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise RuntimeError("GitHub API response invalid; publication refused") from None
    if not isinstance(data, dict):
        raise RuntimeError("GitHub API response invalid; publication refused")
    if result.returncode:
        if allow_missing and data.get("status") == "404":
            return None
        raise RuntimeError("GitHub API request failed; publication refused")
    return data


def publish(version, notes, directory):
    revision = checked_release_revision(version)
    reports = [json.loads((directory / ("publication-report-" + registry) / "publication.json").read_text())
               for registry in REGISTRIES]
    body = release_body(version, revision, notes, reports)
    if github_api("releases/tags/" + version, allow_missing=True) is not None:
        raise ValueError("GitHub Release already exists; inspect it, do not overwrite or retry")
    target = github_api("git/ref/tags/" + version)["object"]
    if target["type"] == "tag":
        target = github_api("git/tags/" + target["sha"])["object"]
    if target["type"] != "commit" or target["sha"] != revision:
        raise ValueError("remote tag revision mismatch")
    command = ["gh", "release", "create", version, "--repo", "github.com/" + REPOSITORY,
               "--verify-tag", "--target", revision, "--title", version, "--notes-file", "-"]
    if "-" in version:
        command += ["--prerelease", "--latest=false"]
    # An uncertain response needs read-only reconciliation, never an automatic retry.
    subprocess.run(command, input=body, text=True, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--publish", type=Path, help="directory containing both publication-report-* artifacts")
    args = parser.parse_args()
    notes = release_notes(args.version, Path("RELEASE_NOTES.md").read_text())
    if args.publish:
        publish(args.version, notes, args.publish)
    else:
        print(notes)
