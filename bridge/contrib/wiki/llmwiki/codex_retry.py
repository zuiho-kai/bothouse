"""Codex event evidence and the bounded retry policy shared by wiki engines."""
import json
import re


class Failure(str):
    def __new__(cls, text, reason, retryable=False, started=True):
        value = super().__new__(cls, text)
        value.reason, value.retryable, value.started = reason, retryable, started
        value.resumable = retryable
        return value


def events(stdout, resume=None):
    usage, errors, active, tid, terminal, progress = {}, [], set(), resume, None, False
    turns = 0
    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except ValueError:
            progress = True  # unparsed stdout cannot prove an empty call
            continue
        kind = event.get("type")
        if kind == "thread.started":
            tid = event.get("thread_id")
        elif kind in ("turn.failed", "turn.completed"):
            terminal = kind
        elif kind != "turn.started" and kind != "error":
            progress = True  # includes messages, tools, patches and unknown event types
        item = event.get("item") or {}
        if kind == "item.started":
            active.add(item.get("id"))
        elif kind == "item.completed":
            active.discard(item.get("id"))
        if kind in ("error", "turn.failed"):
            errors.append(event.get("error") or event.get("message") or event)
        if kind == "turn.completed":
            turns += 1
        for key, value in (event.get("usage") or {}).items():
            usage[key] = usage.get(key, 0) + value
    return usage, turns, errors, tid, terminal, active, progress


def failure(errors, tid, terminal, active, progress=False, result="", stderr="", usage=None):
    text = json.dumps(errors, ensure_ascii=False) + "\n" + stderr
    lower = text.lower()
    # Source: #848 production diagnostics and Codex thread/turn/item events distinguish partial local work.
    # Retain that evidence for logs; #853's fresh retry policy is independent of transport ambiguity.
    rejected = any(word in lower for word in ("usage limit", "quota", "rate limit",
                   "hit your session limit", "invalid_request_error", "authentication_error",
                   "permission_denied")) or bool(re.search(r'\b(400|401|403|404|422)\b', text))
    connection_failed = "failed to connect to responses websocket" in lower
    empty = not (progress or result or active or any((usage or {}).values()))
    settled = bool(tid) and terminal == "turn.failed" and not active
    transport = connection_failed or any(word in lower for word in ("upstream_reset_replay_refused",
                 "upstream_no_response", "upstream_closed_before_response"))
    capacity = any(word in lower for word in ("at capacity", "503 service unavailable", "high demand"))
    if re.search(r'\b429\b', text) or "rate limit" in lower:
        reason = "rate_limited"
    elif rejected:
        reason = "request_rejected"
    elif active:
        reason = "ambiguous_transport"
    elif empty and (connection_failed or capacity):
        reason = "empty_connection" if connection_failed else "capacity"
    elif settled and (transport or capacity):
        reason = "interrupted"
    elif transport or capacity:
        reason = "ambiguous_transport"
    else:
        reason = "failure"
    # Source: user 2026-11-17: any failed model call retries after restoring the round's baseline.
    # Evidence still distinguishes ambiguous tools/quota; it no longer forbids a fresh local attempt.
    value = Failure(text, reason, True)
    value.resumable = False
    return value


def run(invoke, models, remaining, round_seconds, log, reset=None):
    """Retry from the same round baseline, then change model; deadlines still govern admission."""
    # Source: user 2026-11-17 12:5x「有问题都直接重试 3次不行就换模型」: initial call + three retries.
    retries = 3
    tid, previous = None, None
    ok, out, cost = False, Failure("no Codex round admitted", "budget_exhausted", started=False), 0
    for model in models:
        for retry in range(retries + 1):
            left = remaining()
            if left is not None and left < round_seconds:
                log(f"{left:.0f} s left, less than one round ({round_seconds} s); retry waits")
                return False, Failure("not enough remaining time for a model round", "budget_exhausted", started=False), cost, tid, model
            if previous is not None:
                log(f"{model} retry {retry}/{retries} from round baseline" if retry else
                    f"{previous} failed after {retries} retries; starting {model} fresh")
                if reset:
                    reset()
            ok, out, spent, tid = invoke(model, None)
            cost += spent
            previous = model
            if ok or getattr(out, "reason", None) in ("budget_exhausted", "cancelled"):
                return ok, out, cost, tid, model
            log(f"{model} failed: {out[-200:]}")
    return ok, out, cost, tid, models[-1]
