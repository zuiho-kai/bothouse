import hashlib
import json
import subprocess
import sys
from pathlib import Path

FPS = 30
SEG = 300       # frames per segment: each segment gets a fresh browser and encoder to cap peak memory
SCALE = 1.0     # capture scale: 1.0 grabs 1280x720 and upscales to 1080p; use 1.5 if the machine is idle and small text looks soft
ENCODE = ["-vf", "scale=1920:1080:flags=lanczos",
          "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p"]


def render_fingerprint(stage: Path, timeline: dict) -> str:
    # 覆盖时间轴、素材和渲染参数，让旧画面不能混入新版本。
    files = []
    for path in sorted(stage.rglob("*")):
        if path.is_file():
            with path.open("rb") as stream:
                files.append((path.relative_to(stage).as_posix(), hashlib.file_digest(stream, "sha256").hexdigest()))
    inputs = {"timeline": timeline, "stage": files, "fps": FPS, "segment_frames": SEG,
              "scale": SCALE, "encode": ENCODE,
              "renderer": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode("utf-8")).hexdigest()


def segment_is_current(path: Path, fingerprint: str) -> bool:
    metadata = path.with_suffix(".sha256")
    return (path.is_file() and path.stat().st_size > 0 and metadata.is_file()
            and metadata.read_text(encoding="ascii").strip() == fingerprint)


class Project:
    def __init__(self, root: Path):
        self.root = root
        self.stage = root / "stage"
        self.build = root / "build"
        self.segs = self.build / "segs"
        spec = json.loads((root / "narration.json").read_text(encoding="utf-8"))
        self.out = (root / spec["output"]).resolve()
        # optional music bed: path relative to the project, target loudness before ducking
        self.music = (root / spec["music"]).resolve() if spec.get("music") else None
        self.music_lufs = float(spec.get("music_lufs", -30.0))
        # inject the TTS timeline into the page
        self.tl = json.loads((self.build / "timeline.json").read_text(encoding="utf-8"))
        self.tl["fps"] = FPS
        (self.stage / "timeline.js").write_text("window.TL = " + json.dumps(self.tl, ensure_ascii=False) + ";",
                                                encoding="utf-8")
        self.n = int(self.tl["total"] * FPS)
        self.k_total = -(-self.n // SEG)
        self.fingerprint = render_fingerprint(self.stage, self.tl)

    def open_page(self, p, scale: float):
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=scale)
        pg.goto((self.stage / "index.html").as_uri() + "?capture=1")
        pg.wait_for_function("window.READY === true")
        # 场景构建完成后，等待字体就绪和图片解码。
        pg.evaluate("""async () => {
            await document.fonts.ready;
            await Promise.all(Array.from(document.images, image => image.decode()));
        }""")
        return b, pg


def stills(pj: Project, times: list[float]) -> None:
    from playwright.sync_api import sync_playwright

    # QA stills: capture at 1.5x so small text is readable
    with sync_playwright() as p:
        b, pg = pj.open_page(p, 1.5)
        for t in times:
            pg.evaluate(f"renderAt({t})")
            path = pj.build / f"still_{t:05.1f}.png"
            pg.screenshot(path=str(path))
            print(path)
        b.close()


def render_seg(pj: Project, k: int) -> None:
    # render segment k to .part, rename on success, so an interrupted run can resume
    lo, hi = k * SEG, min((k + 1) * SEG, pj.n)
    pj.segs.mkdir(parents=True, exist_ok=True)
    out = pj.segs / f"seg_{k:02d}.mp4"
    if segment_is_current(out, pj.fingerprint):
        print(f"skip seg {k}", flush=True)
        return
    from playwright.sync_api import sync_playwright

    part = pj.segs / f"seg_{k:02d}.part.mp4"
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg",
         "-i", "-", *ENCODE, str(part)],
        stdin=subprocess.PIPE,
    )
    with sync_playwright() as p:
        b, pg = pj.open_page(p, SCALE)
        for i in range(lo, hi):
            pg.evaluate(f"renderAt({i / FPS})")
            enc.stdin.write(pg.screenshot(type="jpeg", quality=95))
        b.close()
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError(f"ffmpeg encode failed: seg {k}")
    part.replace(out)
    out.with_suffix(".sha256").write_text(pj.fingerprint + "\n", encoding="ascii")
    print(f"done seg {k}: frames {lo}-{hi - 1}", flush=True)


def concat(pj: Project) -> Path:
    # segments share encode settings, so the concat demuxer joins them with stream copy
    files = [pj.segs / f"seg_{k:02d}.mp4" for k in range(pj.k_total)]
    missing = [f.name for f in files if not f.exists()]
    if missing:
        raise RuntimeError(f"missing segments: {missing}")
    stale = [f.name for f in files if not segment_is_current(f, pj.fingerprint)]
    if stale:
        raise RuntimeError(f"stale or unverified segments: {stale}; rerun seg before final")
    lst = pj.segs / "list.txt"
    lst.write_text("".join(f"file '{f.name}'\n" for f in files), encoding="utf-8")
    silent = pj.build / "silent.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-c", "copy", str(silent)], check=True)
    lst.unlink()
    return silent


def loudness(path: Path) -> float:
    # integrated loudness (LUFS) via ffmpeg ebur128
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True, check=True)
    lines = [l for l in r.stderr.splitlines() if l.strip().startswith("I:")]
    return float(lines[-1].split()[1])


def mix(pj: Project, silent: Path) -> None:
    # delay each narration line to its start; optionally add a music bed that ducks under the voice
    lines = [l for s in pj.tl["scenes"] for l in s["lines"]]
    total = pj.tl["total"]
    args = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent)]
    for l in lines:
        args += ["-i", l["file"]]
    parts = []
    for i, l in enumerate(lines, start=1):
        ms = int(l["start"] * 1000)
        parts.append(f"[{i}:a]adelay={ms}|{ms},volume=1.6[v{i}]")
    vins = "".join(f"[v{i}]" for i in range(1, len(lines) + 1))
    if pj.music:
        # per-track gain puts the bed at music_lufs before ducking, whatever the source loudness
        gain = pj.music_lufs - loudness(pj.music)
        args += ["-i", str(pj.music)]
        m = len(lines) + 1
        parts += [
            f"{vins}amix=inputs={len(lines)}:normalize=0,asplit=2[voice][sc]",
            f"[{m}:a]atrim=0:{total},asetpts=PTS-STARTPTS,volume={gain:.2f}dB,"
            f"afade=t=in:d=2,afade=t=out:st={total - 3:.3f}:d=3[bed]",
            # voice above threshold pushes the bed down ~10 dB; 400 ms release avoids pumping between lines
            "[bed][sc]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=400[duck]",
            "[voice][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]",
        ]
    else:
        parts.append(f"{vins}amix=inputs={len(lines)}:normalize=0,alimiter=limit=0.95[a]")
    # 补齐镜头留白，使无配乐时音轨也覆盖整个时间轴。
    parts.append(f"[a]apad=whole_dur={total}[padded]")
    args += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[padded]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(total), "-movflags", "+faststart", str(pj.out)]
    subprocess.run(args, check=True)
    silent.unlink()
    print("wrote", pj.out)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: render.py PROJECT_DIR stills T... | seg K... | count | final")
    pj = Project(Path(sys.argv[1]).resolve())
    cmd, rest = sys.argv[2], sys.argv[3:]
    if cmd == "stills":
        stills(pj, [float(x) for x in rest])
    elif cmd == "seg":
        for k in rest:
            render_seg(pj, int(k))
    elif cmd == "count":
        print(pj.k_total)
    elif cmd == "final":
        mix(pj, concat(pj))
    else:
        raise SystemExit(f"unknown command: {cmd}")
