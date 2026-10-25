"""bothouse × AstrBot 桥 —— 核心逻辑（纯标准库，可脱离 AstrBot 单测）。

它做两件事（就是 AstrBot 插件要做的）：
  1. 把 QQ/微信 群里的一条消息，以"用户"身份发进 bothouse 的自建 hub 频道；
  2. 轮询频道，取回角色的回复（author_kind=role），整理成可发回群里的文本。

设计约束：
- 不改 bothouse 主仓库，只用它公开的 hub HTTP 接口；
- 所有状态可在内存（last_seen_id / 去重集合），断线重连后靠 last_seen_id 续上；
- 不记录 token、不把 token 放进异常信息。
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

DEFAULT_TIMEOUT = 15.0

# 角色回复里的"过程消息"（第 N 步 · 💭 思考）——不该转发给外部群
_PROGRESS_RE = re.compile(r"^\s*第\s*\d+\s*步\s*·")
# 角色回复尾部的状态行（模型列表/额度/本机工作目录）——隐私，必须过滤
_LOCAL_PATH_RE = re.compile(r"[A-Za-z]:[\\/]")


def clean_reply_text(text: str, strip_meta: bool = True) -> str:
    """清洗角色回复：去掉过程消息与结尾的状态/路径信息（隐私）。

    - 过程消息（"第 N 步 · …"）整条丢弃；
    - strip_meta=True 时：去掉以 `*[` 开头的行、含“额度”的行、含本机盘符路径的行。
    """
    t = (text or "").strip()
    if not t or _PROGRESS_RE.match(t):
        return ""
    if not strip_meta:
        return t
    lines = []
    for line in t.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("*["):
            continue
        if "额度" in s:
            continue
        if _LOCAL_PATH_RE.search(s):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


class HubError(RuntimeError):
    """调用 hub 失败（网络/鉴权/协议）。"""


class BothouseBridgeCore:
    def __init__(self, hub_url: str, token: str, room_id: int = 1, timeout: float = DEFAULT_TIMEOUT,
                 user_label_prefix: str = "[来自 QQ 群]"):
        self.hub_url = hub_url.rstrip("/")
        self._token = token
        self.room_id = int(room_id)
        self.timeout = timeout
        self.user_label_prefix = user_label_prefix
        self._last_seen_id = 0
        self._seen_ids: set[int] = set()

    # ---------- HTTP ----------
    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.hub_url + path, data=body, method=method,
            headers={"Authorization": "Bearer " + self._token,
                     "Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read(200).decode("utf-8", "replace")
            except Exception:
                pass
            raise HubError("hub HTTP %s %s: %s" % (e.code, path, detail)) from None
        except Exception as e:
            raise HubError("hub 连接失败（%s）：%s" % (type(e).__name__, e)) from None

    # ---------- 对外 ----------
    def send_user_message(self, text: str, sender_name: str = "", chat_name: str = "") -> dict:
        """把群里的一条消息发进频道。返回 hub 的消息对象（含 id）。"""
        prefix = self.user_label_prefix
        who = (" %s" % sender_name) if sender_name else ""
        where = ("（%s）" % chat_name) if chat_name else ""
        msg_text = "%s%s%s：%s" % (prefix, where, who, text)
        msg = self._request("POST", "/api/rooms/%d/messages" % self.room_id,
                            {"text": msg_text, "author_kind": "user"})
        mid = int(msg.get("id") or 0)
        if mid:
            self._last_seen_id = max(self._last_seen_id, mid)
        return msg

    def fetch_new_replies(self, limit: int = 50) -> list[dict]:
        """取回 since 之后的新角色回复（自动去重）。"""
        data = self._request("GET", "/api/rooms/%d/messages?limit=%d" % (self.room_id, limit))
        out = []
        for m in data.get("messages") or []:
            mid = int(m.get("id") or 0)
            if mid <= self._last_seen_id or mid in self._seen_ids:
                continue
            if m.get("author_kind") != "role":
                continue
            self._seen_ids.add(mid)
            out.append(m)
            self._last_seen_id = max(self._last_seen_id, mid)
        return out

    def wait_for_replies(self, timeout: float = 90.0, quiet: float = 20.0,
                         interval: float = 1.5) -> list[dict]:
        """轮询直到收到回复后安静 quiet 秒、或总超时。"""
        replies: list[dict] = []
        t0 = last = time.time()
        while time.time() - t0 < timeout:
            time.sleep(interval)
            new = self.fetch_new_replies()
            if new:
                replies.extend(new)
                last = time.time()
            elif replies and time.time() - last >= quiet:
                break
        return replies

    @staticmethod
    def format_for_chat(reply: dict, strip_meta: bool = True) -> str:
        """把 hub 的角色回复整理成发回群里的文本（自动过滤过程消息/隐私尾注）。"""
        name = reply.get("name") or "AI"
        text = clean_reply_text(reply.get("text") or "", strip_meta=strip_meta)
        if not text:
            return ""
        return "【%s】%s" % (name, text)

    @property
    def last_seen_id(self) -> int:
        return self._last_seen_id
