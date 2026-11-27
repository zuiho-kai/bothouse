"""Feishu team workflow for JiuwenSwarm 0.2.9+ colleagues:
- Need analysis card with verbatim group quotes, shared memory rules, and acceptance criteria
- Dedicated Feishu topic/thread per task (work logs stay in topic; main group stays clean)
- Single in-place-updated progress card in the main group
- Stuck reminder in topic -> escalation to main group
- Delivery check against repeat-mistake rules
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

try:  # POSIX only; on Windows the lock degrades to no-op
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

from . import forum_memory

DEFAULT_STUCK_SECS = 600.0
WATCH_INTERVAL_SECS = 60.0  # 数据/实测：每分钟扫一次就够，卡住判定本身用 DEFAULT_STUCK_SECS（文章图 10 分钟）
_watchdog_lock = threading.Lock()
_watchdog_started = False
log = logging.getLogger(__name__)


def _tasks_dir() -> Path:
    return forum_memory.team_memory_root() / "tasks"


@contextmanager
def _task_lock():
    """Serialize stuck checks across colleagues/processes so one alert is sent once."""
    lock_path = _tasks_dir() / ".check.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as fh:
        if fcntl is None:
            yield
            return
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _watch_loop() -> None:
    while True:
        time.sleep(WATCH_INTERVAL_SECS)
        try:
            check_stuck_tasks()
        except Exception as exc:  # noqa: BLE001
            log.warning("[bothouse] stuck watchdog failed: %s", exc)


def ensure_watchdog() -> None:
    """Start one background stuck checker per process (the agent loop may be idle when a task stalls)."""
    global _watchdog_started
    with _watchdog_lock:
        if _watchdog_started:
            return
        threading.Thread(target=_watch_loop, name="bothouse-stuck-watchdog", daemon=True).start()
        _watchdog_started = True


def _task_path(task_id: str) -> Path:
    return _tasks_dir() / f"{task_id}.json"


def load_task(task_id: str) -> dict[str, Any] | None:
    p = _task_path(task_id)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save_task(task: dict[str, Any]) -> None:
    p = _task_path(str(task["task_id"]))
    forum_memory._atomic_write_text(p, json.dumps(task, ensure_ascii=False, indent=2) + "\n")


def _load_feishu_credentials(agent_id: str = "") -> tuple[str, str] | None:
    env_id = os.environ.get("FEISHU_APP_ID", "").strip()
    env_sec = os.environ.get("FEISHU_APP_SECRET", "").strip()
    if env_id and env_sec:
        return env_id, env_sec

    cfg_candidates: list[Path] = []
    try:
        from jiuwenswarm.common.utils import get_root_dir

        cfg_candidates.append(get_root_dir() / "config.yaml")
    except Exception:
        pass
    cfg_candidates.append(Path.home() / ".jiuwenswarm" / "config.yaml")

    for cfg_path in cfg_candidates:
        if not cfg_path.is_file():
            continue
        try:
            import yaml

            cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        channels = cfg.get("channels") or {}
        ordinary = (channels.get("feishu") or {}).get("apps") or []
        enterprise = (channels.get("feishu_enterprise") or {}).values()
        entries = [e for e in [*ordinary, *enterprise] if isinstance(e, dict) and e.get("enabled", True)]
        if agent_id:
            matched = [e for e in entries if e.get("persistent_agent_id") == agent_id]
            if matched:
                entries = matched
        for entry in entries:
            aid = str(entry.get("app_id", "")).strip()
            sec = str(entry.get("app_secret", "")).strip()
            if aid and sec:
                return aid, sec
    return None


class FeishuClient:
    """Minimal Feishu OpenAPI client (supports FEISHU_API_BASE override for isolated mock testing)."""

    _token_cache: dict[str, tuple[str, float]] = {}

    def __init__(self, *, app_id: str = "", app_secret: str = "", agent_id: str = "") -> None:
        self.base_url = (os.environ.get("FEISHU_API_BASE") or "https://open.feishu.cn/open-apis").rstrip("/")
        if app_id and app_secret:
            self.creds: tuple[str, str] | None = (app_id, app_secret)
        else:
            self.creds = _load_feishu_credentials(agent_id=agent_id)

    @property
    def configured(self) -> bool:
        return self.creds is not None

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, token: str = "") -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Feishu HTTP {exc.code}: {body}") from exc

    def _tenant_token(self) -> str:
        if not self.creds:
            raise RuntimeError("Feishu credentials not configured")
        app_id, app_secret = self.creds
        cached = self._token_cache.get(app_id)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        res = self._request(
            "POST",
            "/auth/v3/tenant_access_token/internal",
            {"app_id": app_id, "app_secret": app_secret},
        )
        token = str(res.get("tenant_access_token") or "")
        if not token:
            raise RuntimeError(f"Failed to obtain tenant_access_token: {res}")
        expire = float(res.get("expire", 7200))
        self._token_cache[app_id] = (token, time.time() + expire)
        return token

    def send_message(self, chat_id: str, msg_type: str, content: dict[str, Any]) -> dict[str, Any]:
        token = self._tenant_token()
        res = self._request(
            "POST",
            "/im/v1/messages?receive_id_type=chat_id",
            {
                "receive_id": chat_id,
                "msg_type": msg_type,
                "content": json.dumps(content, ensure_ascii=False),
                "uuid": str(uuid.uuid4()),
            },
            token=token,
        )
        return (res.get("data") or {}) if isinstance(res, dict) else {}

    def reply_message(
        self,
        message_id: str,
        msg_type: str,
        content: dict[str, Any],
        *,
        reply_in_thread: bool = False,
    ) -> dict[str, Any]:
        token = self._tenant_token()
        res = self._request(
            "POST",
            f"/im/v1/messages/{message_id}/reply",
            {
                "msg_type": msg_type,
                "content": json.dumps(content, ensure_ascii=False),
                "reply_in_thread": reply_in_thread,
                "uuid": str(uuid.uuid4()),
            },
            token=token,
        )
        return (res.get("data") or {}) if isinstance(res, dict) else {}

    def patch_card(self, message_id: str, card: dict[str, Any]) -> dict[str, Any]:
        token = self._tenant_token()
        res = self._request(
            "PATCH",
            f"/im/v1/messages/{message_id}",
            {"content": json.dumps(card, ensure_ascii=False)},
            token=token,
        )
        return res if isinstance(res, dict) else {}


def _deliver_or_preview(
    client: FeishuClient,
    *,
    task_id: str,
    kind: str,
    chat_id: str,
    msg_type: str,
    content: dict[str, Any],
    reply_to: str = "",
    reply_in_thread: bool = False,
    patch_message_id: str = "",
) -> tuple[str, bool]:
    """Send via Feishu OpenAPI if configured, else record locally for preview/mock."""
    if client.configured and chat_id:
        if patch_message_id:
            client.patch_card(patch_message_id, content)
            return patch_message_id, True
        if reply_to:
            data = client.reply_message(reply_to, msg_type, content, reply_in_thread=reply_in_thread)
        else:
            data = client.send_message(chat_id, msg_type, content)
        return str(data.get("message_id") or f"msg_{uuid.uuid4().hex[:10]}"), True

    msg_id = patch_message_id or f"local_{uuid.uuid4().hex[:10]}"
    outbox = _tasks_dir() / f"{task_id}.outbox.jsonl"
    forum_memory._append_jsonl(
        outbox,
        {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "kind": kind,
            "chat_id": chat_id,
            "reply_to": reply_to,
            "reply_in_thread": reply_in_thread,
            "patch_message_id": patch_message_id,
            "message_id": msg_id,
            "msg_type": msg_type,
            "content": content,
        },
    )
    return msg_id, False


def build_need_card(task: dict[str, Any]) -> dict[str, Any]:
    """Build Feishu Interactive Card for 需求分析卡 (v36-04)."""
    quotes_lines = [
        f"• **{q.get('speaker', '成员')}**：{q.get('text', '')}"
        for q in (task.get("user_quotes") or [])
    ] or ["• （暂无群聊原话）"]

    mem_lines = [
        f"• **{r['title']}**：{r['rule']}"
        for r in (task.get("memory_rules") or [])
    ] or ["• （记忆论坛暂无命中历史规则）"]

    criteria_lines = [
        f"{idx}. {item}" for idx, item in enumerate(task.get("acceptance_criteria") or [], 1)
    ] or ["1. 完成核心功能并通过验收"]

    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "template": "blue",
            "title": {"tag": "plain_text", "content": f"📋 需求分析 · {task.get('title', '')}"},
        },
        "elements": [
            {"tag": "markdown", "content": "**一、原话（已带进任务，后面每一步都对照它）**\n" + "\n".join(quotes_lines)},
            {"tag": "hr"},
            {"tag": "markdown", "content": "**二、以前定过的（团队项目记忆）**\n" + "\n".join(mem_lines)},
            {"tag": "hr"},
            {"tag": "markdown", "content": "**三、验收标准**\n" + "\n".join(criteria_lines)},
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {
                        "tag": "plain_text",
                        "content": "回复「开工」确认，或直接说要改哪里",
                    }
                ],
            },
            {
                "tag": "note",
                "elements": [
                    {
                        "tag": "plain_text",
                        "content": "bothouse · 基于 openJiuwen 开发",
                    }
                ],
            },
        ],
    }


def build_progress_card(task: dict[str, Any]) -> dict[str, Any]:
    """Build Feishu Interactive Card for main-group Progress Card (v36-01 left)."""
    status = task.get("status", "in_progress")
    template = {"completed": "green", "stuck": "orange"}.get(status, "turquoise")
    icon_map = {"done": "✅", "in_progress": "🔄", "pending": "⏳", "blocked": "⚠️"}
    lines: list[str] = []
    for sub in task.get("subtasks") or []:
        ic = icon_map.get(sub.get("status", "pending"), "⏳")
        owner = f"（{sub['owner']}）" if sub.get("owner") else ""
        note = f" — {sub['note']}" if sub.get("note") else ""
        lines.append(f"{ic} **{sub.get('id', '')}. {sub.get('name', '')}**{owner}{note}")
    if not lines:
        lines.append("🔄 执行中…")
    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "template": template,
            "title": {"tag": "plain_text", "content": f"📌 进度卡：{task.get('title', '')}"},
        },
        "elements": [
            {"tag": "markdown", "content": "\n".join(lines)},
            {"tag": "note", "elements": [{"tag": "plain_text", "content": "Agent 干活来回在任务话题内更新 · 主群不刷屏"}]},
        ],
    }


def latest_pending_task(chat_id: str) -> dict[str, Any] | None:
    """The most recent need card still waiting for a text confirmation in this chat."""
    tdir = _tasks_dir()
    if not chat_id or not tdir.is_dir():
        return None
    pending: list[tuple[Path, dict[str, Any]]] = []
    for p in tdir.glob("*.json"):
        task = load_task(p.stem)
        if task and task.get("status") == "pending_approval" and str(task.get("chat_id")) == chat_id:
            pending.append((p, task))
    if not pending:
        return None
    newest = max(pending, key=lambda item: item[0].stat().st_mtime)
    return newest[1]


def create_need_card(
    *,
    chat_id: str,
    title: str,
    user_quotes: list[dict[str, str]],
    acceptance_criteria: list[str],
    query: str = "",
    reply_to_message_id: str = "",
    dispatcher: str = "",
    agent_id: str = "",
) -> dict[str, Any]:
    """Search shared memory forum for past rules, build 需求分析卡, and post it to Feishu."""
    search_q = " ".join(
        [query, title, *(q.get("text", "") for q in user_quotes)]
    ).strip()
    threads = forum_memory.search_forum(search_q, limit=4)
    memory_rules = [
        {
            "cid": th["top_cid"],
            "title": th["title"],
            "rule": th["top_rule"],
            "score": th["score"],
            "page": th["page"],
        }
        for th in threads
    ]
    if memory_rules:
        forum_memory.cite_rules(
            [f"{r['page']}#{r['cid']}" for r in memory_rules],
            voter=agent_id or "team",
            session_id=chat_id,
        )

    task_id = f"task_{uuid.uuid4().hex[:8]}"
    task: dict[str, Any] = {
        "task_id": task_id,
        "title": title,
        "chat_id": chat_id,
        "dispatcher": dispatcher,
        "user_quotes": user_quotes,
        "memory_rules": memory_rules,
        "acceptance_criteria": acceptance_criteria,
        "subtasks": [],
        "status": "pending_approval",
        "need_card_message_id": "",
        "topic_root_id": "",
        "progress_message_id": "",
        "last_progress_at": time.time(),
        "stuck_stage": 0,
        "topic_log": [],
    }
    card = build_need_card(task)
    client = FeishuClient(agent_id=agent_id)
    msg_id, delivered = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="need_card",
        chat_id=chat_id,
        msg_type="interactive",
        content=card,
        reply_to=reply_to_message_id,
        reply_in_thread=False,
    )
    task["need_card_message_id"] = msg_id
    save_task(task)
    return {
        "success": True,
        "task_id": task_id,
        "message_id": msg_id,
        "delivered_to_feishu": delivered,
        "memory_rules_count": len(memory_rules),
        "memory_rules": memory_rules,
    }


def start_topic_task(
    *,
    task_id: str,
    subtasks: list[dict[str, str]] | None = None,
    chat_id: str = "",
    title: str = "",
    agent_id: str = "",
) -> dict[str, Any]:
    """Start task: open a dedicated Feishu topic and post one main-group Progress Card."""
    ensure_watchdog()
    task = load_task(task_id) if task_id else None
    if task is None and not task_id and chat_id:
        task = latest_pending_task(chat_id)
        if task is not None:
            task_id = str(task["task_id"])
    if task is None:
        task_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        task = {
            "task_id": task_id,
            "title": title or "新任务",
            "chat_id": chat_id,
            "dispatcher": "",
            "user_quotes": [],
            "memory_rules": [],
            "acceptance_criteria": [],
            "subtasks": [],
            "status": "in_progress",
            "need_card_message_id": "",
            "topic_root_id": "",
            "progress_message_id": "",
            "last_progress_at": time.time(),
            "stuck_stage": 0,
            "topic_log": [],
        }
    if subtasks:
        task["subtasks"] = [
            {
                "id": str(s.get("id") or idx),
                "name": str(s.get("name", "")),
                "owner": str(s.get("owner", "")),
                "status": str(s.get("status") or "pending"),
                "note": str(s.get("note", "")),
            }
            for idx, s in enumerate(subtasks, 1)
        ]
    task["status"] = "in_progress"
    task["last_progress_at"] = time.time()
    task["stuck_stage"] = 0

    cid = str(task.get("chat_id") or chat_id)
    client = FeishuClient(agent_id=agent_id)

    # 1. Topic root message in main group -> all work logs go into this topic (reply_in_thread=True)
    topic_root_id, delivered = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="topic_root",
        chat_id=cid,
        msg_type="text",
        content={"text": f"🧵 任务话题：{task['title']}（干活过程与日志请在话题内查看）"},
    )
    task["topic_root_id"] = topic_root_id

    # 2. Kickoff details inside the topic
    _deliver_or_preview(
        client,
        task_id=task_id,
        kind="topic_kickoff",
        chat_id=cid,
        msg_type="text",
        content={"text": f"已开工：{task['title']}，验收标准共 {len(task.get('acceptance_criteria') or [])} 条。"},
        reply_to=topic_root_id,
        reply_in_thread=True,
    )

    # 3. Single Progress Card in main group (updated in-place via PATCH)
    prog_msg_id, _ = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="progress_card",
        chat_id=cid,
        msg_type="interactive",
        content=build_progress_card(task),
    )
    task["progress_message_id"] = prog_msg_id
    save_task(task)
    return {
        "success": True,
        "task_id": task_id,
        "topic_root_id": topic_root_id,
        "progress_message_id": prog_msg_id,
        "delivered_to_feishu": delivered,
    }


def update_progress(
    *,
    task_id: str,
    subtask_id: str,
    status: str,
    note: str = "",
    agent_id: str = "",
) -> dict[str, Any]:
    """Update one subtask and PATCH the existing main-group Progress Card in-place."""
    task = load_task(task_id)
    if task is None:
        return {"success": False, "error": f"task not found: {task_id}"}
    found = False
    for sub in task.get("subtasks") or []:
        if str(sub.get("id")) == str(subtask_id):
            sub["status"] = status
            if note:
                sub["note"] = note
            found = True
            break
    if not found:
        task.setdefault("subtasks", []).append(
            {"id": str(subtask_id), "name": note or f"子任务 {subtask_id}", "owner": agent_id, "status": status, "note": ""}
        )
    task["last_progress_at"] = time.time()
    task["stuck_stage"] = 0
    if task.get("status") == "stuck":
        task["status"] = "in_progress"

    client = FeishuClient(agent_id=agent_id)
    prog_id, delivered = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="progress_patch",
        chat_id=str(task.get("chat_id", "")),
        msg_type="interactive",
        content=build_progress_card(task),
        patch_message_id=str(task.get("progress_message_id", "")),
    )
    save_task(task)
    return {"success": True, "task_id": task_id, "progress_message_id": prog_id, "delivered_to_feishu": delivered}


def post_topic_log(*, task_id: str, actor: str, text: str, agent_id: str = "") -> dict[str, Any]:
    """Post agent work chatter/logs into the task's Feishu topic (never in main group)."""
    task = load_task(task_id)
    if task is None:
        return {"success": False, "error": f"task not found: {task_id}"}
    topic_root_id = str(task.get("topic_root_id") or "")
    if not topic_root_id:
        return {"success": False, "error": "task has no topic_root_id yet"}
    client = FeishuClient(agent_id=agent_id)
    msg_id, delivered = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="topic_log",
        chat_id=str(task.get("chat_id", "")),
        msg_type="text",
        content={"text": f"【{actor}】{text}"},
        reply_to=topic_root_id,
        reply_in_thread=True,
    )
    task.setdefault("topic_log", []).append({"ts": time.time(), "actor": actor, "text": text})
    task["last_progress_at"] = time.time()
    task["stuck_stage"] = 0
    save_task(task)
    return {"success": True, "task_id": task_id, "message_id": msg_id, "topic_root_id": topic_root_id, "delivered_to_feishu": delivered}


def ask_main_group(*, task_id: str, question: str, agent_id: str = "") -> dict[str, Any]:
    """Ask human for approval (e.g. scope reduction / merge) back in the main group."""
    task = load_task(task_id)
    if task is None:
        return {"success": False, "error": f"task not found: {task_id}"}
    dispatcher = task.get("dispatcher") or "派活人"
    client = FeishuClient(agent_id=agent_id)
    msg_id, delivered = _deliver_or_preview(
        client,
        task_id=task_id,
        kind="ask_main_group",
        chat_id=str(task.get("chat_id", "")),
        msg_type="text",
        content={"text": f"📣 @{dispatcher} 需要拍板（{task.get('title', task_id)}）：{question}"},
    )
    return {"success": True, "task_id": task_id, "message_id": msg_id, "delivered_to_feishu": delivered}


def check_stuck_tasks(*, threshold_secs: float | None = None, agent_id: str = "") -> dict[str, Any]:
    """Check in-progress tasks: 10min idle -> remind in topic; 20min idle -> escalate to main group."""
    tdir = _tasks_dir()
    if not tdir.is_dir():
        return {"checked": 0, "alerts": []}
    with _task_lock():
        return _check_stuck_locked(threshold_secs=threshold_secs, agent_id=agent_id)


def _check_stuck_locked(*, threshold_secs: float | None = None, agent_id: str = "") -> dict[str, Any]:
    thresh = threshold_secs if threshold_secs is not None else float(os.environ.get("BOTHOUSE_STUCK_SECS", DEFAULT_STUCK_SECS))
    tdir = _tasks_dir()

    now = time.time()
    alerts: list[dict[str, Any]] = []
    client = FeishuClient(agent_id=agent_id)
    checked = 0
    for p in sorted(tdir.glob("*.json")):
        task = load_task(p.stem)
        if not task or task.get("status") not in {"in_progress", "stuck"}:
            continue
        checked += 1
        idle = now - float(task.get("last_progress_at") or now)
        stage = int(task.get("stuck_stage") or 0)
        if stage == 0 and idle >= thresh and task.get("topic_root_id"):
            mins = max(1, int(idle // 60))
            _deliver_or_preview(
                client,
                task_id=task["task_id"],
                kind="stuck_topic_alert",
                chat_id=str(task.get("chat_id", "")),
                msg_type="text",
                content={"text": f"⏰ 提醒：本任务已 {mins} 分钟无进展，请同步当前状态或说明卡点。"},
                reply_to=str(task["topic_root_id"]),
                reply_in_thread=True,
            )
            task["stuck_stage"] = 1
            task["status"] = "stuck"
            save_task(task)
            alerts.append({"task_id": task["task_id"], "level": "topic"})
        elif stage == 1 and idle >= thresh * 2:
            dispatcher = task.get("dispatcher") or "派活人"
            _deliver_or_preview(
                client,
                task_id=task["task_id"],
                kind="stuck_main_escalation",
                chat_id=str(task.get("chat_id", "")),
                msg_type="text",
                content={"text": f"⚠️ 卡住提醒：@{dispatcher} 任务「{task.get('title', task['task_id'])}」话题内提醒后仍无进展，请介入处理。"},
            )
            task["stuck_stage"] = 2
            task["status"] = "stuck"
            save_task(task)
            alerts.append({"task_id": task["task_id"], "level": "main_group"})
    return {"checked": checked, "alerts": alerts}


def complete_task(*, task_id: str, summary: str, evidence: str = "", agent_id: str = "") -> dict[str, Any]:
    """Run repeat-mistake checks before delivery; reject if violated, else mark completed."""
    task = load_task(task_id)
    if task is None:
        return {"success": False, "error": f"task not found: {task_id}"}
    chk = forum_memory.check_delivery_rules(summary, evidence=evidence)
    if not chk["passed"]:
        if task.get("topic_root_id"):
            _deliver_or_preview(
                FeishuClient(agent_id=agent_id),
                task_id=task_id,
                kind="delivery_rejected",
                chat_id=str(task.get("chat_id", "")),
                msg_type="text",
                content={"text": f"🚫 交回退回：命中重复犯错检查 — {chk['violations']}"},
                reply_to=str(task["topic_root_id"]),
                reply_in_thread=True,
            )
        return {"success": False, "rejected": True, "violations": chk["violations"]}

    task["status"] = "completed"
    for sub in task.get("subtasks") or []:
        if sub.get("status") in {"pending", "in_progress"}:
            sub["status"] = "done"
    task["last_progress_at"] = time.time()
    client = FeishuClient(agent_id=agent_id)
    if task.get("progress_message_id"):
        _deliver_or_preview(
            client,
            task_id=task_id,
            kind="progress_complete",
            chat_id=str(task.get("chat_id", "")),
            msg_type="interactive",
            content=build_progress_card(task),
            patch_message_id=str(task["progress_message_id"]),
        )
    if task.get("topic_root_id"):
        _deliver_or_preview(
            client,
            task_id=task_id,
            kind="topic_complete",
            chat_id=str(task.get("chat_id", "")),
            msg_type="text",
            content={"text": f"✅ 任务完成交回：{summary}"},
            reply_to=str(task["topic_root_id"]),
            reply_in_thread=True,
        )
    save_task(task)
    return {"success": True, "task_id": task_id, "status": "completed"}
