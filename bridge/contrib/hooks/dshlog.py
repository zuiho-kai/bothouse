"""DSH session logs: find them and read their lines, plain or zstd-compressed.

DSH (dsh-session-persistence-jsonl) writes <DSH_HOME>/sessions/<cwd slug>/<session dir>/ session.v4.jsonl, or
session.v4.jsonl.zstd when its compression is "zstd" (the default). A .zstd log is a run of zstd frames, one per
append batch; the last frame may still be incomplete while DSH writes it. Every reader in bothouse uses this file:
hooks/run.py (installed next to it), tools/peek.py (installed next to it in <data_dir>/tools) and wiki/export.py
(loads it from ../hooks in this checkout).

Decoders, first that is available: Python's compression.zstd (3.14+), the zstandard module, the node that runs
DSH (zlib.zstdDecompressSync, which decodes only the first frame of a buffer, so frames are split here first).
Frames are decoded one by one; decoding stops at the first incomplete or broken frame, and the lines before it
are returned. A file that cannot be read at all gives [].
"""
import glob
import os
import subprocess
import sys

LOG_NAMES = ("session.v4.jsonl", "session.v4.jsonl.zstd")

# Splits a buffer of concatenated zstd frames (RFC 8878 section 3.1) and decodes each with node's zlib.
NODE_ZSTD = r"""
const z = require('zlib');
if (!z.zstdDecompressSync) { process.stderr.write('node ' + process.version + ' has no zlib zstd\n'); process.exit(3); }
const b = require('fs').readFileSync(process.argv[1]); const out = []; let p = 0;
while (p + 4 <= b.length) {
  const m = b.readUInt32LE(p);
  if (((m & 0xFFFFFFF0) >>> 0) === 0x184D2A50) { if (p + 8 > b.length) break; p += 8 + b.readUInt32LE(p + 4); continue; }
  if (m !== 0xFD2FB528) break;
  let q = p + 4; const fhd = b[q++]; const single = (fhd >> 5) & 1, fcs = fhd >> 6;
  if (!single) q++;
  q += [0, 1, 2, 4][fhd & 3];
  q += fcs === 0 ? single : [0, 2, 4, 8][fcs];
  let ok = true;
  for (;;) {
    if (q + 3 > b.length) { ok = false; break; }
    const h = b[q] | (b[q + 1] << 8) | (b[q + 2] << 16); q += 3;
    q += ((h >> 1) & 3) === 1 ? 1 : (h >>> 3);
    if (h & 1) break;
  }
  if (!ok) break;
  if ((fhd >> 2) & 1) q += 4;
  if (q > b.length) break;
  try { out.push(z.zstdDecompressSync(b.subarray(p, q))); } catch (e) { break; }
  p = q;
  if (process.argv[2] === 'head') break;
}
process.stdout.write(Buffer.concat(out));
"""


def _pick(paths):
    """The log of one session directory: the newer file when both encodings are there (the compression setting
    was changed; DSH writes only the configured one)."""
    best = None
    for p in paths:
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        if best is None or m > best[0]:
            best = (m, p)
    return best[1] if best else None


def session_logs(dsh_home):
    """Every session log under <dsh_home>/sessions, one per session directory, sorted by path."""
    by_dir = {}
    base = glob.escape(os.path.join(os.path.expanduser(str(dsh_home)), "sessions"))
    for name in LOG_NAMES:
        for p in glob.glob(os.path.join(base, "*", "*", name)):
            by_dir.setdefault(os.path.dirname(p), []).append(p)
    return sorted(p for p in (_pick(v) for v in by_dir.values()) if p)


def session_file(dsh_home, sid):
    """The log of session `sid` (its directory name), None if there is none."""
    if not sid:
        return None
    base = os.path.join(glob.escape(os.path.join(os.path.expanduser(str(dsh_home)), "sessions")), "*", glob.escape(sid))
    return _pick([p for name in LOG_NAMES for p in glob.glob(os.path.join(base, name))])


def _frames(raw, head, new):
    """Decode raw frame by frame with new() -> a one-frame decompressor (.decompress, .eof, .unused_data)."""
    out = []
    while raw:
        d = new()
        try:
            chunk = d.decompress(raw)
        except Exception:
            break  # a broken frame: keep what came before
        if not d.eof:
            break  # the frame DSH is still writing
        out.append(chunk)
        raw = d.unused_data
        if head:
            break
    return b"".join(out)


def _decode_zstd(path, head):
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return None
    try:  # any failure here (no module, an older module without .eof/.unused_data) moves on to the next decoder
        from compression import zstd  # Python 3.14+
        return _frames(raw, head, zstd.ZstdDecompressor)
    except Exception:
        pass
    try:
        import zstandard
        return _frames(raw, head, lambda: zstandard.ZstdDecompressor().decompressobj())
    except Exception:
        pass
    try:
        r = subprocess.run(["node", "-e", NODE_ZSTD, path] + (["head"] if head else []),
                           capture_output=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        r = e
    if isinstance(r, subprocess.CompletedProcess) and r.returncode == 0:
        return r.stdout
    # no decoder at all: say so (on stderr, the caller still gets []), or every .zstd log silently reads as empty
    why = r.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] if isinstance(r, subprocess.CompletedProcess) else [str(r)]
    print(f"dshlog: cannot decode {path}: no compression.zstd (Python 3.14+), no zstandard module, and node "
          f"failed ({'; '.join(why) or 'exit ' + str(r.returncode)})", file=sys.stderr)
    return None


def read_lines(path, head=False):
    """Lines of a DSH session log, plain or zstd (by the .zstd suffix); [] when it cannot be read.
    head: only the first line (the session record), decoding only the first zstd frame."""
    path = str(path)
    if not path.endswith(".zstd"):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                return [f.readline().rstrip("\n")] if head else f.read().splitlines()
        except OSError:
            return []
    data = _decode_zstd(path, head)
    if not data:
        return []
    lines = data.decode("utf-8", "replace").splitlines()
    return lines[:1] if head else lines
