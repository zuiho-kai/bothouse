"""产品数据目录：gate、任务板、lead 脚本共用这一处解析（Go 侧是 brand.go 的 DataDir，规则相同）。

- data_dir()：BOTHOUSE_DATA_DIR → GATE_SETUP_DIR → ~/.bothouse；~/.bothouse 不存在而旧名 ~/.cc-connect 在时用旧的
  （只选不搬，同 brand.go DataDir）。lead.json 在这里。
- setup_dir()：GATE_SETUP_DIR → data_dir()。gate-team.json、jev.json、secrets.env、任务板（<setup_dir>/team）在这里。
  两个变量都设时：lead.json 跟 BOTHOUSE_DATA_DIR，其余跟 GATE_SETUP_DIR（显式指定的那一项各管各的）。
  bothouse 拉起 gate 时两个都设成同一个数据目录（core/gate_proc.go）。
"""
import os
from pathlib import Path


def _default():
    preferred, legacy = Path.home() / ".bothouse", Path.home() / ".cc-connect"
    return legacy if not preferred.exists() and legacy.is_dir() else preferred


def data_dir():
    for key in ("BOTHOUSE_DATA_DIR", "GATE_SETUP_DIR"):
        if os.environ.get(key):
            return Path(os.environ[key]).expanduser()
    return _default()


def setup_dir():
    if os.environ.get("GATE_SETUP_DIR"):
        return Path(os.environ["GATE_SETUP_DIR"]).expanduser()
    return data_dir()
