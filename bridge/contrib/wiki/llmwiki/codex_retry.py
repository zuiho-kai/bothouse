"""Codex event evidence and bounded continuation, shared by every wiki call site."""
import json
import re


class Failure(str):
    def __new__(cls, text, reason, retryable=False, started=True, provider_down=False):
        value = super().__new__(cls, text)
        value.reason, value.retryable, value.started = reason, retryable, started
        value.resumable = retryable
        value.provider_down = provider_down
        return value


def provider_unavailable(status):
    """Source: api_json's existing outage policy; a malformed request only fails its own batch."""
    return status in (0, 401, 403, 429) or status >= 500


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


def response_statuses(errors, stderr):
    """Read response metadata first; bare numbers inside a message are not HTTP evidence."""
    statuses, messages = [], []
    for error in errors:
        if isinstance(error, dict):
            error = error.get("error", error)
        if isinstance(error, dict):
            for key in ("status", "http_status", "status_code", "http_status_code"):
                status = error.get(key)
                if isinstance(status, (int, str)) and str(status).isdecimal():
                    statuses.append(int(status))
                    break
            messages.append(str(error.get("message", "")))
        else:
            messages.append(str(error))
    if statuses:
        return statuses
    # Source: #906 review permits a leading response code or an explicit HTTP/status diagnostic.
    for message in messages + [stderr]:
        match = re.search(r'(?:^\s*(?:error:\s*)?(?:HTTP(?:/\d(?:\.\d)?)?\s+)?|'
                          r'\b(?:HTTP(?:/\d(?:\.\d)?)?(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*)'
                          r'([45]\d\d)\b', message, re.I | re.M)
        if match:
            statuses.append(int(match.group(1)))
    return statuses


def failure(errors, tid, terminal, active, progress=False, result="", stderr="", usage=None):
    text = json.dumps(errors, ensure_ascii=False) + "\n" + stderr
    lower = text.lower()
    statuses = response_statuses(errors, stderr)
    # Source: #906: an identified bad request cannot become an outage through its body or stderr.
    request_local = any(status in (400, 404, 422) for status in statuses) or "invalid_request_error" in lower
    # Source: #848 returned production diagnostics and Codex thread/turn/item events. A failed
    # connection plus no output, item or usage proves this invocation did no local work.
    # Empty usage alone proves nothing; diagnostic reason codes alone prove no tool outcome.
    rejected = request_local or any(word in lower for word in ("usage limit", "quota", "rate limit",
                   "hit your session limit", "invalid_request_error", "authentication_error",
                   "permission_denied")) or any(status in (401, 403) for status in statuses)
    connection_failed = "failed to connect to responses websocket" in lower
    empty = not (progress or result or active or any((usage or {}).values()))
    settled = bool(tid) and terminal == "turn.failed" and not active
    transport = connection_failed or any(word in lower for word in ("upstream_reset_replay_refused",
                 "upstream_no_response", "upstream_closed_before_response"))
    capacity = any(word in lower for word in ("at capacity", "503 service unavailable", "high demand"))
    if rejected:
        reason, retryable = "request_rejected", False
    elif active:
        reason, retryable = "ambiguous_transport", False
    elif empty and (connection_failed or capacity):
        reason, retryable = ("empty_connection" if connection_failed else "capacity"), True
    elif settled and (transport or capacity):
        reason, retryable = "interrupted", True
    elif transport or capacity or 429 in statuses:
        reason, retryable = "ambiguous_transport", False
    else:
        reason, retryable = "failure", False
    # Source: #906 review distinguishes request-local 400/404/422 from global auth/quota/rate failures.
    down = not request_local and (any(provider_unavailable(status) for status in statuses) if statuses else
        transport or capacity or any(word in lower for word in (
            "usage limit", "quota", "rate limit", "hit your session limit", "authentication_error", "permission_denied")))
    value = Failure(text, reason, retryable, provider_down=down)
    value.resumable = retryable and bool(tid)
    return value


def run(invoke, models, remaining, round_seconds, log, resume=None, reset=None, save=None):
    """Every invocation spends one existing round slot, including immediate connection failures."""
    left = remaining()
    # Source: #848 adopts #791's measured round allocation; unlimited runs retain the finite model chain.
    slots = max(1, int(left // round_seconds)) if left is not None else len(models)
    tid, index, retryable = resume, 0, bool(resume)
    ok, out, cost = False, Failure("no Codex round admitted", "budget_exhausted", started=False), 0
    while index < len(models) and slots:
        left = remaining()
        if left is not None and left < round_seconds:
            log(f"{left:.0f} s left, less than one round ({round_seconds} s); continuation waits")
            return False, Failure("not enough remaining time for a Codex round", "budget_exhausted", started=False), cost, tid, models[index]
        slots -= 1
        if retryable:
            log(f"resuming thread {tid}" if tid else "empty connection; starting exec again")
        elif index and reset:
            log(f"{models[index - 1]} failed; starting {models[index]} fresh")
            reset()
        ok, out, cost, tid = invoke(models[index], tid if retryable else None)
        retryable = not ok and getattr(out, "retryable", False)
        if save:
            save(tid if retryable else None)
        if ok or getattr(out, "reason", None) in ("budget_exhausted", "cancelled", "request_rejected", "ambiguous_transport"):
            break
        log(f"{models[index]} failed: {out[-200:]}")
        index = min(index + 1, len(models) - 1) if retryable else index + 1
    return ok, out, cost, tid, models[min(index, len(models) - 1)]
