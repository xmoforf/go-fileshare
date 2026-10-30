#!/usr/bin/env python3
"""Plan registry tags; --publish promotes tested image archives (CI release jobs only)."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = "xmoforf/go-fileshare"
REGISTRIES = {
    "ghcr.io": ("https://ghcr.io/token", "ghcr.io", "https://ghcr.io/v2/"),
    "docker.io": ("https://auth.docker.io/token", "registry.docker.io", "https://registry-1.docker.io/v2/"),
}
VERSION = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("registry redirect refused")


open_url = urllib.request.build_opener(NoRedirect()).open


def release_tags(version, existing):
    match = VERSION.fullmatch(version)
    if not match or len(version.removeprefix("v") + "-arm64") > 128:
        raise ValueError("expected vMAJOR.MINOR.PATCH[-prerelease], within Docker tag length limit")
    major, minor, patch = map(int, match.groups()[:3])
    prerelease = match.group(4)
    if prerelease and any(part.isdigit() and len(part) > 1 and part[0] == "0"
                          for part in prerelease.split(".")):
        raise ValueError("numeric prerelease identifiers cannot have leading zeros")
    exact = version[1:]
    if any(tag in existing for tag in (exact, exact + "-amd64", exact + "-arm64")):
        raise ValueError("exact version or partial release already exists; do not overwrite")
    tags = [exact]
    if prerelease:
        return tags
    stable = []
    for tag in existing:
        previous = VERSION.fullmatch("v" + tag)
        if previous and previous.group(4) is None:
            stable.append(tuple(map(int, previous.groups()[:3])))
    current = (major, minor, patch)
    if not any(v[:2] == current[:2] and v > current for v in stable):
        tags.append(f"{major}.{minor}")
    if not any(v[0] == major and v > current for v in stable):
        tags.append(str(major))
    if not any(v > current for v in stable):
        tags.append("latest")
    return tags


def registry_tags(actor, credential, registry="ghcr.io"):
    if registry not in REGISTRIES:
        raise ValueError("unsupported registry")
    if not actor or not credential:
        raise ValueError("registry credentials are required")
    token_url, service, base_url = REGISTRIES[registry]
    auth = base64.b64encode(f"{actor}:{credential}".encode()).decode()
    query = urllib.parse.urlencode({"service": service, "scope": "repository:xmoforf/go-fileshare:pull,push"})
    request = urllib.request.Request(token_url + "?" + query,
                                     headers={"Authorization": "Basic " + auth})
    try:
        with open_url(request, timeout=30) as response:
            token = json.load(response)["token"]
        tags_url = base_url + "xmoforf/go-fileshare/tags/list?"
        url = tags_url + "n=100"
        tags, visited = [], set()
        while url:
            if url in visited or not url.startswith(tags_url):
                raise ValueError("unsafe registry pagination")
            visited.add(url)
            request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
            try:
                with open_url(request, timeout=30) as response:
                    page = json.load(response)
                    if not isinstance(page, dict) or "tags" not in page:
                        raise ValueError("invalid registry tag list")
                    values = page["tags"]
                    if values is None:
                        values = []
                    if not isinstance(values, list) or not all(isinstance(t, str) for t in values):
                        raise ValueError("invalid registry tag list")
                    tags.extend(values)
                    link = response.headers.get("Link")
            except urllib.error.HTTPError as error:
                if error.code == 404 and len(visited) == 1:
                    return []
                raise
            if link:
                match = re.fullmatch(r'<([^>]+)>;\s*rel="next"', link)
                if not match:
                    raise ValueError("invalid registry pagination")
                url = urllib.parse.urljoin(url, match.group(1))
            else:
                url = None
        return tags
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as error:
        # Do not include authentication headers, response bodies or credentials in logs.
        raise RuntimeError("registry preflight failed; publication refused") from None


def verify_image(info, arch, version, revision):
    config = info["Config"]
    labels = config.get("Labels") or {}
    expected = {"org.opencontainers.image.version": version,
                "org.opencontainers.image.revision": revision,
                "org.opencontainers.image.source": "https://github.com/xmoforf/go-fileshare",
                "org.opencontainers.image.licenses": "MIT"}
    if (info["Architecture"] != arch or info["Os"] != "linux" or config["User"] != "999:993"
            or config["Entrypoint"] != ["/file-share"]
            or any(labels.get(key) != value for key, value in expected.items())):
        raise ValueError("image platform/config/metadata does not match release")


def checked_release_revision(version):
    revision = os.environ["GITHUB_SHA"]
    if (os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
            or os.environ.get("GITHUB_REF") != "refs/tags/" + version
            or not re.fullmatch(r"[0-9a-f]{40}", revision)):
        raise ValueError("publication requires the expected repository and version tag")
    if subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != revision:
        raise ValueError("checkout revision mismatch")
    return revision


def publish(version, directory, registry="ghcr.io"):
    if registry not in REGISTRIES:
        raise ValueError("unsupported registry")
    image = registry + "/" + REPOSITORY
    revision = checked_release_revision(version)
    actor, credential = os.environ["REGISTRY_USERNAME"], os.environ["REGISTRY_TOKEN"]
    tags = release_tags(version, registry_tags(actor, credential, registry=registry))
    images = {}
    for arch in ("amd64", "arm64"):
        bundle = directory / ("image-" + arch)
        image_id = (bundle / "image-id.txt").read_text().strip()
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError("invalid tested image identity")
        subprocess.run(["docker", "load", "--input", str(bundle / "image.tar")], check=True)
        info = json.loads(subprocess.check_output(["docker", "image", "inspect", image_id]))[0]
        verify_image(info, arch, version, revision)
        images[arch] = image_id
    report = {"image": image, "version": version, "revision": revision, "image_ids": images,
              "tags": tags, "manifests": {}, "status": "publication started; may be partial"}
    report_path = directory / "publication.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    subprocess.run(["docker", "login", registry, "--username", actor, "--password-stdin"],
                   input=credential + "\n", text=True, check=True)
    for arch, image_id in images.items():
        ref = image + ":" + tags[0] + "-" + arch
        subprocess.run(["docker", "tag", image_id, ref], check=True)
        subprocess.run(["docker", "push", ref], check=True)
        raw = subprocess.check_output(["docker", "buildx", "imagetools", "inspect", "--raw", ref])
        manifest = json.loads(raw)
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
        # Docker stores identify images by config digest (classic) or manifest digest (containerd).
        if image_id not in (manifest["config"]["digest"], digest):
            raise ValueError("published identity differs from tested image")
        report["manifests"][arch] = digest
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    command = ["docker", "buildx", "imagetools", "create"]
    for tag in tags:
        command.extend(["--tag", image + ":" + tag])
    command.extend(image + "@" + digest for digest in report["manifests"].values())
    subprocess.run(command, check=True)
    ref = image + ":" + tags[0]
    index = json.loads(subprocess.check_output(["docker", "buildx", "imagetools", "inspect", "--raw", ref]))
    members = {m["platform"]["architecture"]: m["digest"] for m in index["manifests"]
               if m["platform"]["os"] == "linux"}
    if len(index["manifests"]) != 2 or members != report["manifests"]:
        raise ValueError("published index differs from tested platforms")
    digests = set()
    for tag in tags:
        descriptor = json.loads(subprocess.check_output([
            "docker", "buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", image + ":" + tag]))
        digests.add(descriptor["digest"])
    if len(digests) != 1:
        raise ValueError("release aliases disagree")
    report.update(status="published and authenticated registry verification passed", digest=digests.pop())
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--registry", choices=REGISTRIES, default="ghcr.io")
    parser.add_argument("--publish", type=Path, help="directory containing tested image-amd64/image-arm64 artifacts")
    args = parser.parse_args()
    release_tags(args.version, [])
    if args.publish:
        publish(args.version, args.publish, registry=args.registry)
    else:
        print(json.dumps(release_tags(args.version, [])))
