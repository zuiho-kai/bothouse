"""bothouse for JiuwenSwarm: every chat carries the bothouse role's persona file (persona + memory wiki section).

Source, the first that is there:
  - the persona file the bothouse bridge keeps for the role that runs JiuwenSwarm, i.e. the `acp` project whose
    command is jiuwenswarm-acp (bridge/core/acp_presets.json): <work_dir>/AGENTS.md (core/setup_wizard.go
    PersonaFilePath), in which the bridge keeps the memory wiki section between the <!-- conest:wiki --> marks
    (core/rolewiki.go WithWiki). It is the file a DSH member gets from `bothouse setup apply`;
  - the default role install.py makes on a machine with no such role (seed_role there): the same file, under
    <JiuwenSwarm data dir>/bothouse/roles/jiuwenswarm/.
This extension only reads the file.

Two ways in, picked on every request:
  - JiuwenSwarm patched (the repository's patches/jiuwenswarm/, applied by install.py): the text is copied to
    role.md next to this file and the patched RuntimePromptRail puts it into the system prompt. Nothing shows in
    the chat.
  - not patched (a workswarm version the patch was not made for): the text goes in front of the user's message
    (gateway:before_chat_request). JiuwenSwarm shows a rewritten message in the chat and keeps it in the session
    (gateway/message_handler/message_handler.py _publish_hook_params_update_if_changed), so this is the fallback.
"""
from __future__ import annotations

import logging
import os
import tomllib
from pathlib import Path
from typing import Any

import jiuwenswarm
from jiuwenswarm.extensions.hook_event import GatewayHookEvents

log = logging.getLogger("jiuwenswarm.gateway")
ROLE_FILE = Path(__file__).resolve().parent / "role.md"  # what the patched rail reads (patches/jiuwenswarm/)
# The patch's own function name: the target file has it = the patch is in.
PATCH_MARK = "_bothouse_role_section"
PATCH_TARGET = Path(jiuwenswarm.__file__).resolve().parent / "agents/harness/common/rails/runtime_prompt_rail.py"


def bothouse_config() -> Path | None:
    """The bridge's config.toml: $BOTHOUSE_DATA_DIR, else ~/.bothouse, else the old ~/.cc-connect."""
    dirs = [os.environ.get("BOTHOUSE_DATA_DIR"), Path.home() / ".bothouse", Path.home() / ".cc-connect"]
    for d in dirs:
        if d and (Path(d) / "config.toml").is_file():
            return Path(d) / "config.toml"
    return None


def seed_dir() -> Path:
    """Where install.py keeps the default role, laid out as a bothouse data directory: wiki/ (the wiki programs),
    roles/jiuwenswarm/AGENTS.md and roles/jiuwenswarm/wiki/. Inside JiuwenSwarm's data directory, not ~/.bothouse:
    making ~/.bothouse would turn a bridge still on ~/.cc-connect away from its data (bridge/brand.go dataDir)."""
    return Path(__file__).resolve().parent.parent.parent / "bothouse"


def seed_persona_file() -> Path:
    return seed_dir() / "roles" / "jiuwenswarm" / "AGENTS.md"


def bothouse_role_file() -> Path | None:
    """The persona file of the bothouse role that runs JiuwenSwarm (None = no such role)."""
    cfg = bothouse_config()
    if cfg is None:
        return None
    for project in tomllib.loads(cfg.read_text(encoding="utf-8")).get("projects", []):
        agent = project.get("agent") or {}
        opts = agent.get("options") or {}
        # the same test the bridge uses for a JiuwenSwarm command (core/acp_presets.go isJiuwenProc)
        if agent.get("type") == "acp" and "jiuwenswarm" in str(opts.get("cmd", "")).lower() and opts.get("work_dir"):
            return Path(opts["work_dir"]) / "AGENTS.md"
    return None


def role_persona_file() -> Path | None:
    """The persona file in use: the bothouse role's, else the default role's when install.py made one."""
    path = bothouse_role_file()
    if path is None and seed_persona_file().is_file():
        path = seed_persona_file()
    return path


def role_text() -> str:
    path = role_persona_file()
    if path is None or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8").strip()


def patched() -> bool:
    try:
        return PATCH_MARK in PATCH_TARGET.read_text(encoding="utf-8")
    except OSError:
        return False


def sync(text: str) -> None:
    """role.md = text ('' = no file)."""
    try:
        old = ROLE_FILE.read_text(encoding="utf-8")
    except OSError:
        old = None
    if not text:
        if old is not None:
            ROLE_FILE.unlink()
        return
    if old != text + "\n":
        tmp = ROLE_FILE.with_suffix(".tmp")
        tmp.write_text(text + "\n", encoding="utf-8")
        os.replace(tmp, ROLE_FILE)


async def before_chat(ctx: Any) -> None:
    try:
        text = role_text()
        if patched():
            sync(text)
            return
        sync("")
        query = ctx.params.get("query")
        if text and isinstance(query, str) and not query.startswith(text):
            ctx.params["query"] = text + "\n\n" + query
    except Exception as exc:  # noqa: BLE001 - a chat must go through whatever happens here
        log.warning("[bothouse] role text not added to this request: %s", exc)


async def register_extensions(registry: Any) -> None:
    registry.register(GatewayHookEvents.BEFORE_CHAT_REQUEST, before_chat)
    try:
        sync(role_text() if patched() else "")
    except Exception as exc:  # noqa: BLE001
        log.warning("[bothouse] role.md not written at start: %s", exc)
