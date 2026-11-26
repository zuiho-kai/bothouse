"""Bind a frozen Git source.zip from the release handoff to the actual release inputs."""

import argparse
from fnmatch import fnmatchcase
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path


def sha256(file):
    with file.open("rb") as reader:
        return hashlib.file_digest(reader, "sha256").hexdigest()


def tracked_files(root, entries):
    for name in entries:
        candidate = root / name
        if candidate.is_dir():
            yield from (item.relative_to(root).as_posix() for item in candidate.rglob("*") if item.is_file())
        else:
            yield name


def stage(scope, release, handoff_file, destination, expected_version):
    handoff = json.loads(handoff_file.read_text(encoding="utf-8-sig"))
    commit, version = handoff["freeze"], handoff["version"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[1-9]\d{0,4}(?:\.\d{1,5}){2}\.0", version):
        raise ValueError("Invalid frozen source or version")
    if expected_version and expected_version != version:
        raise ValueError("Source handoff and package version differ")
    source = (handoff_file.parent / handoff["source"]["path"]).resolve()
    digest = handoff["source"]["sha256"]
    if sha256(source) != digest:
        raise ValueError("Frozen source archive SHA-256 mismatch")
    excluded_paths = []
    excluded_globs = []
    if scope == "service":
        entries = []
        for line in (release / "social/deploy/service-archive-paths.txt").read_text().splitlines():
            pattern = line.strip()
            if pattern.startswith(":(exclude)"):
                excluded_paths.append(pattern.removeprefix(":(exclude)"))
            elif pattern.startswith(":(exclude,glob)"):
                excluded_globs.append(pattern.removeprefix(":(exclude,glob)"))
            elif pattern:
                entries.append(pattern)
    else:
        entries = ["src", "LICENSE", "LICENSE-MIT-HISTORICAL", "THIRD_PARTY_NOTICES.md", "LICENSES", "package.json", "package-lock.json"]
        entries.extend("social/windows/" + name for name in [
            "pack.cjs", "manifest.xml", "main.cjs", "endpoint.cjs", "social-view.cjs",
            "social-host.cjs", "privacy-preload.cjs", "chat-capture", "store-update.cpp",
        ])
    with zipfile.ZipFile(source) as archive:
        if archive.comment.decode("ascii") != commit:
            raise ValueError("Frozen source archive Git commit mismatch")
        archived = set(archive.namelist())
        def included(item):
            return not (any(item == path or item.startswith(path + "/") for path in excluded_paths) or
                        any(fnmatchcase(item, pattern) for pattern in excluded_globs))

        for name in entries:
            if not (release / name).resolve().is_relative_to(release.resolve()):
                raise ValueError("Release input escapes release root")
            prefix = name + "/"
            files = {item for item in archived if item.startswith(prefix) and not item.endswith("/") and included(item)}
            if (release / name).is_dir() and files != set(tracked_files(release, [name])):
                raise ValueError("Frozen and staged files differ under " + name)
        for name in sorted(set(tracked_files(release, entries))):
            local = release / name
            if not local.resolve().is_relative_to(release.resolve()) or name not in archived:
                raise ValueError("Untracked release input: " + name)
            with archive.open(name) as reader:
                if sha256(local) != hashlib.file_digest(reader, "sha256").hexdigest():
                    raise ValueError("Frozen source differs from release input: " + name)
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "source.zip"
    metadata = destination / "source-release.json"
    # Install into a fresh package/release directory. A prior release stays intact.
    if target.exists() or metadata.exists():
        raise ValueError("Use a release directory without an installed source archive")
    with source.open("rb") as reader, target.open("xb") as writer:
        shutil.copyfileobj(reader, writer)
    if sha256(target) != digest:
        raise ValueError("Installed archive SHA-256 mismatch")
    metadata.write_text(json.dumps({"version": version, "commit": commit, "sha256": digest, "bytes": target.stat().st_size},
                                   separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("scope", choices=["desktop", "service"])
    parser.add_argument("release", type=Path)
    parser.add_argument("handoff", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--version")
    args = parser.parse_args()
    stage(args.scope, args.release, args.handoff, args.destination, args.version)
