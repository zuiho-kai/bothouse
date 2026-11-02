#!/usr/bin/env -S uv run -q --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "jieba", "yt-dlp"]
# ///
"""watchvid <URL> [--p N] [--lang auto|zh|en|ja] [--out DIR] [--keep-video]
       → <out>/<media id>/watchvid-index.md (printed as the last stdout line; the file for the AI to read first)

Why: a bot only gets a video's title and comments; it cannot see the picture or hear the sound. This splits the
video into files an AI can read, in one folder per video:
   meta.json   frames/<sec>s.jpg (scene cuts plus a minimum spacing, at most 40, 768 px wide)   audio.m4a
   transcript.txt (timestamped)   danmaku.txt (Bilibili bullet comments, by time)   comments.txt (top 20)
   watchvid-index.md (overview with every path)
The downloaded video is deleted once frames and audio are out (--keep-video keeps video.mp4). A folder that already
has watchvid-index.md, meta.json and transcript.txt is returned at once; delete it to parse again.

Sites: Bilibili (BV ids, bilibili.com/video/…, b23.tv; multi-part videos default to p=1) through its web API, with
bullet comments and top comments; everything else yt-dlp supports (YouTube, …) through yt-dlp.
Site adapters: a site neither handles (Douyin needs signed requests, for one) can be added without editing this
script. Put a <name>.py in ~/.config/watchvid/adapters (or the folders in $WATCHVID_ADAPTERS, separated by ":")
with MATCH (a regex tried against the link) and fetch(url, folder) that saves folder/video.mp4 and returns a meta
dict (title, url, and optionally site, id, owner, desc, duration, pubdate, stat); optional media_id(url) names the
output folder. A matching adapter is tried before Bilibili and yt-dlp. See watchvid-adapters/ for an example.

Needs: uv (runs this script and installs requests, jieba, yt-dlp by itself) and ffmpeg + ffprobe on PATH
(or WATCHVID_FFMPEG / WATCHVID_FFPROBE). Nothing else is required.

Output folder: --out, else $WATCHVID_DIR, else <data_dir>/media when this script is installed as
<data_dir>/tools/watchvid.py by bothouse, else ~/.bothouse/media.

Transcript, best available first:
   1. $WATCHVID_ASR_URL: any OpenAI-compatible /v1/audio/transcriptions endpoint (OpenAI, Groq, a local
      whisper server …), with $WATCHVID_ASR_KEY and $WATCHVID_ASR_MODEL (default whisper-1). Audio is cut at
      silences into segments of at most 30 s, so every line has a start and end time.
   2. the site's own subtitles or auto-captions through yt-dlp (YouTube and most yt-dlp sites; free, no key).
   3. none: transcript.txt is not written (the next run tries again) and the index says how to turn one on.

Optional, never required:
   Bilibili login: a Cookie header saved in ~/.config/watchvid/bilibili.cookie (or the file named by
   $WATCHVID_BILI_COOKIE), one line "SESSDATA=…; bili_jct=…". Without it the video is fetched logged out
   (about 480P), which is enough for 768 px frames. The cookie is never printed or written to the output.
   $WATCHVID_CN_PROXY=http://host:port: an HTTP proxy with a mainland-China exit, tried next to the direct route
   for Bilibili (its API sometimes answers overseas IPs with a risk-control page)."""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, zlib
from collections import Counter
from functools import reduce
from hashlib import md5
from pathlib import Path

CN_PROXY = os.environ.get("WATCHVID_CN_PROXY", "")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Referer": "https://www.bilibili.com", "Accept-Language": "zh-CN,zh;q=0.9"}
COOKIE_FILE = Path(os.environ.get("WATCHVID_BILI_COOKIE") or Path.home() / ".config/watchvid/bilibili.cookie")
ASR_URL = os.environ.get("WATCHVID_ASR_URL", "")
ASR_KEY = os.environ.get("WATCHVID_ASR_KEY", "")
ASR_MODEL = os.environ.get("WATCHVID_ASR_MODEL", "whisper-1")
# the numbers below are carried over (沿用) from the maintainers' original watchvid
MAX_FRAMES, FRAME_W = 40, 768          # 沿用原版，来源：原任务「最多 40 张左右，宽度压到 ~768px」
SHORT_GAP = (2.0, 4.0)                 # 沿用原版，来源：原任务「短视频大约每 2–4 秒一张」
TARGET_QN = 64                         # 沿用原版：Bilibili 720P，768 宽的帧够用
SEG_MAX = 30.0                         # 沿用原版：转写分段上限（秒）
TOP_COMMENTS = 20                      # 沿用原版：热评前 20


def log(*a): print("[watchvid]", *a, file=sys.stderr, flush=True)


def die(msg): log(msg); sys.exit(1)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def find_ffmpeg():
    ff = os.environ.get("WATCHVID_FFMPEG") or shutil.which("ffmpeg")
    fp = os.environ.get("WATCHVID_FFPROBE") or shutil.which("ffprobe")
    if not ff or not fp:
        die("ffmpeg and ffprobe are required and were not found on PATH. Install them: macOS `brew install ffmpeg`, "
            "Debian/Ubuntu `sudo apt install ffmpeg`, Windows `winget install Gyan.FFmpeg`; "
            "or point WATCHVID_FFMPEG / WATCHVID_FFPROBE at the binaries.")
    return ff, fp


FFMPEG = FFPROBE = None


def out_root(explicit):
    if explicit:
        return Path(explicit).expanduser()
    if os.environ.get("WATCHVID_DIR"):
        return Path(os.environ["WATCHVID_DIR"]).expanduser()
    here = Path(__file__).resolve().parent
    if here.name == "tools" and (here.parent / "config.toml").exists():  # installed by bothouse into <data_dir>/tools
        return here.parent / "media"
    home = Path.home()
    data = home / ".bothouse"
    if not data.exists() and (home / ".cc-connect").is_dir():
        data = home / ".cc-connect"
    return data / "media"


# ---------- Bilibili ----------
def bili_cookies():
    if COOKIE_FILE.is_file():
        try:
            raw = COOKIE_FILE.read_text().strip()
            return dict(kv.strip().split("=", 1) for kv in raw.split(";") if "=" in kv), "file"
        except OSError as ex:
            log(f"cannot read the Bilibili cookie file ({type(ex).__name__}); going on logged out")
    return {}, None


def bili_session(cookies, proxy):
    import requests
    s = requests.Session(); s.headers.update(HEADERS)
    if proxy:
        s.trust_env = False; s.proxies = {"http": CN_PROXY, "https": CN_PROXY}
    for k, v in cookies.items(): s.cookies.set(k, v, domain=".bilibili.com")   # only to Bilibili, never to the CDN
    return s


def pick_route(cookies, bvid):
    """Try the view API on each route (direct, and the CN proxy when set); fastest working route first."""
    tries = []
    for name, px in (("direct", False),) + ((("proxy", True),) if CN_PROXY else ()):
        s = bili_session(cookies, px); t0 = time.time()
        try:
            r = s.get("https://api.bilibili.com/x/web-interface/view", params={"bvid": bvid}, timeout=15)
            ok = r.headers.get("content-type", "").startswith("application/json") and r.json().get("code") == 0
            tries.append({"route": name, "ok": ok, "http": r.status_code, "sec": round(time.time() - t0, 2)})
        except Exception as ex:
            tries.append({"route": name, "ok": False, "http": None, "sec": round(time.time() - t0, 2), "error": type(ex).__name__})
    for t in tries: log(f"API {t['route']}: HTTP {t['http']} {t['sec']}s {'ok' if t['ok'] else 'failed'}")
    order = sorted(tries, key=lambda t: (not t["ok"], t["sec"]))
    return [bili_session(cookies, t["route"] == "proxy") for t in order], tries


def api(sessions, url, ok_codes=(0,), **params):
    """Each route in turn; an HTML answer, network error or risk-control code moves to the next one."""
    errs = []
    for s in sessions:
        for _ in range(2):
            try:
                j = s.get(url, params=params, timeout=20).json()
            except Exception as ex:
                errs.append(type(ex).__name__); time.sleep(1); continue
            if j.get("code") in ok_codes: return j.get("data") or {}
            if j.get("code") in (-352, -412, -509): errs.append(f"code={j['code']}"); break   # risk control
            raise RuntimeError(f"{url} code={j.get('code')} {j.get('message')}")
    hint = "" if CN_PROXY else " (Bilibili may block this IP; WATCHVID_CN_PROXY can add a mainland-China route)"
    raise RuntimeError(f"{url} failed on every route: {', '.join(errs)}{hint}")


MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39,
         12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
         57, 62, 11, 36, 20, 34, 44, 52]   # Bilibili's WBI key table (public, from its web player)


def wbi(nav, params):
    stem = lambda u: u.rsplit("/", 1)[1].split(".")[0]
    raw = stem(nav["wbi_img"]["img_url"]) + stem(nav["wbi_img"]["sub_url"])
    key = reduce(lambda a, i: a + raw[i], MIXIN, "")[:32]
    p = dict(params, wts=int(time.time()))
    p = {k: re.sub(r"[!'()*]", "", str(v)) for k, v in sorted(p.items())}
    p["w_rid"] = md5((urllib.parse.urlencode(p) + key).encode()).hexdigest()
    return p


def resolve(url):
    import requests
    if re.fullmatch(r"BV\w{10}", url): return url, None
    if "b23.tv" in url:
        loc = requests.get(url, headers={"User-Agent": UA}, allow_redirects=False, timeout=15).headers.get("location")
        if not loc: die(f"short link {url} does not redirect (expired or blocked)")
        url = loc
    m = re.search(r"(BV\w{10})", url)
    if not m: return None, None
    p = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("p", [None])[0]
    return m.group(1), p


def pick_streams(dash):
    vids = list(dash["video"])
    avc = [v for v in vids if v.get("codecid") == 7] or vids          # AVC decodes most reliably
    under = [v for v in avc if v["id"] <= TARGET_QN]
    v = max(under, key=lambda x: (x["id"], -x["bandwidth"])) if under else min(avc, key=lambda x: x["id"])
    audios = (dash.get("audio") or []) + ([dash["flac"]["audio"]] if (dash.get("flac") or {}).get("audio") else [])
    a = min(audios, key=lambda x: x["bandwidth"]) if audios else None
    return v, a


def download(urls, dst):
    """Every CDN address (× direct/proxy) is tested for up to 3 s at once; the fastest one downloads."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    if dst.exists() and dst.stat().st_size > 0: return "reused"

    def probe(job):
        url, mode, px = job
        ss = requests.Session(); ss.headers.update(HEADERS)   # the CDN never gets the cookie
        if px: ss.trust_env = False; ss.proxies = px
        try:
            t0, n = time.time(), 0
            with ss.get(url, stream=True, timeout=3, headers={"Range": "bytes=0-2097151"}) as r:
                if r.status_code not in (200, 206): return None
                for c in r.iter_content(8192):
                    n += len(c)
                    if time.time() - t0 > 3: break
            return n / max(time.time() - t0, 1e-3), url, ss, mode
        except Exception:
            return None

    routes = (("direct", None),) + ((("proxy", {"http": CN_PROXY, "https": CN_PROXY}),) if CN_PROXY else ())
    jobs = [(u, m, px) for u in urls[:4] for m, px in routes]
    with ThreadPoolExecutor(len(jobs)) as ex:
        results = [r for r in ex.map(probe, jobs) if r]
    if not results: raise RuntimeError(f"{dst.name}: no CDN address could be downloaded")
    tmp = dst.with_suffix(dst.suffix + ".part")
    for spd, url, ss, mode in sorted(results, key=lambda x: -x[0]):   # fastest first; on failure the next one
        try:
            with ss.get(url, stream=True, timeout=30) as r, open(tmp, "wb") as f:
                r.raise_for_status()
                for c in r.iter_content(1 << 20): f.write(c)
        except Exception:
            continue
        tmp.rename(dst)
        return f"{mode} ({spd / 1e6:.1f} MB/s)"
    raise RuntimeError(f"{dst.name}: every address failed mid-download")


def danmaku(sessions, cid, out):
    for s in sessions:
        try:
            raw = s.get("https://api.bilibili.com/x/v1/dm/list.so", params={"oid": cid}, timeout=20).content
            if b"<!DOCTYPE" not in raw[:200]: break
        except Exception: pass
    else:
        raise RuntimeError("no route returned the bullet comments")
    try: raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    except zlib.error: pass
    import html
    items = sorted((float(p.split(",")[0]), html.unescape(t))
                   for p, t in re.findall(r'<d p="([^"]+)">([^<]*)</d>', raw.decode("utf-8", "ignore")))
    out.write_text("".join(f"{t:7.1f}s  {x}\n" for t, x in items) or "(no bullet comments)\n")
    return items


def comments(sessions, nav, aid, out):
    data = api(sessions, "https://api.bilibili.com/x/v2/reply/wbi/main",
               **wbi(nav, {"oid": aid, "type": 1, "mode": 3, "ps": TOP_COMMENTS, "plat": 1, "web_location": 1315875}))  # 沿用原版：B 站网页端参数
    rs = (data.get("top_replies") or []) + (data.get("replies") or [])
    lines = [f"[{r['like']} likes] {r['member']['uname']}: {r['content']['message']}".replace("\n", " ") for r in rs[:TOP_COMMENTS]]
    out.write_text("\n".join(lines) + "\n" if lines else "(no comments)\n")
    return len(lines)


def ffmpeg_to(dst, args):
    """Write to .part first and rename on success; returns the error text on failure."""
    tmp = dst.with_name(dst.name + ".part")
    r = run([FFMPEG, "-y", "-loglevel", "error"] + args + ["-f", "mp4" if dst.suffix == ".mp4" else "ipod", str(tmp)])
    if r.returncode:
        tmp.unlink(missing_ok=True); return r.stderr[-500:] or "ffmpeg failed"
    tmp.rename(dst)


def bilibili(bvid, p, d):
    cookies, src = bili_cookies()
    sessions, tries = pick_route(cookies, bvid)
    # 沿用原版 watchvid: the nav API answers code -101 when logged out, and wbi_img is still in data
    nav = api(sessions, "https://api.bilibili.com/x/web-interface/nav", ok_codes=(0, -101))
    login = bool(nav.get("isLogin"))
    log("logged in" if login else "logged out" + (" (cookie file rejected)" if src else ""))
    view = api(sessions, "https://api.bilibili.com/x/web-interface/view", bvid=bvid)
    pages = view.get("pages") or [{"cid": view["cid"], "page": 1, "part": "", "duration": view["duration"]}]
    page = next((x for x in pages if x["page"] == p), None) or die(f"there is no p={p}; the video has {len(pages)} parts")
    st = view["stat"]
    meta = {"site": "bilibili", "id": bvid, "url": f"https://www.bilibili.com/video/{bvid}?p={p}", "p": p,
            "pages": len(pages), "part": page.get("part"), "title": view["title"], "owner": view["owner"]["name"],
            "desc": view["desc"], "duration": page["duration"],
            "pubdate": time.strftime("%Y-%m-%d %H:%M", time.localtime(view["pubdate"])), "tname": view.get("tname_v2") or view.get("tname"),
            "stat": {k: st.get(k) for k in ("view", "danmaku", "reply", "favorite", "coin", "share", "like")},
            "aid": view["aid"], "cid": page["cid"], "logged_in": login,
            "api_route": [{k: t[k] for k in ("route", "ok", "http", "sec")} for t in tries]}
    mp4, m4a = d / "video.mp4", d / "audio.m4a"
    vf, af = d / "video.m4s", d / "audio.m4s"
    if not mp4.exists():
        play = api(sessions, "https://api.bilibili.com/x/player/wbi/playurl",
                   **wbi(nav, {"bvid": bvid, "cid": page["cid"], "fnval": 4048, "fnver": 0, "fourk": 1, "qn": 0}))  # 沿用原版：DASH 全清晰度
        v, a = pick_streams(play["dash"])
        qmap = dict(zip(play.get("accept_quality", []), play.get("accept_description", [])))
        meta["stream"] = {"quality": qmap.get(v["id"], v["id"]), "size": f"{v['width']}x{v['height']}", "codecs": v["codecs"]}
        log(f"stream {meta['stream']['quality']} {meta['stream']['size']}")
        log("video", download([v["baseUrl"]] + (v.get("backupUrl") or []), vf))
        if a: log("audio", download([a["baseUrl"]] + (a.get("backupUrl") or []), af))
        err = ffmpeg_to(mp4, ["-i", str(vf)] + (["-i", str(af)] if a else []) + ["-c", "copy"])
        if err: die("ffmpeg could not merge the streams (the .m4s files are kept for the next run): " + err)
        if a and not m4a.exists() and ffmpeg_to(m4a, ["-i", str(af), "-c", "copy"]) is None: af.unlink()
        vf.unlink(missing_ok=True)
    dm = d / "danmaku.txt"
    if not dm.exists():
        try: log(f"{len(danmaku(sessions, page['cid'], dm))} bullet comments")
        except Exception as ex: log(f"bullet comments failed: {ex}")
    cm = d / "comments.txt"
    if not cm.exists():
        try: log(f"{comments(sessions, nav, view['aid'], cm)} top comments")
        except Exception as ex: log(f"comments failed: {ex}")
    return meta, mp4


# ---------- other sites (yt-dlp) ----------
YTDLP = [sys.executable, "-m", "yt_dlp"]


def ytdlp_info(url):
    r = run(YTDLP + ["-J", "--no-playlist", url])
    if r.returncode: die("yt-dlp cannot read this link: " + r.stderr[-400:])
    info = json.loads(r.stdout)
    return info, "vid-" + re.sub(r"[^\w.-]", "_", f"{info.get('extractor_key', 'web')}_{info['id']}")


def ytdlp(url, info, d):
    mp4 = d / "video.mp4"
    if not mp4.exists():
        r = run(YTDLP + ["--no-playlist", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                         "--ffmpeg-location", str(Path(FFMPEG).parent), "-o", str(mp4), url])
        if r.returncode or not mp4.exists(): die("yt-dlp download failed: " + r.stderr[-400:])
    meta = {"site": info.get("extractor_key"), "id": info["id"], "url": info.get("webpage_url", url), "title": info.get("title"),
            "owner": info.get("uploader") or info.get("channel"), "desc": info.get("description"), "duration": info.get("duration"),
            "pubdate": info.get("upload_date"),
            "stat": {"view": info.get("view_count"), "like": info.get("like_count"), "reply": info.get("comment_count")}}
    return meta, mp4


# ---------- site adapters ----------
def adapter_dirs():
    env = os.environ.get("WATCHVID_ADAPTERS")
    return [Path(x).expanduser() for x in env.split(os.pathsep) if x] if env else [Path.home() / ".config/watchvid/adapters"]


def load_adapters(dirs=None):
    """Every <name>.py in the adapter folders that defines MATCH and fetch; broken ones are skipped with a log line."""
    import importlib.util
    found = []
    for folder in dirs if dirs is not None else adapter_dirs():
        for f in sorted(folder.glob("*.py")) if folder.is_dir() else []:
            try:
                spec = importlib.util.spec_from_file_location(f"watchvid_adapter_{f.stem}", f)
                mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
                re.compile(mod.MATCH)
                if not callable(mod.fetch): raise AttributeError("fetch is not callable")
            except Exception as ex:
                log(f"adapter {f} skipped: {ex}"); continue
            mod.NAME = f.stem; found.append(mod)
    return found


def pick_adapter(url, adapters):
    return next((a for a in adapters if re.search(a.MATCH, url)), None)


def adapter_id(ad, url):
    raw = ad.media_id(url) if callable(getattr(ad, "media_id", None)) else md5(url.encode()).hexdigest()[:12]
    return "ad-" + re.sub(r"[^\w.-]", "_", f"{ad.NAME}_{raw}")


def via_adapter(ad, url, d):
    mp4 = d / "video.mp4"
    try:
        meta = dict(ad.fetch(url, d) or {})
    except Exception as ex:
        die(f"adapter {ad.NAME} could not read this link: {ex}")
    if not mp4.exists(): die(f"adapter {ad.NAME} returned without saving {mp4}")
    meta.setdefault("site", ad.NAME); meta.setdefault("url", url); meta.setdefault("title", url)
    return meta, mp4


def vtt_lines(text):
    """WebVTT → '[start–end] text' lines; auto-captions repeat each line as it scrolls, so repeats are dropped."""
    def sec(t):
        parts = t.replace(",", ".").split(":")
        return sum(float(x) * 60 ** i for i, x in enumerate(reversed(parts)))
    out, seen = [], set()
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        m = re.search(r"([\d:.,]+)\s*-->\s*([\d:.,]+)[^\n]*\n?", block)
        if not m: continue
        lines = [" ".join(re.sub(r"<[^>]+>", "", l).split()) for l in block[m.end():].split("\n")]
        new = [l for l in lines if l and l not in seen]
        seen.update(new)
        if new:
            out.append(f"[{sec(m.group(1)):6.1f}s–{sec(m.group(2)):6.1f}s] {' '.join(new)}")
    return out


def site_subtitles(url, info, lang):
    """The site's own subtitles (manual first, then auto-captions) through yt-dlp: (lines, language) or (None, None)."""
    subs, auto = info.get("subtitles") or {}, info.get("automatic_captions") or {}
    want = ([lang] if lang != "auto" else []) + [info.get("language") or "", "zh-Hans", "zh", "en", "ja"]
    for pool in (subs, auto):
        keys = [k for k in pool if k != "live_chat"]
        pick = next((k for w in want if w for k in keys if k == w or k.startswith(w + "-")), None)
        if not pick and pool is subs and keys: pick = keys[0]
        if not pick and pool is auto:   # auto-captions in the original language end in "-orig"
            pick = next((k for k in keys if k.endswith("-orig")), None)
        if not pick: continue
        with tempfile.TemporaryDirectory() as tmp:
            r = run(YTDLP + ["--skip-download", "--no-playlist", "--sub-format", "vtt",
                             "--write-subs" if pool is subs else "--write-auto-subs", "--sub-langs", pick,
                             "-o", str(Path(tmp) / "s"), url])
            files = list(Path(tmp).glob("*.vtt"))
            if r.returncode or not files: continue
            lines = vtt_lines(files[0].read_text(errors="ignore"))
            if lines: return lines, pick + (" (auto-captions)" if pool is auto else "")
    return None, None


# ---------- frames / transcript ----------
def probe_duration(f):
    return float(run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]).stdout.strip() or 0)


def frame_times(mp4, dur):
    r = run([FFMPEG, "-hide_banner", "-i", str(mp4), "-an", "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-f", "null", "-"])
    cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    min_gap = max(SHORT_GAP[0], dur / MAX_FRAMES)
    fill_gap = max(SHORT_GAP[1], dur / MAX_FRAMES * 1.5)
    picked = []
    for t in [0.5] + [c + 0.3 for c in cuts]:           # 0.3 s after a cut skips the blurry transition frame
        if t < dur - 0.2 and (not picked or t - picked[-1] >= min_gap): picked.append(t)
    full = []
    for a, b in zip(picked, picked[1:] + [dur - 0.3]):   # long scenes get extra frames
        full.append(a)
        k = int((b - a) // fill_gap)
        full += [a + (b - a) * i / (k + 1) for i in range(1, k + 1)]
    if len(full) > MAX_FRAMES:
        full = [full[round(i * (len(full) - 1) / (MAX_FRAMES - 1))] for i in range(MAX_FRAMES)]
    return sorted(set(round(t, 1) for t in full)), len(cuts)


def extract_frames(mp4, d, dur):
    fd = d / "frames"
    if fd.exists() and any(fd.glob("*.jpg")): return sorted(fd.glob("*.jpg")), None
    fd.mkdir(exist_ok=True)
    times, ncuts = frame_times(mp4, dur)
    for t in times:
        run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{t}", "-i", str(mp4), "-frames:v", "1",
             "-vf", f"scale='min({FRAME_W},iw)':-2", "-q:v", "3", str(fd / f"{t:06.1f}s.jpg")])
    return sorted(fd.glob("*.jpg")), ncuts


def segments(wav, dur):
    r = run([FFMPEG, "-hide_banner", "-i", str(wav), "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    mids = [(a + b) / 2 for a, b in zip(starts, ends)]
    segs, a = [], 0.0
    while dur - a > 0.5:
        cand = [m for m in mids if a + 5 <= m <= a + SEG_MAX]
        b = max(cand) if cand else min(a + SEG_MAX, dur)
        if dur - b < 3: b = dur
        segs.append((a, b)); a = b
    return segs


def asr(wav, dur, lang):
    import requests
    lines, fails = [], 0
    headers = {"Authorization": f"Bearer {ASR_KEY}"} if ASR_KEY else {}
    with tempfile.TemporaryDirectory() as tmp:
        for a, b in segments(wav, dur):
            seg = Path(tmp) / f"{a:.1f}.wav"
            run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{a}", "-to", f"{b}", "-i", str(wav), str(seg)])
            data = {"model": ASR_MODEL}
            if lang != "auto": data["language"] = lang
            try:
                resp = requests.post(ASR_URL, headers=headers, timeout=600,
                                     files={"file": (seg.name, seg.read_bytes(), "audio/wav")}, data=data)
                if not resp.ok: raise RuntimeError(f"HTTP {resp.status_code}")
                text = resp.json().get("text", "").strip()
            except Exception as ex:
                fails += 1; text = f"(this segment failed: {ex})"
            if text: lines.append(f"[{a:6.1f}s–{b:6.1f}s] {text}")
    return lines, fails


NO_ASR = ("(no transcript: the site has no subtitles and no speech-to-text is configured. Set WATCHVID_ASR_URL to an "
          "OpenAI-compatible /v1/audio/transcriptions endpoint, plus WATCHVID_ASR_KEY / WATCHVID_ASR_MODEL, and run again)")


def transcribe(mp4, d, dur, lang, url, info):
    """Returns the transcript text; transcript.txt is written only when it is complete (otherwise the next run retries)."""
    out = d / "transcript.txt"
    if out.exists(): return out.read_text()
    if ASR_URL:
        wav = d / "audio16k.wav"
        r = run([FFMPEG, "-y", "-loglevel", "error", "-i", str(mp4), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
        if r.returncode:
            wav.unlink(missing_ok=True)
            has_audio = run([FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(mp4)]).stdout.strip()
            if has_audio: log("could not extract the audio track; transcript not cached"); return "(audio extraction failed; the next run retries)"
            out.write_text("(no audio track)\n"); return out.read_text()
        lines, fails = asr(wav, dur, lang)
        wav.unlink(missing_ok=True)
        body = "\n".join(lines) if lines else "(no speech recognised: maybe only music or sound effects)"
        text = f"# Transcript (speech-to-text {ASR_MODEL}, cut at silences, at most {SEG_MAX:.0f} s per line)\n{body}\n"
        if fails:
            log(f"{fails} segments failed; transcript.txt not written"); return "(incomplete transcript; the next run retries)\n" + text
        out.write_text(text); return text
    if info is not None:
        lines, which = site_subtitles(url, info, lang)
        if lines:
            text = f"# Transcript (the site's subtitles, {which})\n" + "\n".join(lines) + "\n"
            out.write_text(text); return text
    log("no transcript: no site subtitles and WATCHVID_ASR_URL is not set")
    return NO_ASR


def top_words(dm_file, n=30):  # 30 沿用原版 watchvid
    if not dm_file.exists(): return []
    import warnings; warnings.filterwarnings("ignore", category=SyntaxWarning)
    import jieba
    jieba.setLogLevel(60)
    texts = [m.group(1) for l in dm_file.read_text().splitlines() if (m := re.match(r"\s*[\d.]+s  (.+)", l))]
    stop = set("这个 那个 什么 怎么 就是 还是 不是 没有 我们 你们 他们 一个 真的 可以 自己 这么 感觉 因为 所以 但是 然后".split())
    c = Counter(w for t in texts for w in jieba.cut(t) if len(w.strip()) >= 2 and w not in stop and not w.isdigit())
    return c.most_common(n)


def write_index(d, meta, frames, transcript):
    st = meta.get("stat") or {}
    hms = lambda s: f"{int(s) // 60}:{int(s) % 60:02d}" if s else "?"
    L = [f"# {meta['title']}", "",
         f"- Link: {meta['url']}", f"- Uploader: {meta.get('owner')}  Published: {meta.get('pubdate')}  Length: {hms(meta.get('duration'))}",
         "- Stats: " + "  ".join(f"{k} {v}" for k, v in st.items() if v is not None)]
    if meta.get("stream"):
        s = meta["stream"]
        L.append(f"- Stream: {s['quality']} {s['size']} {s['codecs']}; logged in: {meta.get('logged_in')}")
    L += ["", "## Description", "", (meta.get("desc") or "(none)").strip(), "",
          f"## Frames ({len(frames)}, in time order; open them with your image tool)", ""]
    L += [f"- {f.stem}  {f}" for f in frames]
    L += ["", "## Transcript", "", transcript.strip(), ""]
    tw = top_words(d / "danmaku.txt")
    if tw:
        L += ["## Frequent words in bullet comments", "", "  ".join(f"{w}×{c}" for w, c in tw), ""]
    others = [x for x in ("audio.m4a", "danmaku.txt", "comments.txt", "meta.json", "video.mp4") if (d / x).exists()]
    L += ["## Other files", ""] + [f"- {d / x}" for x in others]
    (d / "watchvid-index.md").write_text("\n".join(L) + "\n")


def main():
    global FFMPEG, FFPROBE
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"): print(__doc__); return

    def opt(name, default):
        if name in args:
            i = args.index(name)
            if i + 1 >= len(args): die(f"{name} needs a value")
            v = args[i + 1]; del args[i:i + 2]; return v
        return default
    keep = "--keep-video" in args
    if keep: args.remove("--keep-video")
    p_arg, lang, out = opt("--p", None), opt("--lang", "auto"), opt("--out", None)
    if not args: die("missing the video link; see watchvid --help")
    FFMPEG, FFPROBE = find_ffmpeg()
    url = args[0]
    t0 = time.time()
    info = None
    ad = pick_adapter(url, load_adapters())
    bvid, p_url = resolve(url) if not ad and re.search(r"b23\.tv|bilibili\.com|^BV", url) else (None, None)
    if ad:
        mid = adapter_id(ad, url)
        log(f"using adapter {ad.NAME}")
    elif bvid:
        p = int(p_arg or p_url or 1)
        mid = "bili-" + (bvid if p == 1 else f"{bvid}_p{p}")
    else:
        info, mid = ytdlp_info(url)
    d = out_root(out) / mid
    d.mkdir(parents=True, exist_ok=True)
    idx = d / "watchvid-index.md"
    if not keep and all((d / x).exists() for x in ("watchvid-index.md", "meta.json", "transcript.txt")):
        log(f"already parsed: {d}")
        print(idx); return
    meta, mp4 = via_adapter(ad, url, d) if ad else bilibili(bvid, p, d) if bvid else ytdlp(url, info, d)
    dur = probe_duration(mp4) or float(meta.get("duration") or 0)
    frames, ncuts = extract_frames(mp4, d, dur)
    log(f"{len(frames)} frames" + (f" ({ncuts} scene cuts)" if ncuts is not None else " (reused)"))
    m4a = d / "audio.m4a"
    if not m4a.exists():   # yt-dlp sites have no separate audio stream: copy the track, else re-encode to AAC
        if ffmpeg_to(m4a, ["-i", str(mp4), "-vn", "-c:a", "copy"]) and ffmpeg_to(m4a, ["-i", str(mp4), "-vn", "-c:a", "aac"]):
            log("no audio extracted (maybe there is no audio track)")
    transcript = transcribe(mp4, d, dur, lang, url, info)
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    for x in ("video.m4s", "audio.m4s") + (() if keep else ("video.mp4",)):
        (d / x).unlink(missing_ok=True)
    write_index(d, meta, frames, transcript)
    log(f"done in {time.time() - t0:.1f}s")
    print(idx)


if __name__ == "__main__":
    main()
