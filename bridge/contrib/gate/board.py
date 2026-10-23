#!/usr/bin/env python3
"""任务板：谁手上有哪件事、做在哪（分支/PR/路径）、做到哪一步。

用户原话（2026-10-22）：「核心是为什么他不能共享进度……他应该能看到为什么从开始找」；
提议任务板后：「可以的，核心要区分一下，让jev判断，是给谁回的」。

- 每条一行：事情、分支/PR/路径、状态、谁在做、更新时间。存 <BOARD_DIR>/board.jsonl（不叫 .json：
  cc-connect 把 team 目录下的 *.json 当队友状态文件读，core/team.go teamSummary）。
- 读：ctxsvc.context 把整张板附进每个 bot 每轮的上下文（板子变了才重推）；gate 判收件人时也读（gate.addressee）。
- 写：../lead/board（本文件的命令行）。
- BOARD_DIR：环境变量，默认 <GATE_SETUP_DIR>/team（GATE_SETUP_DIR 默认 ~/.cc-connect，同 lead.py）；
  建议设成 cc-connect 的 team_status_dir，和队友状态放一起。

用法：
  board                                  # 列出进行中的事
  board add <事情> <分支/PR/路径> <状态> <谁> [--next 几点看]   # 新加一条，打印编号
  board update <编号> <状态> [分支/PR/路径] [谁] [--next 几点看]
  board done <编号>                       # 结束：移出任务板，记进 board-done.jsonl
  --next：下次几点回来看这件事（如 14:30），显示在板上，让用户知道后面还会不会处理。
    只有 later 能写（它先挂好定时，挂不上就撤掉这行；用环境变量 BOARD_LATER=1 标明），手写 --next 会被拒：
    板上写了「下次看」却没挂定时，就没人兑现（2026-10-23 PR #81 审查）。

频道卡片（用户 2026-10-23「我这根本感知不到你后面还可以去处理……也没看到有任何sub表」）：
  每次 add/update/done 后，在条目所在频道把「还没做完的事」编辑进同一条置顶消息（不刷屏）。
  条目的频道 = 加它时的 CC_SESSION_KEY；旧条目没记频道的，被 update 时记成当时的频道，没被碰过的在每张卡上都列。
  Discord token：环境变量 DISCORD_BOT_TOKEN，否则 <GATE_SETUP_DIR>/secrets.env 里的同名变量；读不到就跳过卡片。
  消息 id 存 <BOARD_DIR>/board-cards.state（不叫 .json，理由同上）；消息被删就重发并置顶。失败只打警告，不影响板子本身。
"""
import fcntl, json, os, subprocess, sys, time, urllib.error, urllib.request
from contextlib import contextmanager
from pathlib import Path

SETUP = Path(os.environ.get("GATE_SETUP_DIR") or Path.home() / ".cc-connect").expanduser()
DIR = Path(os.environ.get("BOARD_DIR") or SETUP / "team").expanduser()


def _path(name):
    return DIR / name


@contextmanager
def _locked():
    DIR.mkdir(parents=True, exist_ok=True)
    with open(_path("board.lock"), "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def _read(name="board.jsonl"):
    try:
        lines = _path(name).read_text().splitlines()
    except FileNotFoundError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def _write(items):
    tmp = _path("board.jsonl.tmp")
    tmp.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
    os.replace(tmp, _path("board.jsonl"))


def items():
    return _read()


def fmt(i):
    nxt = f"｜下次看 {i['next']}" if i.get("next") else ""
    return f"#{i['id']} {i['what']}｜{i.get('where') or '-'}｜{i.get('status') or '-'}｜{i.get('who') or '-'}｜{i.get('at', '')}{nxt}"


def lines():
    return [fmt(i) for i in items()]


def _now():
    return time.strftime("%m-%d %H:%M")


def _cur_channel():
    k = os.environ.get("CC_SESSION_KEY", "")  # 形如 discord:<频道 id>
    c = k.removeprefix("discord:")
    return c if k.startswith("discord:") and c.isdigit() else None


def add(what, where, status, who, nxt=None):
    with _locked():
        cur = _read()
        nid = max([i["id"] for i in cur + _read("board-done.jsonl")] + [0]) + 1
        it = {"id": nid, "what": what, "where": where, "status": status, "who": who, "at": _now()}
        if nxt:
            it["next"] = nxt
        if _cur_channel():
            it["ch"] = _cur_channel()
        cur.append(it)
        _write(cur)
    return nid


def update(nid, status, where=None, who=None, nxt=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        hit["status"], hit["at"] = status, _now()
        if where:
            hit["where"] = where
        if who:
            hit["who"] = who
        if nxt:
            hit["next"] = nxt
        if not hit.get("ch") and _cur_channel():
            hit["ch"] = _cur_channel()
        _write(cur)
    return True


def done(nid):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        _write([i for i in cur if i["id"] != nid])
        with open(_path("board-done.jsonl"), "a") as f:
            f.write(json.dumps({**hit, "done_at": _now()}, ensure_ascii=False) + "\n")
    return True


# ---- 频道卡片 ----
API = "https://discord.com/api/v10"
LIMIT = 2000  # Discord 单条消息内容上限 2000 字符（API 文档 Create Message: content up to 2000 characters）


def _token():  # 同 ../lead/_team.py：环境变量或 secrets.env，不落盘不打印
    tok = os.environ.get("DISCORD_BOT_TOKEN")
    if tok:
        return tok
    env = SETUP / "secrets.env"
    if not env.is_file():
        return ""
    return subprocess.run(["/bin/sh", "-c", 'set -a; . "$1"; printf %s "$DISCORD_BOT_TOKEN"', "sh", str(env)],
                          capture_output=True, text=True).stdout.strip()


def api(method, path, body=None):
    tok = _token()
    if not tok:
        raise RuntimeError("读不到 DISCORD_BOT_TOKEN")
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bot {tok}",
                                          "User-Agent": "DiscordBot (bothouse, 1)",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def card_text(its):
    head = f"**还没做完的事**（任务板，{_now()} 更新；板子一变这条就改）"
    if not its:
        return head + "\n现在没有进行中的事。"
    def row(i, cap):
        st = i.get("status") or "-"
        if cap is not None and len(st) > cap:
            st = st[:cap] + "…"
        nxt = f"｜下次看 {i['next']}" if i.get("next") else ""
        return f"#{i['id']} {i['what']}｜{i.get('who') or '-'}｜{st}｜{i.get('at', '')}{nxt}"
    cap = None
    while True:  # 超过 Discord 上限就把每条的状态截短，直到放得下
        text = head + "\n" + "\n".join(row(i, cap) for i in its)
        if len(text) <= LIMIT or cap == 0:
            return text[:LIMIT]
        cap = max(0, (cap if cap is not None else max(len(i.get("status") or "") for i in its)) - 10)


def _post_pinned(ch, text):
    m = api("POST", f"/channels/{ch}/messages", {"content": text, "allowed_mentions": {"parse": []}})
    try:
        api("PUT", f"/channels/{ch}/pins/{m['id']}")
    except urllib.error.HTTPError as e:
        print(f"board: 卡片已发但置顶失败（HTTP {e.code}）", file=sys.stderr)
    return m["id"]


def refresh(chans):
    """把这些频道和已有卡片的频道都改成当前板子（没记频道的旧条目在每张卡上都列，所以都要改）；返回 {频道: 消息id}。"""
    out = {}
    with _locked():
        try:
            state = json.loads(_path("board-cards.state").read_text())
        except (FileNotFoundError, ValueError):
            state = {}
        its = _read()
        for ch in sorted(c for c in set(chans) | set(state) if c):
            text = card_text([i for i in its if i.get("ch") in (None, ch)])
            mid = state.get(ch)
            try:
                if mid:
                    try:
                        api("PATCH", f"/channels/{ch}/messages/{mid}", {"content": text, "allowed_mentions": {"parse": []}})
                    except urllib.error.HTTPError as e:
                        if e.code != 404:  # 只有消息被删了才重发
                            raise
                        mid = None
                if not mid:
                    mid = _post_pinned(ch, text)
                state[ch] = out[ch] = mid
            except Exception as e:  # 卡片失败不影响板子本身
                print(f"board: 频道 {ch} 卡片没更新：{type(e).__name__} {getattr(e, 'code', '') or e}", file=sys.stderr)
        tmp = _path("board-cards.state.tmp")
        tmp.write_text(json.dumps(state))
        os.replace(tmp, _path("board-cards.state"))
    return out


def _chan_of(nid):
    for i in _read() + _read("board-done.jsonl"):
        if i["id"] == nid:
            return i.get("ch")
    return None


def _split_next(argv):
    if "--next" in argv:
        k = argv.index("--next")
        if k + 1 >= len(argv):
            sys.exit("--next 后面要写几点，比如 --next 14:30")
        if os.environ.get("BOARD_LATER") != "1":
            sys.exit("--next 只能由 later 写（它会同时挂定时）：later 10m \"<事情>\" \"<到点要做什么>\"")
        return argv[:k] + argv[k + 2:], argv[k + 1]
    return argv, None


def main(argv):
    argv, nxt = _split_next(argv)
    cmd = argv[0] if argv else "list"
    try:
        if cmd in ("list", "ls"):
            print("\n".join(lines()) or "（任务板是空的）")
        elif cmd == "add" and len(argv) == 5:
            nid = add(*argv[1:5], nxt=nxt)
            print(f"#{nid}")
            refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "update" and 3 <= len(argv) <= 5:
            nid = int(argv[1].lstrip("#"))
            if not update(nid, argv[2], *argv[3:5], nxt=nxt):
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已更新")
            refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "done" and len(argv) == 2:
            nid = int(argv[1].lstrip("#"))
            if not done(nid):
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已结束")
            refresh({_chan_of(nid), _cur_channel()})
        else:
            sys.exit(__doc__.split("用法：", 1)[1].rstrip())
    except ValueError:
        sys.exit("编号要是数字，比如 board done 3")


if __name__ == "__main__":
    main(sys.argv[1:])
