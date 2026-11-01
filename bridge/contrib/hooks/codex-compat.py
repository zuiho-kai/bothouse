"""Codex command/rollout adapter. Output decisions use the shared hook protocol.
Source: https://learn.chatgpt.com/docs/hooks (transcripts are version-dependent).
Dispatch uses spawn_agent.message; hook output must restore that argument name.
"""
import json
import os
import tempfile


def adapt(payload):
    payload = dict(payload)
    inp = dict(payload.get("tool_input") or {})
    if payload.get("tool_name") in ("Bash", "exec_command", "shell_command", "shell"):
        payload["tool_name"] = "Bash"
        cmd = inp.get("command", inp.get("cmd", ""))
        # Codex canonical Bash input uses a string command. Never interpret an
        # argv list as shell syntax; it can contain quoted data.
        if isinstance(cmd, str):
            inp["command"] = cmd
        payload["tool_input"] = inp
    if payload.get("tool_name") in ("spawn_agent", "Agent"):
        payload["tool_name"] = "Agent"
        payload["tool_input"] = inp
    if payload.get("hook_event_name") not in ("Stop", "SubagentStop"):
        return payload, None
    entries = []
    try:
        with open(payload.get("transcript_path") or "", encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("type") in ("user", "assistant"):
                    entries.append(event)  # already a chat transcript
                elif event.get("type") == "response_item":
                    item = event.get("payload") or {}
                    if item.get("type") == "message" and item.get("role") in ("user", "assistant"):
                        text = "\n".join(c.get("text", "") for c in item.get("content", [])
                                         if isinstance(c, dict) and c.get("type") in ("input_text", "output_text", "text"))
                        if text:
                            entries.append({"type": item["role"], "message": {"content": [{"type": "text", "text": text}]}})
                    elif item.get("type") == "function_call":
                        try:
                            args = json.loads(item.get("arguments") or "{}")
                        except ValueError:
                            continue
                        name = item.get("name") or ""
                        if name in ("exec_command", "shell_command"):
                            name = "Bash"
                            args = dict(args, command=args.get("cmd", args.get("command", "")))
                        entries.append({"type": "assistant", "message": {"content": [{
                            "type": "tool_use", "id": item.get("call_id"), "name": name, "input": args}]}})
    except OSError:
        return payload, None
    fd, path = tempfile.mkstemp(prefix="codex-hook-", suffix=".jsonl")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for event in entries:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    payload["transcript_path"] = path
    return payload, path
