"""bothouse for JiuwenSwarm 0.2.9+: the bothouse role's persona file (persona + memory wiki section) as a
system prompt section, through JiuwenSwarm's own plugin rails (no patch to JiuwenSwarm).

Where the text comes from, the first that is there (the same order as extension/extension.py, the 0.2.8 way):
  - the persona file the bothouse bridge keeps for the role that runs JiuwenSwarm, i.e. the `acp` project whose
    command runs jiuwenswarm (bridge/core/acp_presets.go isJiuwenProc): <work_dir>/AGENTS.md, with the memory wiki
    section between the <!-- conest:wiki --> marks (bridge/core/rolewiki.go WithWiki);
  - the default role install.py makes on a machine with no such role: <JiuwenSwarm data dir>/bothouse/roles/
    jiuwenswarm/AGENTS.md.
The file is read on every model call, so an edit shows from the next call on. This rail only reads it.

Mounted where JiuwenSwarm mounts plugin rails: a chat whose plugin selection has "bothouse", and a JiuwenMate
colleague (Web, Feishu) whose capabilities.plugins has "bothouse" (server/jiuwenmate/resource_assembly.py).
"""
from __future__ import annotations

import logging
import os
import tomllib
from pathlib import Path
from typing import Any

from openjiuwen.core.single_agent.prompts.builder import PromptSection
from openjiuwen.harness.rails.base import DeepAgentRail

log = logging.getLogger(__name__)
SECTION = "bothouse.role"
# after JiuwenSwarm's own identity section, as the 0.2.8 patch put it
# (jiuwenswarm/agents/harness/common/prompt/priority_registry.py SystemPromptPriority.CONTEXT_SOUL)
PRIORITY = 102


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


class BothouseRoleRail(DeepAgentRail):
    """Before each model call: the bothouse role's persona and memory wiki section go into the system prompt."""

    def __init__(self) -> None:
        super().__init__()
        self._agent: Any | None = None

    def init(self, agent: Any) -> None:
        self._agent = agent

    def uninit(self, agent: Any) -> None:
        builder = getattr(self._agent, "system_prompt_builder", None)
        if builder is not None:
            builder.remove_section(SECTION)
        self._agent = None

    async def before_model_call(self, ctx: Any) -> None:
        builder = getattr(self._agent, "system_prompt_builder", None)
        if builder is None:
            return
        try:
            text = role_text()
        except Exception as exc:  # noqa: BLE001 - a model call must go through whatever happens here
            log.warning("[bothouse] role text not read: %s", exc)
            text = ""
        if not text:
            builder.remove_section(SECTION)
            return
        builder.add_section(PromptSection(name=SECTION, content={"cn": text, "en": text}, priority=PRIORITY))
