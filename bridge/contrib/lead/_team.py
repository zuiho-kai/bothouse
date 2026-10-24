"""d10 / ws-handoff / ws-forward 共用：团队名单、当前主角色、工作区频道、Discord token 都从 gate 已有的配置读，不写死。

- 团队文件、当前主角色：复用 ../gate/lead.py（查找顺序同 gate：GATE_TEAM → <GATE_SETUP_DIR>/gate-team.json → team.example.json；
  主角色默认存产品数据目录的 lead.json，GATE_LEAD_FILE 可显式覆盖）。gate 不在 ../gate 时设 GATE_DIR。
- 工作区频道：环境变量 WS_CHANNEL，否则团队文件顶层 "workspace"（平台频道 ID）；都没有 → None（ws-handoff 会新建）。
- Discord token：环境变量 DISCORD_BOT_TOKEN，否则 <GATE_SETUP_DIR>/secrets.env 里的同名变量。
- 发消息/定时器用的身份：调用者自己的 CC_PROJECT（cc-connect 给每个会话设的），即正在当主的那位。
"""
import json, os, subprocess, sys
from pathlib import Path

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(os.environ.get("GATE_DIR") or _here.parent / "gate").expanduser()))
import lead  # noqa: E402  gate/lead.py

SETUP = lead._SETUP
LAST = SETUP / "ws-handoff-last.json"  # 最近一次 ws-handoff 的交接（ws-forward 读）


def team():
    return lead._default_team()


def workspace():
    return os.environ.get("WS_CHANNEL") or str(team().get("workspace") or "") or None


def member_id(who):
    """名字 / 别名 / key / 平台 ID → 平台 ID；认不出 → None。"""
    if str(who).isdigit():
        return str(who)
    k = lead.resolve(who)
    return lead.ID.get(k) if k is not None else None


def project():
    p = os.environ.get("CC_PROJECT", "")
    if not p:
        sys.exit("读不到 CC_PROJECT：请在 cc-connect 的会话里跑（发消息/定时器要用当主角色自己的身份）")
    return p


def token():
    if os.environ.get("DISCORD_BOT_TOKEN"):
        return os.environ["DISCORD_BOT_TOKEN"]
    env = SETUP / "secrets.env"
    out = subprocess.run(["/bin/sh", "-c", 'set -a; . "$1"; printf %s "$DISCORD_BOT_TOKEN"', "sh", str(env)],
                         capture_output=True, text=True).stdout.strip() if env.is_file() else ""
    if not out:
        sys.exit(f"读不到 DISCORD_BOT_TOKEN（环境变量或 {env}）")
    return out


def name_of(proj):
    """cc-connect 项目名 → 团队文件里的名字（和群里叫的一致）；认不出就原样返回项目名。later 写任务板「谁」用。"""
    k = lead.resolve(proj)
    return lead.NAME[k] if k is not None else proj
