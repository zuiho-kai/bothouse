"""系统语音处理（macOS voice processing，FaceTime 那套回声消除）：收音和本机喇叭播放都走它。

为什么要：2026-10-19 真机验收（/tmp/rhwake/accept.log），耳麦挂书架、人在一米多外，喇叭回声 0.5 秒均值 70-130，
用户说话帧 p90 约 38：角色一开口，用户说「暂停」、叫名字都被盖掉。之前试过 livekit 的 WebRTC AEC3，
离线仿真里它在角色播放时把用户人声一起压到底噪（/tmp/rhaec/diag/REPORT.md），没合入。

做法（roles.toml [voice] player = "vpio" 时才用）：一个 Swift 小进程（rh/vpio/rh_vpio.swift，第一次用时 swiftc 编译）
开 AVAudioEngine 并打开 voice processing，同一个引擎既收音（处理后 16 kHz 单声道 16 位，从 stdout 交回）
又播角色的声音（从 stdin 收 PCM）。系统知道自己往喇叭放了什么，回声在系统里就减掉了，主机这边照旧切句、转写、认口令。

2026-10-19 在这台机器上（macOS 27.0，Jabra EVOLVE 30 II 收音、Mac Studio 扬声器播放）原型实测：
- 引擎能启动，输入格式 3 声道 48 kHz，三个声道内容一样（--probe 打的各声道音量相同），取第 0 声道；
- 辅助进程自己播的角色台词，收音里只剩开头约 1 秒的残留（帧 RMS 约 20），之后 3 左右（不开时同一段 0.5 秒均值 22-81）；
- 别的 app（afplay）从同一个喇叭放的声音也会被当成回声减掉，所以真机验收不能拿喇叭放“用户的话”冒充用户；
- 压低别的 app 音量（ducking）已设成系统允许的最小（关高级压音、程度 min），系统没有“完全不压”的选项。
系统语音处理不能离线跑（离线渲染模式下开不了 voice processing：AVAudioEngine 报 -10863 / -80800），只能真机验。

闭麦按钮、语音「闭麦」停声音走的是 meeting.stop() -> 播放的打断事件 -> 这里的 stop，收音一直开着。
"""
from __future__ import annotations

import json
import queue
import struct
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Iterator

from . import voice as voicemod

SRC = Path(__file__).with_name("vpio") / "rh_vpio.swift"
BUILD = Path(__file__).with_name("vpio") / "build" / "rh_vpio"
# 等辅助进程打开语音处理、报 ready 的秒数。来源：实现者定；2026-10-19 原型实测启动约 1.3 秒，留余量。
READY_TIMEOUT = 10.0
# 没人读收音时最多攒这么多块（每块约 0.1 秒），多的丢掉：只播不收（比如收音关了）时不越攒越多。
# 来源：实现者定，约 10 秒，比 rh/voice.py MIC_STALL_SEC 长得多。
MIC_QUEUE_MAX = 100
# 等一句播完时，除了音频本身时长再多等这么久还没回执就当辅助进程卡了。来源：实现者定（输出缓冲 + 重采样，远小于它）。
PLAY_GRACE_SEC = 5.0


class VPIOError(RuntimeError):
    """started：这句开始播了没有（没开始播的可以改用 afplay 重播，开始了就不重播）。"""

    def __init__(self, msg: str, started: bool = False):
        super().__init__(msg)
        self.started = started


def build_helper(src: Path = SRC, out: Path = BUILD, swiftc: str = "swiftc") -> Path:
    """编译辅助进程（源码比二进制新才重编）。编译不出来抛 RuntimeError。"""
    if out.is_file() and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    r = subprocess.run([swiftc, "-O", str(src), "-o", str(tmp)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"编译 {src.name} 失败：{r.stderr.strip()[-2000:]}")
    tmp.replace(out)
    return out


class VPIO:
    """管一个辅助进程：mic() 读处理后的收音，play() 播一段 PCM。进程死了（拔耳麦、换默认设备）下次用时重开。
    cmd：启动辅助进程的命令（测试换成假的）。"""

    def __init__(self, cmd: list[str], log: Callable[[str], None] = lambda s: print(s, flush=True),
                 ready_timeout: float = READY_TIMEOUT):
        self.cmd, self.log, self.ready_timeout = cmd, log, ready_timeout
        self._mu = threading.Lock()        # 起停进程
        self._wmu = threading.Lock()       # 写 stdin
        self._proc: subprocess.Popen | None = None
        self._mic: queue.Queue[bytes | None] = queue.Queue(MIC_QUEUE_MAX)
        self._events: dict[int, tuple[threading.Event, dict]] = {}
        self._ready = threading.Event()
        self._err = ""
        self._next_id = 0
        self._closed = False

    # ---- 进程 ----
    def _ensure(self) -> subprocess.Popen:
        with self._mu:
            if self._closed:
                raise VPIOError("系统语音处理已关闭")
            if self._proc is not None and self._proc.poll() is None:
                return self._proc
            self._kill()
            self._ready, self._err = threading.Event(), ""
            self._mic = queue.Queue(MIC_QUEUE_MAX)
            proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self._proc = proc
            threading.Thread(target=self._read, args=(proc, self._ready, self._mic), daemon=True).start()
            threading.Thread(target=self._read_log, args=(proc,), daemon=True).start()
            if not self._ready.wait(self.ready_timeout) or proc.poll() is not None:
                err = self._err or f"{self.ready_timeout:g} 秒没就绪"
                self._kill()
                raise VPIOError(f"系统语音处理起不来：{err}")
            return proc

    def _kill(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        if proc.stdin:
            try:
                proc.stdin.close()
            except OSError:
                pass

    def close(self) -> None:
        with self._mu:
            self._closed = True
            self._kill()

    def _read_log(self, proc: subprocess.Popen) -> None:
        with proc.stderr:
            for line in proc.stderr:
                self.log(f"[vpio] {line.decode('utf-8', 'replace').rstrip()}")

    def _read(self, proc: subprocess.Popen, ready: threading.Event, mic: queue.Queue) -> None:
        """读 stdout：'A' 收音块放进 mic 队列（满了丢最旧的），'E' 事件。进程退出时叫醒所有在等的。"""
        out = proc.stdout
        try:
            while True:
                head = out.read(5)
                if len(head) < 5:
                    break
                kind, n = head[0], struct.unpack("<I", head[1:])[0]
                body = out.read(n)
                if len(body) < n:
                    break
                if kind == ord("A"):
                    while True:
                        try:
                            mic.put_nowait(body)
                            break
                        except queue.Full:
                            try:
                                mic.get_nowait()
                            except queue.Empty:
                                pass
                elif kind == ord("E"):
                    self._on_event(json.loads(body), ready)
        finally:
            out.close()
            proc.wait()
            if not self._err:
                self._err = f"辅助进程退出了（退出码 {proc.returncode}）"
            ready.set()
            try:
                mic.put_nowait(None)
            except queue.Full:
                pass
            with self._mu:
                waiting = list(self._events.values())
            for ev, info in waiting:
                info.setdefault("ev", "dead")
                ev.set()

    def _on_event(self, e: dict, ready: threading.Event) -> None:
        kind = e.get("ev")
        if kind == "ready":
            self.log(f"[vpio] 系统语音处理就绪：输入 {e.get('in')}，压其它 app 音量 {e.get('ducking')}，自动增益 {e.get('agc')}")
            ready.set()
        elif kind == "error":
            self._err = str(e.get("msg", ""))
        elif kind in ("done", "stopped"):
            with self._mu:
                w = self._events.get(e.get("id"))
            if w is not None:
                w[1].update(e)
                w[0].set()

    def _send(self, proc: subprocess.Popen, cmd: dict, data: bytes = b"") -> None:
        with self._wmu:
            proc.stdin.write((json.dumps(cmd) + "\n").encode() + data)
            proc.stdin.flush()

    # ---- 收音 ----
    def mic(self) -> Iterator[bytes]:
        """处理后的收音，按 rh.voice 的帧长（30 毫秒）切好交出。进程死了或卡住抛 RuntimeError（rh.voice.resilient 会重开）。"""
        self._ensure()
        q = self._mic
        step = voicemod.FRAME_SAMPLES * 2
        buf = bytearray()
        while True:
            try:
                chunk = q.get(timeout=voicemod.MIC_STALL_SEC)
            except queue.Empty:
                raise RuntimeError(f"{voicemod.MIC_STALL_SEC:g} 秒没收到声音数据（麦克风拔掉了？）") from None
            if chunk is None:
                raise RuntimeError(f"系统语音处理停了：{self._err}")
            buf += chunk
            while len(buf) >= step:
                yield bytes(buf[:step])
                del buf[:step]

    # ---- 播放 ----
    def play(self, pcm: bytes, sr: int, cancel: threading.Event) -> bool:
        """播一段 16 位单声道 PCM，阻塞到播完（True）；cancel 一响就停（False）。出错抛 VPIOError。"""
        proc = self._ensure()
        with self._mu:
            self._next_id += 1
            pid = self._next_id
            done, info = threading.Event(), {}
            self._events[pid] = (done, info)
        try:
            try:
                self._send(proc, {"cmd": "play", "id": pid, "sr": sr, "bytes": len(pcm)}, pcm)
            except OSError as e:
                raise VPIOError(f"写不进辅助进程：{e!r}") from None
            deadline = time.monotonic() + len(pcm) / 2 / sr + PLAY_GRACE_SEC
            while not done.wait(0.03):
                if cancel.is_set():
                    try:
                        self._send(proc, {"cmd": "stop"})
                    except OSError:
                        pass
                    done.wait(1.0)   # 等它回 stopped，免得下一句开头被这个 stop 掐掉；来源：实现者定
                    return False
                if time.monotonic() > deadline:
                    raise VPIOError("辅助进程播完没回执", started=True)
            if info.get("ev") == "dead":
                raise VPIOError(f"播放中系统语音处理停了：{self._err}", started=True)
            if info.get("error"):
                raise VPIOError(f"辅助进程播不了这段：{info['error']}")
            return info.get("ev") == "done"
        finally:
            with self._mu:
                self._events.pop(pid, None)


class VPIOPlayTTS:
    """本机喇叭走系统语音处理：先用 synth 合成整段，交给 VPIO 播，阻塞到播完；打断事件一响就停。
    系统语音处理起不来（没麦、设备刚拔）且这句还没开始播时，这句改用 fallback（afplay，旧方式）播，免得角色没声音。"""

    def __init__(self, synth: voicemod.Synth, vpio: VPIO, fallback: voicemod.PlayTTS | None = None,
                 log: Callable[[str], None] = lambda s: print(s, flush=True)):
        self.synth, self.vpio, self.fallback, self.log = synth, vpio, fallback, log
        self._closed = False

    def close(self) -> None:
        self._closed = True
        self.vpio.close()
        if self.fallback is not None and hasattr(self.fallback, "close"):
            self.fallback.close()

    def speak(self, text: str, voice: str, cancel: threading.Event, role: str = "") -> bool:
        if self._closed:
            return False
        wav = self.synth.synth(text, voice)
        if cancel.is_set() or self._closed:
            return False
        pcm, sr = read_wav(wav)
        try:
            return self.vpio.play(pcm, sr, cancel)
        except VPIOError as e:
            if e.started or self.fallback is None or self._closed:
                self.log(f"[vpio] 这句没播完：{e}")
                return True
            self.log(f"[vpio] 系统语音处理播不了，这句改用 afplay：{e}")
            return self.fallback.play_wav(wav, cancel)


def read_wav(wav: bytes) -> tuple[bytes, int]:
    """WAV -> (16 位单声道 PCM, 采样率)。合成出来的都是 16 位单声道（say -o 16 kHz、rh/qwen_worker.py 24 kHz）。"""
    import io
    import wave
    with wave.open(io.BytesIO(wav), "rb") as r:
        if r.getsampwidth() != 2 or r.getnchannels() != 1:
            raise RuntimeError(f"只播 16 位单声道 WAV，这段是 {r.getsampwidth() * 8} 位 {r.getnchannels()} 声道")
        return r.readframes(r.getnframes()), r.getframerate()
