"""产品数据目录：gate、任务板、lead 脚本共用这一处解析（Go 侧是 brand.go 的 DataDir，规则相同）。

- data_dir()：BOTHOUSE_DATA_DIR → GATE_SETUP_DIR → CC_DATA_DIR → ~/.bothouse；~/.bothouse 不存在而旧名 ~/.cc-connect 在时用旧的
  （只选不搬，同 brand.go DataDir）。lead.json 在这里。
- setup_dir()：GATE_SETUP_DIR → data_dir()。gate-team.json、jev.json、secrets.env、任务板（<setup_dir>/team）在这里。
  两个变量都设时：lead.json 跟 BOTHOUSE_DATA_DIR，其余跟 GATE_SETUP_DIR（显式指定的那一项各管各的）。
  bothouse 拉起 gate 时两个都设成同一个数据目录（core/gate_proc.go）。
"""
import os
import sys
import tempfile
from pathlib import Path

_TEMP = tuple(str(Path(t).resolve()) for t in {tempfile.gettempdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"} if os.path.isdir(t))


def _in_test():
    """测试进程：设了 BOTHOUSE_TEST、载了 unittest/pytest，或 HOME 在临时目录（iso-check 的做法）。"""
    if os.environ.get("BOTHOUSE_TEST") or "unittest" in sys.modules or "pytest" in sys.modules:
        return True
    home = str(Path(os.environ.get("HOME") or "/").resolve())
    return any(home == t or home.startswith(t + "/") for t in _TEMP)


def _live_dir(p):
    """p 自己或上级里放着 config.toml、又不在临时目录里的那一层：一份在用的数据目录（桥读的真实配置在那里）。"""
    for d in (p, *p.parents):
        s = str(d)
        if any(s == t or s.startswith(t + os.sep) for t in _TEMP):
            return None  # 往上走先碰到临时目录：测试自己建的数据目录，放行
        if (d / "config.toml").is_file():
            return d
    return None


def guard(path):
    """测试碰到在用的数据目录（它自己或上级放着真实 config.toml，且不在临时目录里）就中止。
    起因 2026-11-01：bot 会话带着 BOTHOUSE_DATA_DIR/CC_DATA_DIR，测试只换了 HOME，安装测试把团队记录、hooks、tools 写进了线上目录。
    2026-11-22：原来只认真实主目录下的 ~/.bothouse、~/.cc-connect，本机线上目录 ~/.cc-connect-maomao 漏网，
    单测夹具整份覆盖了线上任务板；改成按「真实配置在哪」判，不再写死目录名单。"""
    if path is None or str(path) == "" or not _in_test():
        return path
    p = Path(path).expanduser().resolve()
    live = _live_dir(p)
    if live is not None:
        raise SystemExit(f"测试碰到了线上数据目录 {p}（{live} 有真实 config.toml）：先清掉 BOTHOUSE_DATA_DIR / CC_DATA_DIR / BOARD_DIR，HOME 放进 iso-check 的隔离目录")
    return path


def _default():
    preferred, legacy = Path.home() / ".bothouse", Path.home() / ".cc-connect"
    return legacy if not preferred.exists() and legacy.is_dir() else preferred


def data_dir():
    for key in ("BOTHOUSE_DATA_DIR", "GATE_SETUP_DIR", "CC_DATA_DIR"):
        if os.environ.get(key):
            return guard(Path(os.environ[key]).expanduser())
    return guard(_default())


def setup_dir():
    if os.environ.get("GATE_SETUP_DIR"):
        return guard(Path(os.environ["GATE_SETUP_DIR"]).expanduser())
    return data_dir()


# ── 桥的数据文件：Python 侧只在这里认文件名和格式（#2051 第 5 件）。写者见各函数说明，这里只读。 ──

def load_config(path=None):
    """config.toml（默认 setup_dir() 下那份）解析成 dict（写者：桥）；文件没有、坏了、Python 没有 tomllib（3.10 及以下）都回 None，
    调用方按「没配」走默认（桥给角色会话设了 BOARD_DIR，老 Python 上用不到配置）。"""
    try:
        import tomllib
    except ImportError:
        return None
    try:
        with open(path or setup_dir() / "config.toml", "rb") as f:
            return tomllib.load(f)
    except (OSError, ValueError):
        return None


def projects(path=None):
    """config.toml 的 [[projects]] 列表；读不了回 []。"""
    p = (load_config(path) or {}).get("projects")
    return [x for x in p if isinstance(x, dict)] if isinstance(p, list) else []


def board_dir():
    """任务板目录：BOARD_DIR → config.toml 里第一处 team_status_dir（顶层的，或第一个设了它的 project）→ setup_dir()/team；
    结果过测试守卫。"""
    if os.environ.get("BOARD_DIR"):
        return guard(Path(os.environ["BOARD_DIR"]).expanduser())
    cfg = load_config() or {}
    for p in [cfg] + projects():
        d = str(p.get("team_status_dir") or "").strip() if isinstance(p, dict) else ""
        if d:
            return guard(Path(d).expanduser())
    return guard(setup_dir() / "team")


def read_json(name, default=None):
    """data_dir()/name 的 JSON；文件没有或坏了回 default。"""
    import json
    try:
        return json.loads((data_dir() / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def team_workspaces():
    """team_workspaces.json 整份（写者：桥 core/team_workspace*.go）；没有回 {}。"""
    st = read_json("team_workspaces.json", {})
    return st if isinstance(st, dict) else {}


def workspace_keys():
    """桥记过的所有工作区频道 key：handoffs 的键，加各聊天频道 parents 里工作区的 <平台>:<id>。"""
    st = team_workspaces()
    out = set((st.get("handoffs") or {}).keys())
    for parent, rows in (st.get("parents") or {}).items():
        plat = str(parent).split(":", 1)[0]
        out |= {f"{plat}:{w.get('id')}" for w in rows or [] if isinstance(w, dict) and w.get("id")}
    return out


def lead():
    """lead.json（写者：桥 core/api_handoff.go writeLeadSelectionFile）：{lead, name, at, auto}；没有回 {}。"""
    st = read_json("lead.json", {})
    return st if isinstance(st, dict) else {}
