# 本机私货的口子（#2051）：发布包里只有这个文件，本机自己加的关卡放在 <数据目录>/collaboration/local/hooks.py。
# 那个文件不存在、或没写某个函数，就什么都不做（返回 None）；写了就按固定几个点调：
#   report_block(notes, draft, failed) -> 退回的话或 None   ws-up --report 过了 report check 之后
#   on_ask(chat, notes, text)                               ws-up --ask 提问发出去之前（出错不挡提问）
# 开关照旧放 <数据目录>/collaboration/handoff-rules.local.json，代码放它隔壁的 local/，线上脚本不用再手改。
import importlib.util, os, sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ.get("GATE_DIR") or Path(__file__).resolve().parent.parent / "gate").expanduser()))
import datadir  # noqa: E402

_MOD = False


def _hooks():
    global _MOD
    if _MOD is False:
        _MOD = None
        p = Path(os.environ.get("LEAD_LOCAL_HOOKS") or datadir.data_dir() / "collaboration" / "local" / "hooks.py")
        if p.is_file():
            sys.path.insert(0, str(p.parent))
            spec = importlib.util.spec_from_file_location("lead_local_hooks", p)
            _MOD = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(_MOD)
    return _MOD


def call(name, *args):
    fn = getattr(_hooks(), name, None)
    return fn(*args) if callable(fn) else None
