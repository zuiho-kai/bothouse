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

写：board stage / board approve（board.py 调本文件的 cli），对照件检查调 add_compare。
approvals 只能往后追加：save 发现盘上已有的认可记录被改或被删就拒绝，本文件也不提供改、删认可的入口。
"""
import hashlib, json, os, sys, tempfile
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
    """board stage / approve / deliver 的命令行：返回要打印的字；不做的事 sys.exit 一句人话（退出码 1）。"""
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
