"""Transfer cleared still avatars from the bound local Bothouse library to its planet."""
import hashlib
import http.client
import json
import re
import struct
import tomllib
import zlib

MAX_PNG = 2 * 1024 * 1024
SLUG = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
PNG = b"\x89PNG\r\n\x1a\n"
# These declarations can provide the public credit without an additional per-image
# grant. A local/private pack without an applicable grant never acquires a licence.
PUBLIC_LICENSES = {"CC0-1.0", "CC-BY-4.0"}


def pixels(raw):
    """Keep the same pixel/palette/transparency chunks as prepare-resident-art."""
    if len(raw) > MAX_PNG or not raw.startswith(PNG):
        raise ValueError("Not a bounded PNG")
    chunks, pos, scan_data = [PNG], 8, []
    while pos + 12 <= len(raw):
        length, kind = struct.unpack_from(">I4s", raw, pos)
        end = pos + 12 + length
        if end > len(raw) or zlib.crc32(raw[pos + 4:end - 4]) != int.from_bytes(raw[end - 4:end], "big"):
            break
        if pos == 8:
            if kind != b"IHDR" or length != 13 or not all(0 < n <= 1024 for n in struct.unpack_from(">II", raw, 16)):
                break
            width, height, depth, colour, compression, filtering, interlace = struct.unpack_from(">IIBBBBB", raw, 16)
            depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
            if depth not in depths.get(colour, ()) or compression or filtering or interlace:
                break
            channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
            stride = (width * channels * depth + 7) // 8 + 1
        elif kind in (b"IHDR", b"acTL", b"fcTL", b"fdAT"):
            break
        if kind in (b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"):
            chunks.append(raw[pos:end])
        if kind == b"IDAT" and length:
            scan_data.append(raw[pos + 8:end - 4])
        if kind == b"IEND":
            if end == len(raw) and not length and scan_data:
                decoder = zlib.decompressobj()
                decoded = decoder.decompress(b"".join(scan_data), stride * height + 1)
                if decoder.eof and not decoder.unused_data and len(decoded) == stride * height and max(decoded[::stride]) <= 4:
                    return b"".join(chunks)
            break
        pos = end
    raise ValueError("Incomplete static portrait")


def avatar(port, slug):
    # Fixed local endpoint used by Friends' Bothouse instance.py role_portrait.
    # Never follow the library's URL or HTTP redirects; send no token.
    if not SLUG.fullmatch(slug) or type(port) is not int or not 0 < port <= 65535:
        return None
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        conn.request("GET", "/api/v1/library/avatar-image/" + slug)
        reply = conn.getresponse()
        if reply.status == 200 and reply.getheader("Content-Type") == "image/png":
            return pixels(reply.read(MAX_PNG + 1))
    except (OSError, ValueError, zlib.error, http.client.HTTPException):
        pass
    finally:
        conn.close()
    return None


def public_text(s):
    return isinstance(s, str) and 0 < len(s.strip()) <= 160 and all(c.isprintable() for c in s)


def index_library(library):
    packs = {p["id"]: p for p in library.get("packs") or [] if p.get("enabled") is True}
    return {a["slug"]: (a, packs[a["pack"]]) for a in library.get("avatars") or []
            if a.get("pack") in packs and not a.get("hidden")}


def prepare(snapshot, port, library, approvals=()):
    """After ACL/selection. library() returns GET library's data, never a path.
    Optional exact grants carry instance, project, slug, pack, sha256, author, license.
    Returns a bounded wire roster and only the PNGs offered by this snapshot.
    """
    wire = {**snapshot, "residents": [dict(r) for r in snapshot["residents"]]}
    images = {}
    candidates = [r for r in wire["residents"] if r["source"] == "bridge" and r["appearanceKey"] != "default"]
    if not candidates:
        return wire, images

    def read_index():
        try:
            return index_library(library())
        except (KeyError, ValueError, TypeError, http.client.HTTPException, OSError):
            return {}

    before = read_index()
    used = 0
    prepared = []
    for r in candidates:
        slug = r["appearanceKey"]
        r["portrait"] = None
        if not SLUG.fullmatch(slug) or slug not in before:
            continue
        item, pack = before[slug]
        if pack["id"] == "default" and pack.get("builtin") is True:
            prepared.append((r, slug, None, None))
            continue
        grants = [g for g in approvals if all(g.get(k) == v for k, v in (
            ("instance", wire["instance"]), ("project", r["project"]), ("slug", slug), ("pack", pack["id"])))]
        licensed = pack.get("license") in PUBLIC_LICENSES and public_text(pack.get("author"))
        if not licensed and not grants:
            continue
        raw = avatar(port, slug)
        if not raw or used + len(raw) > 32 * 1024 * 1024:
            continue
        sha = hashlib.sha256(raw).hexdigest()
        grant = next((g for g in grants if g.get("sha256") == sha), None)
        if not licensed and grant is None:
            continue
        # A grant permits sharing this exact file. Keep the pack's existing
        # attribution and terms wherever it already supplies them.
        credit = {k: pack.get(k) or (grant or {}).get(k) for k in ("author", "license")}
        if not all(public_text(credit.get(k)) for k in ("author", "license")):
            continue
        descriptor = dict(sha256=sha, pack=item["pack"], author=credit["author"], license=credit["license"])
        prepared.append((r, slug, descriptor, raw))
        used += len(raw)
    # The library's revision-bearing URL is compared only as metadata. A pack
    # disabled or replaced during the local read must not carry its old credit.
    after = read_index() if prepared else {}
    for r, slug, d, raw in prepared:
        if before[slug] != after.get(slug):
            continue
        if d is None:
            del r["portrait"]  # authoritative built-in, use its original animation
            continue
        r["portrait"] = d
        rid = "bh_" + hashlib.sha256((wire["instance"] + "\0" + r["project"]).encode()).hexdigest()[:21]
        images[(rid, d["sha256"])] = raw
    return wire, images


def upload_missing(origin, token, response, images):
    """Use the same validated world origin and source token as /api/resident-feed."""
    if origin.scheme != "https" and not (origin.scheme == "http" and origin.hostname in ("127.0.0.1", "::1", "localhost")):
        raise ValueError("Use the bound world origin")
    for entry in response.get("missingArt", []):
        identity = (entry.get("id"), entry.get("sha256"))
        if identity not in images:
            continue
        conn = (http.client.HTTPSConnection if origin.scheme == "https" else http.client.HTTPConnection)(
            origin.hostname, origin.port, timeout=5)
        try:
            conn.request("POST", "/api/resident-feed/art/" + "/".join(identity), images[identity],
                         {"Authorization": "Bearer " + token, "Content-Type": "image/png"})
            reply = conn.getresponse()
            if reply.status != 200 or json.loads(reply.read(512)).get("ok") is not True:
                raise ValueError("World did not accept the portrait")
        finally:
            conn.close()


def publish_current(publisher, config, selected, friends, world, token, *, approvals=(),
                    expected_instance=None, stopped=None):
    """Shared by the command and the Windows host; pass globals of publish-residents.py."""
    def snapshot():
        snap = publisher["project_snapshot"](config, selected, friends)
        if expected_instance is not None and snap["instance"] != expected_instance:
            raise ValueError("The bound Bothouse instance changed")
        return snap

    first = snapshot()
    with config.open("rb") as stream:
        mgmt = tomllib.load(stream)["management"]
    port = mgmt.get("port") or 9820
    local = publisher["origin"]("http://127.0.0.1:" + str(port), local=True)
    request = publisher["request"]

    def library():
        result = request(local, "/api/v1/library", {"Authorization": "Bearer " + mgmt["token"]})
        return result["data"] if result.get("ok") is True else {}

    wire, images = prepare(first, port, library, approvals)
    if images:
        # Selection/ACL may have changed during local image reads. Use the
        # newest roster and retain bytes only for its unchanged exact bindings.
        latest = snapshot()
        if latest["instance"] != first["instance"]:
            raise ValueError("The bound Bothouse instance changed")
        by_role = {(r["source"], r["project"], r["appearanceKey"]): r for r in wire["residents"]}
        allowed = set()
        for row in latest["residents"]:
            key = (row["source"], row["project"], row["appearanceKey"])
            old = by_role.get(key, {})
            if "portrait" in old:
                row["portrait"] = old["portrait"]
                if row["portrait"]:
                    rid = "bh_" + hashlib.sha256((latest["instance"] + "\0" + row["project"]).encode()).hexdigest()[:21]
                    allowed.add((rid, row["portrait"]["sha256"]))
            elif not old and row["source"] == "bridge":
                row["portrait"] = None
        wire, images = latest, {k: v for k, v in images.items() if k in allowed}
    if stopped is not None and stopped.is_set():
        return None
    publisher["finalize_looks"](wire)
    result = request(world, "/api/resident-feed", {"Authorization": "Bearer " + token,
                     "Content-Type": "application/json"}, wire)
    if result.get("ok") is not True:
        raise ValueError("The world did not confirm publication")
    if stopped is None or not stopped.is_set():
        upload_missing(world, token, result, images)
    return wire
