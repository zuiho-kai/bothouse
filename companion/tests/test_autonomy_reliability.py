"""Exercise the real transport and dispatcher without live network or timers."""
import io
import http.client
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
import urllib.error
from unittest.mock import Mock

import pytest

from autonomy.io import Discord, RemoteError
from test_autonomy import NOW, config, runner


def client(monkeypatch, outcomes):
    discord = object.__new__(Discord)
    discord.token = "test-private-token"
    discord.opener = Mock()
    discord.opener.open.side_effect = outcomes
    clock = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    sleeps = []
    def sleep(delay):
        sleeps.append(delay)
        clock[0] += delay
    monkeypatch.setattr(time, "sleep", sleep)
    return discord, sleeps, clock


def eof():
    return urllib.error.URLError(ssl.SSLEOFError("private diagnostic body"))


def response(value):
    return io.BytesIO(json.dumps(value).encode())


def http_error(code, headers=None):
    return urllib.error.HTTPError("https://invalid/private", code, "private body", headers or {}, io.BytesIO(b"private body"))


def test_tls_eof_recovers_without_failing_tick(runner, monkeypatch):
    discord, sleeps, _ = client(monkeypatch, [eof(), response([])])
    runner.discord = discord
    runner.tick(NOW)
    assert discord.opener.open.call_count == 2
    assert sleeps == [1]
    assert len(runner.bridge.timers) == 1
    assert "collection_error" not in runner.state


def test_exhaustion_is_bounded_and_survives_success(runner, monkeypatch):
    discord, sleeps, _ = client(monkeypatch, [eof(), eof(), eof()])
    runner.discord = discord
    with pytest.raises(RemoteError):
        runner.tick(NOW)
    assert discord.opener.open.call_count == 3
    assert sleeps == [1, 2]
    assert not runner.bridge.timers
    path = runner.path.with_name("diagnostics.json")
    failure = json.loads(path.read_text())["failures"][-1]
    assert failure["stage"] == "collect"
    assert failure["kind"] == "transport"
    assert failure["cause"] == "tls_eof"
    assert failure["attempts"] == 3
    assert "private" not in path.read_text()
    assert path.stat().st_mode & 0o777 == 0o600
    discord.opener.open.side_effect = [response([])]
    runner.tick(NOW)
    assert "collection_error" not in runner.state
    assert json.loads(path.read_text())["failures"][-1] == failure
    assert len(runner.bridge.timers) == 1


@pytest.mark.parametrize("kwargs", [{"body": {"content": "message"}}, {"files": [("a.txt", b"data")], "body": {}}])
def test_send_is_never_retried(monkeypatch, kwargs):
    discord, sleeps, _ = client(monkeypatch, [eof(), response({"id": "1"})])
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages", **kwargs)
    assert discord.opener.open.call_count == 1
    assert sleeps == []


@pytest.mark.parametrize("code", [400, 401, 403, 404])
def test_permanent_http_errors_are_not_retried(monkeypatch, code):
    discord, sleeps, _ = client(monkeypatch, [http_error(code)])
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages")
    assert discord.opener.open.call_count == 1
    assert sleeps == []


@pytest.mark.parametrize("code", [408, 429, 500, 502, 503, 504])
def test_transient_http_errors_retry(monkeypatch, code):
    discord, sleeps, _ = client(monkeypatch, [http_error(code), response([])])
    assert discord.call("/channels/123/messages") == []
    assert discord.opener.open.call_count == 2


def test_retry_after_is_respected_without_exceeding_budget(monkeypatch):
    discord, sleeps, _ = client(monkeypatch, [http_error(429, {"Retry-After": "4"}), response([])])
    assert discord.call("/channels/123/messages") == []
    assert sleeps == [4]
    discord, sleeps, _ = client(monkeypatch, [http_error(429, {"Retry-After": "90"})])
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages")
    assert discord.opener.open.call_count == 1
    assert sleeps == []


def test_collection_deadline_limits_request_and_retry(monkeypatch):
    discord, sleeps, clock = client(monkeypatch, [])
    def fail(request, timeout):
        assert timeout <= 2
        clock[0] += timeout
        raise eof()
    discord.opener.open.side_effect = fail
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages", deadline=2)
    assert discord.opener.open.call_count == 1
    assert sleeps == []


def test_certificate_failure_does_not_retry(monkeypatch):
    discord, sleeps, _ = client(monkeypatch, [urllib.error.URLError(ssl.SSLCertVerificationError("private"))])
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages")
    assert discord.opener.open.call_count == 1
    assert sleeps == []


def test_render_failure_diagnostic_survives_and_does_not_duplicate_activity(runner, monkeypatch):
    original = runner.render
    monkeypatch.setattr(runner, "render", Mock(side_effect=OSError("private message")))
    with pytest.raises(OSError):
        runner.tick(NOW)
    path = runner.path.with_name("diagnostics.json")
    failure = json.loads(path.read_text())["failures"][-1]
    assert failure["stage"] == "render"
    assert "private" not in path.read_text()
    monkeypatch.setattr(runner, "render", original)
    runner.tick(NOW)
    assert len(runner.bridge.timers) == 1
    assert json.loads(path.read_text())["failures"][-1] == failure


def test_partial_response_is_read_again(monkeypatch):
    broken = Mock()
    broken.__enter__ = Mock(return_value=broken)
    broken.__exit__ = Mock(return_value=False)
    broken.read.side_effect = http.client.IncompleteRead(b"private partial body")
    discord, sleeps, _ = client(monkeypatch, [broken, response([])])
    assert discord.call("/channels/123/messages") == []
    assert discord.opener.open.call_count == 2
    broken.__exit__.assert_called_once()


def test_invalid_json_is_not_retried(monkeypatch):
    discord, sleeps, _ = client(monkeypatch, [io.BytesIO(b"private invalid json")])
    with pytest.raises(RemoteError, match="invalid JSON"):
        discord.call("/channels/123/messages")
    assert discord.opener.open.call_count == 1
    assert sleeps == []


def test_request_timeouts_share_finite_budget(monkeypatch):
    discord, sleeps, clock = client(monkeypatch, [])
    def fail(request, timeout):
        clock[0] += timeout
        raise TimeoutError("private")
    discord.opener.open.side_effect = fail
    with pytest.raises(RemoteError):
        discord.call("/channels/123/messages")
    assert discord.opener.open.call_count == 3
    assert clock[0] == 45


def test_diagnostics_history_is_bounded(runner):
    from autonomy.diagnostics import record_failure
    for i in range(25):
        record_failure(runner.path.parent, "collect", ValueError("private"))
    history = json.loads(runner.path.with_name("diagnostics.json").read_text())
    assert len(history["failures"]) == 20
    assert "private" not in json.dumps(history)


def test_diagnostic_write_failure_does_not_mask_original(runner, monkeypatch, capsys):
    import autonomy.diagnostics as diagnostics
    monkeypatch.setattr(diagnostics, "write_json", Mock(side_effect=OSError("private storage failure")))
    runner.discord.fail_page = 1
    with pytest.raises(RemoteError, match="HTTP 429"):
        runner.tick(NOW)
    assert capsys.readouterr().err == "autonomy: unable to persist failure diagnostics\n"


def test_sqlite_failure_at_initialization_is_recorded(config, tmp_path):
    from autonomy.__main__ import Runner
    from test_autonomy import FakeBridge, FakeDiscord
    import sqlite3
    (tmp_path / "messages.sqlite3").write_bytes(b"broken database")
    with pytest.raises(sqlite3.DatabaseError):
        Runner(config, tmp_path / "state.json", FakeBridge(), FakeDiscord())
    failure = json.loads((tmp_path / "diagnostics.json").read_text())["failures"][-1]
    assert failure["stage"] == "initialize"
    assert failure["kind"] == "sqlite"
    assert type(failure["sqlite_code"]) is int


def test_real_cli_tick_failure_and_recovery_leave_diagnostics(config, tmp_path):
    """Real python -m entry point, fake Discord reads; forbid all network writes."""
    shim = tmp_path / "shim"
    shim.mkdir()
    (shim / "sitecustomize.py").write_text(
        "import io, os, ssl, time, urllib.error, urllib.request\n"
        "time.sleep = lambda delay: None\n"
        "class Opener:\n"
        "    calls = 0\n"
        "    def open(self, request, timeout):\n"
        "        assert request.get_method() == 'GET'\n"
        "        self.calls += 1\n"
        "        if os.environ['TEST_FAIL'] == 'yes' or self.calls == 1:\n"
        "            raise urllib.error.URLError(ssl.SSLEOFError('private body'))\n"
        "        return io.BytesIO(b'[]')\n"
        "urllib.request.build_opener = Opener\n"
    )
    bridge_config = tmp_path / "bridge.toml"
    bridge_config.write_text(
        '[[projects]]\nname="cjiang"\n[[projects.platforms]]\ntype="discord"\n'
        '[projects.platforms.options]\ntoken="fake-token"\n'
    )
    # No due activity and no pending timers: this CLI probe can only collect/render.
    config.update(enabled=False, start_at="2099-01-01T00:00:00+08:00",
                  bridge_config=str(bridge_config), socket=str(tmp_path / "unused.sock"))
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    source = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=os.pathsep.join((str(shim), str(source))), TEST_FAIL="yes", HOME=str(tmp_path))
    command = [sys.executable, "-m", "autonomy", "--config", str(path), "tick"]
    failed = subprocess.run(command, cwd=tmp_path, env=env, capture_output=True, text=True, timeout=10)
    assert failed.returncode == 1
    history = json.loads((tmp_path / "diagnostics.json").read_text())
    assert history["failures"][-1]["cause"] == "tls_eof"
    assert history["failures"][-1]["attempts"] == 3
    assert "private body" not in failed.stderr
    env["TEST_FAIL"] = "no"
    recovered = subprocess.run(command, cwd=tmp_path, env=env, capture_output=True, text=True, timeout=10)
    assert recovered.returncode == 0, recovered.stderr
    assert json.loads((tmp_path / "diagnostics.json").read_text()) == history
    assert json.loads((tmp_path / "state.json").read_text())["actions"] == {}
