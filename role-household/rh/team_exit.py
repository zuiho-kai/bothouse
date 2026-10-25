"""工作区的统一出口（#597 G1b）：工作区里 bot 回复第一行是 [ask] / [report] 时转到主聊天频道（system 帖，不叫醒聊天频道的 bot），
用户在聊天频道带编号回 [ask]，答案以用户身份贴回工作区并 @ 提问的 bot。
照 conest bridge/core/dsh_bundle/collab/team-exit.mjs（DSH 网关的出口）；cloud_web 的出口归网关（bridge/platform/cloud-web/protocol.go
claim 注释），桥在 cloud_web 上不转，不会重复。和 DSH 的差别：
- rh 消息没有 reply_to，只认正文里的编号 ask-xxxxxxxx，所以转发帖写明「回复时带上编号」。
- 归属只认 Hub.workspace_owner：空闲（已放回池里）的工作区不再往旧聊天频道转，旧编号的回答也不再送回。
- rh 没有任务表：不暂停任务；退回时直接给提问的 bot 发一帧 mentioned=true 的消息叫醒它（CloudWeb.nudge，同 cloudweb.mjs nudge）。"""
from __future__ import annotations

import re
import secrets

# #574 B4：[ask] 要带「自验：」和「类别：」才去等用户；只有方向、花钱、需要用户看的成品、权限确认可写「自验：无需」。
# 同 team-exit.mjs、bridge/core/team_ask_evidence.go askEvidenceProblems。
SELF_CHECK = re.compile(r"自验\s*[：:]")
CATEGORY = re.compile(r"类别\s*[：:]")
EXEMPT = re.compile(r"方向|花钱|成品|权限")
NO_CHECK = re.compile(r"^(无需|不需要|无|免)([\s，。,.;；（(]|$)")
ASK_MISSING_SELF_CHECK = "缺「自验：」（附证据：截图或命令输出）"
ASK_MISSING_CATEGORY = "缺「类别：」（方向、花钱、需要用户看的成品、权限确认之一，或写别的类别）"
ASK_NO_CHECK_NOT_EXEMPT = "「自验：无需」只限方向、花钱、需要用户看的成品、权限确认四类，其它类别要附证据"
BOUNCE_WAKE_LIMIT = 2   # 连续退回几次还叫醒提问的 bot，再多只贴不叫。来源：team-exit.mjs、team_ask_evidence.go askBounceWakeLimit
MARK = re.compile(r"^\[(ask|report)\][ \t]*\n?([\s\S]*\S[\s\S]*)$", re.I)   # 同 team-exit.mjs:97
TOKEN = re.compile(r"\bask-[0-9a-f]{8}\b")
ANSWER_KEY = re.compile(r"^team-answer:([^:]+):")

SCHEMA = """CREATE TABLE IF NOT EXISTS team_exit_asks (
  id TEXT PRIMARY KEY, parent_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
  member_id TEXT NOT NULL, forwarded_id INTEGER UNIQUE, source_id INTEGER UNIQUE,
  answer_source_id INTEGER UNIQUE, answered INTEGER NOT NULL DEFAULT 0)"""


def exit_target(msg: dict) -> str | None:
    """贴回工作区的答案只给提问的那个 bot（client_key team-answer:<bot>:<编号>）。"""
    m = ANSWER_KEY.match(msg.get("client_key") or "")
    return m.group(1) if m else None


def ask_evidence_problems(body: str) -> list[str]:
    """[ask] 正文缺什么；[] = 可以去问用户。"""
    cat = CATEGORY.search(body)
    category = body[cat.end():].split("\n")[0].strip() if cat else ""
    check = ""
    own = SELF_CHECK.search(body)
    if own:
        rest = body[own.end():]
        nxt = CATEGORY.search(rest)
        check = (rest[:nxt.start()] if nxt else rest).strip()
    problems = []
    if not check:
        problems.append(ASK_MISSING_SELF_CHECK)
    if not category:
        problems.append(ASK_MISSING_CATEGORY)
    if check and category and NO_CHECK.search(check) and not EXEMPT.search(category):
        problems.append(ASK_NO_CHECK_NOT_EXEMPT)
    return problems


def ask_bounce_text(problems: list[str]) -> str:
    return (f"这条 [ask] 没有转给用户：{'；'.join(problems)}。补上后重发：第一行只写 [ask]，正文写「自验：」附证据和「类别：」；"
            "方向、花钱、需要用户看的成品、权限确认四类可写「自验：无需」。")


class TeamExit:
    def __init__(self, hub, cw):
        self.hub, self.cw, self.db = hub, cw, hub.db
        with self.db:
            self.db.execute(SCHEMA)
        self.bounces: dict[str, int] = {}   # "<工作区>:<bot>" -> 连续退回次数

    def _ask(self, sql: str, args: tuple) -> dict | None:
        r = self.db.execute(sql, args).fetchone()
        return dict(r) if r else None

    def answer_for(self, msg: dict) -> dict | None:
        """这条用户消息是不是在回某个 [ask]（正文带编号、在提问时的聊天频道里、工作区还归它）。"""
        if msg.get("author_kind") != "user" or exit_target(msg):
            return None
        prior = self._ask("SELECT * FROM team_exit_asks WHERE answer_source_id=?", (msg["id"],))
        if prior:
            return prior
        token = TOKEN.search(msg.get("text") or "")
        if not token:
            return None
        ask = self._ask("SELECT * FROM team_exit_asks WHERE parent_id=? AND answered=0 AND id=?",
                        (msg["room_id"], token.group(0)))
        if ask is None or self.hub.workspace_owner(ask["workspace_id"]) != ask["parent_id"]:
            return None   # 工作区已放回或换了主：按普通消息走
        return ask

    async def _post(self, room_id: int, body: dict) -> dict:
        msg, new = self.hub.create(room_id, body)
        if new:
            await self.hub.broadcast({"type": "message", "message": msg}, room_id)
            await self.hub.notify_new(msg)
        return msg

    async def on_new(self, msg: dict) -> None:
        answer = self.answer_for(msg)
        if answer:
            if answer["answered"]:
                return
            # 以用户身份贴进工作区、@ 提问的 bot；client_key 稳定，重试不重复贴
            await self._post(answer["workspace_id"], {
                "author_kind": "user", "text": f"@{answer['member_id']} 用户回复 {answer['id']}：\n{msg['text']}",
                "client_key": f"team-answer:{answer['member_id']}:{answer['id']}"})
            with self.db:
                self.db.execute("UPDATE team_exit_asks SET answered=1, answer_source_id=? WHERE id=?",
                                (msg["id"], answer["id"]))
            return
        if msg.get("author_kind") != "role":
            return
        mark = MARK.match(msg["text"].strip()) if msg.get("card") is None else None
        parent = self.hub.workspace_owner(msg["room_id"])
        if parent is None or parent == msg["room_id"]:
            return
        room = self.hub.room(msg["room_id"])
        ask = bool(mark) and mark.group(1).lower() == "ask"
        key = f"{room['id']}:{msg['author']}"
        if ask:
            problems = ask_evidence_problems(mark.group(2))
            if problems:
                return await self._bounce(room, msg, problems)
        self.bounces.pop(key, None)   # 没被退回的回复结束连续退回
        if not mark:
            return
        record = None
        if ask:
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO team_exit_asks(id, parent_id, workspace_id, member_id, source_id) "
                                "VALUES(?,?,?,?,?)", (f"ask-{secrets.token_hex(4)}", parent, room["id"], msg["author"],
                                                      msg["id"]))
            record = self._ask("SELECT * FROM team_exit_asks WHERE source_id=?", (msg["id"],))
            head = f"📬 来自 {room['name']} · {msg['name']} · {record['id']}（回复时带上编号 {record['id']}）"
        else:
            head = f"📬 来自 {room['name']} · {msg['name']} · 阶段结果"
        fwd = await self._post(parent, {"author_kind": "system", "text": f"{head}\n{mark.group(2)}",
                                        "client_key": f"team-exit:{msg['id']}"})
        if record is not None:
            with self.db:
                self.db.execute("UPDATE team_exit_asks SET forwarded_id=? WHERE id=?", (fwd["id"], record["id"]))

    async def _bounce(self, room: dict, msg: dict, problems: list[str]) -> None:
        """在工作区贴出为什么没转，并叫醒提问的 bot 去补（不叫醒它会以为已经问了用户，干等）。"""
        key = f"{room['id']}:{msg['author']}"
        count = self.bounces[key] = self.bounces.get(key, 0) + 1
        notice = await self._post(room["id"], {"author_kind": "system",
                                               "text": f"📬 @{msg['name']} {ask_bounce_text(problems)}",
                                               "client_key": f"team-exit-bounce:{msg['id']}"})
        if count <= BOUNCE_WAKE_LIMIT:
            await self.cw.nudge(msg["author"], notice)
