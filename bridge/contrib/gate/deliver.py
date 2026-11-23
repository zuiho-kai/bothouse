#!/usr/bin/env python3
"""成品活的交付记录：先交一小段样，用户认了才铺开整版；认过的那份记下来，以后不许动（#1904）。

用户原话（2026-11-23）：「先交一小段让你点头，你认了才铺开整版。……你点过头的东西记下来，新会话也自动带上，不许改动。」

每件成品活一份 <任务板目录>/deliver/<编号>.json（任务板目录 = board.py 的 DIR）。格式是定死的，桥每轮注入认可记录、
交付前的对照件检查都读它，改字段前先和读的一方对齐：
  {"id": "1904", "title": "活名", "chat": "discord:<频道id>",          # chat = 任务板条目所属频道（board.channel_of）
   "stage": "样" | "全量",
   "product": "<当前成品路径或链接>", "refs": ["<原件路径或链接>", ...],
   "approvals": [{"file": "<认可的那份>", "sha256": "<文件指纹，链接则空>", "quote": "<用户原话>", "at": "<ISO 时间>",
                  "locked": ["<不许动的部分>", ...]}],
   "compares":  [{"product": "<成品>", "sha256": "<成品指纹>", "against": "<原件或认可样>",
                  "diffs": ["差别1", "差别2", "差别3"], "at": "<ISO 时间>"}]}
最新认可 = approvals 最后一条。进「全量」要求 approvals 非空。

写：board stage / board approve / board compare（board.py 调本文件的 cli）。
approvals 只能往后追加：save 发现盘上已有的认可记录被改或被删就拒绝，本文件也不提供改、删认可的入口。

对照件（用户 2026-11-23 认可的做法：「交之前，由一个只拿到你原话和原件的新人，把成品和原件并排比一遍，写出最大的三处差别，
跟成品一起交给你。」）：
- compare（board compare <编号>）：起一个不带工具、不读设置的干净模型（claude -p），只喂用户原话、原件或最新认可样、成品，
  让它写最大的三处差别，带成品指纹记进 compares。
- exit_check：交给用户的出口共用的判断（hooks/deliver-check.py 的 bothouse send 带附件、lead/ws-pass 放行都调它）：
  登记过的成品有原件或认可样，却没有和现在这份指纹一致的对照件 → 拦；没有原件也没有认可样 → 只许带一句问话；没登记的不管。
"""
import base64, hashlib, json, os, shutil, subprocess, sys, tempfile
from contextlib import contextmanager, suppress
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import filelock  # noqa: E402

STAGES = ("样", "全量")


class Refused(Exception):
    """这一步不做，str(e) 是给人看的一句原因。"""


def _board():
    import board  # 用到才载：board.py 直接当脚本跑时本文件是被它载进来的，顶层互相 import 会绕圈
    return board


def _dir():
    return _board().DIR / "deliver"


def path(nid):
    return _dir() / f"{int(str(nid).lstrip('#'))}.json"


@contextmanager
def _locked():
    # 自己一把锁，不用 board.lock：持锁时还要读任务板（board._read 自己会去拿 board.lock，同进程再拿一次会卡死）
    _dir().mkdir(parents=True, exist_ok=True)
    with open(_dir() / "deliver.lock", "w") as lk:
        filelock.lock(lk)
        yield


def _now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _is_link(s):
    return "://" in str(s or "")


def _norm(s):
    """本地有的文件记绝对路径（读的一方不在同一个目录里跑），链接和别的写法原样留。"""
    s = str(s or "").strip()
    if not s or _is_link(s):
        return s
    p = Path(s).expanduser()
    return str(p.resolve()) if p.exists() else s


def sha256_of(s):
    """本地文件的指纹；链接、不存在的路径、目录返回空串。"""
    if _is_link(s):
        return ""
    p = Path(str(s or "")).expanduser()
    if not p.is_file():
        return ""
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read(nid):
    try:
        return json.loads(path(nid).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError:
        raise Refused(f"交付记录 {path(nid)} 读不出来（不是合法 JSON），先看一眼这个文件，没动它")


def load(nid):
    """编号 nid 的交付记录；没登记过返回 None。"""
    return _read(nid)


def latest_approval(rec):
    """最新一次认可（approvals 最后一条）；rec 可以是记录或编号。没有返回 None。"""
    if not isinstance(rec, dict):
        rec = load(rec)
    got = (rec or {}).get("approvals") or []
    return got[-1] if got else None


def _save_locked(rec):
    old = _read(rec["id"])
    was = (old or {}).get("approvals") or []
    if rec.get("approvals", [])[:len(was)] != was:
        raise Refused(f"#{rec['id']} 用户认可过的记录不能改、不能删，只能往后追加；没写")
    target = path(rec["id"])
    fd, tmp = tempfile.mkstemp(prefix=target.stem + ".", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
        with suppress(OSError):
            os.chmod(tmp, _board()._default_file_mode())  # mkstemp 建的是 0600，别的角色和桥也要读
        _board()._replace_with_retry(tmp, target)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp)
        raise
    return rec


def save(rec):
    """整份原子写回；盘上已有的认可记录被改或被删就拒绝（Refused）。"""
    with _locked():
        return _save_locked(rec)


def _new(nid):
    b = _board()
    it = b.item_by_id(nid)
    if not it:
        raise Refused(f"没有 #{nid}，先跑 board 看编号")
    return {"id": str(it["id"]), "title": b.short(it), "chat": b.channel_of(it), "stage": "样",
            "product": "", "refs": [], "approvals": [], "compares": []}


def _change(nid, fn):
    """读（没有就照任务板条目新建）→ fn 改 → 写，整段在一把锁里。"""
    nid = int(str(nid).lstrip("#"))
    with _locked():
        rec = _read(nid) or _new(nid)
        fn(rec)
        return _save_locked(rec)


def set_stage(nid, stage, product=None, refs=None):
    """切到「样」或「全量」；product、refs 给了才改（refs 给了就整份换成这次给的）。
    进「全量」时还没有用户认可记录就拒绝（Refused），记录不动。"""
    if stage not in STAGES:
        raise Refused(f"阶段只有「样」和「全量」，没有「{stage}」")

    def fn(rec):
        if stage == "全量" and not rec.get("approvals"):
            raise Refused(f"#{rec['id']} 还不能铺开全量：用户还没对样点过头。先交一小段样给用户看，"
                          f"他认了用 board approve {rec['id']} --file <他认的那份> --quote \"<他的原话>\" 记下，再进全量")
        rec["stage"] = stage
        if product is not None:
            rec["product"] = _norm(product)
        if refs:
            rec["refs"] = [_norm(r) for r in refs]
    return _change(nid, fn)


def approve(nid, file, quote, locked=()):
    """记一次用户认可：追加到 approvals，不动前面的。file 是本地文件就记指纹，是链接指纹留空。"""
    file, quote = str(file or "").strip(), str(quote or "").strip()
    if not quote:
        raise Refused("要写 --quote：用户认可时的原话，照抄，不要概括")
    if not file:
        raise Refused("要写 --file：用户认的是哪一份（本地文件或链接）")
    if not _is_link(file) and not Path(file).expanduser().is_file():
        raise Refused(f"找不到 {file}：--file 写用户认的那份文件的路径，或者它的链接")
    one = {"file": _norm(file), "sha256": sha256_of(file), "quote": quote, "at": _now(),
           "locked": [s.strip() for s in locked if str(s).strip()]}
    return _change(nid, lambda rec: rec.setdefault("approvals", []).append(one))


def add_compare(nid, product, against, diffs):
    """记一份对照件：成品 product 对着原件或认可样 against 比出的差别 diffs（最大的三处），追加到 compares。"""
    one = {"product": _norm(product), "sha256": sha256_of(product), "against": _norm(against),
           "diffs": [str(d).strip() for d in diffs if str(d).strip()], "at": _now()}
    return _change(nid, lambda rec: rec.setdefault("compares", []).append(one))


# ---- 对照件：干净模型把成品和原件并排比，写最大的三处差别 ----
MODEL = "sonnet"
TIMEOUT = 300
TEXT_MAX = 60000        # 文字材料最多喂这么多字，超出的截掉并写明
IMG_MAX = 3 << 20       # 图片超过这么大先缩小再喂
FRAMES = 6              # 视频按时长均匀抽这么多帧
IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
VIDEO = (".mp4", ".mov", ".webm", ".mkv", ".m4v")

SYSTEM = """你是交付前的对照人。你手上只有三样东西：用户的原话、原件（或用户认可过的样品）、这次要交给用户的成品。你没参与制作，不知道制作过程，不替任何人说话。
把成品和原件并排比一遍，写出两者之间最大的三处差别，从大到小排。

规则：
1. 每处差别具体到指得出的地方：哪一段、哪个位置，原件是什么样，成品是什么样。一条一句大白话，不超过 80 字，不换行。
2. 先看用户原话要的是什么：原话要、成品没做到的差别排最前。
3. 只写差别。不评价好坏，不给修改建议，不写客套话。
4. 两份几乎一样、找不出三处时，有几处写几处；一处也找不出就只写一条「没看出差别」。

只输出一个 JSON 对象，不要别的字：{"diffs":["差别1","差别2","差别3"]}"""


def _ffmpeg(name="ffmpeg"):
    return shutil.which(name) or str(Path.home() / ".local" / "bin" / name)


def _img(data, mime="image/jpeg"):
    return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}}


def _run_media(args):
    try:
        r = subprocess.run(args, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Refused(f"{Path(args[0]).name} 没跑成（{type(e).__name__}），图太大或视频要靠它抽帧才能比")
    return r


def _frames(p):
    """视频按时长均匀抽 FRAMES 帧（宽不超过 768 的 JPEG）；返回 [(秒, 图片字节)]。"""
    r = _run_media([_ffmpeg("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)])
    try:
        dur = float(r.stdout.decode().strip())
    except ValueError:
        raise Refused(f"读不出 {p} 的时长，没法抽帧来比")
    out = []
    with tempfile.TemporaryDirectory(prefix="deliver-cmp-") as d:
        for k in range(FRAMES):
            t, f = dur * (k + 0.5) / FRAMES, Path(d) / f"{k}.jpg"
            _run_media([_ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(p), "-frames:v", "1",
                        "-vf", "scale='min(768,iw)':-2", str(f)])
            if f.is_file():
                out.append((t, f.read_bytes()))
    if not out:
        raise Refused(f"{p} 一帧也抽不出来，没法比")
    return out


def _material(label, src):
    """一份材料（本地文件）变成喂给模型的内容块；模型看不了的格式拒绝（Refused）。"""
    p = Path(str(src)).expanduser()
    if _is_link(src) or not p.is_file():
        raise Refused(f"{label}「{src}」不是本机上的文件：干净模型不带工具，打不开链接，先把它落到本地再比")
    ext = p.suffix.lower()
    if ext in IMG_MIME:
        data, mime = p.read_bytes(), IMG_MIME[ext]
        if len(data) > IMG_MAX:
            with tempfile.TemporaryDirectory(prefix="deliver-cmp-") as d:
                small = Path(d) / "small.jpg"
                _run_media([_ffmpeg(), "-y", "-loglevel", "error", "-i", str(p), "-frames:v", "1",
                            "-vf", "scale='min(1568,iw)':-2", str(small)])
                if not small.is_file():
                    raise Refused(f"{label} {p} 太大，缩小也没成，没法比")
                data, mime = small.read_bytes(), "image/jpeg"
        return [{"type": "text", "text": f"【{label}】（图片）"}, _img(data, mime)]
    if ext == ".pdf":
        return [{"type": "text", "text": f"【{label}】（PDF）"},
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                "data": base64.b64encode(p.read_bytes()).decode()}}]
    if ext in VIDEO:
        out = [{"type": "text", "text": f"【{label}】（视频，按时长均匀抽的 {FRAMES} 帧，依次是）"}]
        for t, data in _frames(p):
            out += [{"type": "text", "text": f"第 {t:.1f} 秒："}, _img(data)]
        return out
    try:
        text = p.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        raise Refused(f"{label} {p} 这种格式干净模型看不了：先转成图片、PDF 或文字，再用那一份比")
    more = f"\n（后面还有 {len(text) - TEXT_MAX} 字没给）" if len(text) > TEXT_MAX else ""
    return [{"type": "text", "text": f"【{label}】（文字，全文如下）\n{text[:TEXT_MAX]}{more}"}]


def _ask_model(content):
    """不带工具、不读设置、不挂 hook 的 claude -p 问一次（写法同 lead/_added_judge.py；有图所以走 stream-json）。
    返回差别列表；没装 claude、超时、输出读不出都算没比成（Refused），不编差别。"""
    msg = {"type": "user", "message": {"role": "user", "content": content}}
    try:
        p = subprocess.run(["claude", "-p", "--model", MODEL, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
                            "--no-session-persistence", "--system-prompt", SYSTEM, "--input-format", "stream-json",
                            "--output-format", "stream-json", "--verbose"],
                           input=json.dumps(msg, ensure_ascii=False) + "\n", capture_output=True, text=True,
                           timeout=TIMEOUT, cwd=tempfile.gettempdir())
        res = None
        for l in p.stdout.splitlines():
            with suppress(ValueError):
                j = json.loads(l)
                if isinstance(j, dict) and j.get("type") == "result":
                    res = j
        if res is None or p.returncode != 0 or res.get("is_error"):
            raise RuntimeError(f"claude 退出码 {p.returncode}：{(p.stderr or p.stdout).strip()[-200:]}")
        txt = (res.get("result") or "").strip()
        j = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
        diffs = [" ".join(str(d).split()) for d in (j.get("diffs") if isinstance(j, dict) else None) or []]
        diffs = [d for d in diffs if d][:3]
        if not diffs:
            raise ValueError("结果里没有 diffs")
        return diffs
    except Refused:
        raise
    except Exception as e:  # noqa: BLE001
        raise Refused(f"干净模型没比成（{type(e).__name__}: {str(e)[:200]}），没记对照件；过一会儿重跑")


def _handoff_quotes(nid):
    """这件活的交接文件里「用户原话」节的内容（任务板路径栏是本机交接文件时才有）；没有返回空串。"""
    try:
        b = _board()
        f = b.handoff_of(b.item_by_id(int(nid)))
        lines = Path(f).read_text(encoding="utf-8").splitlines() if f else []
    except Exception:  # noqa: BLE001
        return ""
    out, on = [], False
    for l in lines:
        if l.lstrip().startswith("#"):
            on = "用户原话" in l
            continue
        if on and l.strip():
            out.append(l)
    return "\n".join(out).strip()


def against_of(rec):
    """拿什么来比：登记的原件（refs 里第一份本机文件），没有原件就用最新认可的那份；都没有返回空串。"""
    refs = [r for r in rec.get("refs") or [] if r]
    for r in refs:
        if not _is_link(r) and Path(r).expanduser().is_file():
            return r
    last = latest_approval(rec)
    if last and last.get("file") and not _is_link(last["file"]) and Path(last["file"]).expanduser().is_file():
        return last["file"]
    return refs[0] if refs else ((last or {}).get("file") or "")


def compare(nid, product=None, quotes=()):
    """出一份对照件：干净模型只看用户原话、原件或最新认可样、成品，写最大的三处差别，记进 compares（带成品指纹）。
    用户原话 = quotes（board compare --quote）+ 交接文件「用户原话」节 + 认可记录里的原话；一句都没有就拒绝。"""
    nid = int(str(nid).lstrip("#"))
    rec = load(nid)
    if rec is None:
        raise Refused(f"#{nid} 还没有交付记录：先 board stage {nid} 样 --product <成品> --ref <原件>")
    product = _norm(product or rec.get("product") or "")
    if not product:
        raise Refused(f"#{nid} 没登记成品：board compare {nid} --product <成品文件>，或先 board stage {nid} 样 --product <成品>")
    against = against_of(rec)
    if not against:
        raise Refused(f"#{nid} 没有原件、用户也没认过样，没有东西可比：只发最小的一段样，带一句问话让用户看；"
                      f"有原件就 board stage {nid} {rec.get('stage') or '样'} --ref <原件> 登记")
    said = [str(q).strip() for q in quotes if str(q).strip()]
    said += [q for q in (_handoff_quotes(nid),) if q]
    said += [a["quote"] for a in rec.get("approvals") or [] if a.get("quote")]
    if not said:
        raise Refused(f"要写 --quote：用户对这件活的原话，照抄，不要概括（board compare {nid} --quote \"<原话>\"）")
    kind = "原件" if against in (rec.get("refs") or []) else "用户认可过的样品"
    content = [{"type": "text", "text": "【用户原话】\n" + "\n".join(dict.fromkeys(said))}]
    content += _material(kind, against) + _material("成品", product)
    diffs = _ask_model(content)
    return add_compare(nid, product, against, diffs)


def diff_text(c):
    """一份对照件写成跟成品一起交给用户的那段话。"""
    return (f"和「{os.path.basename(str(c.get('against') or '')) or '原件'}」并排比，最大的差别：\n"
            + "\n".join(f"{k}. {d}" for k, d in enumerate(c.get("diffs") or [], 1)))


def _squash(s):
    return "".join(ch for ch in str(s or "") if not ch.isspace() and ch not in "\"'`\\")


def carried(msg, c):
    """给用户的话里是不是带上了这份对照件的每一处差别（不看空白和引号）。"""
    m = _squash(msg)
    return all(_squash(d) in m for d in c.get("diffs") or [])


def _same_file(a, b):
    try:
        return os.path.realpath(os.path.expanduser(str(a))) == os.path.realpath(os.path.expanduser(str(b)))
    except (OSError, ValueError):
        return False


def _records():
    out = []
    for f in sorted(_dir().glob("*.json")):
        with suppress(OSError, ValueError):
            rec = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(rec, dict):
                rec.setdefault("id", f.stem)
                out.append(rec)
    return out


def exit_check(files, msg="", nid=None):
    """交给用户的出口共用的判断。files：要发出去的本地文件；msg：跟着发的话；nid：知道是哪件活时给（ws-pass）。
    管哪些：files 里是某份记录登记的成品（product）的，加上 nid 那份记录登记的本机成品。没登记的不管。
    返回 (拦下的理由, 过了的对照件)：
      有原件或认可样，却没有和现在这份成品指纹一致的对照件 → 拦，先 board compare；
      没有原件也没有认可样 → msg 里没有一句问话就拦；
      过了的对照件 [{"id", "file", "compare", "text"}]，调的一方保证 text（三处差别）跟成品一起到用户手里。"""
    todo = {}
    for rec in _records():
        prod = rec.get("product") or ""
        if not prod or _is_link(prod):
            continue
        hit = next((f for f in files if _same_file(f, prod)), None)
        if hit or (nid is not None and str(rec.get("id")) == str(nid) and Path(prod).expanduser().is_file()):
            todo[str(rec.get("id"))] = (rec, hit or prod)
    problems, passed = [], []
    for rid, (rec, f) in todo.items():
        name = f"#{rid}「{rec.get('title') or ''}」的成品 {f}"
        if not (rec.get("refs") or rec.get("approvals")):
            if not any(q in str(msg or "") for q in "？?"):
                problems.append(f"【没有原件也没有认可样】{name}：没有原件、用户也没认过样，只许发最小的一段样，"
                                f"话里带一句问话（问用户这样行不行）。有原件就 board stage {rid} {rec.get('stage') or '样'} "
                                f"--ref <原件> 登记，再跑 board compare {rid}")
            continue
        sha = sha256_of(f)
        fresh = [c for c in rec.get("compares") or [] if sha and c.get("sha256") == sha and c.get("diffs")]
        if not fresh:
            problems.append(f"【没有对照件】{name}：有原件或用户认可过的样，但还没有和现在这份一致的对照件（成品改过要重比）。"
                            f"先跑 board compare {rid}（干净模型只看用户原话、原件、成品，写最大的三处差别），再发")
            continue
        passed.append({"id": rid, "file": f, "compare": fresh[-1], "text": diff_text(fresh[-1])})
    return problems, passed


def _pop_opts(argv, single=(), multi=()):
    """从 argv 里取出 --名字 值：single 只留最后一个，multi 攒成列表。返回（剩下的位置参数，取到的选项）。"""
    rest, got, k = [], {m: [] for m in multi}, 0
    while k < len(argv):
        a = argv[k]
        if a in single or a in multi:
            if k + 1 >= len(argv):
                raise Refused(f"{a} 后面要写内容")
            if a in multi:
                got[a].append(argv[k + 1])
            else:
                got[a] = argv[k + 1]
            k += 2
            continue
        rest.append(a)
        k += 1
    return rest, got


def cli(cmd, argv):
    """board stage / approve / compare / deliver 的命令行：返回要打印的字；不做的事 sys.exit 一句人话（退出码 1）。"""
    try:
        if cmd == "stage":
            rest, o = _pop_opts(argv, single=("--product",), multi=("--ref",))
            if len(rest) != 2:
                raise Refused("用法：board stage <编号> 样|全量 [--product 成品路径或链接] [--ref 原件路径或链接 ...]")
            rec = set_stage(rest[0], rest[1], o.get("--product"), o["--ref"])
            return f"#{rec['id']} 现在是「{rec['stage']}」" + (f"，成品 {rec['product']}" if rec.get("product") else "")
        if cmd == "approve":
            rest, o = _pop_opts(argv, single=("--file", "--quote"), multi=("--locked",))
            if len(rest) != 1:
                raise Refused("用法：board approve <编号> --file <用户认的那份> --quote \"<用户原话>\" [--locked \"<不许动的部分>\" ...]")
            rec = approve(rest[0], o.get("--file"), o.get("--quote"), o["--locked"])
            a = rec["approvals"][-1]
            return (f"#{rec['id']} 已记下用户认可（第 {len(rec['approvals'])} 次）：{a['file']}"
                    + ("，不许动：" + "；".join(a["locked"]) if a["locked"] else ""))
        if cmd == "compare":
            rest, o = _pop_opts(argv, single=("--product",), multi=("--quote",))
            if len(rest) != 1:
                raise Refused("用法：board compare <编号> [--product 成品文件] [--quote \"<用户原话>\" ...]")
            rec = compare(rest[0], o.get("--product"), o["--quote"])
            return (f"#{rec['id']} 已记下对照件（成品 {rec['compares'][-1]['product']}）。发成品时把下面这段原样带在给用户的话里：\n"
                    + diff_text(rec["compares"][-1]))
        if cmd == "deliver":
            if len(argv) != 1:
                raise Refused("用法：board deliver <编号>")
            rec = load(int(argv[0].lstrip("#")))
            if rec is None:
                raise Refused(f"#{argv[0].lstrip('#')} 还没有交付记录：先 board stage {argv[0].lstrip('#')} 样")
            return json.dumps(rec, ensure_ascii=False, indent=2)
    except Refused as e:
        sys.exit(str(e))
    raise Refused(f"没有 board {cmd}")
