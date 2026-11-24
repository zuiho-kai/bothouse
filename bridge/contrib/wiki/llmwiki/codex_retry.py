"""Codex event evidence and the bounded retry policy shared by wiki engines."""
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
                if isinstance(status, (int, str)) and str(status).strip().isdecimal():
                    statuses.append(int(status))
                    break
            messages.append(str(error.get("message", "")))
        else:
            messages.append(str(error))
    if statuses:
        return statuses
    # Source: #906 r6: bare zero can be a tool count; status zero requires HTTP/status context.
    for message in messages:
        match = re.search(r'^[ \t]*(?:error:[ \t]*)?([45]\d\d)\b|'
                          r'\b(?:HTTP(?:/\d(?:\.\d)?)?(?:[ \t]+status)?|status(?:[ \t]+code)?)[ \t]*[:=]?[ \t]*'
                          r'(0|[45]\d\d)\b', message, re.I)
        if match:
            statuses.append(int(match.group(1) or match.group(2)))
    if statuses:
        return statuses
    # stderr holds every diagnostic of the process (plugins, tools, start-up), not the response. Only its last
    # line counts, where the CLI says why it gave up (ingest log 2026-11-20: 「Failed to refresh token status=401
    # Unauthorized」 after an unrelated websocket line), and only a status written as one: 「exit status 0」 and a
    # leading number are not HTTP statuses.
    last = next((line for line in reversed(stderr.splitlines()) if line.strip()), "")
    match = re.search(r'\bHTTP(?:/\d(?:\.\d)?)?(?:[ \t]+status)?[ \t]*[:=]?[ \t]*(0|[45]\d\d)\b|'
                      r'\bstatus(?:[ \t]+code)?[ \t]*[:=]?[ \t]*([45]\d\d)\b', last, re.I)
    return [int(match.group(1) or match.group(2))] if match else []


def failure(errors, tid, terminal, active, progress=False, result="", stderr="", usage=None):
    text = json.dumps(errors, ensure_ascii=False) + "\n" + stderr
    lower = text.lower()
    statuses = response_statuses(errors, stderr)
    # Source: #906 r5: response status decides classification; only missing status admits text evidence.
    request_local = (any(status in (400, 404, 422) for status in statuses) if statuses else
                     "invalid_request_error" in lower)
    # Source: #906 r6: match complete refusal phrases; relay diagnostics can continue with details.
    text_refused = any(word in lower for word in ("usage limit", "hit your session limit",
                        "authentication_error", "permission_denied")) or bool(re.search(
        r'\b(?:insufficient_quota|quota_exceeded|quota_exhausted|rate_limit_exceeded)\b|'
        r'\b(?:rate limit (?:exceeded|reached)|quota (?:exceeded|exhausted)|'
        r'too many requests|exceeded your current quota)\b', lower))
    # Source: #848 returned production diagnostics and Codex thread/turn/item events. A failed
    # connection plus no output, item or usage proves this invocation did no local work.
    # Empty usage alone proves nothing; diagnostic reason codes alone prove no tool outcome.
    rejected = (request_local or any(status in (401, 403) for status in statuses) if statuses else
                request_local or text_refused)
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
    down = (any(provider_unavailable(status) for status in statuses) if statuses else
            not request_local and (transport or capacity or text_refused))
    value = Failure(text, reason, retryable, provider_down=down)
    value.resumable = retryable and bool(tid)
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
