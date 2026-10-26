"""d10 / ws-handoff / ws-forward 共用：团队名单、当前主角色、工作区频道都从 gate 已有的配置读，不写死。

- 团队文件：只认向导写的那一份（GATE_TEAM，否则 <GATE_SETUP_DIR>/gate-team.json），不回退到 team.example.json；
  成员的 "id" 是平台用户 ID 原样字符串（Discord 数字、飞书 ou_…、DSH 成员 id 都认），"workspace" 是她的工作目录。
- 当前主角色：复用 ../gate/lead.py（默认存产品数据目录的 lead.json，GATE_LEAD_FILE 可显式覆盖）。gate 不在 ../gate 时设 GATE_DIR。
- 工作区频道：环境变量 WS_CHANNEL，否则团队文件顶层 "workspace"（平台频道 ID）；都没有 → None（ws-handoff 会新建）。
- 不读平台 token：发消息、建工作区都走桥（<桥> send / workspace / timer），读频道历史走桥的 api.sock GET /channel/history（channel_history），四平台通用。
- 发消息/定时器用的身份：调用者自己的 CC_PROJECT（cc-connect 给每个会话设的），即正在当主的那位。
- 队友工作目录：团队文件成员的 "wt"，没有就用 "workspace"（一个路径或路径列表，git 副本本身或放 git 副本的目录），d10-fire 看里面有没有新提交来续期；
  不写就只看频道里的动静。
"""
import http.client, json, os, re, shutil, socket, subprocess, sys, urllib.parse
from pathlib import Path

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(os.environ.get("GATE_DIR") or _here.parent / "gate").expanduser()))
import lead  # noqa: E402  gate/lead.py
import datadir  # noqa: E402  gate/datadir.py：数据目录只解析这一处

SETUP = datadir.setup_dir()
LAST = SETUP / "ws-handoff-last.json"  # 最近一次 ws-handoff 的交接（ws-forward 读）


_TEAM = None


def _load():
    """向导写的团队文件 → dict；没有 → None。读到后让 lead 的名字/ID 表也用它（不拿示例团队认人）。"""
    global _TEAM
    if _TEAM is None:
        f = Path(os.environ.get("GATE_TEAM") or SETUP / "gate-team.json").expanduser()
        if not f.is_file():
            return None
        _TEAM = json.loads(f.read_text(encoding="utf-8"))
        lead.configure(_TEAM)
    return _TEAM


def team():
    """团队文件内容；没有（还没跑过向导）→ {}：认不出队友，工作区频道只看 WS_CHANNEL。"""
    return _load() or {}


def workspace():
    return os.environ.get("WS_CHANNEL") or str(team().get("workspace") or "") or None


def member_id(who):
    """名字 / 别名 / key / 平台 ID（<@id>、平台:id 也行）→ 团队文件里的平台 ID；认不出 → None。
    ID 不假设是数字：飞书 open_id、DSH 成员 id 原样比对。"""
    if _load() is None:
        return str(who) if str(who).isdigit() else None
    w = str(who).strip()
    m = re.fullmatch(r"<@!?([^>]+)>", w)
    if m:
        w = m.group(1)
    for cand in (w, w.split(":", 1)[1] if ":" in w else None):
        if cand and cand in lead.ID.values():
            return cand
    if w.isdigit():  # 团队文件外的 Discord ID 照旧放行（直接写数字派给谁）
        return w
    k = lead.resolve(who)
    return lead.ID.get(k) if k is not None else None


def worktrees(tid):
    """平台 ID → 团队文件里她的 "wt" 下的 git 副本目录列表（路径本身是 git 副本就是它，否则取它下面一层的子目录）。"""
    t = team()
    members = [t.get("lead") or {}, *(t.get("subs") or {}).values()]
    m = next((x for x in members if isinstance(x, dict) and str(x.get("id") or "") == str(tid)), None)
    raw = (m or {}).get("wt") or (m or {}).get("workspace") or []
    out = []
    for p in [raw] if isinstance(raw, str) else raw:
        d = Path(str(p)).expanduser()
        if (d / ".git").exists():
            out.append(d)
        elif d.is_dir():
            out += sorted(x for x in d.iterdir() if x.is_dir())
    return out


def project():
    p = os.environ.get("CC_PROJECT", "")
    if not p:
        sys.exit("读不到 CC_PROJECT：请在 cc-connect 的会话里跑（发消息/定时器要用当主角色自己的身份）")
    return p


def cc_bin():
    """桥程序：CC_BIN，否则 PATH 里的 bothouse / cc-connect（同目录 later 的找法）；都没有返回 None。
    只装了 bothouse 的用户也要能挂 d10、续期、发暂停（原先 d10 / d10-fire 写死 cc-connect）。"""
    return os.environ.get("CC_BIN") or shutil.which("bothouse") or shutil.which("cc-connect")


def name_of(proj):
    """cc-connect 项目名 → 团队文件里的名字（和群里叫的一致）；认不出（或没有团队文件）就原样返回项目名。later 写任务板「谁」用。"""
    if _load() is None:
        return proj
    k = lead.resolve(proj)
    return lead.NAME[k] if k is not None else proj


def api_socket():
    """桥的本地 API socket：CC_DATA_DIR（同 bothouse send 的找法）→ 产品数据目录，下面的 run/api.sock。"""
    base = os.environ.get("CC_DATA_DIR", "").strip()
    return Path(base).expanduser() / "run" / "api.sock" if base else datadir.data_dir() / "run" / "api.sock"


class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self._path))


def channel_history(session_key, proj="", limit=50, timeout=10):
    """session_key 所在频道最近 limit 条（旧→新），经桥 GET /channel/history，不碰平台 token。
    每条 {"id","author_id","author_name","is_bot","is_self","content","time"}。
    平台不支持读历史（桥回 501）返回 None；桥不在、未连上、读失败抛 OSError。"""
    q = urllib.parse.urlencode({k: v for k, v in (("session_key", session_key), ("project", proj), ("limit", str(limit))) if v})
    c = _UnixHTTP(api_socket(), timeout)
    try:
        c.request("GET", "/channel/history?" + q)
        r = c.getresponse()
        body = r.read().decode("utf-8", "replace")
    except (OSError, http.client.HTTPException) as e:
        raise OSError(f"桥 api.sock 读不到：{e}") from e
    finally:
        c.close()
    if r.status == 501:
        return None
    if r.status != 200:
        raise OSError(f"桥读频道历史失败（{r.status}）：{body.strip()}")
    return json.loads(body).get("messages") or []
