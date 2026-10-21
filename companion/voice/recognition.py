"""ASR startup and request timing; never log audio or recognized text."""
import asyncio
import logging
import time


async def prewarm(speech, enabled):
    if enabled:
        try:
            result = await asyncio.to_thread(speech.warmup)
        except Exception:
            # Do not expose backend exception text (paths or model output).
            raise RuntimeError("语音识别预热失败；服务未就绪，请检查本地模型。") from None
        logging.getLogger("uvicorn.error").info("ASR startup warmup: %s", result)


async def transcribe_request(speech, request):
    started = time.monotonic()
    audio = await request.body()
    received = time.monotonic()
    if callable(getattr(speech, "transcribe_timed", None)):
        text, metrics = await asyncio.to_thread(speech.transcribe_timed, audio)
    else:
        text = await asyncio.to_thread(speech.transcribe, audio)
        metrics = {}
    # Whitelist numeric metrics so backend content cannot enter the log.
    timings = {key: value for key, value in metrics.items()
               if key in {"audio_ms", "validation_ms", "queue_ms", "setup_ms",
                          "inference_ms", "total_ms"}
               and type(value) in (int, float)}
    timings["upload_ms"] = getattr(request.state, "upload_ms", round((received - started) * 1000))
    elapsed = round((time.monotonic() - started) * 1000)
    logging.getLogger("uvicorn.error").info("ASR request: elapsed_ms=%s stages=%s", elapsed, timings)
    return {"text": text, "elapsed_ms": elapsed, "timings": timings}
