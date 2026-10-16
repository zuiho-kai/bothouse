"""Download pinned public trial assets over HTTPS; no model code is executed."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request


MODELS = {
    "tts": ("mlx-community/Fun-CosyVoice3-0.5B-2512-fp16", "18ccb7fbd7246e8cd3420d02f5dd28595cc0fcd9"),
    "tokenizer": ("mlx-community/S3TokenizerV3", "b143914b3e912278104824da706edc9c2d317c4e"),
}
REFERENCE = "https://raw.githubusercontent.com/QwenAudio/CosyVoice/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/asset/zero_shot_prompt.wav"
REFERENCE_SHA256 = "c7b31d6dbe7cc6a716dded00550db5b50940bf209e424e4ad207b12e657c8ff6"


def download_ranges(url, target, size):
    """Retain ranges for resuming; the caller verifies the assembled file."""
    chunk_size = 128 * 1024 * 1024
    ranges = [(start, min(start + chunk_size, size) - 1) for start in range(0, size, chunk_size)]

    def fetch(bounds):
        start, end = bounds
        part = target.with_name(target.name + f".range-{start}-{end}")
        saved = part.stat().st_size if part.exists() else 0
        if saved > end - start + 1:
            raise ValueError(f"Oversized retained range: {part}")
        if saved == end - start + 1:
            return part
        offset = start + saved
        request = urllib.request.Request(url + f"&range_start={offset}", headers={"Range": f"bytes={offset}-{end}"})
        with urllib.request.urlopen(request, timeout=60) as source:
            if source.status != 206 or source.headers.get("Content-Range") != f"bytes {offset}-{end}/{size}":
                raise ValueError("Server did not honor the requested range")
            with part.open("ab") as output:
                while chunk := source.read(4 * 1024 * 1024):
                    output.write(chunk)
        if part.stat().st_size != end - start + 1:
            raise ValueError(f"Incomplete range: {part}")
        print("Range ready", start, end, flush=True)
        return part

    with ThreadPoolExecutor(max_workers=8) as pool:
        parts = list(pool.map(fetch, ranges))
    assembled = target.with_name(target.name + ".assembled")
    with assembled.open("xb") as output:
        for part in parts:
            with part.open("rb") as source:
                while chunk := source.read(8 * 1024 * 1024):
                    output.write(chunk)
    return assembled


def checksum(path, lfs):
    digest = hashlib.sha256() if lfs else hashlib.sha1()
    if not lfs:
        digest.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    root = args.destination.resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, (repo, revision) in MODELS.items():
        with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/{revision}", timeout=30) as response:
            entries = json.load(response)
        folder = root / name
        folder.mkdir(exist_ok=True)
        manifest[name] = {"repo": repo, "revision": revision, "local_path": str(folder), "files": {}}
        for item in entries:
            filename = item["path"]
            if filename not in {"config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors", "README.md"}:
                continue
            target = folder / filename
            lfs = item.get("lfs")
            expected = lfs["oid"] if lfs else item["oid"]
            if not target.exists():
                url = f"https://huggingface.co/{repo}/resolve/{revision}/{filename}?download=true"
                print("Downloading", repo, filename, item["size"], flush=True)
                if item["size"] > 64 * 1024 * 1024:
                    partial = download_ranges(url, target, item["size"])
                else:
                    partial = folder / (filename + ".http-download")
                    with urllib.request.urlopen(url, timeout=60) as source, partial.open("xb") as output:
                        if source.status != 200:
                            raise RuntimeError(f"Expected complete response, got HTTP {source.status}")
                        while chunk := source.read(4 * 1024 * 1024):
                            output.write(chunk)
                if partial.stat().st_size != item["size"] or checksum(partial, lfs) != expected:
                    raise ValueError(f"Download verification failed: {partial}")
                partial.rename(target)
            if target.stat().st_size != item["size"] or checksum(target, lfs) != expected:
                raise ValueError(f"Existing file verification failed: {target}")
            manifest[name]["files"][filename] = expected
    reference = root / "reference.wav"
    if not reference.exists():
        with urllib.request.urlopen(REFERENCE, timeout=30) as source:
            reference.write_bytes(source.read())
    if checksum(reference, True) != REFERENCE_SHA256:
        raise ValueError(f"Reference audio verification failed: {reference}")
    manifest["reference"] = {"url": REFERENCE, "sha256": checksum(reference, True), "text": "希望你以后能够做的比我还好呦。"}
    (root / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print("All assets downloaded and checksummed", flush=True)


if __name__ == "__main__":
    main()
