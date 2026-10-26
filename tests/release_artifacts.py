#!/usr/bin/env python3
"""Assert checksums, ELF metadata, notices and image parity for local candidates."""
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile


def verify(directory):
    directory = Path(directory)
    for line in (directory / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert Path(name).name == name, "checksum name must be a basename"
        with (directory / name).open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == digest, name
    metadata = json.loads((directory / "build.json").read_text())
    for arch, machine in [("amd64", 62), ("arm64", 183)]:
        stem = f"file-share-{metadata['version']}-linux-{arch}"
        with tarfile.open(directory / (stem + ".tar.gz")) as archive:
            def member(name):
                return archive.extractfile(stem + "/" + name).read()
            binary = member("file-share")
            assert binary[:6] == b"\x7fELF\x02\x01", "64-bit little-endian ELF required"
            assert int.from_bytes(binary[18:20], "little") == machine, arch
            assert json.loads(member("build.json")) == metadata
            notices = {entry.name[len(stem) + 1:]: archive.extractfile(entry).read()
                       for entry in archive.getmembers() if entry.isfile() and
                       (entry.name.startswith(stem + "/licenses/") or
                        entry.name in [stem + "/LICENSE", stem + "/THIRD_PARTY_NOTICES.md"])}
            assert "LICENSE" in notices and len(notices) > 10
            for doc in ["README.md", "SECURITY.md", "RELEASE_NOTES.md", "docs/operations.md", "dist/file-share.service"]:
                assert member(doc), doc
        with tarfile.open(directory / (stem + ".docker.tar")) as image:
            manifests = json.load(image.extractfile("manifest.json"))
            assert len(manifests) == 1, "exactly one platform image required"
            manifest = manifests[0]
            config = json.load(image.extractfile(manifest["Config"]))
            assert config["architecture"] == arch
            assert config["os"] == "linux"
            assert config["config"]["User"] == "999:993"
            assert config["config"]["Entrypoint"] == ["/file-share"]
            assert config["config"]["Labels"]["org.opencontainers.image.version"] == metadata["version"]
            assert config["config"]["Labels"]["org.opencontainers.image.revision"] == metadata["revision"]
            payload = {}
            for layer in manifest["Layers"]:
                with tarfile.open(fileobj=io.BytesIO(image.extractfile(layer).read())) as contents:
                    for entry in contents.getmembers():
                        if entry.isfile():
                            payload[entry.name.removeprefix("./")] = contents.extractfile(entry).read()
            assert payload["file-share"] == binary, "archive and image binary differ"
            for name, data in notices.items():
                assert payload["usr/share/doc/file-share/" + name] == data, name
        if platform.machine() == {"amd64": "x86_64", "arm64": "aarch64"}[arch]:
            candidate = Path(tempfile.mkdtemp(prefix="file-share-candidate-")) / "file-share"
            candidate.write_bytes(binary)
            candidate.chmod(0o700)
            result = subprocess.check_output([candidate, "-version"], text=True)
            assert result == f"file-share {metadata['version']} ({metadata['revision']})\n"
            print(f"Native version PASS ({arch}); retained binary: {candidate}")
        print(f"PASS {arch}: checksum/ELF/metadata/notices/image parity (not foreign runtime proof)")


if __name__ == "__main__":
    if not __debug__:
        raise SystemExit("assertions required; do not use python -O")
    verify(sys.argv[1])
