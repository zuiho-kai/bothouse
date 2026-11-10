#!/usr/bin/env python3
"""任务板：谁手上有哪件事、做在哪（分支/PR/路径）、做到哪一步。

用户原话（2026-10-22）：「核心是为什么他不能共享进度……他应该能看到为什么从开始找」；
提议任务板后：「可以的，核心要区分一下，让jev判断，是给谁回的」。

- 每条一行：事情、分支/PR/路径、状态、谁在做、更新时间。存 <BOARD_DIR>/board.jsonl（不叫 .json：
  cc-connect 把 team 目录下的 *.json 当队友状态文件读，core/team.go teamSummary）。
- 读：ctxsvc.context 把整张板附进每个 bot 每轮的上下文（板子变了才重推）；gate 判收件人时也读（gate.addressee）。
- 写：../lead/board（本文件的命令行）。
- 事件：add/update/pause/交回/退回/done 往同目录 board-events.jsonl 追一行，供团队工作台地图飞光（Issue #876）。
- BOARD_DIR：环境变量，默认 <GATE_SETUP_DIR>/team（GATE_SETUP_DIR 不设 = 产品数据目录，见 datadir.py，同 gate 和 lead.py）；
  建议设成 cc-connect 的 team_status_dir，和队友状态放一起。

用法：
  board                                  # 列出进行中的事
  board add <事情> <分支/PR/路径> <状态> <谁> --short 短名 [--next 几点看]   # 新加一条，打印编号
                                         #   短名（≤10 字）上团队板；不写就从事情去掉「用户点名：」「#N 续：」这类前缀再截
  board update <编号> <状态> [分支/PR/路径] [谁] [--next 几点看]
                                         #   状态以收尾词开头（已完成/已验收/已收口/已结束/done）就直接结束，同 done
  board next <编号> <几点> | --restore <JSON>  # 只改「下次看」（later 专用，要 BOARD_LATER=1）；打印改前记录和事情
  board done <编号> <返工次数> [原因]      # 结束：移出任务板，记进 board-done.jsonl；返工次数必填，大于 0 时原因必填
  board rework [天数]                    # 最近 14 天的返工次数和原因
  board backlog                          # 列出待办：排在 bug 后面的小问题、非阻塞的验收发现。默认列表和置顶团队板都不显示它们
  board backlog <编号...> [--why 原因]     # 把条目挪进待办：留在板上（不删、不进 board-done.jsonl），默认列表和置顶团队板
                                         #   只留一行「待办 N 件」；条目在工作区里时同 pause 放回工作区。恢复用 board resume <编号>
  board pause <编号> [原因]               # 暂停：留在板上、团队板单列「暂停」块，不算做完、不进 board-done.jsonl；
                                         #   条目在工作区里时同时 <桥> workspace park：那里没别的活就放回池子、清会话
                                         #   （恢复后重新 ws-handoff，先复用空着的工作区，不保证回原号）
  board resume <编号>                     # 恢复：回到「在做」
  board hold [编号...] [--why 原因]        # 为集中发布暂停：标「为发布暂停」，不放回工作区、不清会话；不给编号 = 板上所有
                                         #   在工作区里、没交回、没暂停的条目。看门不把这期间的报错算失败；桥重启（发布切换）
                                         #   后自动去掉标记、叫原工作区从停点续（core/team_release_hold.go）
  board unhold [编号...]                  # 发布没切（取消/改期）时手动去掉「为发布暂停」；不给编号 = 全部
  board pr <编号> <GitHub PR URL> no-deploy|deploy  # 派活人绑定本代次 PR 和交接部署范围
  board tier <编号> simple|complex         # 验收档位：不标=简单档（设置里选的便宜模型先审）；审的人拿不准标 complex，
                                         #   桥换复杂档的审核人再审一遍（用户 2026-11-04「简单的交给便宜模型」）
  board merged                          # 核对绑定 PR：已合并且不部署转待收口（不代替验收）；要部署的转「等发布」（不算卡住）
  board deployed <提交> [编号...]         # 桥以 <提交> 版本起来后（桥自己会跑）：等发布的条目已含在这次部署里的转「待上线验收」，
                                         #   桥自动派非作者去做上线验收；查不到（gh 失败）的先不动，下次再核
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
import json, os, re, shlex, shutil, subprocess, sys, tempfile, time
from contextlib import contextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # ../lead/board 从别处跑时也找得到同目录的 datadir.py
import datadir  # noqa: E402
import filelock  # noqa: E402  跨进程锁：Mac/Linux 用 fcntl.flock，Windows 用 msvcrt.locking

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
        filelock.lock(lk)
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


# Windows 上 os.replace 不是总能立刻拿到目标文件的 DELETE 权限：它正被杀毒软件、索引服务或另一个
# 进程短暂打开时会直接抛 PermissionError（WinError 5 / 32），等几十毫秒再试就能过去（#257：CI 的
# bridge-windows 里 test_board_concurrent_add 偶发红，失败栈就是这里的 os.replace，不是数据写坏）。
_REPLACE_RETRY_BUDGET_S = 2.0   # 来源：#257 交接给的总预算「总预算 2 秒」
_REPLACE_RETRY_FIRST_S = 0.02   # 来源：同上「每次 20–50 ms」，从下限起、逐次翻倍封顶
_REPLACE_RETRY_MAX_S = 0.05     # 来源：同上「每次 20–50 ms」的上限
_DEFAULT_FILE_MODE = None       # 建新板子文件时的权限，按 umask 算，见 _default_file_mode


def _retryable_replace_error(e):
    """只有瞬时占用类错误才重试：PermissionError（Windows 的 WinError 5/32 都以它的形式抛），
    以及带 winerror 5/32 的 OSError；其它异常（磁盘满、路径错等）立刻抛。"""
    return isinstance(e, PermissionError) or getattr(e, "winerror", None) in (5, 32)


def _replace_with_retry(src, dst):
    deadline = time.monotonic() + _REPLACE_RETRY_BUDGET_S
    delay = _REPLACE_RETRY_FIRST_S
    while True:
        try:
            os.replace(src, dst)
            return
        except OSError as e:
            if not _retryable_replace_error(e) or time.monotonic() + delay > deadline:
                raise
            time.sleep(delay)
            delay = min(delay * 2, _REPLACE_RETRY_MAX_S)


def _default_file_mode():
    """新文件该有的权限：和原来 Path.write_text 一样按 umask 走（mkstemp 建的是 0600，
    板子第一次落盘就悄悄变成只有自己能读，别的角色/用户读不到）。算一次就记下来：
    os.umask 是进程级状态，每写一次就临时改成 0 会波及同进程里别人建的文件。"""
    global _DEFAULT_FILE_MODE
    if _DEFAULT_FILE_MODE is None:
        umask = os.umask(0)
        os.umask(umask)
        _DEFAULT_FILE_MODE = 0o666 & ~umask
    return _DEFAULT_FILE_MODE


def _write(items, name="board.jsonl"):
    """整份原子替换：临时文件每条用一个唯一名（原来所有进程共抢 board.jsonl.tmp，会互相覆盖/删掉对方
    正在 rename 的文件），os.replace 对 Windows 的瞬时占用错误有界重试；失败时删掉临时文件再抛，原文件不变。"""
    target = _path(name)
    text = "".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items)
    try:
        mode = target.stat().st_mode & 0o777
    except OSError:  # 不存在，或 Windows 上正好被占用查不到：按默认权限建，别在这里失败
        mode = _default_file_mode()
    fd, tmp = tempfile.mkstemp(prefix=name + ".", suffix=".tmp", dir=str(DIR))
    try:
        # 不写死 encoding：和原来 Path.write_text 一样按解释器默认编码（board.cmd 带 -X utf8），
        # 别让「写 utf-8、读默认编码」在非 UTF-8 模式的 Windows 上变成乱码
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        if os.name == "posix" and mode is not None:
            with suppress(OSError):
                os.chmod(tmp, mode)  # mkstemp 建的是 0600，别悄悄改掉原文件的权限（Windows 上 chmod 只改只读位，跳过）
        _replace_with_retry(tmp, target)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp)
        raise


def items():
    return _read()


def fmt(i):
    nxt = f"｜下次看 {i['next']}" if i.get("next") else ""
    pz = f"｜暂停（{i['paused']}{'：' + i['pause_why'] if i.get('pause_why') else ''}）" if i.get("paused") else ""
    bl = f"｜待办（{i['backlog']}{'：' + i['backlog_why'] if i.get('backlog_why') else ''}）" if i.get("backlog") else ""
    card = f"｜卡 {i['card']}" if i.get("card") else ""
    hd = "｜为发布暂停" if i.get("release_hold") else ""
    return f"#{i['id']} {i['what']}｜{i.get('where') or '-'}{' ' + i['where_link'] if i.get('where_link') else ''}｜{i.get('status') or '-'}｜{i.get('who') or '-'}｜{i.get('at', '')}{nxt}{pz}{bl}{hd}{card}"


def lines():
    """进行中的事。待办（backlog）不在这里列，见 backlog_lines（用户 2026-11-05「任务板怎么还有一堆任务」）。"""
    return [fmt(i) for i in items() if not i.get("backlog")]


def backlog_lines():
    return [fmt(i) for i in items() if i.get("backlog")]


def backlog_count():
    """待办各有几条（置顶团队板末尾只写一行「待办 N 件」，core/team_task_board.go teamTaskBoardBacklogCount，改要一起改）。"""
    return sum(1 for i in _read() if i.get("backlog"))


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


# 团队工作台（Issue #876）：任务板每变一次，往 board-events.jsonl 追一行，供协作插件读来点亮地图上的派活光。
# 格式固定（ts/id/kind/from/to/title，note 可选），改之前先和读的一方对齐；写事件失败不能影响任务板本身。
EVENTS = "board-events.jsonl"
_EVENT_SPLIT = re.compile(r"[、,，/]")
_EVENT_TAG = re.compile(r"[（(].*$")
_EVENT_WS = re.compile(r"^工作区\d*\s*")
_RETURNED_RE = re.compile(r"已交回|交回|result_ready", re.I)
_REJECTED_RE = re.compile(r"退回|打回|返工")


def _member(who):
    """who 里第一个成员名：「肥鱼（复审）」「肥鱼、C酱」「工作区1肥鱼」「工作区gge」都取后面的成员名。"""
    s = _EVENT_TAG.sub("", _EVENT_SPLIT.split(str(who or ""), 1)[0]).strip()
    return _EVENT_WS.sub("", s).strip()


def event(nid, kind, it, note=None):
    rec = {"ts": datetime.now().astimezone().isoformat(timespec="seconds"),
           "id": str(nid), "kind": kind,
           "from": str(it.get("dispatcher") or ""), "to": _member(it.get("who")),
           "title": short(it)}
    if note:
        rec["note"] = str(note)
    try:
        with open(_path(EVENTS), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError) as e:
        print(f"board: 事件没写进 {EVENTS}（{e}），任务板已照常更新", file=sys.stderr)


def _update_event(nid, status, before, hit):
    """update 的这次变化对应哪种事：收尾词交给 done 记，退回归退回，交回归交回，换人归派活。"""
    if CLOSED_RE.match(status):
        return
    if _REJECTED_RE.search(status):
        event(nid, "rejected", hit, status)
    elif _RETURNED_RE.search(status):
        event(nid, "returned", hit, status)
    elif hit.get("who") != before.get("who"):
        event(nid, "assigned", hit)


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
        event(nid, "created", it)
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


def _moves_ws(old_who, new_who):
    """新「谁」是不是让条目离开眼下的工作区：改派到另一个「工作区N…」（N 和原来的不同），或改成「待接手」（没人做、
    排队用的那个词，原来就靠它放回工作区）才算。只改负责人写法（「肥鱼 <频道>」、同一工作区换主角色名）不算，
    条目继续绑着原工作区——否则主桥每小时收口（core reconcileTeamWorkspaces）把正在跑的工作区当成空的收回、
    杀会话（Issue #1111，用户 2026-11-05 选①「改负责人时不再拆绑定」）。"""
    if (new_who or "").strip() == "待接手":
        return True
    new = WS_NAME_RE.match(new_who or "")
    if not new:
        return False
    old = WS_NAME_RE.match(old_who or "")
    return not (old and old.group(1) == new.group(1))


def _keeps_handoff(old, new):
    """「分支/PR/路径」原来是交接文件、新给的不是文件（合并请求链接、分支名）：保留交接路径，新值记进 where_link。
    11-10 #1347：路径栏被改成 PR 链接后，ws-pass 按交接找不到条目，主角色核完放不出去。"""
    old, new = (old or "").strip(), (new or "").strip()
    return bool(old) and new != old and os.path.isfile(old) and not os.path.isfile(os.path.expanduser(new))


def update(nid, status, where=None, who=None, nxt=None, same_ws=False):
    """same_ws：调用方已查明新「谁」指的就是条目眼下绑的工作区（main 里按桥的池子对过 id），不解绑。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        before = dict(hit)
        hit["status"], hit["at"] = status, _now()
        for k in ("backlog", "backlog_why", "backlog_at", "backlog_by"):
            hit.pop(k, None)  # 改了状态就是又动起来了：待办标记撤掉、回到主板（不然改了也看不见）
        tid = None
        if who and hit.get("ws") and not same_ws and _moves_ws(before.get("who"), who):
            hit["ws_was"] = hit.pop("ws")  # 改派到另一个工作区：这件不再算在原工作区（main 里 park 掉它的交接）
            _back_to_chat(hit)
            tid = hit.pop("guard", None)  # 改派：撤兜底，交给新工作区时 ws-handoff 再挂
        if where:
            if _keeps_handoff(hit.get("where"), where):
                hit["where_link"] = where  # 交接文件留在 where：ws-pass / ws-forward / 桥都按它找这件活（#1350）
            else:
                hit["where"] = where
        if who:
            hit["who"] = who
        if nxt:
            hit["next"], hit["next_ts"] = nxt, _deadline(nxt)
        if not hit.get("ch") and _cur_channel():
            hit["ch"] = _cur_channel()
        _write(cur)
        _update_event(nid, status, before, hit)
    _del_timer(tid)
    return before


def progress(nid):
    """Record an explicit ws-up progress report for this bound workspace task."""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or not hit.get("ws") or hit.get("paused") or hit.get("backlog"):
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


def _forward_bytes(path, line):
    """读原文、插进「## 转交结果」节，返回要写回去的完整字节；这里一个字都不写。

    「先算好再换文件」是这次返工的关键：原来先 open(path, "w") 截断再写，写到一半抛异常
    （比如摘要里带半截代理对，utf-8 编不出来）就把整份交接文件的后半截丢了——工作区接着读
    的时候看到的是残缺的「接着做」。
    """
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
    text = "\n".join(lines) + "\n"
    try:
        return text.encode("utf-8")
    except UnicodeEncodeError as e:
        # 单靠 encode 的默认报错看不出是哪一行，这里说清是哪来的、还能怎么办。
        raise ValueError(
            f"转交结果这一行写不进交接文件：第 {e.start} 个字符不是合法 UTF-8"
            "（多半是上游摘要里的半截代理对）；文件没有改动）"
        ) from None


def append_forward(path, line):
    """把 line 追加进交接文件的「## 转交结果」节，整份内容原子替换。

    先写同目录临时文件 + fsync，再 os.replace：中途失败时原文件一个字节都不变，
    也不会出现「写了一半」的交接文件被工作区读到。
    """
    data = _forward_bytes(path, line)
    target = os.path.abspath(path)
    d = os.path.dirname(target) or "."
    try:
        mode = os.stat(target).st_mode & 0o777
    except FileNotFoundError:
        mode = None
    fd, tmp = tempfile.mkstemp(prefix=".forward-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        if mode is not None:
            os.chmod(tmp, mode)  # mkstemp 建的是 0600，别悄悄改掉原文件的权限
        os.replace(tmp, target)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp)
        raise
    # 目录项也落盘：替换完立刻断电，别人看到的仍是旧文件或新文件，不会是空文件。
    with suppress(OSError):
        dfd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)


def paused_item(path):
    """交接文件 path 对应、正在暂停的条目（ws-handoff 建条目时 where 记的就是交接文件）；没有返回 None。
    待办（backlog）的交接也在停手：ws-forward 转话时同样按「已停下」提醒（见 ws-forward wake_prompt）。"""
    return next((i for i in _read() if (i.get("paused") or i.get("backlog")) and i.get("where") == path), None)


def done_records():
    """board-done.jsonl 里全部做完的记录（旧到新）。ws-forward 按交接记下的编号查这件活交回没有。"""
    return _read("board-done.jsonl")


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
        hit["paused_at"] = _bound_now()
        hit["paused_by"] = os.environ.get("CC_PROJECT", "")
        hit.pop("pause_req", None)
        hit.pop("pause_req_at", None)
        for k in ("backlog", "backlog_why", "backlog_at", "backlog_by"):
            hit.pop(k, None)  # 暂停比待办更急：从待办挪出来，进团队板的「暂停」块
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
        event(nid, "paused", hit, why)
    _del_timer(tid)
    return {**hit, "ws": ws} if ws else hit


WAIT_EXT = "等外部："  # board wait 暂停时写的原因前缀（core/team_wait_external.go waitExternalWhy，两边改要一起改）


def wait_external(nid, why, minutes):
    """外部条件卡住：照 ask 暂停（放回工作区、撤兜底），原因写「等外部：<why>」，wait_until 记到点时刻（epoch）。"""
    hit = pause(nid, WAIT_EXT + (why or "外部条件"))
    if not hit:
        return hit
    until = int(time.time()) + minutes * 60
    with _locked():
        cur = _read()
        it = next((i for i in cur if i["id"] == nid), None)
        if it is not None:
            it["wait_until"] = until
            it["status"] = f"等外部（{time.strftime('%H:%M', time.localtime(until))} 再看）：{why}"[:120]
            _write(cur)
    hit["wait_until"] = until
    if os.path.isfile(hit.get("where") or ""):
        append_forward(hit["where"], f"{_now()} 等外部（#{nid}）：{why}。工作区已放回，"
                                     f"{time.strftime('%m-%d %H:%M', time.localtime(until))} 桥会另交一个空工作区接着做。")
    return hit


def _in_own_workspace(it):
    """这一轮就跑在条目绑定的工作区里（CC_SESSION_KEY 的频道 = it["ws"] 的频道）。"""
    here = os.environ.get("CC_SESSION_KEY", "").split(":")[1:2]
    return bool(here) and bool(it.get("ws")) and here == it["ws"].split(":")[1:2]


def self_pause(nid, why=None):
    """工作区在自己那一轮里 board pause 自己：不暂停、不放回，只记 pause_req（停手原因）和时刻，返回条目；
    不是这种情况返回 None，照常 pause。桥看到 pause_req 就要这一轮交 [report]（core workspace_report.go）。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or hit.get("paused") or not _in_own_workspace(hit):
            return None
        hit["pause_req"] = why or "工作区自己停手"
        hit["pause_req_at"] = _bound_now()
        hit["at"] = _now()
        _write(cur)
        event(nid, "pause_req", hit, why)
    if os.path.isfile(hit.get("where") or ""):
        append_forward(hit["where"], f"{_now()} 工作区自己停手（#{nid}）{'：' + why if why else ''}。这一轮交 [report] 说做到哪。")
    return hit


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


def _park_done(hit):
    """收尾（done / 收尾词）时条目还绑着工作区（没交回就直接结束）：当场放回，不等每小时对账（用户 2026-11-04
    「工作区用完了及时清理」「交回/暂停/验收完当场放回」）。和 pause 一样：不在那个工作区里结束的连同那一轮一起停。"""
    if not isinstance(hit, dict) or not hit.get("ws"):
        return
    here = os.environ.get("CC_SESSION_KEY", "").split(":")[1:2]
    freed = park_workspace(hit, stop=(here != hit["ws"].split(":")[1:2]))
    if freed is not None:
        print("工作区已放回池子，会话已清" if freed else "工作区里还有别的活，先不放回")


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


EVENTS_TAIL = 8 << 20  # 只读 events.jsonl 末尾这么多字节（桥 20 MB 轮转）


def _events_path():
    return Path(os.environ.get("BOARD_EVENTS") or (SETUP / "events.jsonl")).expanduser()


def last_activity(sk):
    """工作区会话 sk 最近一次真在干活（工具调用、回复）的时刻（epoch 秒），读不到返回 None。
    来源是桥的统一事件流 <数据目录>/events.jsonl（core/events.go）。"""
    if not sk:
        return None
    path, best = _events_path(), None
    needle = json.dumps(sk).encode()
    for f in (path, path.with_name(path.name + ".1")):
        try:
            with open(f, "rb") as fh:
                fh.seek(0, 2)
                fh.seek(max(0, fh.tell() - EVENTS_TAIL))
                data = fh.read()
        except OSError:
            continue
        for line in data.splitlines():
            if needle not in line:
                continue
            try:
                ev = json.loads(line)
                if ev.get("session_key") != sk or ev.get("type") not in ("tool", "reply"):
                    continue
                t = datetime.fromisoformat(ev["time"]).timestamp()
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
            best = t if best is None else max(best, t)
        if best is not None:
            break  # 当前文件有就不翻轮转出去的旧文件
    return best


def _touch_progress(nid, stamp):
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or hit.get("paused") or hit.get("backlog"):
            return None
        if stamp > hit.get("progress_at", 0):
            hit["progress_at"] = stamp
            _write(cur)
        return hit


def pause_stale(now=None):
    now = time.time() if now is None else now
    changed = []
    for it in _read():
        if it.get("paused") or it.get("backlog") or it.get("release_hold") or not it.get("ws") or it.get("next_ts", 0) > now:
            continue  # 为发布暂停的条目在等发布切换，不是停滞；待办是主动排下的小事，不算停滞
        stamp = it.get("progress_at")
        if stamp is None:
            continue
        at_ts = _ts(it.get("at"), now)
        if isinstance(at_ts, (int, float)) and at_ts > stamp:
            stamp = at_ts
        if now - stamp < STALE_AFTER:
            continue
        # 只认 ws-up/board 更新会把正在调工具的工作区当停滞放掉（2026-11-02 #922 01:47、#925 02:03，
        # 桥的 10 分钟看门同一时刻还判「有进展」）：先看工作区会话在事件流里的真实动作，一小时内动过就续。
        act = last_activity(it["ws"])
        if act is not None and now - act < STALE_AFTER:
            hit = _touch_progress(it["id"], act)
            if hit:
                schedule_stale_check(hit, delay=f"{max(5, int((STALE_AFTER - (now - act)) // 60) + 1)}m")
            continue
        # 2026-11-05 起「待办」是另一个状态（board backlog）：这里只是暂停，别写成「转待办」误导人
        hit = pause(it["id"], "一小时无进展")
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


def schedule_stale_check(it, delay="60m"):
    if not it.get("ws") or not _cc_bin() or not it.get("sk"):
        return
    command = _timer_command()
    r = subprocess.run([_cc_bin(), "timer", "add", "--session-key", it["sk"], "--delay", delay,
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
            f"还在做就查卡在哪（工作区最后的发言、看门催促、命令是不是挂住），"
            f"要接着等就用 ws-forward --notes {it.get('where', '')} \"<要它做的>\" 催一下（会重挂兜底），不自己 timer add，然后只回 NO_REPLY。"
            # #1188：兜底是系统内部检查，不对用户汇报进度；只有卡住要用户拍板或动手时才说
            f"只有卡住、非用户拍板或动手不可时，才跟用户说一句要用户做什么，并写明这是兜底检查发现的、不是用户要求的。")


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
    """chat 所在分类的共享池里叫 name 的工作区 → <平台>:<id>；查询失败抛错，不能当成改派依据。"""
    try:
        p = subprocess.run([cc, "workspace", "list", "--session-key", chat, "--json"],
                           capture_output=True, text=True, timeout=WS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        raise ValueError(f"查询工作区列表失败（{e}）") from e
    if p.returncode != 0:
        err = (p.stderr.strip() or p.stdout.strip())[:200]
        raise ValueError(f"查询工作区列表失败（{err}）")
    try:
        pool = json.loads(p.stdout)["pool"]
        if not isinstance(pool, list):
            raise ValueError("pool 不是列表")
    except (ValueError, KeyError, TypeError) as e:
        raise ValueError("查询工作区列表失败：桥返回的数据无效") from e
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


def bind_pr(nid, url, no_deploy):
    match = re.fullmatch(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/([1-9]\d*)", url)
    if not match:
        raise ValueError("需要完整 GitHub PR 链接")
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        actor = os.environ.get("CC_PROJECT", "")
        if hit is None or not actor or actor != hit.get("dispatcher"):
            raise ValueError("只有该条目的派活人可以绑定 PR 与部署范围")
        binding = {"url": url, "repo": match[1], "number": int(match[2]),
                   "no_deploy": no_deploy, "bound": hit.get("bound", "")}
        if hit.get("pr_binding") != binding:
            # A different PR is a different generation: the old merge/deploy state is not this one's
            # (#985 review 2.1: rebinding used to keep the old await_deploy and compare the wrong commit).
            hit.pop("pr_merge", None)
            hit.pop("await_deploy", None)
            hit.pop("deployed", None)
        hit["pr_binding"] = binding
        _write(cur)


def reconcile_merged_prs():
    """Query outside the board lock, then compare the binding/generation before recording."""
    for item in _read():
        binding = item.get("pr_binding") or {}
        if not binding or item.get("paused") or item.get("pr_merge") or binding.get("bound") != item.get("bound", ""):
            continue
        try:
            result = subprocess.run(["gh", "pr", "view", str(binding["number"]), "--repo", binding["repo"],
                                     "--json", "state,mergedAt,mergeCommit,statusCheckRollup"], capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                print(f"board: #{item['id']} PR 查询失败，保留原状态", file=sys.stderr)
                continue
            pr = json.loads(result.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError) as err:
            print(f"board: #{item['id']} PR 查询失败：{err}", file=sys.stderr)
            continue
        if pr.get("state") != "MERGED" or not pr.get("mergedAt"):
            continue
        with _locked():
            cur = _read()
            hit = next((i for i in cur if i["id"] == item["id"]), None)
            if hit is None or hit.get("pr_binding") != binding or hit.get("bound", "") != binding["bound"] or hit.get("pr_merge") or hit.get("paused"):
                continue
            hit["pr_merge"] = {"url": binding["url"], "merged_at": pr["mergedAt"], "commit": (pr.get("mergeCommit") or {}).get("oid", "")}
            if binding.get("no_deploy"):
                hit.setdefault("returned_at", _bound_now())
                hit["reviewer"] = hit.get("dispatcher", "")
                hit["status"] = "待收口：PR 已合并（不部署），等待验收"
            else:
                # 要部署的：合并前已审过（审过才合），现在等集中发布，不是卡住也不是待验收（#134 ③）。
                # 部署后 board deployed 转「待上线验收」，桥再自动派非作者去验。
                for key in ("returned_at", "reviewer", "review_rejected"):
                    hit.pop(key, None)
                hit["await_deploy"] = dict(hit["pr_merge"])
                hit["status"] = "等发布：PR 已合并，等集中发布上线"
            hit["at"] = _now()
            _write(cur)
            simple = REVIEW_TIERS.get(hit.get("review_tier") or "simple") != "complex"
        # 小活合并且检查都过就自动收口，大活（board tier complex）仍等人看
        # （用户 2026-11-04 23:2x「小活交回时，只要检查都过了就自动收口，大活才需要人看」）。
        # 只对不部署（no_deploy）的绑定生效：要部署的活合并后还要上线，先等发布、部署后转
        # 「待上线验收」再走这一遍自动收口，合并就关会把它整个跳过、await_deploy 永远挂着
        # （用户 2026-11-04 17:07「已合待部署的活单列等发布，部署后转待上线验收并自动派非作者验」）。
        if binding.get("no_deploy") and simple and checks_green(pr.get("statusCheckRollup")):
            ended = done(item["id"], 0)
            if ended:
                _park_done(ended)
                print(f"board: #{item['id']} PR 已合并、检查全过，小活自动收口")


CHECK_OK = {"SUCCESS", "SKIPPED", "NEUTRAL"}


def checks_green(rollup):
    """GitHub statusCheckRollup 全部成功/跳过才算过；没有检查记录不算过（不能凭空收口）。"""
    if not rollup:
        return False
    for c in rollup:
        state = (c.get("conclusion") or c.get("state") or "").upper()
        if state not in CHECK_OK:
            return False
    return True


def _deploy_contains(repo, merge, deployed):
    """部署的提交是否已含合并提交：GitHub compare base...head，head 领先或相同即含。None = 查不到。"""
    try:
        result = subprocess.run(["gh", "api", f"repos/{repo}/compare/{merge}...{deployed}", "--jq", ".status"],
                                capture_output=True, text=True, timeout=GH_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() in ("ahead", "identical")


def mark_deployed(commit, nids=None):
    """部署成功（桥以 commit 版本起来）后：等发布的条目若已含在 commit 里，转「待上线验收」并记交回时刻，
    桥的验收调度据此自动挑非作者去做上线验收（用户 2026-11-04「可以」：部署成功自动转待上线验收并派肥鱼验）。
    gh 查询在锁外做，写回前再核一遍条目没变。返回转了的编号。"""
    moved = []
    for item in _read():
        wait = item.get("await_deploy") or {}
        binding = item.get("pr_binding") or {}
        if nids and item["id"] not in nids:
            continue
        if not wait:
            continue
        # Say why an item that IS waiting cannot be moved, instead of hanging silently (#985 review 2.4).
        if item.get("paused"):
            print(f"board: #{item['id']} 正在暂停（{item.get('pause_why') or '无原因'}），先不转待上线验收", file=sys.stderr)
            continue
        if not wait.get("commit") or not binding.get("repo"):
            print(f"board: #{item['id']} 等发布记的是 {wait.get('commit') or '(空提交)'}、仓库 {binding.get('repo') or '(没绑 PR)'}，"
                  f"没法核对是否已上线，先不动；重新 board pr 绑定后可再跑 board deployed", file=sys.stderr)
            continue
        has = _deploy_contains(binding["repo"], wait["commit"], commit)
        if has is None:
            print(f"board: #{item['id']} 查不到 {commit[:8]} 是否含合并提交，先不动", file=sys.stderr)
            continue
        if not has:
            continue
        with _locked():
            cur = _read()
            hit = next((i for i in cur if i["id"] == item["id"]), None)
            # Re-read under the lock: the generation and the PAUSE must be the ones queried
            # (#985 review 2.3: an item paused meanwhile must not be written silently).
            if hit is None or hit.get("await_deploy") != wait or hit.get("pr_binding") != binding or hit.get("paused"):
                continue
            hit.pop("await_deploy")
            hit["deployed"] = {"commit": commit, "at": _bound_now()}
            hit["returned_at"] = _bound_now()
            hit["reviewer"] = hit.get("dispatcher", "")
            hit["status"] = f"待上线验收：已随 {commit[:8]} 部署"
            hit["at"] = _now()
            _write(cur)
            event(hit["id"], "returned", hit)
        moved.append(item["id"])
    return moved


REVIEW_TIERS = {"simple": "simple", "简单": "simple", "complex": "complex", "复杂": "complex"}


def set_tier(nid, tier):
    """验收档位记在条目 review_tier 上，桥的复盘扫描（core/team_task_review.go）按它选审核人。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return False
        hit["review_tier"] = REVIEW_TIERS[tier]
        _write(cur)
    return True


def returned(nid, reviewer, at=None, bound=None, receipt=None):
    """Record a delivered report, not acceptance. Repeated reports keep the deadline."""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if bound is not None:
            if not bound or not receipt or hit is None or hit.get("bound") != bound:
                return False
            receipts = hit.setdefault("relay_returns", [])
            if receipt in receipts:
                return True
            if hit.get("paused"):
                return False  # A late relay must never undo an explicit pause.
            receipts.append(receipt)
        archived = None
        if hit is None:
            # Legacy workers may say "done" before their final report (#770). That is
            # execution completion, not dispatcher acceptance of a delivered artifact.
            archived = _read("board-done.jsonl")
            hit = next((i for i in reversed(archived) if i["id"] == nid), None)
            if hit is None or not hit.get("chat"):
                return False
            if hit.get("review_accepted_at"):
                return True  # a delayed report must not reopen an accepted task
            hit = dict(hit)
            for key in ("done_at", "auto_pruned", "returned_at"):
                hit.pop(key, None)
            cur.append(hit)
        if hit.get("returned_at"):
            if bound is not None:
                _write(cur)
            return True
        hit["returned_at"] = datetime.fromisoformat(re.sub(r"\.\d+", lambda m: m[0][:7].ljust(7, "0"), at).replace("Z", "+00:00")).isoformat() if at else _bound_now()
        hit["reviewer"] = hit.get("dispatcher") or reviewer
        hit.pop("review_rejected", None)  # A new handback supersedes the earlier rejection.
        hit.pop("pause_req", None)  # 停手的那一轮交回了
        hit.pop("pause_req_at", None)
        hit["status"], hit["at"] = "已交回待验收", _now()
        if hit.get("chat"):
            hit["sk"] = hit["chat"]
        if hit.get("ws"):
            hit["ws_was"] = hit.pop("ws")
        hit.pop("paused", None)
        hit.pop("pause_why", None)
        for k in ("backlog", "backlog_why", "backlog_at", "backlog_by"):
            hit.pop(k, None)  # 真交回了：从待办回到待验收
        _back_to_chat(hit)
        tid = hit.pop("guard", None)
        _write(cur)
        event(nid, "returned", hit)
        if archived is not None:
            _write([i for i in archived if i["id"] != nid], "board-done.jsonl")
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
        for k in ("backlog", "backlog_why", "backlog_at", "backlog_by"):
            hit.pop(k, None)  # 打回要返工：从待办回到暂停（团队板「暂停」块，等你处理）
        # Rework is not the build already deployed for review (#985 review 2.2): the next handback
        # binds its own PR and deployment again.
        hit.pop("await_deploy", None)
        hit.pop("deployed", None)
        hit["paused"] = hit["at"] = _now()
        hit["paused_at"] = _bound_now()
        hit["paused_by"] = os.environ.get("CC_PROJECT", "")
        hit["review_rejected"] = reason
        rounds = hit.get("reject_reasons") or []
        rounds.append(reason)
        hit["reject_reasons"] = rounds
        # 返工上限（11-06 用户：评审死循环）：第二次退回不再续做，停下等用户定；ws-handoff --resume 会拒。
        capped = len(rounds) >= REWORK_CAP
        if capped:
            hit["rework_cap"] = True
            hit["pause_why"] = f"{REWORK_CAP_WHY}：" + reason
        else:
            hit["pause_why"] = "验收退回：" + reason
        hit["status"] = hit["pause_why"]
        _write(cur)
        event(nid, "rejected", hit, reason)
        snap = dict(hit)
    if capped:
        _ask_rework_cap(snap)
    return "capped" if capped else True


REWORK_CAP = 2
REWORK_CAP_WHY = "两轮未过，等用户"


def _clip(s, n=80):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[:n].rstrip() + "…"


def _worker_side(it):
    """干活这边的说法：交接同目录 report-<编号>.md（交回草稿）里「做了什么」那行；没有就指回工作区交回。"""
    where = it.get("where") or ""
    f = os.path.join(os.path.dirname(where), f"report-{it['id']}.md") if where else ""
    try:
        lines = [l.strip() for l in open(f, encoding="utf-8") if l.strip()]
    except OSError:
        lines = []
    if len(lines) >= 2 and lines[0].startswith("[report]"):
        return _clip(lines[1])
    return "见工作区最后一次交回"


def _ask_rework_cap(it):
    """第二次退回：交接里记一笔，并在聊天频道发 [ask] 让用户定（失败只写 stderr，不拦退回）。"""
    nid, rounds = it["id"], it.get("reject_reasons") or []
    text = (f"[ask] #{nid} 背景：「{it.get('what', '')}」验收退回两次，按返工上限先停下，等你定。\n"
            f"验收这边：第一次「{_clip(rounds[0])}」，第二次「{_clip(rounds[-1])}」。\n"
            f"干活这边：{_worker_side(it)}\n"
            "要你做的：定接着改（说清按谁的标准）、换人做，还是按现在的收。")
    if it.get("where") and os.path.isfile(it["where"]):
        append_forward(it["where"], f"{_now()} {REWORK_CAP_WHY}（#{nid}）：第二次退回「{rounds[-1]}」；ws-handoff --resume 已停用，等用户定。")
    chat, proj = it.get("chat") or it.get("sk") or "", it.get("project") or os.environ.get("CC_PROJECT", "")
    if not chat or not proj:
        print(f"board: #{nid} 没有聊天频道或项目，[ask] 没发：\n{text}", file=sys.stderr)
        return
    binp = os.environ.get("CC_BIN") or shutil.which("bothouse") or shutil.which("cc-connect") or "cc-connect"
    try:
        r = subprocess.run([binp, "send", "-p", proj, "-s", chat, "--message", text.replace("<@", "<\u200b@")],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip() or r.stdout.strip() or f"exit {r.returncode}")
    except Exception as e:
        print(f"board: #{nid} [ask] 没发出去（{e}），请转给用户：\n{text}", file=sys.stderr)


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
            hit.pop("pr_merge", None)  # Previous generation's merge is not this handback.
            # A new generation is not waiting on the old merge's deployment (#985 review 2.1).
            hit.pop("await_deploy", None)
            hit.pop("deployed", None)
            hit["bound"] = _bound_now()  # reoccupy 刚 claim 了一件新交接
            hit.pop("ws_was", None)
            if ws.startswith("discord:"):
                hit["ch"] = ws.split(":", 1)[1]
            _write(cur)


def queued(nid):
    """Paused queue entries keep their place until explicitly resumed (user 2026-11-02)."""
    try:
        entries = json.loads((SETUP / "ws-queue.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False
    return any(isinstance(entry, dict) and entry.get("nid") == nid for entry in entries)


def hold(nids, why=None):
    """为集中发布暂停（用户 2026-11-04「可以」：发布前主动保存停点的活标「为发布暂停」，发布切完自动续，不计失败）。
    只打标记，不 park：会话和工作区留着，桥重启后原地续。返回标上的编号。"""
    with _locked():
        cur = _read()
        picked = []
        for i in cur:
            if nids and i["id"] not in nids:
                continue
            if not nids and (not i.get("ws") or i.get("returned_at")):
                continue
            if i.get("paused") or i.get("backlog") or i.get("release_hold"):
                continue
            mark = {"at": _bound_now(), "by": os.environ.get("CC_PROJECT", "")}
            if why:
                mark["why"] = why
            i["release_hold"] = mark
            picked.append(i["id"])
        if picked:
            _write(cur)
    return picked


def unhold(nids, at=None):
    """去掉「为发布暂停」。at：只去掉这一次打的标记（桥重启后续办时带上，免得撤掉重启后新打的）。返回去掉的编号。"""
    with _locked():
        cur = _read()
        cleared = []
        for i in cur:
            mark = i.get("release_hold")
            if not mark or (nids and i["id"] not in nids) or (at is not None and mark.get("at") != at):
                continue
            i.pop("release_hold")
            i["at"] = _now()
            cleared.append(i["id"])
        if cleared:
            _write(cur)
    return cleared


def resume(nid):
    """None：没有这条；False：它没在暂停也没在待办；True：已恢复。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None or not (hit.get("paused") or hit.get("backlog")):
            return None if hit is None else False
        hit.pop("paused", None)
        hit.pop("pause_why", None)
        hit.pop("backlog", None)
        hit.pop("backlog_why", None)
        # Resuming continues work, not the deployment that was already verified (#985 review 2.2).
        hit.pop("await_deploy", None)
        hit.pop("deployed", None)
        hit["at"] = _now()
        _write(cur)
    return True


def backlog(nid, why=None):
    """条目挪进待办（用户 2026-11-05「任务板怎么还有一堆任务」：排在 bug 后面的小问题、非阻塞的验收发现）。
    和 pause 一样留在 board.jsonl、不进 board-done.jsonl、工作区里的活放回池子；区别是默认列表（lines）和置顶团队板
    都不列它们，只在末尾留一行「待办 N 件」，board backlog 才看得到。恢复同暂停：board resume <编号>。
    待办不参加自动收起（prune_candidates 只看 paused）：排下的事不能因为没人动就消失，只有 resume / update / done 才动它。
    返回 {**条目, "ws": 原工作区} / 条目 / None（没有这条）。"""
    with _locked():
        cur = _read()
        hit = next((i for i in cur if i["id"] == nid), None)
        if hit is None:
            return None
        hit["backlog"] = hit["at"] = _now()
        hit.pop("paused", None)  # 从暂停挪进待办：团队板的「暂停 N 件」不能再算它
        hit.pop("pause_why", None)
        hit["backlog_at"] = _bound_now()
        hit["backlog_by"] = os.environ.get("CC_PROJECT", "")
        hit.pop("unpruned", None)
        ws = hit.pop("ws", None)  # 同 pause：工作区随后放回池子，ws_was 留着，resume 时向桥收回（reoccupy）
        if ws:
            hit["ws_was"] = ws
            _back_to_chat(hit)
        if why:
            hit["backlog_why"] = why
        else:
            hit.pop("backlog_why", None)
        tid = hit.pop("guard", None)  # 不在工作区做了：不再等工作区交回
        _write(cur)
        event(nid, "paused", hit, why or "挪进待办")  # 事件种类沿用 paused（工作台地图按它把这条从座位上收走）
    _del_timer(tid)
    return {**hit, "ws": ws} if ws else hit


# 收尾词：update 写成这些开头的状态就直接 done（用户 2026-10-28「任务榜完成的为什么不下掉」：
# 只有明确完成/验收/收口才关闭；「已交回」仍需验收。和桥 watchBoardClosed 同一组词。
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
            session = os.environ.get("CC_SESSION_KEY") or os.environ.get("CC_SESSION", "")
            if hit.get("returned_at") or (hit.get("chat") and session == hit["chat"]):
                rec["review_accepted_at"] = _bound_now()
            if rework is not None:  # 不填就不写这两项，汇总时算「未填」
                rec["rework"] = rework
                if why:
                    rec["rework_why"] = why
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        event(nid, "done", hit)
    _del_timer(tid)
    return hit  # 移出板的条目（绑着工作区时 main 里 park 掉，_park_done）


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
    return {int(next(g for g in m if g)) for m in _pr_ref_re(repo).findall(" ".join(filter(None, (i.get("where"), i.get("where_link")))))}


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
    if i.get("returned_at") or i.get("review_rejected") or not i.get("paused") or _asking(i) or queued(i.get("id")):
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
        _write(recs, "board-done.jsonl")  # 同样的唯一临时名 + 重试（#257；原来所有进程共抢 .tmp）
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
        # 这次点到的编号全都不收：board backlog 1 2 3 一次挪几条时，别把后面那几条先收进完成记录
        ids = {int(x.lstrip("#")) for x in argv[1:] if x.lstrip("#").isdigit()}
        _say_pruned(auto_prune(check_pr=False, skip=ids))
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
            same = False  # 新「谁」点名的就是眼下绑的工作区：不收回、不解绑（#1111）
            if cur and m and not cur.get("paused") and argv[4] != cur.get("who") and cur.get("chat") and _cc_bin():
                try:
                    back = _ws_id_by_name(_cc_bin(), cur["chat"], m.group(1))
                except ValueError as e:
                    sys.exit(f"#{nid} {e}，板子和工作区绑定未改")
                if not back:
                    sys.exit(f"#{nid} 查询未找到{m.group(1)}，板子和工作区绑定未改")
                if back and back == cur.get("ws"):
                    back, same = None, True
                why = reoccupy(cur, back) if back else None
                if why:
                    _refuse(nid, why)
            before = update(nid, argv[2], *argv[3:5], nxt=nxt, same_ws=same)
            if before and back:
                rebind(nid, back)
            if not before:
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            ended = CLOSED_RE.match(argv[2]) and done(nid)
            if ended:
                print(f"已结束：状态「{argv[2]}」是收尾词，#{nid} 移出任务板（返工次数记「未填」）")
                _park_done(ended)
                return
            print("已更新")
            if before.get("ws") and not any(i["id"] == nid and i.get("ws") == before["ws"] for i in items()):
                freed = park_workspace(before)  # 「谁」改走了：它在工作区的那件交接放回桥
                if freed:
                    print("工作区已放回池子，会话已清")
        elif cmd == "pr" and len(argv) == 4 and argv[3] in ("no-deploy", "deploy"):
            bind_pr(int(argv[1].lstrip("#")), argv[2], argv[3] == "no-deploy")
            print("已绑定 PR 与部署范围；合并不代表验收")
        elif cmd == "merged" and len(argv) == 1:
            reconcile_merged_prs()
        elif cmd == "deployed" and len(argv) >= 2 and re.fullmatch(r"[0-9a-f]{7,40}", argv[1]):
            got = mark_deployed(argv[1], [int(x.lstrip("#")) for x in argv[2:]])
            print("转待上线验收：" + ("、".join(f"#{n}" for n in got) if got else "没有已含在这次部署里的等发布条目"))
        elif cmd == "tier" and len(argv) == 3 and argv[2] in REVIEW_TIERS:
            if not set_tier(int(argv[1].lstrip("#")), argv[2]):
                sys.exit("条目不存在，未改档位")
            print("已改验收档位：" + REVIEW_TIERS[argv[2]])
        elif cmd == "returned" and len(argv) in (3, 4, 6):
            if not returned(int(argv[1].lstrip("#")), *argv[2:]):
                sys.exit("条目不存在，未登记交回")
            print("已交回待验收")
        elif cmd == "reject" and len(argv) == 3 and argv[2].strip():
            got = reject(int(argv[1].lstrip("#")), argv[2].strip())
            if not got:
                sys.exit("条目不在待验收状态，未退回")
            if got == "capped":
                print(f"第二次退回：已暂停「{REWORK_CAP_WHY}」，已在聊天频道发 [ask] 请用户定；ws-handoff --resume 不再续做")
            else:
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
            ended = done(nid, rework, why or None)
            if not ended:
                sys.exit(f"没有 #{argv[1].lstrip('#')}，先跑 board 看编号")
            print("已结束")
            _park_done(ended)
            hint = open_pr_hint()
            if hint:
                print(hint)
        elif cmd == "backlog" and len(argv) == 1:
            print("\n".join(backlog_lines()) or "（没有待办）")
        elif cmd == "backlog" and len(argv) >= 2:
            rest, why = argv[1:], None
            if "--why" in rest:
                k = rest.index("--why")
                if k + 1 >= len(rest):
                    sys.exit("用法：board backlog <编号...> [--why 原因]")
                why, rest = rest[k + 1], rest[:k] + rest[k + 2:]
            if not rest:
                sys.exit("用法：board backlog <编号...> [--why 原因]")
            moved, missing = [], []
            for nid in [int(x.lstrip("#")) for x in rest]:
                hit = backlog(nid, why)
                if not hit:
                    missing.append(nid)
                    continue
                moved.append(nid)
                if os.path.isfile(hit.get("where") or ""):  # ws-handoff 建的条目：停手话写进交接，工作区读得到
                    append_forward(hit["where"], f"{_now()} 挪进待办（#{nid}）{'：' + hit['backlog_why'] if hit.get('backlog_why') else ''}。"
                                                 "停手，不要再起后台命令，正在跑的停掉；上面更早的「接着做」作废，等主频道恢复再做。")
                # 同 pause：在别处下的命令连那一轮一起停；在那个工作区里自己下的不打断（会把正在跑的这一轮掐掉）
                here = os.environ.get("CC_SESSION_KEY", "").split(":")[1:2]
                freed = park_workspace(hit, stop=(here != (hit.get("ws") or "").split(":")[1:2]))
                if freed is not None:
                    print(f"#{nid} 工作区已放回池子，会话已清" if freed else f"#{nid} 工作区里还有别的活，先不放回")
            if missing:
                print(f"没有 #{'、#'.join(str(n) for n in missing)}，先跑 board 看编号", file=sys.stderr)
            if moved:
                print("已挪进待办：" + "、".join(f"#{n}" for n in moved) + "（board backlog 看，board resume <编号> 恢复）")
            if missing:
                sys.exit(1)
        elif cmd == "pause" and 2 <= len(argv) <= 3:
            nid = int(argv[1].lstrip("#"))
            req = self_pause(nid, argv[2] if len(argv) > 2 else None)
            if req:
                # 工作区在自己那一轮里 pause 自己：当场放回会清会话、把这一轮连同要写的 [report] 一起掐掉，
                # 暂停的条目又会让桥把交回扣在工作区（agentm #26，11-09）。改成记一笔「要停手」，不放回：
                # 这一轮照常写 [report] 交回，桥收到后放回工作区；没写，桥叫它补交，补不上就把最后一段话转给主角色。
                print(f"已记停手（#{nid}）：工作区里不自己暂停。这一轮最后一条回复第一行写 [report] #{nid}，"
                      "说做到哪、卡在哪、要谁定；交回后桥自动放回工作区。")
                return
            hit = pause(nid, argv[2] if len(argv) > 2 else None)
            if not hit:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已暂停")
            if os.path.isfile(hit.get("where") or ""):  # ws-handoff 建的条目：停手话写进交接的转交结果节，工作区读得到
                append_forward(hit["where"], f"{_now()} 已暂停（#{nid}）{'：' + hit['pause_why'] if hit.get('pause_why') else ''}。"
                                             "停手，不要再起后台命令，正在跑的停掉；上面更早的「接着做」作废，等主频道恢复再做。")
            schedule_prune_check(hit)
            freed = park_workspace(hit, stop=True)  # 在那个工作区里自己 pause 的已在上面改成记停手
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
        elif cmd == "wait" and len(argv) == 4:
            # 工作区 [report] 写了「等外部：…」（桥调，core/team_wait_external.go）：外部条件卡住（没空卡、等 CI、等对方），
            # 条目记「等外部」并带 wait_until，工作区放回池子、撤兜底；看门不再叫醒，到点桥 ws-handoff --resume 接着做
            # （用户 11-09「没卡导致不断重复跑」→「修」）。
            nid, minutes = int(argv[1].lstrip("#")), max(1, int(argv[3]))
            hit = wait_external(nid, argv[2].strip(), minutes)
            if not hit:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print(f"已记等外部，{minutes} 分钟后接着做")
            freed = park_workspace(hit)
            if freed is not None:
                print("工作区已放回池子，会话已清" if freed else "工作区里还有别的活，先不放回")
        elif cmd == "resume" and len(argv) == 2:
            nid = int(argv[1].lstrip("#"))
            if unprune(nid):  # 自动收起的：先从完成记录拿回板上（还暂停着），再照常恢复
                print(f"#{nid} 已从自动收起里找回")
            cur = next((i for i in items() if i["id"] == nid), None)
            in_queue = queued(nid)
            back = cur.get("ws_was") if not in_queue and cur and (cur.get("paused") or cur.get("backlog")) and WS_NAME_RE.match(cur.get("who") or "") else None
            why = reoccupy(cur, back) if back else None
            if why:
                _refuse(nid, why)
            r = resume(nid)
            if r and back and cur.get("chat") and _cc_bin():
                rebind(nid, back)
            if r is None:
                sys.exit(f"没有 #{nid}，先跑 board 看编号")
            print("已恢复" if r else f"#{nid} 没在暂停")
            if in_queue:
                script = Path(__file__).resolve().parent.parent / "lead" / "ws-handoff"
                result = subprocess.run([sys.executable, "-I", str(script), "--drain"], timeout=60)
                if result.returncode != 0:
                    sys.exit("已恢复，队列派发失败；条目仍在原队列位置，请重试 ws-handoff --drain")
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
        elif cmd in ("hold", "unhold"):
            rest, opt = argv[1:], None
            flag = "--why" if cmd == "hold" else "--at"  # --at：桥续办时只撤它看到的那次标记
            if flag in rest:
                k = rest.index(flag)
                if k + 1 >= len(rest):
                    sys.exit("用法：board hold [编号...] [--why 原因] ｜ board unhold [编号...] [--at 标记时刻]")
                opt, rest = rest[k + 1], rest[:k] + rest[k + 2:]
            nids = [int(x.lstrip("#")) for x in rest]
            got = hold(nids, opt) if cmd == "hold" else unhold(nids, opt)
            word = "为发布暂停" if cmd == "hold" else "去掉为发布暂停"
            print(f"{word}：" + ("、".join(f"#{n}" for n in got) if got else "没有符合的条目"))
        elif cmd == "rework" and len(argv) <= 2:
            print(rework_report(int(argv[1]) if len(argv) > 1 else REWORK_DAYS))
        else:
            sys.exit(__doc__.split("用法：", 1)[1].rstrip())
    except ValueError:
        sys.exit("编号、返工次数、天数要是数字，比如 board done 3 1 \"原因\"")


if __name__ == "__main__":
    main(sys.argv[1:])
