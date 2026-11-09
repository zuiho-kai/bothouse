#!/usr/bin/env python3 -I
"""Run one wiki pass with the Claude Agent SDK when an API engine is explicitly configured.

The caller supplies the model, working directory and settings over stdin. The API key must be present in
ANTHROPIC_API_KEY; no credential file path or account is assumed.
"""
import asyncio, json, os, sys

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query


async def main():
    job = json.loads(sys.stdin.read())
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    env = {"ANTHROPIC_API_KEY": api_key, "WIKI_INGEST": "1",
           "CLAUDE_CODE_OAUTH_TOKEN": "", "ANTHROPIC_AUTH_TOKEN": "", "ANTHROPIC_BASE_URL": ""}
    system = {"type": "preset", "preset": "claude_code"}
    if job.get("system_append"):
        system["append"] = job["system_append"]
    opts = ClaudeAgentOptions(
        model=job["model"], cwd=job["cwd"], env=env, system_prompt=system,
        tools=["Read", "Edit", "Write", "Glob", "Grep", "Bash"], permission_mode="acceptEdits",
        settings=json.dumps(job["settings"]), strict_mcp_config=True, setting_sources=[],
        extra_args={"no-session-persistence": None})
    prompt = job["instruction"] + ("\n\n" + job["stdin"] if job.get("stdin") else "")
    result = None
    async for message in query(prompt=prompt, options=opts):
        if isinstance(message, ResultMessage):
            result = message
    if result is None:
        print(json.dumps({"result": "Agent SDK: no result", "is_error": True}))
        return 1
    print(json.dumps({"result": result.result or "; ".join(map(str, result.errors or [])),
                      "is_error": result.is_error, "total_cost_usd": result.total_cost_usd or 0,
                      "num_turns": result.num_turns, "modelUsage": result.model_usage or {}}, ensure_ascii=False))
    return 1 if result.is_error else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as error:
        print(json.dumps({"result": f"Agent SDK error: {type(error).__name__}: {str(error)[:300]}", "is_error": True}))
        sys.exit(1)
