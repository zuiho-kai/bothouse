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
  board done <编号> [返工次数 [原因]]      # 结束：移出任务板，记进 board-done.jsonl
  board rework [天数]                    # 最近 14 天的返工次数和原因
  board pause <编号> [原因]               # 暂停：留在板上、卡片单列「暂停」块，不算做完、不进 board-done.jsonl；
                                         #   条目在工作区里时同时 <桥> workspace park：那里没别的活就放回池子、清会话
                                         #   （恢复后重新 ws-handoff，先复用空着的工作区，不保证回原号）
  board resume <编号>                     # 恢复：回到「在做」
  board link <编号> <卡片链接>             # 给这件事挂一张公开任务卡（Discord 消息链接），卡片那行末尾出「[卡](链接)」
  board refresh                          # 只重画所有已有的置顶卡（让「已过」到点就出现，可由定时调用）
  --next：下次几点回来看这件事（如 14:30），显示在板上，让用户知道后面还会不会处理。
    只有 later 能写（它先挂好定时，挂不上就撤掉这行；用环境变量 BOARD_LATER=1 标明），手写 --next 会被拒：
    板上写了「下次看」却没挂定时，就没人兑现（2026-10-23 PR #81 审查）。

频道卡片（用户 2026-10-23「我这根本感知不到你后面还可以去处理……也没看到有任何sub表」）：
  每次 add/update/done/pause/resume/link 后，在条目所在频道把任务板（在做 + 暂停 + 今天做完）编辑进同一条置顶消息（不刷屏）。
  「下次看」到点后，桥里对应的定时（later 挂的，描述 = 事情）也不在了，就标「已过」：说明到点没人回来看。
  done 之后若设了 BOARD_PR_REPO（owner/name），用 gh 列出自己在该仓库还开着的 PR 作提醒；不设、gh 不在或失败都静默跳过。
  工作区归属来自桥的注册表（<桥> workspace list --session-key discord:<频道> --json）：聊天频道的卡按「本频道 + 名下各工作区」
  分块，工作区里的条目变了也改它所属聊天频道的卡；问不到桥就只列本频道的条目。
  条目的频道 = 加它时的 CC_SESSION_KEY；旧条目没记频道的，被 update 时记成当时的频道，没被碰过的在每张卡上都列。
  Discord token：环境变量 DISCORD_BOT_TOKEN，否则 <GATE_SETUP_DIR>/secrets.env 里的同名变量；读不到就跳过卡片。
  消息 id 存 <BOARD_DIR>/board-cards.state（不叫 .json，理由同上）；消息被删就重发并置顶。失败只打警告，不影响板子本身。
"""
import fcntl, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
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
    pz = f"｜暂停（{i['paused']}{'：' + i['pause_why'] if i.get('pause_why') else ''}）" if i.get("paused") else ""
    card = f"｜卡 {i['card']}" if i.get("card") else ""
    return f"#{i['id']} {i['what']}｜{i.get('where') or '-'}｜{i.get('status') or '-'}｜{i.get('who') or '-'}｜{i.get('at', '')}{nxt}{pz}{card}"


def lines():
    return [fmt(i) for i in items()]


def _now():
    return time.strftime("%m-%d %H:%M")


def _cur_channel():
    k = os.environ.get("CC_SESSION_KEY", "")  # 形如 discord:<频道 id>
    c = k.removeprefix("discord:")
    return c if k.startswith("discord:") and c.isdigit() else None


NEXT_GRACE = 120  # 秒：later 按当前分钟算「几点」，定时到点最多晚 59 秒，再留一分钟余量；过了这么久还没回来看才算「已过」


def _deadline(hhmm, ref=None):
    """「下次看 HH:MM」对应的时刻（epoch）：ref（默认现在）之后第一个 HH:MM，跨午夜算明天。"""
    ref = time.time() if ref is None else ref
    try:
        h, m = (int(x) for x in hhmm.split(":"))
    except (AttributeError, ValueError):
        return None
    lt = time.localtime(ref)
    ts = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, h, m, 0, 0, 0, -1))
    return int(ts + 86400 if ts < ref - NEXT_GRACE else ts)


def _bound_now():
    """条目绑上工作区的时刻（RFC 3339，UTC）：桥里那件交接（claim 时记的）早于它，同一聊天频道之后再交的晚于它；
    park 时带上，桥只放这一件（core ParkTeamWorkspaceFor）。"""
    return datetime.now(timezone.utc).isoformat()


def _back_to_chat(it):
    """条目离开工作区（暂停、「谁」改走）：工作区随后放回池子、可能归别的聊天频道，条目的卡片频道 ch 改回交活的
    聊天频道，免得从原聊天频道的置顶卡上消失、又出现在后来领走工作区的频道卡上（审查 pr261-code.md 第 2 条）。"""
    chat = it.get("chat") or ""
    if chat.startswith("discord:") and chat.split(":", 1)[1].isdigit():
        it["ch"] = chat.split(":", 1)[1]


def add(what, where, status, who, nxt=None, ws=None, chat=None):
    """ws：ws-handoff 交活时建的条目绑到这个工作区（<平台>:<id>，桥里那一件交接）；pause、把「谁」改走时放掉那一件。
    chat：交活的聊天频道（<平台>:<id>），恢复/改回工作区时按它向桥收回占用（reoccupy）。"""
    with _locked():
        cur = _read()
        nid = max([i["id"] for i in cur + _read("board-done.jsonl")] + [0]) + 1
        it = {"id": nid, "what": what, "where": where, "status": status, "who": who, "at": _now()}
        if nxt:
            it["next"], it["next_ts"] = nxt, _deadline(nxt)
        if _cur_channel():
            it["ch"] = _cur_channel()
        sk = os.environ.get("CC_SESSION_KEY") or os.environ.get("CC_SESSION", "")
        if ":" in sk:  # 完整会话 key（飞书、DSH、网页版也有），pause 时按它找工作区
            it["sk"] = ":".join(sk.split(":", 2)[:2])
        if ws:
            it["ws"] = it["sk"] = ws
            it["bound"] = _bound_now()
            if chat and ":" in chat:
                it["chat"] = ":".join(chat.split(":", 2)[:2])
            it.pop("ch", None)
            if ws.startswith("discord:"):
                it["ch"] = ws.split(":", 1)[1]
        cur.append(it)
        _write(cur)
    return nid


def update(nid, status, where=None, who=None, nxt=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        before = dict(hit)
        hit["status"], hit["at"] = status, _now()
        if who and hit.get("ws") and who != before.get("who"):
            hit["ws_was"] = hit.pop("ws")  # 「谁」改走：这件不再算在那个工作区（main 里 park 掉它的交接）
            _back_to_chat(hit)
        if where:
            hit["where"] = where
        if who:
            hit["who"] = who
        if nxt:
            hit["next"], hit["next_ts"] = nxt, _deadline(nxt)
        if not hit.get("ch") and _cur_channel():
            hit["ch"] = _cur_channel()
        _write(cur)
    if hit.get("ws"):
        schedule_stale_check(hit)
    return before


CARD_RE = re.compile(r"https://discord\.com/channels/\d+/\d+/\d+")  # Discord 消息链接：/channels/<服务器>/<频道>/<消息>


def link(nid, url):
    if not CARD_RE.fullmatch(url):
        raise ValueError("card")
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        hit["card"] = url
        _write(cur)
    return True


# 暂停：条目留在 board.jsonl（不写 board-done.jsonl，不算完成），带 paused（暂停时刻）和 pause_why；卡片上单列「暂停」块。
def pause(nid, why=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        hit["paused"] = hit["at"] = _now()
        ws = hit.pop("ws", None)  # 交接已放回桥（main 里 park）；ws_was 留着，resume 时向桥收回（reoccupy）
        if ws:
            hit["ws_was"] = ws
            _back_to_chat(hit)
        if why:
            hit["pause_why"] = why
        else:
            hit.pop("pause_why", None)
        _write(cur)
    return {**hit, "ws": ws} if ws else hit


def _ws_key(it):
    """条目所在频道的会话 key（<平台>:<id>）：add 时记的 sk，老条目退回 discord:<ch>。"""
    return it.get("sk") or (f"discord:{it['ch']}" if it.get("ch") else "")


def _park_once(cc, sk, chat, bound=None):
    """<桥> workspace park 一次，只放 chat 交的那一件（绑定时刻 bound 及以前最新的那件）：工作区眼下不归 chat、
    或那件早已收尾（工作区做完放回、又被别人或 chat 自己的新活领走）时桥拒绝（not owned），什么都不动。
    True 放回了 / False 那里还有活 / None 不在工作区、不归它、早已放回或失败（失败写 stderr）。"""
    args = [cc, "workspace", "park", "--session-key", sk, "--chat", chat]
    if bound:
        args += ["--before", bound]
    try:
        p = subprocess.run(args + ["--json"],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"board: 工作区没放回（{e}），pause 照常记", file=sys.stderr)
        return None
    if p.returncode != 0:
        if "not owned" not in p.stderr:  # 不在工作区里（聊天频道）或工作区早已空：不用放
            print(f"board: 工作区没放回（{p.stderr.strip()[:200]}），pause 照常记", file=sys.stderr)
        return None
    try:
        return bool(json.loads(p.stdout).get("freed"))
    except ValueError:
        return None


def park_workspace(it):
    """暂停即放回（用户同意的「停着的活挪到待办列表」）：条目是 ws-handoff 交活时建、绑了工作区的（it["ws"]），
    <桥> workspace park 放掉它在那里的那一件交接；那里没别的活在做，桥就把工作区放回池子并清掉会话
    （core/team_workspace.go ParkTeamWorkspace）。只按绑定的条目放：没绑的（在工作区里手动 add 的）不动桥，
    免得把刚交、还没上板的活一起放掉、串频道（审查 ~/.claude/reviews/ws-stale-local-code.md 第二轮）。
    返回 True 放回了 / False 还有别的活留着 / None 没绑工作区、没桥或失败（失败写 stderr，不拦 pause）。"""
    cc = _cc_bin()
    if not it.get("ws") or not cc or not it.get("chat"):
        return None  # 没记交活的聊天频道：认不出工作区眼下是不是还在做这件，不放（宁可多占，不停别人的活）
    return _park_once(cc, it["ws"], it["chat"], it.get("bound"))


# User, 2026-10-24: "稳定的一放一收，以小时为力度". Unfinished tasks with no
# progress for one hour stay on the board as paused and release only their bound handoff (#261).
STALE_AFTER = 60 * 60


def pause_stale(now=None):
    now = time.time() if now is None else now
    changed = []
    for it in _read():
        if it.get("paused") or not it.get("ws") or it.get("next_ts", 0) > now:
            continue
        try:
            stamp = time.mktime(time.strptime(f"{time.localtime(now).tm_year}-{it['at']}", "%Y-%m-%d %H:%M"))
        except (KeyError, ValueError):
            continue
        if stamp > now:  # board timestamps omit the year; handle the New Year rollover
            stamp = time.mktime(time.strptime(f"{time.localtime(now).tm_year - 1}-{it['at']}", "%Y-%m-%d %H:%M"))
        if now - stamp < STALE_AFTER:
            continue
        hit = pause(it["id"], "一小时无进展，转待办")
        if hit:
            park_workspace(hit)
            changed.append(hit)
    return changed


def schedule_stale_check(it):
    if not it.get("ws") or not _cc_bin() or not it.get("sk"):
        return
    command = f'{sys.executable} "{Path(__file__).resolve()}" refresh'
    r = subprocess.run([_cc_bin(), "timer", "add", "--session-key", it["sk"], "--delay", "60m",
                        "--exec", command, "--mute", "--desc", f"检查任务 #{it['id']} 是否停滞"],
                       capture_output=True, text=True)
    if r.returncode:
        print(f"board: #{it['id']} 自动停滞检查未安排：{r.stderr.strip()[:200]}", file=sys.stderr)


WS_NAME_RE = re.compile(r"^(工作区\d+)")  # 「谁」= 工作区名 + 主角色名（ws-handoff 写的 f"{name}{lead_name}"）


def _ws_id_by_name(cc, chat, name):
    """chat 所在分类的共享池里叫 name 的工作区 → <平台>:<id>；问不到返回 None。"""
    try:
        p = subprocess.run([cc, "workspace", "list", "--session-key", chat, "--json"],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
        pool = json.loads(p.stdout).get("pool") or [] if p.returncode == 0 else []
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        return None
    plat = chat.split(":", 1)[0]
    return next((f"{plat}:{w['id']}" for w in pool if isinstance(w, dict) and w.get("name") == name and w.get("id")), None)


def reoccupy(it, ws):
    """暂停或把「谁」改走时工作区已放回池子（park），可能已被别的聊天频道领走；这时恢复，工作区会同时归两个聊天频道、
    上报串到后来的频道。所以 resume / 把「谁」改回工作区之前，先以交活的聊天频道（it["chat"]）向桥认领它
    （<桥> workspace claim，core ClaimTeamWorkspace：归别的聊天频道就拒绝，没被领走就记回原聊天频道、加一件在做的交接）。
    返回 None 可以继续（已收回，或条目没记聊天频道、没桥：不涉及桥）/ 字符串：拒绝的原因，板子不改。"""
    cc, chat = _cc_bin(), it.get("chat")
    if not cc or not chat or not ws:
        return None
    try:
        p = subprocess.run([cc, "workspace", "claim", ws.split(":", 1)[-1], "--session-key", chat],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return f"问不到桥这个工作区眼下归谁（{e}）"
    if p.returncode != 0:
        err = (p.stderr.strip() or p.stdout.strip())[:200]
        if "another chat channel" in err or "workspace-owned" in err:
            return f"工作区暂停后被别的聊天频道领走了（{err}）"
        return f"向桥收回工作区失败（{err}）"
    return None


def _refuse(nid, why):
    sys.exit(f"#{nid} 不能回到原工作区：{why}，板子没改。把「谁」改成「待接手」（board update {nid} <状态> \"\" 待接手），"
             f"或用 ws-handoff 另交一个工作区")


def rebind(nid, ws):
    """reoccupy 收回后，条目重新绑上工作区（之后 pause / 改走会再放回）。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is not None:
            hit["ws"] = hit["sk"] = ws
            hit["bound"] = _bound_now()  # reoccupy 刚 claim 了一件新交接
            hit.pop("ws_was", None)
            if ws.startswith("discord:"):
                hit["ch"] = ws.split(":", 1)[1]
            _write(cur)


def resume(nid):
    """None：没有这条；False：它没在暂停；True：已恢复。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or not hit.get("paused"):
            return None if hit is None else False
        hit.pop("paused", None)
        hit.pop("pause_why", None)
        hit["at"] = _now()
        _write(cur)
    return True


def done(nid, rework=None, why=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        _write([i for i in cur if i["id"] != nid])
        with open(_path("board-done.jsonl"), "a") as f:
            rec = {**hit, "done_at": _now()}
            if rework is not None:  # 不填就不写这两项，汇总时算「未填」
                rec["rework"] = rework
                if why:
                    rec["rework_why"] = why
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return True


# 返工汇总。用户同意橘的提议「任务收尾时在任务板上多记一项『返工了几次、为什么』……攒上两周就知道哪条规则真起了作用」（2026-10-23「可以的」）
REWORK_DAYS = 14  # 来源：同上「攒上两周」


def _done_time(s):
    """done_at 形如 10-23 14:30（没写年）：按今年算，比现在晚就是去年的。"""
    try:
        t = time.strptime(f"{time.localtime().tm_year}-{s}", "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return None
    ts = time.mktime(t)
    if ts > time.time() + 86400:
        ts = time.mktime(time.strptime(f"{time.localtime().tm_year - 1}-{s}", "%Y-%m-%d %H:%M"))
    return ts


def rework_report(days=REWORK_DAYS):
    since = time.time() - days * 86400
    recs = [r for r in _read("board-done.jsonl") if (_done_time(r.get("done_at")) or 0) >= since]
    by, clean, unset = {}, [], []
    for r in recs:
        n = r.get("rework")
        if n is None:
            unset.append(r)
        elif n == 0:
            clean.append(r)
        else:
            by.setdefault(r.get("rework_why") or "（没写原因）", []).append(r)
    out = [f"最近 {days} 天结束 {len(recs)} 件：返工 {sum(len(v) for v in by.values())} 件，没返工 {len(clean)} 件，未填 {len(unset)} 件"]
    for why, rs in sorted(by.items(), key=lambda kv: -sum(r["rework"] for r in kv[1])):
        out.append(f"{why}：{sum(r['rework'] for r in rs)} 次｜" + "，".join(f"#{r['id']} {r['what']}（{r['rework']}）" for r in rs))
    return "\n".join(out)


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


# 「今天做完」只列最新几件，其余写「…另 N 件」：一天做完上百件会把 2000 字的卡撑爆，在做的要优先放得下。
DONE_PER_BLOCK = 3
TIMER_TIMEOUT = 5  # 秒：本机 socket 调用，正常 1 秒内；超时就当不知道定时在不在，「下次看」照原样显示
_AUTO = object()
_TIMER_LINE = re.compile(r"^\s*\S+\s+[0-9a-f]+\s+(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)?\s+(.*?)\s*$")


def _cc_bin():  # 同 ../lead/later：CC_BIN，否则 PATH 里的 bothouse / cc-connect
    return os.environ.get("CC_BIN") or shutil.which("bothouse") or shutil.which("cc-connect")


def _timers():
    """桥里还没到点的定时 [(epoch, 描述)]（cc-connect timer list）；拿不到返回 None。
    later 挂定时用 --desc "<事情>"，和任务板条目的 what 一样，靠它对上。"""
    cc = _cc_bin()
    if not cc:
        return None
    try:
        p = subprocess.run([cc, "timer", "list"], capture_output=True, text=True, timeout=TIMER_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None
    out = p.stdout or ""
    if p.returncode != 0:
        return None
    if out.strip().startswith("No pending timers"):
        return []
    if not out.lstrip().startswith("Pending timers"):
        return None
    from datetime import datetime
    res = []
    for ln in out.splitlines():
        m = _TIMER_LINE.match(ln)
        if m:
            tz = m.group(2) or ""
            try:
                ts = datetime.fromisoformat(m.group(1) + ("+00:00" if tz == "Z" else tz)).timestamp()
            except ValueError:
                continue
            res.append((ts, m.group(3)))
    return res


def _next_live(i, timers, now=None):
    """「下次看」还作不作数：True 还没到点（或定时还挂着），False 已过（到点了、定时也不在了），None 不知道（照原样显示）。
    later 先记板再挂定时，刚记上的那一下定时还查不到，所以先看时间（next_ts，记板时算好）。"""
    now = time.time() if now is None else now
    ts = i.get("next_ts")
    if ts and ts > now - NEXT_GRACE:
        return True
    if timers is None:  # 问不到桥（挂了、超时、在重启）：定时可能还等着桥起来再发
        return None
    try:
        h, m = (int(x) for x in i["next"].split(":"))
    except (KeyError, AttributeError, ValueError):
        return None
    def gap(t):
        lt = time.localtime(t)
        d = abs(lt.tm_hour * 60 + lt.tm_min - h * 60 - m) % 1440
        return min(d, 1440 - d) * 60
    return any(d == i.get("what") and gap(t) <= NEXT_GRACE for t, d in timers)


WS_TIMEOUT = 5  # 秒：问桥工作区注册表的上限，同 TIMER_TIMEOUT 的用意（桥卡住时不拖住 board 命令）


def _ws_reg(ch):
    """产品的工作区注册表（<桥> workspace list --session-key discord:<ch> --json，core/team_workspace_api.go）：
    返回 (聊天频道 id, [(工作区名, 工作区频道 id)])；ch 是工作区时返回它所属的聊天频道。拿不到（没桥、团队工作区关着、
    不是团队频道）返回 None，调用方退回只按条目频道过滤。"""
    cc = _cc_bin()
    if not cc or not ch:
        return None
    try:
        p = subprocess.run([cc, "workspace", "list", "--session-key", f"discord:{ch}", "--json"],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
        r = json.loads(p.stdout) if p.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if not isinstance(r, dict):
        return None
    parent = str(r.get("parent") or "").split(":")
    pid = parent[1] if len(parent) > 1 else parent[0]
    if not pid:
        return None
    ws = [(str(w.get("name") or w.get("id")), str(w["id"])) for w in r.get("workspaces") or []
          if isinstance(w, dict) and w.get("id") and str(w["id"]) != pid]
    return pid, ws


def card_text(its, done=(), timers=_AUTO, blocks=None):
    """在做 / 暂停 / 今天做完 三块。整卡保证 <= LIMIT：先少列做完的，再截短状态；在做的一件都不丢。
    blocks=[(块名, 频道 id), ...]：聊天频道的卡按「本频道 + 名下各工作区」分块列在做的事（第一块是本频道，
    没记频道的旧条目也算它）；今天做完的不分块，工作区的条目前面标工作区名。None 时不分块。"""
    if timers is _AUTO:
        timers = _timers() if any(i.get("next") for i in its) else None
    live = {i.get("id"): _next_live(i, timers) for i in its if i.get("next")}
    names = {cid: name for name, cid in (blocks or [])[1:]}
    def row(i, cap):
        st = i.get("status") or "-"
        if cap is not None and len(st) > cap:
            st = st[:cap] + "…"
        nxt = ""
        if i.get("paused"):  # 暂停的不显示「下次看」，改写暂停时刻和原因
            why = i.get("pause_why") or ""
            nxt = f"｜{i['paused']} 暂停{'：' + why if why else ''}"
        elif i.get("next"):
            nxt = f"｜下次看 {i['next']}" + ("（已过）" if live.get(i.get("id")) is False else "")
        card = f" [卡]({i['card']})" if i.get("card") else ""  # 链接整段追加，不会被截在中间
        return f"#{i['id']} {i['what']}｜{i.get('who') or '-'}｜{st}｜{i.get('at', '')}{nxt}{card}"
    seen = {}  # 同一件事分几次上板（如等 CI 回来看了几趟）只列一行；最近做完的排前面
    for k, i in enumerate(done):
        ws = names.get(i.get("ch"))
        key = f"- {ws + '·' if ws else ''}{i.get('who') or '-'}：{i.get('what')}"
        n, _ = seen.get(key, (0, 0))
        seen[key] = (n + 1, k)
    done_rows = [key + (f"（{n} 趟）" if n > 1 else "") for key, (n, _) in sorted(seen.items(), key=lambda kv: -kv[1][1])]
    def tail(n):
        if not done_rows:
            return []
        if n is None:  # 最后一招：做完的只写件数
            return ["", f"**今天做完** {len(done_rows)} 件"]
        more = [f"- …另 {len(done_rows) - n} 件"] if len(done_rows) > n else []
        return ["", "**今天做完**"] + done_rows[:n] + more
    head = f"**任务板**（{_now()} 更新；板子一变这条就改）"
    longest = max([len(i.get("status") or "") for i in its] + [0])
    caps = [None] + list(range(longest - 10, -1, -10)) + [0]
    stages = [(n, None) for n in range(DONE_PER_BLOCK, -1, -1)] + [(None, c) for c in caps]
    for n, cap in stages:
        live_its = [i for i in its if not i.get("paused")]
        if blocks:
            own = blocks[0][1]
            body = []
            for k, (name, cid) in enumerate(blocks):
                rs = [row(i, cap) for i in live_its if i.get("ch") == cid or (k == 0 and i.get("ch") in (None, own))]
                if k == 0:
                    body += rs
                elif rs:
                    body += ["", f"**{name}**"] + rs
            body = body or ["现在没有进行中的事。"]
        else:
            body = [row(i, cap) for i in live_its] or ["现在没有进行中的事。"]
        held = [row(i, cap) for i in its if i.get("paused")]
        text = "\n".join([head] + body + (["", "**暂停**"] + held if held else []) + tail(n))
        if len(text) <= LIMIT:
            return text
    return text[:LIMIT]


def _today_done():
    today = time.strftime("%m-%d")
    return [i for i in _read("board-done.jsonl") if str(i.get("done_at", "")).startswith(today)]


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
        its, today = _read(), _today_done()
        timers = _timers() if any(i.get("next") for i in its) else None  # 每次刷新只问一次桥
        todo = {c for c in set(chans) | set(state) if c}
        regs = {c: _ws_reg(c) for c in todo}
        for r in list(regs.values()):  # 工作区的条目变了，它所属聊天频道的卡也要改
            if r and r[0] not in regs:
                regs[r[0]] = _ws_reg(r[0])
        for ch in sorted(regs):
            r = regs[ch]
            blocks = [("", ch)] + r[1] if r and r[0] == ch and r[1] else None
            ids = {cid for _, cid in blocks} if blocks else {ch}
            mine = lambda xs: [i for i in xs if i.get("ch") is None or i.get("ch") in ids]
            text = card_text(mine(its), mine(today), timers, blocks)
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


# done 后提醒自己还开着的 PR（开了就该合）。只提醒，不阻塞 done；没设仓库、gh 不在、失败、超时都静默跳过。
GH_TIMEOUT = 10  # 秒：gh 走网络，正常 1–3 秒；超时就当没有，不拖慢 done


def open_pr_hint():
    repo = os.environ.get("BOARD_PR_REPO")
    if not repo:
        return None
    try:
        p = subprocess.run(["gh", "pr", "list", "--repo", repo, "--state", "open", "--author", "@me", "--limit", "100",
                            "--json", "number"], capture_output=True, text=True, timeout=GH_TIMEOUT)
        prs = json.loads(p.stdout) if p.returncode == 0 else []
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if not prs:
        return None
    return f"还有 {len(prs)} 个 PR 没合：" + " ".join(f"#{x['number']}" for x in prs)


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
            cur = next((i for i in items() if i["id"] == nid), None)
            m = WS_NAME_RE.match(argv[4]) if len(argv) > 4 and argv[4] else None
            back = None  # 「谁」改回某个工作区（不是它眼下绑的那个）：先向桥收回，归别人就拒绝
            if cur and m and not cur.get("paused") and argv[4] != cur.get("who") and cur.get("chat") and _cc_bin():
                back = _ws_id_by_name(_cc_bin(), cur["chat"], m.group(1))
                why = reoccupy(cur, back) if back else None
                if why:
                    _refuse(nid, why)
            before = update(nid, argv[2], *argv[3:5], nxt=nxt)
            if before and back:
                rebind(nid, back)
            if not before:
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已更新")
            if before.get("ws") and not any(i["id"] == nid and i.get("ws") == before["ws"] for i in items()):
                freed = park_workspace(before)  # 「谁」改走了：它在工作区的那件交接放回桥
                if freed:
                    print("工作区已放回池子，会话已清")
            refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "done" and 2 <= len(argv) <= 4:
            nid = int(argv[1].lstrip("#"))
            rework = int(argv[2]) if len(argv) > 2 else None
            if rework is not None and rework < 0:
                sys.exit("返工次数要是 0 或正整数，比如 board done 3 1 \"没先读现有实现\"")
            if not done(nid, rework, argv[3] if len(argv) > 3 else None):
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已结束")
            refresh({_chan_of(nid), _cur_channel()})
            hint = open_pr_hint()
            if hint:
                print(hint)
        elif cmd == "pause" and 2 <= len(argv) <= 3:
            nid = int(argv[1].lstrip("#"))
            hit = pause(nid, argv[2] if len(argv) > 2 else None)
            if not hit:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已暂停")
            freed = park_workspace(hit)
            if freed is not None:
                print("工作区已放回池子，会话已清" if freed else "工作区里还有别的活，先不放回")
            refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "resume" and len(argv) == 2:
            nid = int(argv[1].lstrip("#"))
            cur = next((i for i in items() if i["id"] == nid), None)
            back = cur.get("ws_was") if cur and cur.get("paused") and WS_NAME_RE.match(cur.get("who") or "") else None
            why = reoccupy(cur, back) if back else None
            if why:
                _refuse(nid, why)
            r = resume(nid)
            if r and back and cur.get("chat") and _cc_bin():
                rebind(nid, back)
            if r is None:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            if r:
                active = next(i for i in items() if i["id"] == nid)
                schedule_stale_check(active)
            print("已恢复" if r else f"#{nid} 没在暂停")
            if r:
                refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "link" and len(argv) == 3:
            nid = int(argv[1].lstrip("#"))
            try:
                ok = link(nid, argv[2].strip())
            except ValueError:
                sys.exit("卡片链接要是 https://discord.com/channels/<服务器>/<频道>/<消息>")
            if not ok:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已挂卡")
            refresh({_chan_of(nid), _cur_channel()})
        elif cmd == "refresh" and len(argv) == 1:
            pause_stale()
            refresh(set())  # 改所有已有卡片的频道（board-cards.state 里的）
        elif cmd == "rework" and len(argv) <= 2:
            print(rework_report(int(argv[1]) if len(argv) > 1 else REWORK_DAYS))
        else:
            sys.exit(__doc__.split("用法：", 1)[1].rstrip())
    except ValueError:
        sys.exit("编号、返工次数、天数要是数字，比如 board done 3 1 \"原因\"")


if __name__ == "__main__":
    main(sys.argv[1:])
