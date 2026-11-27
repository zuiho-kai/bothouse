"""bothouse for JiuwenSwarm 0.2.9+:
1. Injects the bothouse role's persona and wiki section as a system prompt section.
2. Searches the shared team memory forum per query and injects top rules into the system prompt.
3. Checks in-progress tasks for stuck reminders during task iterations.
"""
from __future__ import annotations

import logging
import os
import tomllib
from pathlib import Path
from typing import Any

from openjiuwen.core.single_agent.prompts.builder import PromptSection
from openjiuwen.harness.rails.base import DeepAgentRail

from ..common import feishu_workflow, forum_memory

log = logging.getLogger(__name__)
SECTION = "bothouse.role"
MEMORY_SECTION = "bothouse.team_memory"
PRIORITY = 102
MEMORY_PRIORITY = 103


def bothouse_config() -> Path | None:
    """The bridge's config.toml: $BOTHOUSE_DATA_DIR, else ~/.bothouse, else the old ~/.cc-connect."""
    for d in (os.environ.get("BOTHOUSE_DATA_DIR"), Path.home() / ".bothouse", Path.home() / ".cc-connect"):
        if d and (Path(d) / "config.toml").is_file():
            return Path(d) / "config.toml"
    return None


def bothouse_role_file() -> Path | None:
    """The persona file of the bothouse role that runs JiuwenSwarm (None = no such role)."""
    cfg = bothouse_config()
    if cfg is None:
        return None
    for project in tomllib.loads(cfg.read_text(encoding="utf-8")).get("projects", []):
        agent = project.get("agent") or {}
        opts = agent.get("options") or {}
        if agent.get("type") == "acp" and "jiuwenswarm" in str(opts.get("cmd", "")).lower() and opts.get("work_dir"):
            return Path(opts["work_dir"]) / "AGENTS.md"
    return None


def seed_persona_file() -> Path:
    from jiuwenswarm.common.utils import get_root_dir

    return get_root_dir() / "bothouse" / "roles" / "jiuwenswarm" / "AGENTS.md"


def role_text() -> str:
    path = bothouse_role_file()
    if path is None or not path.is_file():
        path = seed_persona_file()
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _extract_last_query(ctx: Any) -> str:
    inputs = getattr(ctx, "inputs", None)
    messages = getattr(inputs, "messages", None) or []
    for msg in reversed(messages):
        role = getattr(msg, "role", None) if not isinstance(msg, dict) else msg.get("role")
        if role == "user":
            content = getattr(msg, "content", None) if not isinstance(msg, dict) else msg.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return ""


class BothouseRoleRail(DeepAgentRail):
    """Before each model call: inject persona + shared team memory forum hits; check stuck tasks on iteration."""

    def __init__(self) -> None:
        super().__init__()
        self._agent: Any | None = None

    def init(self, agent: Any) -> None:
        self._agent = agent

    def uninit(self, agent: Any) -> None:
        builder = getattr(self._agent, "system_prompt_builder", None)
        if builder is not None:
            builder.remove_section(SECTION)
            builder.remove_section(MEMORY_SECTION)
        self._agent = None

    async def before_model_call(self, ctx: Any) -> None:
        builder = getattr(self._agent, "system_prompt_builder", None)
        if builder is None:
            return
        try:
            text = role_text()
        except Exception as exc:  # noqa: BLE001
            log.warning("[bothouse] role text not read: %s", exc)
            text = ""
        if not text:
            builder.remove_section(SECTION)
        else:
            builder.add_section(PromptSection(name=SECTION, content={"cn": text, "en": text}, priority=PRIORITY))

        try:
            query = _extract_last_query(ctx)
            hits = forum_memory.search_forum(query, limit=3) if query else []
        except Exception as exc:  # noqa: BLE001
            log.warning("[bothouse] team memory search failed: %s", exc)
            hits = []

        if hits:
            lines = ["## 团队共享记忆论坛（命中高分规则）"]
            for th in hits:
                lines.append(f"- `[#{th['top_cid']}]` {th['title']}：{th['top_rule']}（分 {th['score']}）")
            mem_text = "\n".join(lines)
            builder.add_section(
                PromptSection(name=MEMORY_SECTION, content={"cn": mem_text, "en": mem_text}, priority=MEMORY_PRIORITY)
            )
        else:
            builder.remove_section(MEMORY_SECTION)

    async def after_task_iteration(self, ctx: Any) -> None:
        try:
            feishu_workflow.check_stuck_tasks()
        except Exception as exc:  # noqa: BLE001
            log.warning("[bothouse] stuck check failed: %s", exc)
