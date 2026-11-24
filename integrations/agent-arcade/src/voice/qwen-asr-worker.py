"""Local manual ASR host. stdin/stdout JSON; audio exists only in bounded memory."""
import collections
import importlib.metadata
import json
import math
import os
from pathlib import Path
import queue
import struct
import sys
import threading
import time

RATE = 16000
FRAME_SAMPLES = 320
FRAME_BYTES = FRAME_SAMPLES * 2
MAX_SECONDS = 60
MAX_BYTES = RATE * 2 * MAX_SECONDS
HANDS_FREE_SECONDS = 600
SEGMENT_SECONDS = 20
VERSIONS = {"qwen-asr": "0.0.6", "transformers": "4.57.6",
            "sounddevice": "0.5.6", "webrtcvad-wheels": "2.0.14.post1"}
LANGUAGES = {"zh-CN": "Chinese", "en-US": "English"}


class VoiceFailure(Exception):
    pass


class OnsetDetector:
    """WebRTC mode 2, three voiced 20-ms frames within a five-frame window.

    Rearm after 300 ms classified non-speech. This detects acoustic speech,
    not speaker identity, intent, or an accepted conversational interruption.
    """
    def __init__(self, vad, required=3, window=5):
        self.vad = vad
        self.required = required
        self.window = collections.deque(maxlen=window)
        self.active = False
        self.silence = 0
        self.has_speech = False
        self.last_voiced = False

    def feed(self, frame):
        if len(frame) != FRAME_BYTES:
            raise VoiceFailure("voice_audio_format")
        voiced = self.vad.is_speech(frame, RATE)
        self.last_voiced = bool(voiced)
        self.window.append(bool(voiced))
        self.silence = 0 if voiced else self.silence + 1
        if self.active and self.silence >= 15:
            self.active = False
            self.window.clear()
        if not self.active and sum(self.window) >= self.required:
            self.active = True
            self.has_speech = True
            return True
        return False


class Segmenter:
    """Headphone mode: stricter onset, 600-ms tail, bounded non-overlapping turns."""
    def __init__(self, detector):
        self.detector = detector
        self.preroll = collections.deque(maxlen=10)  # 200 ms, including the onset frames.
        self.audio = bytearray()
        self.active = False
        self.blocked = False
        self.voiced = 0
        self.silence = 0

    def feed(self, frame):
        onset = self.detector.feed(frame)
        self.silence = 0 if self.detector.last_voiced else self.silence + 1
        if self.blocked:
            if self.silence >= 30:
                self.blocked = False
                self.preroll.clear()
            return None
        if not self.active:
            self.preroll.append(frame)
            if onset:
                self.audio = bytearray(b"".join(self.preroll))
                self.voiced = sum(self.detector.window)
                self.active = True
                return {"kind": "onset"}
            return None
        self.audio.extend(frame)
        self.voiced += int(self.detector.last_voiced)
        if len(self.audio) >= RATE * 2 * SEGMENT_SECONDS:
            self.audio.clear()
            self.active, self.blocked = False, True
            return {"kind": "discard", "reason": "segment-too-long"}
        if self.silence >= 30:
            audio, self.audio = self.audio, bytearray()
            self.active = False
            self.preroll.clear()
            if self.voiced < 10:  # At least 200 ms classified speech, not merely an onset.
                audio.clear()
                return {"kind": "discard", "reason": "segment-too-short"}
            return {"kind": "segment", "audio": audio}
        return None


class Capture:
    def __init__(self, op_id, locale, mode="push-to-talk"):
        self.id = op_id
        self.locale = locale
        self.mode = mode
        self.frames = queue.Queue(maxsize=100)
        self.audio = bytearray()
        self.cancelled = threading.Event()
        self.finishing = threading.Event()
        self.failure = None
        self.stream = None
        self.finish_id = None
        self.phase = "loading"
        self.utterance = 0
        self.segments = queue.Queue(maxsize=1)

    def callback(self, data, frames, timestamp, status):
        # The PortAudio callback never invokes a model, blocks, or writes stdout.
        if self.cancelled.is_set() or self.finishing.is_set() or self.failure:
            return
        if status:
            self.failure = "voice_audio_overflow"
            return
        if frames != FRAME_SAMPLES or len(data) != FRAME_BYTES:
            self.failure = "voice_audio_format"
            return
        try:
            self.frames.put_nowait(bytes(data))
        except queue.Full:
            self.failure = "voice_audio_overflow"

    def clear(self):
        self.audio.clear()
        while True:
            try:
                self.frames.get_nowait()
            except queue.Empty:
                break
        self.clear_segments()

    def clear_segments(self):
        while True:
            try:
                _, audio = self.segments.get_nowait()
                audio.clear()
            except queue.Empty:
                return


class Runtime:
    def __init__(self, model_path):
        self.model_path = Path(model_path)
        self.model = None

    def capabilities(self):
        versions = {key: importlib.metadata.version(key) for key in VERSIONS}
        if versions != VERSIONS:
            raise VoiceFailure("voice_dependencies")
        if not all((self.model_path / name).is_file() for name in
                   ("config.json", "model.safetensors", "preprocessor_config.json")):
            raise VoiceFailure("voice_model_missing")
        return {"backend": "qwen3-asr-local", "handsFree": True, "manualReview": True,
                "maxCaptureSeconds": MAX_SECONDS, "recordingRetained": False,
                "maxHandsFreeSeconds": HANDS_FREE_SECONDS, "maxSegmentSeconds": SEGMENT_SECONDS,
                "recognizers": [{"id": "qwen3-asr-0.6b", "name": "Qwen3-ASR 0.6B", "locale": key}
                                for key in LANGUAGES], "voices": [], "versions": versions}

    def load(self):
        if self.model is not None:
            return
        self.capabilities()
        for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
            os.environ[key] = "1"
        import torch
        import numpy as np
        import sounddevice as sd
        import webrtcvad
        from qwen_asr import Qwen3ASRModel
        if not torch.cuda.is_available():
            raise VoiceFailure("voice_gpu_unavailable")
        torch.set_num_threads(1)
        self.np, self.sd, self.webrtcvad = np, sd, webrtcvad
        self.model = Qwen3ASRModel.from_pretrained(
            str(self.model_path), dtype=torch.bfloat16, device_map="cuda:0",
            attn_implementation="sdpa", local_files_only=True, trust_remote_code=False,
            use_safetensors=True, max_inference_batch_size=1, max_new_tokens=256)

    def detector(self, hands_free=False):
        return OnsetDetector(self.webrtcvad.Vad(2), required=6 if hands_free else 3, window=8 if hands_free else 5)

    def input_stream(self, callback):
        # None selects PortAudio's current default input. No loopback or ASIO override.
        return self.sd.RawInputStream(samplerate=RATE, blocksize=FRAME_SAMPLES,
                                      channels=1, dtype="int16", device=None, callback=callback)

    def transcribe(self, audio, locale):
        waveform = self.np.frombuffer(audio, dtype="<i2").astype(self.np.float32) / 32768.0
        try:
            result = self.model.transcribe(audio=(waveform, RATE), language=LANGUAGES[locale])
            return str(result[0].text).strip() if result else ""
        finally:
            waveform.fill(0)


class Host:
    def __init__(self, runtime, emit, now=time.monotonic):
        self.runtime, self.emit, self.now = runtime, emit, now
        self.current = None
        self.lock = threading.RLock()
        self.thread = None
        self.running = False

    def live(self, capture):
        return self.current is capture and not capture.cancelled.is_set()

    def event(self, capture, event, **fields):
        with self.lock:
            if self.live(capture):
                self.emit(capture.id, event, **fields)

    def stop_stream(self, capture):
        stream, capture.stream = capture.stream, None
        if stream:
            try:
                stream.abort()
            finally:
                stream.close()

    def cancel(self):
        with self.lock:
            capture, self.current = self.current, None
            if capture:
                capture.cancelled.set()
        if capture:
            self.stop_stream(capture)

    def dispatch(self, row):
        op_id, op = row.get("id"), row.get("op")
        if not isinstance(op_id, str) or not 1 <= len(op_id) <= 64:
            return
        starting = None
        try:
            if op == "capabilities":
                self.emit(op_id, "capabilities", **self.runtime.capabilities())
            elif op == "listen":
                if row.get("locale") not in LANGUAGES:
                    raise VoiceFailure("voice_locale")
                mode = row.get("mode", "push-to-talk")
                if mode not in ("push-to-talk", "hands-free"):
                    raise VoiceFailure("voice_mode")
                with self.lock:
                    if self.current or self.running:
                        raise VoiceFailure("voice_busy")
                    capture = Capture(op_id, row["locale"], mode)
                    self.current = capture
                    self.running = True
                    starting = capture
                self.event(capture, "loading")
                # Windows native NumPy/SciPy imports can hang when first loaded
                # by a worker while the protocol thread blocks in stdin.readline.
                # Initialize only after explicit Listen, on this protocol thread;
                # Ready/capabilities stay lightweight. Node cancellation kills this
                # owned process during loading, before any input device is opened.
                self.runtime.load()
                with self.lock:
                    if not self.live(capture):
                        self.running = False
                        return
                    self.thread = threading.Thread(target=self.capture, args=(capture,), daemon=True)
                    self.thread.start()
            elif op == "finish-listening":
                with self.lock:
                    capture = self.current
                    if not capture or capture.id != row.get("listenId") or capture.phase != "listening" or capture.mode != "push-to-talk":
                        raise VoiceFailure("voice_stale_operation")
                    capture.finish_id = op_id
                    capture.finishing.set()
            elif op in ("interrupt", "close", "stop-listening"):
                self.cancel()
                self.emit(op_id, "closed" if op == "close" else "interrupted")
            else:
                raise VoiceFailure("voice_protocol")
        except Exception as error:
            if starting is not None:
                with self.lock:
                    starting.cancelled.set()
                    starting.clear()
                    if self.current is starting:
                        self.current = None
                        self.running = False
            code = str(error) if isinstance(error, VoiceFailure) else "voice_unavailable"
            self.emit(op_id, "error", code=code)

    def consume(self, capture, detector, frame, meter):
        if len(capture.audio) + len(frame) > MAX_BYTES:
            raise VoiceFailure("voice_capture_limit")
        capture.audio.extend(frame)
        if detector.feed(frame):
            self.event(capture, "speech-start", detector="webrtcvad", mode=2, voicedFrames=3, windowFrames=5)
        self.measure(capture, frame, meter)

    def measure(self, capture, frame, meter):
        meter[2] += 1
        if meter[2] % 10 == 0:
            samples = struct.unpack("<320h", frame)
            level = min(100, round(math.sqrt(sum(x*x for x in samples) / FRAME_SAMPLES) / 32768 * 100))
            meter[0], meter[1] = level, max(meter[1], level)
            self.event(capture, "audio-level", current=level, max=meter[1], count=meter[2])

    def infer_segments(self, capture):
        while self.live(capture):
            try:
                utterance, audio = capture.segments.get(timeout=0.05)
            except queue.Empty:
                continue
            try:
                if not self.live(capture) or utterance != capture.utterance:
                    continue
                text = self.runtime.transcribe(audio, capture.locale)
                if len(text) > 2000:
                    raise VoiceFailure("voice_text_limit")
                with self.lock:
                    # A newer onset invalidates both queued and currently computing text.
                    if self.live(capture) and utterance == capture.utterance:
                        self.emit(capture.id, "transcript" if text else "unrecognized", text=text, utteranceId=utterance)
            except Exception as error:
                capture.failure = str(error) if isinstance(error, VoiceFailure) else "voice_unavailable"
            finally:
                audio.clear()

    def capture_hands_free(self, capture, started):
        segmenter = Segmenter(self.runtime.detector(hands_free=True))
        meter = [0, 0, 0]
        inference = threading.Thread(target=self.infer_segments, args=(capture,), daemon=True)
        inference.start()
        try:
            while self.live(capture):
                if capture.failure:
                    raise VoiceFailure(capture.failure)
                if self.now() - started >= HANDS_FREE_SECONDS:
                    raise VoiceFailure("voice_listen_timeout")
                try:
                    frame = capture.frames.get(timeout=0.05)
                except queue.Empty:
                    continue
                self.measure(capture, frame, meter)
                result = segmenter.feed(frame)
                if not result:
                    continue
                if result["kind"] == "onset":
                    with self.lock:
                        capture.utterance += 1
                        capture.clear_segments()
                        self.event(capture, "speech-start", detector="webrtcvad", mode=2,
                                   voicedFrames=6, windowFrames=8, utteranceId=capture.utterance)
                elif result["kind"] == "discard":
                    self.event(capture, "unrecognized", reason=result["reason"], utteranceId=capture.utterance)
                else:
                    # Only one pending complete segment; no unbounded transcription backlog.
                    with self.lock:
                        capture.clear_segments()
                        capture.segments.put_nowait((capture.utterance, result["audio"]))
        finally:
            segmenter.audio.clear()
            segmenter.preroll.clear()
            capture.clear_segments()

    def capture(self, capture):
        ended = False
        try:
            detector, meter = self.runtime.detector(), [0, 0, 0]
            with self.lock:
                if not self.live(capture):
                    return
                capture.stream = self.runtime.input_stream(capture.callback)
                capture.stream.start()
                capture.phase = "listening"
                started = self.now()
                self.event(capture, "listening", maxCaptureSeconds=HANDS_FREE_SECONDS if capture.mode == "hands-free" else MAX_SECONDS)
            if capture.mode == "hands-free":
                self.capture_hands_free(capture, started)
                return
            while self.live(capture) and not capture.finishing.is_set():
                if capture.failure:
                    raise VoiceFailure(capture.failure)
                if self.now() - started >= MAX_SECONDS:
                    raise VoiceFailure("voice_capture_limit")
                try:
                    self.consume(capture, detector, capture.frames.get(timeout=0.05), meter)
                except queue.Empty:
                    pass
            self.stop_stream(capture)
            if not self.live(capture):
                return
            if capture.failure:
                raise VoiceFailure(capture.failure)
            # Stop/close precedes the finish acknowledgement, final queue drain and inference.
            with self.lock:
                capture.phase = "recognizing"
                self.emit(capture.finish_id, "finishing", listenId=capture.id, microphoneClosed=True)
                self.event(capture, "microphone-closed")
            while not capture.frames.empty():
                self.consume(capture, detector, capture.frames.get_nowait(), meter)
            if not detector.has_speech:
                self.event(capture, "unrecognized")
            elif self.live(capture):
                text = self.runtime.transcribe(capture.audio, capture.locale)
                if len(text) > 2000:
                    raise VoiceFailure("voice_text_limit")
                if text:
                    self.event(capture, "transcript", text=text)
                else:
                    self.event(capture, "unrecognized")
            ended = True
        except Exception as error:
            code = str(error) if isinstance(error, VoiceFailure) else "voice_unavailable"
            self.event(capture, "error", code=code)
        finally:
            try:
                self.stop_stream(capture)
            finally:
                capture.clear()
                with self.lock:
                    self.running = False
                    if self.current is capture:
                        self.current = None
                        if ended and not capture.cancelled.is_set():
                            self.emit(capture.id, "listen-ended")


def main():
    # Capture protocol stdout before redirecting third-party logs away from it.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    protocol = sys.stdout
    sys.stdout = sys.stderr
    output_lock = threading.Lock()

    def emit(op_id, event, **fields):
        with output_lock:
            protocol.write(json.dumps({"id": op_id, "event": event, **fields}, ensure_ascii=False) + "\n")
            protocol.flush()

    if len(sys.argv) != 2:
        return 2
    host = Host(Runtime(sys.argv[1]), emit)
    emit("", "ready")
    try:
        while True:
            line = sys.stdin.readline(4097)
            if not line:
                break
            if len(line) > 4096:
                return 2
            try:
                row = json.loads(line)
                if not isinstance(row, dict):
                    return 2
            except (ValueError, TypeError):
                return 2
            host.dispatch(row)
            if row.get("op") == "close":
                break
    finally:
        host.cancel()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
