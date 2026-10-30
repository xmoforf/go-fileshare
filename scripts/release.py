#!/usr/bin/env python3
"""Build local-only artifacts from committed HEAD. Never loads or pushes images."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from image_release import release_tags

ROOT = Path(__file__).resolve().parents[1]


def validate_version(value):
    release_tags(value, [])
    return value


def prepare_output(path):
    path.mkdir(parents=True, exist_ok=False)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", type=validate_version)
    parser.add_argument("output", type=Path, help="new directory; existing paths are refused")
    args = parser.parse_args()
    # Archive HEAD rather than sweeping local credentials, fixtures or untracked files.
    run("git", "diff", "--exit-code", "HEAD", "--", ".", cwd=ROOT, stdout=subprocess.DEVNULL)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    source = subprocess.check_output(["git", "archive", revision], cwd=ROOT)
    output = args.output.resolve()
    prepare_output(output)
    work = Path(tempfile.mkdtemp(prefix="file-share-release-"))
    print(f"Build workspace retained: {work}", flush=True)
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        archive.extractall(work, filter="data")
    for name in ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses", "docs/releases.md", "RELEASE_NOTES.md"]:
        if not (work / name).exists():
            raise RuntimeError(f"missing release prerequisite: {name}")
    compiler = subprocess.check_output(["go", "version"], text=True).strip()
    run("go", "mod", "verify", cwd=work)
    metadata = {"version": args.version, "revision": revision, "compiler": compiler,
                "platforms": ["linux/amd64", "linux/arm64"],
                "runtime_verified": [], "status": "candidate; release gates required"}
    for arch in ["amd64", "arm64"]:
        name = f"file-share-{args.version}-linux-{arch}"
        bundle = work / name
        bundle.mkdir()
        env = dict(os.environ, CGO_ENABLED="0", GOOS="linux", GOARCH=arch)
        run("go", "build", "-trimpath", "-buildvcs=false", "-ldflags",
            f"-X main.version={args.version} -X main.revision={revision}",
            "-o", str(bundle / "file-share"), ".", cwd=work, env=env)
        for doc in ["LICENSE", "THIRD_PARTY_NOTICES.md", "README.md", "RELEASE_NOTES.md",
                    "SECURITY.md", "CONTRIBUTING.md", "auth.example.json"]:
            shutil.copy2(work / doc, bundle / doc)
        for directory in ["licenses", "docs", "dist"]:
            shutil.copytree(work / directory, bundle / directory)
        (bundle / "build.json").write_text(json.dumps(metadata, indent=2) + "\n")
        with tarfile.open(output / f"{name}.tar.gz", "w:gz") as archive:
            archive.add(bundle, arcname=name)
        run("docker", "buildx", "build", "--platform", f"linux/{arch}",
            "--file", str(work / "dist/Dockerfile.release"),
            "--label", f"org.opencontainers.image.version={args.version}",
            "--label", f"org.opencontainers.image.revision={revision}",
            "--output", f"type=docker,dest={output / (name + '.docker.tar')}", str(bundle))
    (output / "build.json").write_text(json.dumps(metadata, indent=2) + "\n")
    shutil.copy2(work / "RELEASE_NOTES.md", output)
    with (output / "SHA256SUMS").open("x") as checksums:
        for path in sorted(output.iterdir()):
            if path.name != "SHA256SUMS":
                with path.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                checksums.write(f"{digest}  {path.name}\n")
    print(f"Candidate artifacts: {output}; not a release approval", flush=True)


if __name__ == "__main__":
    main()
