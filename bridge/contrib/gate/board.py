#!/usr/bin/env python3
"""任务板：谁手上有哪件事、做在哪（分支/PR/路径）、做到哪一步。

用户原话（2026-10-22）：「核心是为什么他不能共享进度……他应该能看到为什么从开始找」；
提议任务板后：「可以的，核心要区分一下，让jev判断，是给谁回的」。

- 每条一行：事情、分支/PR/路径、状态、谁在做、更新时间。存 <BOARD_DIR>/board.jsonl（不叫 .json：
  cc-connect 把 team 目录下的 *.json 当队友状态文件读，core/team.go teamSummary）。
- 读：ctxsvc.context 把整张板附进每个 bot 每轮的上下文（板子变了才重推）；gate 判收件人时也读（gate.addressee）。
- 写：../lead/board（本文件的命令行）。
- BOARD_DIR：环境变量，默认 <GATE_SETUP_DIR>/team（GATE_SETUP_DIR 不设 = 产品数据目录，见 datadir.py，同 gate 和 lead.py）；
  建议设成 cc-connect 的 team_status_dir，和队友状态放一起。

用法：
  board                                  # 列出进行中的事
  board add <事情> <分支/PR/路径> <状态> <谁> --short 短名 [--next 几点看]   # 新加一条，打印编号
                                         #   短名（≤10 字）上团队板；不写就从事情去掉「用户点名：」「#N 续：」这类前缀再截
  board update <编号> <状态> [分支/PR/路径] [谁] [--next 几点看]
                                         #   状态以收尾词开头（已交回/已完成/已验收/已收口/已结束/done）就直接结束，同 done
  board next <编号> <几点> | --restore <JSON>  # 只改「下次看」（later 专用，要 BOARD_LATER=1）；打印改前记录和事情
  board done <编号> <返工次数> [原因]      # 结束：移出任务板，记进 board-done.jsonl；返工次数必填，大于 0 时原因必填
  board rework [天数]                    # 最近 14 天的返工次数和原因
  board pause <编号> [原因]               # 暂停：留在板上、团队板单列「暂停」块，不算做完、不进 board-done.jsonl；
                                         #   条目在工作区里时同时 <桥> workspace park：那里没别的活就放回池子、清会话
                                         #   （恢复后重新 ws-handoff，先复用空着的工作区，不保证回原号）
  board resume <编号>                     # 恢复：回到「在做」
  board link <编号> <卡片链接>             # 给这件事挂一张公开任务卡（Discord 消息链接），board 列表那行末尾出「卡 链接」
  board refresh                          # 把一小时没进展的工作区条目转暂停（停滞检查定时调用），再自动收起没用的暂停条目
  board prune [--dry-run]                # 只做自动收起（--dry-run 只列不动）；收起的条目 board resume <编号> 能找回
  board prune --off | --on | --idle <小时> # 整块板子关掉 / 打开自动收起、改闲置门槛（默认开、24 小时），打印当前设定
  add 拒绝纯回看条目：事情以「#编号」开头指向板上另一条，或状态以「等着」开头且没有 PR 号/路径；
    改用完成通知，或在原条目上 board update / later <编号>（later 在原条目上记「下次看」，不新建回看条目）。
  --next / board next：下次几点回来看这件事（如 14:30），显示在板上，让用户知道后面还会不会处理。
    只有 later 能写（它先改好 next 再挂定时，挂不上就改回原值；用环境变量 BOARD_LATER=1 标明），手写会被拒：
    板上写了「下次看」却没挂定时，就没人兑现（2026-10-23 PR #81 审查）。

频道卡片（用户 2026-10-23「我这根本感知不到你后面还可以去处理……也没看到有任何sub表」）：
  本脚本不再自己发置顶卡、不读平台 token（#597 K9）：桥的原生团队板（core/team_task_board.go）读同一个
  <BOARD_DIR>/board.jsonl，在每个条目所在频道（add 时记的 sk；工作区交接的条目也上交活的聊天频道 chat）的团队板里
  出一节「任务板」（在做按本频道 + 名下各工作区分块、暂停、今天做完；「下次看」到点且定时已不在标「已过」；没记频道的老条目按 ch 归频道，都没有就出在主聊天频道），四平台都走桥的 BoardPoster。要出板，BOARD_DIR 和 team_status_dir 须是同一个目录。
  done 之后若设了 BOARD_PR_REPO（owner/name），用 gh 列出自己在该仓库还开着的 PR 作提醒；不设、gh 不在或失败都静默跳过。

暂停条目自动收起（已经没用的暂停条目不再要人手动清）：暂停条目满足任一条就移进 board-done.jsonl（带 auto_pruned=原因，不删数据，board resume 能找回）：
  ① 「分支/PR/路径」（where）里的 PR 全部已合或已关，且合/关超过 2 小时（要设 BOARD_PR_REPO；gh 查不到就不按这条收）；
  ② 状态或暂停原因写了「并入 #N」/「并入主线 #N」，且 #N 还在板上；
  ③ 暂停后闲置门槛小时（默认 24，`board prune --idle <小时>` 改）没汇报、没改；闲置从暂停时刻起算。暂停原因含「等用户」「等待用户」的、事情写了「主线」的不按③收。
  提问暂停（ws-up --ask，原因以「等待用户答复」开头）一律不收。等用户的条目团队板暂停行标「等你 N 小时」（core/team_task_board.go）。
  触发：每个 board 命令顺带跑（不查 gh）、board refresh / board prune（查 gh）、暂停时挂两个定时（2 小时、闲置门槛）跑 refresh。
  开关和门槛是整块板子的设定（多个角色共用一块板）：只存在 <BOARD_DIR>/board-prune.json，只有 board prune --off / --on /
  --idle <小时> 写它；所有角色的命令和桥跑的定时都只读它。文件没有 = 开、24 小时；文件坏了 = 不收并警告一行。
  返工汇总和团队板「今天做完」都不算自动收起的记录。
"""
import fcntl, json, os, re, shlex, shutil, subprocess, sys, time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # ../lead/board 从别处跑时也找得到同目录的 datadir.py
import datadir  # noqa: E402

SETUP = datadir.setup_dir()


def _board_dir():
    if os.environ.get("BOARD_DIR"):
        return Path(os.environ["BOARD_DIR"]).expanduser()
    cfg = SETUP / "config.toml"
    if cfg.is_file():
        try:
            m = re.search(r'^\s*team_status_dir\s*=\s*"([^"]+)"', cfg.read_text(encoding="utf-8"), re.M)
            if m and m.group(1).strip():
                return Path(m.group(1).strip()).expanduser()
        except OSError:
            pass
    return (SETUP / "team").expanduser()


DIR = _board_dir()


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


# 团队板只显示短名（用户 2026-10-28「工作区的任务板又长又臭」）。同 core/team_task_board.go teamTaskBoardShort，改要一起改。
SHORT_RUNES = 10
_SHORT_TAG = re.compile(r"[（(]用户点名[)）]")
_SHORT_PREFIX = re.compile(r"^\s*(?:用户点名(?:「[^」]*」|（[^）]*）|\s*#\d+\s*\S{0,3})?[：:]|用户点名\s*|事故\s*#\d+[^：:]{0,8}[：:]|#\d+[^：:]{0,10}[：:])\s*")


# 测试活：标题以测试标记加分隔符开头（「测试：」「验收探针：」「【自检】」「probe:」），交回、提问、上报都不进用户的聊天频道
# （用户 2026-10-28「这个傻逼提问探针是什么东西啊？来了三个」）。与 core/test_noise.go 的 testWorkTitle 同一条规则。
TEST_TITLE = re.compile(r"^\s*[\[【(（]?\s*(验收探针|提问探针|探针|测试|自检|自验|test|probe|self-?check)\s*[\]】)）:：]", re.I)


def is_test(title):
    return bool(TEST_TITLE.match(title or ""))


def short_of(what):
    """事情的短名：去掉「用户点名：」「#N 续：」「事故 #N 跟进：」这类前缀，冒号前够短就取冒号前，否则截 10 字。"""
    s = _SHORT_TAG.sub("", str(what or "")).strip()
    while True:
        t = _SHORT_PREFIX.sub("", s, count=1)
        if t == s or not t:
            break
        s = t
    m = re.search(r"[：:，,；;（(]", s)
    if m and 2 <= m.start() <= SHORT_RUNES:
        return s[:m.start()].strip()
    return s if len(s) <= SHORT_RUNES else s[:SHORT_RUNES].rstrip() + "…"


WAIT_STATUS_RE = re.compile(r"等待?用户|待用户")  # 状态写着在等用户（等用户[看片]、待用户定），同 core teamOtherQuiet


def waits_user(it):
    """等用户拍板/看片的条目：暂停原因或状态写着等用户。"""
    if it.get("paused"):
        return bool(WAIT_USER_RE.search(it.get("pause_why") or ""))
    return bool(WAIT_STATUS_RE.search(it.get("status") or ""))


def in_chat(it, key):
    """条目属于会话 key（<平台>:<id>）所在频道：建在这里、绑在这里（工作区），或从这里交出（聊天频道）。"""
    chat = ":".join(str(key or "").split(":", 2)[:2])
    if ":" not in chat:
        return False
    cid = chat.split(":", 1)[1]
    c = it.get("chat") or ""
    c = c if ":" in c else (f"discord:{c}" if c else "")
    return chat in (it.get("ws"), it.get("sk"), c) or (chat.startswith("discord:") and it.get("ch") == cid)


def short(it):
    return it.get("short") or short_of(it.get("what"))


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


def add(what, where, status, who, nxt=None, ws=None, chat=None, short_name=None):
    """ws：ws-handoff 交活时建的条目绑到这个工作区（<平台>:<id>，桥里那一件交接）；pause、把「谁」改走时放掉那一件。
    chat：交活的聊天频道（<平台>:<id>），恢复/改回工作区时按它向桥收回占用（reoccupy）。"""
    with _locked():
        cur = _read()
        nid = max([i["id"] for i in cur + _read("board-done.jsonl")] + [0]) + 1
        it = {"id": nid, "what": what, "short": (short_name or "").strip()[:SHORT_RUNES] or short_of(what),
              "where": where, "status": status, "who": who, "at": _now(), "dispatcher": os.environ.get("CC_PROJECT", "")}
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


def unadd(nid):
    """撤掉刚 add 的条目（ws-handoff 叫醒失败时用）：不进 board-done，不算返工。"""
    with _locked():
        cur = _read()
        tid = next((i.get("guard") for i in cur if i.get("id") == nid), None)
        _write([i for i in cur if i.get("id") != nid])
    _del_timer(tid)


# 纯回看条目：见文件头「add 拒绝纯回看条目」
def _lookback_reason(what, where, status):
    m = re.match(r"\s*#(\d+)", what)
    if m and any(i.get("id") == int(m.group(1)) for i in _read()):
        return f"「{what}」指向板上已有的 #{m.group(1)}"
    if status.lstrip().startswith("等着"):
        has_ref = where.strip() not in ("", "-") or re.search(r"PR\s*#?\d+|/", what + status)
        if not has_ref:
            return f"状态「{status}」只是在等、没有 PR 号/路径"
    return None


def set_next(nid, nxt=None, restore=None):
    """later 用：只改条目的「下次看」。nxt 给几点就设上；restore 给改前的记录（{} = 原来没有）就原样放回。
    返回 (改前的 next 记录, 事情)；没这个编号返回 None。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return None
        prev = {k: hit[k] for k in ("next", "next_ts") if k in hit}
        hit.pop("next", None), hit.pop("next_ts", None)
        if restore is not None:
            hit.update({k: restore[k] for k in ("next", "next_ts") if k in restore})
        else:
            hit["next"], hit["next_ts"] = nxt, _deadline(nxt)
        if not hit.get("ch") and _cur_channel():
            hit["ch"] = _cur_channel()
        _write(cur)
    return prev, hit.get("what", "")


def update(nid, status, where=None, who=None, nxt=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        before = dict(hit)
        hit["status"], hit["at"] = status, _now()
        tid = None
        if who and hit.get("ws") and who != before.get("who"):
            hit["ws_was"] = hit.pop("ws")  # 「谁」改走：这件不再算在那个工作区（main 里 park 掉它的交接）
            _back_to_chat(hit)
            tid = hit.pop("guard", None)  # 改派：撤兜底，交给新工作区时 ws-handoff 再挂
        if where:
            hit["where"] = where
        if who:
            hit["who"] = who
        if nxt:
            hit["next"], hit["next_ts"] = nxt, _deadline(nxt)
        if not hit.get("ch") and _cur_channel():
            hit["ch"] = _cur_channel()
        _write(cur)
    _del_timer(tid)
    return before


def progress(nid):
    """Record an explicit ws-up progress report for this bound workspace task."""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or not hit.get("ws") or hit.get("paused"):
            return False
        hit["progress_at"] = time.time()
        _write(cur)
    schedule_stale_check(hit)
    return True


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


# 交接文件「## 转交结果」节：ws-forward 转话和 board pause 的停手话都插到这一节末尾（下一个「## 」之前），节不存在才在
# 文件末尾新建。只往文件末尾追加时，节后面有「## 检查点」就落进检查点，工作区按提示读转交结果节读到的是旧的「接着做」，
# 把暂停的活又跑了三次（用户 2026-10-28「为什么又重新跑了一次，什么问题修一下」）。
FORWARD_HEAD = "## 转交结果"


def append_forward(path, line):
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    entry = f"- {line}"
    if FORWARD_HEAD in lines:
        end = next((k for k in range(lines.index(FORWARD_HEAD) + 1, len(lines)) if lines[k].startswith("## ")), len(lines))
        while end > lines.index(FORWARD_HEAD) + 1 and not lines[end - 1].strip():
            end -= 1  # 插在节里最后一条后面，节和下一节之间的空行留着
        lines[end:end] = [entry]
    else:
        lines += ([""] if lines and lines[-1].strip() else []) + [FORWARD_HEAD, entry]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def paused_item(path):
    """交接文件 path 对应、正在暂停的条目（ws-handoff 建条目时 where 记的就是交接文件）；没有返回 None。"""
    return next((i for i in _read() if i.get("paused") and i.get("where") == path), None)


def done_item(path):
    """交接文件 path 对应的活已交回：板上没有它的条目，board-done.jsonl 里有它做完的记录（自动收起的暂停不算），返回最后一条；否则 None。
    ws-forward 用它拦下往已交回的活转话（工作区交回后会话已清空，话发过去没人接）。"""
    if any(i.get("where") == path for i in _read()):
        return None
    return next((r for r in reversed(_read("board-done.jsonl")) if r.get("where") == path and not r.get("auto_pruned")), None)


# 暂停：条目留在 board.jsonl（不写 board-done.jsonl，不算完成），带 paused（暂停时刻）和 pause_why；团队板上单列「暂停」块。
def pause(nid, why=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        hit["paused"] = hit["at"] = _now()
        hit.pop("unpruned", None)  # 重新暂停：自动收起按新的暂停重新判（见 prune_why）
        ws = hit.pop("ws", None)  # 交接已放回桥（main 里 park）；ws_was 留着，resume 时向桥收回（reoccupy）
        if ws:
            hit["ws_was"] = ws
            _back_to_chat(hit)
        if why:
            hit["pause_why"] = why
        else:
            hit.pop("pause_why", None)
        tid = hit.pop("guard", None)  # 暂停、提问让出（ask 也走这里）：不再等工作区交回
        _write(cur)
    _del_timer(tid)
    return {**hit, "ws": ws} if ws else hit


def _ws_key(it):
    """条目所在频道的会话 key（<平台>:<id>）：add 时记的 sk，老条目退回 discord:<ch>。"""
    return it.get("sk") or (f"discord:{it['ch']}" if it.get("ch") else "")


def _park_once(cc, sk, chat, bound=None, stop=False):
    """<桥> workspace park 一次，只放 chat 交的那一件（绑定时刻 bound 及以前最新的那件）：工作区眼下不归 chat、
    或那件早已收尾（工作区做完放回、又被别人或 chat 自己的新活领走）时桥拒绝（not owned），什么都不动。
    True 放回了 / False 那里还有活 / None 不在工作区、不归它、早已放回或失败（失败写 stderr）。"""
    args = [cc, "workspace", "park", "--session-key", sk, "--chat", chat]
    if bound:
        args += ["--before", bound]
    if stop:
        args.append("--stop")
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


def park_workspace(it, stop=False):
    """暂停即放回（用户同意的「停着的活挪到待办列表」）：条目是 ws-handoff 交活时建、绑了工作区的（it["ws"]），
    <桥> workspace park 放掉它在那里的那一件交接；那里没别的活在做，桥就把工作区放回池子并清掉会话
    （core/team_workspace.go ParkTeamWorkspace）。只按绑定的条目放：没绑的（在工作区里手动 add 的）不动桥，
    免得把刚交、还没上板的活一起放掉、串频道（审查 ~/.claude/reviews/ws-stale-local-code.md 第二轮）。
    stop：用户叫停（board pause）时连工作区正在跑的那一轮一起打断，暂停后不再有输出；ws-up --ask 自己挂起不打断
    （用户 2026-10-28「我都说不做了，你还问我」「为什么工作区没暂停」）。
    返回 True 放回了 / False 还有别的活留着 / None 没绑工作区、没桥或失败（失败写 stderr，不拦 pause）。"""
    cc = _cc_bin()
    if not it.get("ws") or not cc or not it.get("chat"):
        return None  # 没记交活的聊天频道：认不出工作区眼下是不是还在做这件，不放（宁可多占，不停别人的活）
    return _park_once(cc, it["ws"], it["chat"], it.get("bound"), stop)


# User, 2026-10-24: "稳定的一放一收，以小时为力度". Unfinished tasks with no
# progress for one hour stay on the board as paused and release only their bound handoff (#261).
STALE_AFTER = 60 * 60


def pause_stale(now=None):
    now = time.time() if now is None else now
    changed = []
    for it in _read():
        if it.get("paused") or not it.get("ws") or it.get("next_ts", 0) > now:
            continue
        stamp = it.get("progress_at")
        if stamp is None:
            continue
        at_ts = _ts(it.get("at"), now)
        if isinstance(at_ts, (int, float)) and at_ts > stamp:
            stamp = at_ts
        if now - stamp < STALE_AFTER:
            continue
        hit = pause(it["id"], "一小时无进展，转待办")
        if hit:
            park_workspace(hit)
            schedule_prune_check(hit)
            changed.append(hit)
    return changed


def _timer_command():
    """定时跑的 board refresh：桥用自己的环境跑，钉住板子目录和 PR 仓库（开关、门槛在板子目录里，见 prune_conf）。"""
    env = [f"BOARD_DIR={shlex.quote(str(DIR))}"]
    if os.environ.get("BOARD_PR_REPO"):
        env.append(f"BOARD_PR_REPO={shlex.quote(os.environ['BOARD_PR_REPO'])}")
    return f"env {' '.join(env)} {shlex.quote(sys.executable)} {shlex.quote(str(Path(__file__).resolve()))} refresh"


def schedule_stale_check(it):
    if not it.get("ws") or not _cc_bin() or not it.get("sk"):
        return
    command = _timer_command()
    r = subprocess.run([_cc_bin(), "timer", "add", "--session-key", it["sk"], "--delay", "60m",
                        "--exec", command, "--mute", "--desc", f"检查任务 #{it['id']} 是否停滞"],
                       capture_output=True, text=True)
    if r.returncode:
        print(f"board: #{it['id']} 自动停滞检查未安排：{r.stderr.strip()[:200]}", file=sys.stderr)


# 兜底定时器（用户 2026-10-29「他那边返回给你的时候，这个定时任务自动删了，你那边还是要有个定时任务，防止说他那边超时」）：
# ws-handoff / ws-forward 交活时在交活的聊天频道（条目 chat）挂一个，到点叫醒那里的主角色查卡在哪、跟用户说；
# 条目结束（工作区 [report] 交回，桥调 board update 已完成）、提问让出（board ask）、暂停、「谁」改走时撤掉。
# 结果靠工作区 [report] 推回聊天频道，定时器只管超时，不轮询。条目上记 guard（timer id）。
GUARD_DELAY = "30m"  # 橘定的默认（交接 notes/ws-fallback-timer-1029.md），ws-handoff --guard 可改
TIMER_ID_RE = re.compile(r"Timer created:\s*(\S+)")


def _guard_prompt(it, delay):
    where = it.get("who") or "工作区"
    return (f"兜底到点：#{it['id']}「{it.get('what', '')}」交给{where} {delay} 了，还没交回。"
            f"先看任务板 #{it['id']}：已经完成或暂停就什么都不说，只回 NO_REPLY。"
            f"还在做就查卡在哪（工作区最后的发言、看门催促、命令是不是挂住），跟用户说一句卡在哪、你怎么办；"
            f"要接着等就用 ws-forward --notes {it.get('where', '')} \"<要它做的>\" 催一下（会重挂兜底），不自己 timer add。")


def _del_timer(tid):
    cc = _cc_bin()
    if not tid or not cc:
        return
    try:
        p = subprocess.run([cc, "timer", "del", tid], capture_output=True, text=True, timeout=WS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"board: 兜底定时器 {tid} 没撤掉（{e}）", file=sys.stderr)
        return
    if p.returncode and "not found" not in (p.stderr + p.stdout).lower():  # 已经到点触发过：不用撤
        print(f"board: 兜底定时器 {tid} 没撤掉（{p.stderr.strip()[:200]}）", file=sys.stderr)


def disarm_guard(nid):
    """撤掉 #nid 的兜底定时器（没有就什么都不做）。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        tid = hit.pop("guard", None) if hit else None
        if tid:
            _write(cur)
    _del_timer(tid)


def arm_guard(nid, delay=None):
    """给 #nid 挂（或重挂）兜底定时器，返回 timer id；条目没记聊天频道、没桥、挂不上返回 None（只警告，不拦交活）。"""
    delay = delay or GUARD_DELAY
    disarm_guard(nid)
    cc = _cc_bin()
    it = next((i for i in _read() if i["id"] == nid), None)
    if not cc or it is None or not it.get("chat"):
        return None
    try:
        p = subprocess.run([cc, "timer", "add", "-s", it["chat"], "--delay", delay, "--timeout-mins", "0",
                            "--silent", "--desc", f"兜底 #{nid}：工作区 {delay} 没交回就查", "--prompt", _guard_prompt(it, delay)],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"board: #{nid} 兜底定时器没挂上（{e}）", file=sys.stderr)
        return None
    m = TIMER_ID_RE.search(p.stdout)
    if p.returncode or not m:
        print(f"board: #{nid} 兜底定时器没挂上（{(p.stderr.strip() or p.stdout.strip())[:200]}）", file=sys.stderr)
        return None
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:  # 挂的时候条目已经结束了
            stale = True
        else:
            stale = False
            hit["guard"] = m.group(1)
            _write(cur)
    if stale:
        _del_timer(m.group(1))
        return None
    return m.group(1)


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


def returned(nid, reviewer, at=None):
    """Record a delivered report, not acceptance. Repeated reports keep the deadline."""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        if hit.get("returned_at"):
            return True
        hit["returned_at"] = datetime.fromisoformat(at.replace("Z", "+00:00")).isoformat() if at else _bound_now()
        hit["reviewer"] = hit.get("dispatcher") or reviewer
        hit["status"], hit["at"] = "已交回待验收", _now()
        if hit.get("chat"):
            hit["sk"] = hit["chat"]
        if hit.get("ws"):
            hit["ws_was"] = hit.pop("ws")
        hit.pop("paused", None)
        hit.pop("pause_why", None)
        _back_to_chat(hit)
        tid = hit.pop("guard", None)
        _write(cur)
    _del_timer(tid)
    return True


def reject(nid, reason):
    """Keep feedback for ws-handoff --resume's occupancy-aware dispatch."""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or not hit.get("returned_at"):
            return False
        hit.pop("returned_at", None)
        hit.pop("reviewer", None)
        hit["paused"] = hit["at"] = _now()
        hit["review_rejected"] = reason
        hit["pause_why"] = "验收退回：" + reason
        hit["status"] = hit["pause_why"]
        _write(cur)
    return True


def rebind(nid, ws):
    """reoccupy 收回后，条目重新绑上工作区（之后 pause / 改走会再放回）。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is not None:
            hit["ws"] = hit["sk"] = ws
            hit.pop("returned_at", None)
            hit.pop("reviewer", None)
            hit.pop("review_rejected", None)
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


# 收尾词：update 写成这些开头的状态就直接 done（用户 2026-10-28「任务榜完成的为什么不下掉」：
# 工作区交回时只改状态为「已交回」「done」，没人再跑 board done，条目一直挂着）。和桥 watchBoardClosed 同一组词。
CLOSED_RE = re.compile(r"\s*(?:已验收|验收通过|已收口|已完成|已结束|done\b)", re.I)


def done(nid, rework=None, why=None):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        _write([i for i in cur if i["id"] != nid])
        tid = hit.pop("guard", None)  # 交回了：撤兜底
        with open(_path("board-done.jsonl"), "a") as f:
            rec = {**hit, "status": "已完成", "done_at": _now()}  # #597 N3：结束记录不带着原来的「进行中」
            if rework is not None:  # 不填就不写这两项，汇总时算「未填」
                rec["rework"] = rework
                if why:
                    rec["rework_why"] = why
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    _del_timer(tid)
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
    recs = [r for r in _read("board-done.jsonl")
            if (_done_time(r.get("done_at")) or 0) >= since and not r.get("auto_pruned")]  # 自动收起不是做完，不算返工
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


# ---- 暂停条目自动收起（规则见文件头「暂停条目自动收起」）----
# 照本机任务板已验收的实现。10-26 手动清的 8 条回放：24 小时档选中 4 条，8 小时档选中 6 条（#583 #584 当时才暂停 22 分钟，
# 闲置从暂停时刻算后不收）；6 条保护项不误收。产品侧改动：闲置门槛默认 24 小时可调、
# 等用户只认「等用户/等待用户」、PR 仓库来自 BOARD_PR_REPO、去掉本机的「用户点名只提醒」子规则。
PRUNE_PR_AFTER = 2 * 3600  # 秒：规则「PR 已合或已关，且超过 2 小时」；按 PR 的 mergedAt/closedAt 算（方案二审第 3 条）
# 小时：闲置门槛默认 24 小时，board prune --idle 改
PRUNE_IDLE_DEFAULT_H = 24
PR_FINAL_RECHECK = 30 * 60  # 秒：沿用本机 board.py PR_FINAL_RECHECK；开着/查不到的 PR 半小时内不再问 gh，终态缓存后不再问
ASK_WHY = "等待用户答复"  # ws-up --ask 暂停时写的原因（contrib/lead/ws-up）
# 等用户：和 core/team_task_board.go teamTaskBoardWaitUser 是同一条，两边改要一起改（方案二审第 D 条）
WAIT_USER_RE = re.compile(r"等待?用户")
_MERGED_INTO = re.compile(r"并入(?:主线)?\s*#(\d+)")


# 开关和门槛是板子级设定（PR #457 二审）：多个角色共用一块板，按角色环境变量设会互相冲掉；桥跑定时用桥自己的环境，
# 也读不到角色环境。所以只存在 <BOARD_DIR>/board-prune.json，只有 board prune --off/--on/--idle 写；谁跑都只读它。
PRUNE_CONF = "board-prune.json"
_conf_warned = set()


def prune_conf():
    """{"on": 开关, "idle_hours": ③ 的门槛小时}。文件没有 = 默认（开、24 小时）；文件坏了 = 关并在 stderr 警告一次（宁可少收）。"""
    try:
        raw = _path(PRUNE_CONF).read_text()
    except FileNotFoundError:
        return {"on": True, "idle_hours": PRUNE_IDLE_DEFAULT_H}
    except OSError as e:
        raw, err = None, str(e)
    conf = None
    if raw is not None:
        try:
            got = json.loads(raw)
            on, h = got.get("on", True), got.get("idle_hours", PRUNE_IDLE_DEFAULT_H)
            if isinstance(on, bool) and isinstance(h, (int, float)) and not isinstance(h, bool) and h > 0:
                conf = {"on": on, "idle_hours": float(h)}
            err = "内容不对"
        except (ValueError, AttributeError):
            err = "不是 JSON 对象"
    if conf is None:
        if str(DIR) not in _conf_warned:
            _conf_warned.add(str(DIR))
            print(f"board: {_path(PRUNE_CONF)} 读不了（{err}），这次不自动收起；用 board prune --on / --idle 重写", file=sys.stderr)
        conf = {"on": False, "idle_hours": PRUNE_IDLE_DEFAULT_H, "broken": True}
    return conf


def set_prune_conf(on=None, idle_hours=None):
    """board prune --off/--on/--idle：改板子级设定（文件坏了从默认起），返回新设定。"""
    with _locked():
        conf = prune_conf()
        conf = {"on": True, "idle_hours": PRUNE_IDLE_DEFAULT_H} if conf.get("broken") else conf
        if on is not None:
            conf["on"] = on
        if idle_hours is not None:
            conf["idle_hours"] = float(idle_hours)
        tmp = _path(f"{PRUNE_CONF}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(conf))
        os.replace(tmp, _path(PRUNE_CONF))
    return conf


def prune_on():
    return prune_conf()["on"]


def prune_idle_after():
    """③ 的闲置门槛（秒），见 prune_conf。"""
    return prune_conf()["idle_hours"] * 3600


def _ts(s, now):
    """「MM-DD HH:MM」（没写年）→ epoch：按 now 那年算，比 now 晚一天以上就是去年的（同 _done_time 的跨年处理）。"""
    lt = time.localtime(now)
    try:
        ts = time.mktime(time.strptime(f"{lt.tm_year}-{s}", "%Y-%m-%d %H:%M"))
        if ts > now + 86400:  # 同 _done_time
            ts = time.mktime(time.strptime(f"{lt.tm_year - 1}-{s}", "%Y-%m-%d %H:%M"))
    except (TypeError, ValueError):
        return None
    return ts


def _asking(i):
    return (i.get("pause_why") or "").startswith(ASK_WHY)


def _waiting_user(i):
    return bool(WAIT_USER_RE.search(i.get("pause_why") or ""))


def _pr_ref_re(repo):
    """BOARD_PR_REPO 仓库的 PR 写法（同本机 board.py _PR_REF）：PR297 / PR#297、<name>#297 / <owner>/<name>#297、
    github.com/<owner>/<name>/pull/297。不认裸 #N（和任务板编号混）。边界用 ASCII：Python 的 \\w 含汉字，「已合PR297」也要认。"""
    owner, name = (re.escape(x) for x in repo.split("/", 1))
    return re.compile(r"(?<![A-Za-z0-9_])PR#?([1-9]\d*)(?!\d)"
                      rf"|(?<![A-Za-z0-9_/.-])(?:{owner}/)?{name}#([1-9]\d*)(?!\d)"
                      rf"|github\.com/{owner}/{name}/pull/([1-9]\d*)(?!\d)", re.IGNORECASE)


def _repo():
    r = (os.environ.get("BOARD_PR_REPO") or "").strip()
    return r if re.fullmatch(r"[\w.-]+/[\w.-]+", r) else None


def _where_prs(i, repo=None):
    """只认「分支/PR/路径」（where）里的 PR：状态里提到的 PR 常是中间一步（本机样本「PR341已合」后面还有活）。"""
    repo = repo or _repo()
    if not repo:
        return set()
    return {int(next(g for g in m if g)) for m in _pr_ref_re(repo).findall(i.get("where") or "")}


def _idle_since(i, now):
    """暂停条目闲置的起点：暂停时刻、ws-up 上报（progress_at）、暂停之后的手改（at）取最晚的。
    不早于暂停时刻（PR #457 审查第 1 条）：progress_at 只在没暂停时写，总在暂停之前；只看它，刚暂停的会因为暂停前
    久没汇报被当场收走。"""
    ts = [t for t in (_ts(i.get("paused"), now), i.get("progress_at"), _ts(i.get("at"), now))
          if isinstance(t, (int, float))]
    return max(ts) if ts else None


def pr_final(numbers, now=None, repo=None):
    """{编号: {"state": MERGED/CLOSED/OPEN/None, "closed_at": epoch}}；缓存 board-prs-final.state，终态不再查，
    查不到（没 gh、失败、超时）的 state=None。"""
    now = time.time() if now is None else now
    repo = repo or _repo()
    if not repo or not numbers:
        return {}
    try:
        cache = json.loads(_path("board-prs-final.state").read_text())
        cache = cache if isinstance(cache, dict) and cache.get("repo") == repo else {"repo": repo}
    except (OSError, ValueError):
        cache = {"repo": repo}
    prs = cache.setdefault("prs", {})
    need = sorted(n for n in set(numbers) if not (str(n) in prs and (
        prs[str(n)].get("state") in ("MERGED", "CLOSED") or now - prs[str(n)].get("checked_at", 0) < PR_FINAL_RECHECK)))
    if need:
        owner, name = repo.split("/", 1)
        fields = " ".join(f"pr{n}:pullRequest(number:{n}){{number state mergedAt closedAt}}" for n in need)
        got = None
        try:
            p = subprocess.run(["gh", "api", "graphql", "-f", f'query=query{{repository(owner:"{owner}",name:"{name}"){{{fields}}}}}'],
                               capture_output=True, text=True, timeout=GH_TIMEOUT)
            got = json.loads(p.stdout)["data"]["repository"]
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
            pass
        for n in need:
            pr = got.get(f"pr{n}") if isinstance(got, dict) else None
            rec = {"state": None, "checked_at": now}
            if isinstance(pr, dict) and pr.get("state") in ("MERGED", "CLOSED", "OPEN"):
                rec["state"] = pr["state"]
                raw = pr.get("mergedAt") if pr["state"] == "MERGED" else pr.get("closedAt")
                if raw:
                    rec["closed_at"] = datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
            prs[str(n)] = rec
        try:
            DIR.mkdir(parents=True, exist_ok=True)
            tmp = _path(f"board-prs-final.state.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(cache))
            os.replace(tmp, _path("board-prs-final.state"))
        except OSError:
            pass
    return {n: prs.get(str(n), {}) for n in numbers}


def prune_why(i, its, now, prs, idle_after=None):
    """暂停条目该自动收起返回原因；不收返回 None。prs = pr_final 的结果（{} = 不按 PR 判）。"""
    if i.get("returned_at") or i.get("review_rejected") or not i.get("paused") or _asking(i):
        return None  # 提问等答复的一律不收
    if i.get("unpruned"):
        prs, its = {}, []  # 手动找回过（resume 被拒仍暂停）：①② 的事实不会变，不再按它们收；③从找回时刻重新计，再暂停时清掉
    nums = _where_prs(i)
    if nums and prs:
        st = [prs.get(n) or {} for n in nums]
        if all(s.get("state") in ("MERGED", "CLOSED") and s.get("closed_at") and now - s["closed_at"] >= PRUNE_PR_AFTER for s in st):
            return "PR " + "、".join(f"#{n}{'已合' if prs[n]['state'] == 'MERGED' else '已关'}" for n in sorted(nums)) + "超过 2 小时"
    live = {x.get("id") for x in its}
    for field in ("pause_why", "status"):
        m = _MERGED_INTO.search(i.get(field) or "")
        if m and int(m.group(1)) in live and int(m.group(1)) != i.get("id"):
            return f"已并入 #{m.group(1)}"
    if _waiting_user(i) or "主线" in (i.get("what") or ""):
        return None  # 等用户：只免③（PR 已合/已并入时等的事已过，照①②收）；主线条目闲着也不收
    idle_after = prune_idle_after() if idle_after is None else idle_after
    idle = _idle_since(i, now)
    if idle is not None and now - idle >= idle_after:
        return f"暂停后 {int((now - idle) // 3600)} 小时没汇报没更新"
    return None


def prune_candidates(its=None, now=None, prs=None, check_pr=True):
    """[(条目, 原因)]。prs 不给时 check_pr=True 就问 gh（pr_final），False 不按 PR 判。"""
    now = time.time() if now is None else now
    its = _read() if its is None else its
    paused = [i for i in its if i.get("paused")]
    if prs is None:
        prs = pr_final({n for i in paused for n in _where_prs(i)}, now) if check_pr else {}
    return [(i, w) for i in paused for w in [prune_why(i, its, now, prs)] if w]


def auto_prune(dry=False, now=None, check_pr=True, skip=()):
    """把该收的暂停条目移进 board-done.jsonl（带 auto_pruned=原因），返回 [(条目, 原因)]。dry=True 只列不动。
    skip：这次命令正要操作的编号，先不收。板子设定关掉时什么都不做。"""
    if not prune_on():
        return []
    now = time.time() if now is None else now
    its = _read()
    paused = [i for i in its if i.get("paused")]
    prs = pr_final({n for i in paused for n in _where_prs(i)}, now) if check_pr else {}  # gh 在锁外查
    picks = [(i, w) for i, w in prune_candidates(its, now, prs) if i["id"] not in skip]
    if dry or not picks:
        return picks
    out = []
    with _locked():
        cur = _read()  # 锁外查 gh 时可能有人改过（update、改暂停原因）：重读，用同一份 PR 结果重判，只收仍该收的
        ids = {i["id"] for i, _ in picks}
        why = {i["id"]: w for i in cur if i["id"] in ids for w in [prune_why(i, cur, now, prs)] if w}
        hits = [i for i in cur if i["id"] in why]
        if not hits:
            return []
        with open(_path("board-done.jsonl"), "a") as f:
            for i in hits:
                f.write(json.dumps({**i, "done_at": _now(), "auto_pruned": why[i["id"]]}, ensure_ascii=False) + "\n")
                out.append((i, why[i["id"]]))
        _write([i for i in cur if i not in hits])
    return out


def unprune(nid):
    """resume 找回自动收起的条目：board-done.jsonl 里这个编号最后一条是 auto_pruned 的，拿回板上（照旧暂停着）。
    手动 done 的不找回。返回放回的条目，没有返回 None。"""
    with _locked():
        if any(i.get("id") == nid for i in _read()):
            return None
        recs = _read("board-done.jsonl")
        k = next((k for k in range(len(recs) - 1, -1, -1) if recs[k].get("id") == nid), None)
        if k is None or not recs[k].get("auto_pruned"):
            return None
        rec = {x: v for x, v in recs.pop(k).items() if x not in ("done_at", "auto_pruned")}
        # 找回算一次更新（PR #457 审查第 4 条）：resume 接着被 reoccupy 拒绝时条目留在板上暂停着，不能下一条命令又按③收走
        rec["at"] = _now()
        rec["unpruned"] = True
        tmp = _path("board-done.jsonl.tmp")
        tmp.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in recs))
        os.replace(tmp, _path("board-done.jsonl"))
        _write(_read() + [rec])
    return rec


def schedule_prune_check(it):
    """暂停时挂两个定时跑 board refresh：PR 合/关满 PRUNE_PR_AFTER、闲置满门槛（③）各一个，没人动板也会收（方案二审第 C 条）。
    不要求条目绑工作区（schedule_stale_check 要 ws，暂停时 ws 已解绑）；只要有桥和条目所在频道的会话 key（sk），
    没有就跳过，靠每次 board 命令顺带清理兜底。挂失败只写 stderr，不拦 pause。到点晚一分钟跑，免得正好卡在门槛前。"""
    cc, sk = _cc_bin(), it.get("sk")
    if not prune_on() or not cc or not sk or _asking(it):
        return
    command = _timer_command()
    for minutes in sorted({PRUNE_PR_AFTER // 60 + 1, int(prune_idle_after() // 60) + 1}):  # +1：见上「晚一分钟」
        try:
            r = subprocess.run([cc, "timer", "add", "--session-key", sk, "--delay", f"{minutes}m",
                                "--exec", command, "--mute", "--desc", f"检查暂停的任务 #{it['id']} 要不要自动收起"],
                               capture_output=True, text=True, timeout=WS_TIMEOUT)
        except (OSError, subprocess.SubprocessError) as e:
            print(f"board: #{it['id']} 自动收起检查未安排：{e}", file=sys.stderr)
            return
        if r.returncode:
            print(f"board: #{it['id']} 自动收起检查未安排：{r.stderr.strip()[:200]}", file=sys.stderr)


def _say_pruned(out):
    for i, w in out:
        print(f"board: 自动收起 #{i['id']} {i.get('what', '')[:40]}（{w}），board resume {i['id']} 能找回", file=sys.stderr)


def _cc_bin():  # 同 ../lead/later：CC_BIN，否则 PATH 里的 bothouse / cc-connect
    return os.environ.get("CC_BIN") or shutil.which("bothouse") or shutil.which("cc-connect")


WS_TIMEOUT = 5  # 秒：问桥工作区注册表的上限（本机 socket 调用，正常 1 秒内；桥卡住时不拖住 board 命令）


def _split_short(argv):
    if "--short" in argv:
        k = argv.index("--short")
        if k + 1 >= len(argv):
            sys.exit("--short 后面要写短名（≤10 字），比如 --short 任务板整理")
        return argv[:k] + argv[k + 2:], argv[k + 1]
    return argv, None


def _split_next(argv):
    if "--next" in argv:
        k = argv.index("--next")
        if k + 1 >= len(argv):
            sys.exit("--next 后面要写几点，比如 --next 14:30")
        if os.environ.get("BOARD_LATER") != "1":
            sys.exit("--next 只能由 later 写（它会同时挂定时）：later <编号> 10m \"<到点要做什么>\"")
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
    argv, short_name = _split_short(argv)
    cmd = argv[0] if argv else "list"
    if cmd not in ("refresh", "prune"):  # 每个命令顺带收一次（不查 gh，不拖慢命令）；这次要操作的编号先不收
        nid = argv[1].lstrip("#") if len(argv) > 1 else ""
        _say_pruned(auto_prune(check_pr=False, skip={int(nid)} if nid.isdigit() else set()))
    try:
        if cmd in ("list", "ls"):
            print("\n".join(lines()) or "（任务板是空的）")
        elif cmd == "add" and len(argv) == 5:
            if not (short_name or "").strip() or len(short_name.strip()) > SHORT_RUNES:
                sys.exit(f"不加：要写 --short 短名（≤{SHORT_RUNES} 字，置顶任务表上显示的名字），不再从任务句截前十字")
            why = _lookback_reason(*argv[1:4])
            if why:
                sys.exit(f"不加：{why}。用完成通知，或在原条目上 board update / later <编号>")
            nid = add(*argv[1:5], nxt=nxt, short_name=short_name)
            print(f"#{nid}")
        elif cmd == "next" and len(argv) in (3, 4):
            if os.environ.get("BOARD_LATER") != "1":
                sys.exit("「下次看」只能由 later 写（它会同时挂定时）：later <编号> 10m \"<到点要做什么>\"")
            nid = int(argv[1].lstrip("#"))
            if len(argv) == 4 and argv[2] == "--restore":
                r = set_next(nid, restore=json.loads(argv[3]))
            elif len(argv) == 3 and re.fullmatch(r"\d\d:\d\d", argv[2]):
                r = set_next(nid, argv[2])
            else:
                sys.exit("用法：board next <编号> <几点如 14:30> | board next <编号> --restore '<JSON>'")
            if r is None:
                sys.exit(f"没有 #{nid}：later 只能挂在任务板已有的条目上，先 board add 正经条目（事情、分支/PR/路径、状态、谁）")
            print(json.dumps(r[0], ensure_ascii=False))
            print(str(r[1]).replace("\n", " "))
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
            if CLOSED_RE.match(argv[2]) and done(nid):
                print(f"已结束：状态「{argv[2]}」是收尾词，#{nid} 移出任务板（返工次数记「未填」）")
                return
            print("已更新")
            if before.get("ws") and not any(i["id"] == nid and i.get("ws") == before["ws"] for i in items()):
                freed = park_workspace(before)  # 「谁」改走了：它在工作区的那件交接放回桥
                if freed:
                    print("工作区已放回池子，会话已清")
        elif cmd == "returned" and len(argv) in (3, 4):
            if not returned(int(argv[1].lstrip("#")), *argv[2:]):
                sys.exit("条目不存在，未登记交回")
            print("已交回待验收")
        elif cmd == "reject" and len(argv) == 3 and argv[2].strip():
            if not reject(int(argv[1].lstrip("#")), argv[2].strip()):
                sys.exit("条目不在待验收状态，未退回")
            print("已记录退回问题；用 ws-handoff --resume <编号> <问题> 续办")
        elif cmd == "done" and 2 <= len(argv) <= 4:
            # 返工次数必填、>0 时原因必填：不填就没法统计哪条规矩起了作用（board rework 汇总里的「未填」）
            nid = int(argv[1].lstrip("#"))
            if len(argv) < 3:
                sys.exit("要写返工次数：board done <编号> <返工次数> [原因]，没返工写 0，比如 board done 3 0")
            rework = int(argv[2])
            if rework < 0:
                sys.exit("返工次数要是 0 或正整数，比如 board done 3 1 \"没先读现有实现\"")
            why = argv[3].strip() if len(argv) > 3 else ""
            if rework > 0 and not why:
                sys.exit(f"返工 {rework} 次要写原因，比如 board done {nid} {rework} \"没先读现有实现\"")
            if not done(nid, rework, why or None):
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已结束")
            hint = open_pr_hint()
            if hint:
                print(hint)
        elif cmd == "pause" and 2 <= len(argv) <= 3:
            nid = int(argv[1].lstrip("#"))
            hit = pause(nid, argv[2] if len(argv) > 2 else None)
            if not hit:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已暂停")
            if os.path.isfile(hit.get("where") or ""):  # ws-handoff 建的条目：停手话写进交接的转交结果节，工作区读得到
                append_forward(hit["where"], f"{_now()} 已暂停（#{nid}）{'：' + hit['pause_why'] if hit.get('pause_why') else ''}。"
                                             "停手，不要再起后台命令，正在跑的停掉；上面更早的「接着做」作废，等主频道恢复再做。")
            schedule_prune_check(hit)
            # 在那个工作区里自己 pause 的不打断（会把正在跑 board 的这一轮掐掉）
            here = os.environ.get("CC_SESSION_KEY", "").split(":")[1:2]
            freed = park_workspace(hit, stop=(here != (hit.get("ws") or "").split(":")[1:2]))
            if freed is not None:
                print("工作区已放回池子，会话已清" if freed else "工作区里还有别的活，先不放回")
        elif cmd == "ask" and len(argv) == 2:
            # 工作区发了 [ask]（桥调，core/team_workspace_one.go endWorkspaceTask）：条目记「等你」，工作区放回池子、清会话，
            # 不打断这一轮；用户答复后 ws-handoff --resume 找空工作区接着做（用户 2026-10-28 批第 3 条）
            nid = int(argv[1].lstrip("#"))
            hit = pause(nid, ASK_WHY)
            if not hit:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已记等你")
            if os.path.isfile(hit.get("where") or ""):
                append_forward(hit["where"], f"{_now()} 已提问、等用户答复（#{nid}）：工作区已放回，答复到了会另交一个空工作区接着做。")
            freed = park_workspace(hit)
            if freed is not None:
                print("工作区已放回池子，会话已清" if freed else "工作区里还有别的活，先不放回")
        elif cmd == "resume" and len(argv) == 2:
            nid = int(argv[1].lstrip("#"))
            if unprune(nid):  # 自动收起的：先从完成记录拿回板上（还暂停着），再照常恢复
                print(f"#{nid} 已从自动收起里找回")
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
            print("已恢复" if r else f"#{nid} 没在暂停")
        elif cmd == "link" and len(argv) == 3:
            nid = int(argv[1].lstrip("#"))
            try:
                ok = link(nid, argv[2].strip())
            except ValueError:
                sys.exit("卡片链接要是 https://discord.com/channels/<服务器>/<频道>/<消息>")
            if not ok:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已挂卡")
        elif cmd == "refresh" and len(argv) == 1:
            pause_stale()
            _say_pruned(auto_prune())
        elif cmd == "prune" and argv[1:2] in (["--off"], ["--on"], ["--idle"]):
            on, h = {"--off": False, "--on": True}.get(argv[1]), None
            if argv[1] == "--idle":
                try:
                    h = float(argv[2].lower().rstrip("h")) if len(argv) == 3 else 0
                except ValueError:
                    h = 0
                if not h > 0:
                    sys.exit("--idle 后面写小时数，比如 board prune --idle 24")
            elif len(argv) != 2:
                sys.exit("用法：board prune --off | --on | --idle <小时>")
            c = set_prune_conf(on, h)
            print(f"自动收起：{'开' if c['on'] else '关'}，闲置门槛 {c['idle_hours']:g} 小时（整块板子生效）")
        elif cmd == "prune" and argv[1:] in ([], ["--dry-run"]):
            dry = argv[1:] == ["--dry-run"]
            out = auto_prune(dry=dry)
            for i, w in out:
                print(f"{'会收' if dry else '已收起'} #{i['id']} {i.get('what', '')}（{w}）")
            if not out:
                print("没有要收起的暂停条目" if prune_on() else "自动收起已关（board prune --on 打开）")
        elif cmd == "rework" and len(argv) <= 2:
            print(rework_report(int(argv[1]) if len(argv) > 1 else REWORK_DAYS))
        else:
            sys.exit(__doc__.split("用法：", 1)[1].rstrip())
    except ValueError:
        sys.exit("编号、返工次数、天数要是数字，比如 board done 3 1 \"原因\"")


if __name__ == "__main__":
    main(sys.argv[1:])
