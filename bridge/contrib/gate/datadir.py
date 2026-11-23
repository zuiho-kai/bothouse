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
