"""hub 和 cloudweb、team_exit 共用的异常。叶子模块，不 import 任何 rh 模块。
放这里的原因：发布包用 `python -m rh.hub` 起 hub，hub.py 跑在 __main__ 里；别的模块再 `from .hub import Conflict`
会另载一份 rh.hub，抛的是 __main__.Conflict、接的是 rh.hub.Conflict，except 不命中，bot 连接被断（PR #390 审稿第 2 轮）。"""
from __future__ import annotations


class Conflict(Exception):
    """频道重名、往归档的频道发消息：HTTP 409。"""


class WorkspaceError(Exception):
    """team_workspace 被拒；code 是桥认的错误串（conest bridge/platform/cloud-web/workspaces.go
    teamWorkspaceRequest：workspace-owned / stale-claim / room-missing / unsupported）。"""

    def __init__(self, code: str, msg: str = ""):
        super().__init__(msg or code)
        self.code = code
