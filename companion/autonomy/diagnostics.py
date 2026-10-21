"""Bounded failure history independent of state updates and muted cron output."""
from datetime import datetime, timezone
import json
import sqlite3
import sys

from .io import RemoteError, write_json


def failure_details(exc):
    if isinstance(exc, RemoteError):
        kinds = {"remote", "http", "transport", "deadline", "invalid_data"}
        causes = {"unknown", "tls_certificate", "tls_eof", "tls", "timeout", "dns",
                  "connection", "incomplete_read", "http_transport", "network"}
        result = {"kind": exc.kind if exc.kind in kinds else "remote",
                  "cause": exc.cause if exc.cause in causes else "unknown"}
        if type(exc.attempts) is int and 0 <= exc.attempts <= 3:
            result["attempts"] = exc.attempts
        if type(exc.status) is int and 100 <= exc.status <= 599:
            result["http_status"] = exc.status
        return result
    if isinstance(exc, sqlite3.Error):
        result = {"kind": "sqlite"}
        code = getattr(exc, "sqlite_errorcode", None)
        if type(code) is int:
            result["sqlite_code"] = code
        return result
    if isinstance(exc, OSError):
        result = {"kind": "filesystem"}
        if type(exc.errno) is int:
            result["errno"] = exc.errno
        return result
    return {"kind": "invalid_data" if isinstance(exc, ValueError) else "unexpected"}


def record_failure(directory, stage, exc):
    """Never mask the triggering exception if diagnostics storage also fails."""
    path = directory / "diagnostics.json"
    entry = {"at": datetime.now(timezone.utc).isoformat(), "stage": stage, **failure_details(exc)}
    try:
        history = json.loads(path.read_text()).get("failures", []) if path.exists() else []
        if not isinstance(history, list):
            history = []
        write_json(path, {"failures": (history + [entry])[-20:]})
    except (OSError, ValueError, AttributeError, TypeError):
        print("autonomy: unable to persist failure diagnostics", file=sys.stderr)
