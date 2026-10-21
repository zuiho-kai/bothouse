import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from voice.recognition import prewarm, transcribe_request
from test_voice_device_app import setup, path


async def test_prewarm_disabled_and_failure_has_no_backend_content():
    speech = SimpleNamespace(warmup=Mock(side_effect=RuntimeError("secret text")))
    await prewarm(speech, False)
    speech.warmup.assert_not_called()
    with pytest.raises(RuntimeError, match="服务未就绪") as exc:
        await prewarm(speech, True)
    assert "secret text" not in str(exc.value)


async def test_timing_log_never_contains_transcript(caplog):
    async def body():
        return b"wav"
    speech = SimpleNamespace(transcribe_timed=Mock(return_value=("private transcript",
        {"inference_ms": 400, "queue_ms": 20, "text": "private transcript"})))
    with caplog.at_level("INFO", logger="uvicorn.error"):
        result = await transcribe_request(speech, SimpleNamespace(
            body=body, state=SimpleNamespace(upload_ms=123)))
    assert result["text"] == "private transcript"
    assert result["timings"]["upload_ms"] == 123
    assert result["timings"]["inference_ms"] == 400
    assert "private transcript" not in caplog.text


async def test_device_lifespan_prewarms_before_serving(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    # lifespan closes over settings: construct with opt-in settings.
    from voice.device_app import create_device_app
    warm = Mock(return_value={"total_ms": 1})
    speech.warmup = warm
    service = app.state.service
    app = create_device_app(replace(service.settings, asr_prewarm=True),
        app.state.room.registry, speech=speech, bridge=bridge, roles=tuple(service.roles.values()))
    async with app.router.lifespan_context(app):
        warm.assert_called_once()
        assert not service.tasks
        assert not bridge.calls
    await client.aclose()


async def test_device_upload_is_measured_in_guard(tmp_path):
    app, client, _, _ = setup(tmp_path)
    async def slow_body():
        yield b"start"
        await asyncio.sleep(.035)
        yield b"end"
    async with client:
        result = await client.post(path() + "/transcribe", content=slow_body())
    assert result.status_code == 200
    assert result.json()["timings"]["upload_ms"] >= 30
