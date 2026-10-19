"""板子收音：小智板子上传的麦克风 Opus 解成 PCM，当作又一个音源接进主机现有的收音链路
（rh/voice.py Listener：切句、转文字、本地唤醒模型、暂停、闭麦，全和 Mac 麦克风同一套）。

    板子 ──WS 二进制帧（Opus 16k/60ms，按协议版本带头）──▶ XiaozhiServer.on_mic(角色, Opus 包)
         ──▶ BoardMic：拼成 Ogg 流喂常驻 ffmpeg 解码 ──▶ 30 毫秒 16k PCM 帧队列 ──▶ Listener（音源 frames()）
         ──▶ Host.on_voice / on_kws（叫名字才应、暂停、闭麦、开麦，同 Mac 麦克风）

板子近场收音，不和 Mac 喇叭的回声混（~/code/role-household-fw/PLAN-two-forms.md 1.3 第 2 条）。两形态共用：
形态 A 进自建频道，形态 B 以后转进 Discord。固件侧要放开上行（role-household-fw xiaozhi-esp32 分支 rh-uplink，
CONFIG_RH_DISABLE_MIC_UPLINK=n、CONFIG_RH_ALWAYS_LISTEN=y）；现在板子上的固件不上传，这里收不到东西也不出错。

一次只听一块板子：先说话的那块占着，它 OWNER_IDLE_SEC 没再上传就换别的板子可以占（几块板子的声音混在一个切句器里会乱）。
已知：真固件（rh-uplink 分支 CONFIG_RH_ALWAYS_LISTEN=y）进 Listening 后每一帧都上传、没有 VAD，占着的板子静默时也在上传，
所以多块板子时 OWNER_IDLE_SEC 永远不会换人。现在只绑了一块板，等有第二块板再改成按解码后的音量判断占用
（代码审查 ~/.claude/reviews/rh-board-mic-code.md 建议 4）。

板子断开、换板子在主机事件循环里发生（rh/xiaozhi.py 调 on_mic / on_mic_end）：这里锁内只把解码器摘下来，
关 ffmpeg、等它退出都放到后台线程，不卡事件循环（代码审查必须修 1：原来锁内等 join，板子掉线会把整个主机停 2 秒）。
"""
from __future__ import annotations

import queue
import struct
import subprocess
import threading
import time
from typing import Callable, Iterator

from .voice import END_SILENCE_MS, FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE
from .xiaozhi import FRAME_MS as OPUS_FRAME_MS, find_ffmpeg

FRAME_BYTES = FRAME_SAMPLES * 2   # 一帧 16 位单声道 PCM 的字节数（rh/voice.py 的帧：30 毫秒）
# 板子不再上传后补多少帧静音：够切句器认出一句结束（rh/voice.py END_SILENCE_MS）再多两帧，之后就不补，等下一包。
# 来源：END_SILENCE_MS / FRAME_MS + 2，实现者定。
TAIL_FRAMES = END_SILENCE_MS // FRAME_MS + 2
# 占着收音的板子这么久没上传，别的板子可以接着占。来源：实现者定，比一句话中间的停顿（END_SILENCE_MS 0.7 秒）长。
OWNER_IDLE_SEC = 2.0
# 没有板子上传时，读帧多久醒一次看要不要退出（秒）。来源：实现者定，只影响主机退出时等多久。
IDLE_POLL_SEC = 0.5
# 板子还在上传时，一包（60 毫秒，解出两帧）和下一包之间队列会空 30 毫秒左右：这么久没有新帧才算板子停了、开始补静音，
# 不然包和包之间会被塞进静音帧（转文字的音频里三分之一是假静音，一句话的时间轴也被拉长，唤醒模型的命中对不上句子）。
# 来源：实现者定，取包间隔（rh/xiaozhi.py FRAME_MS 60 毫秒）的三倍，容 Wi-Fi 抖动。
GAP_SEC = 3 * OPUS_FRAME_MS / 1000
# Opus 在 Ogg 里的时间单位是 48 kHz 采样数（来源：RFC 7845 第 4 节）：一包 60 毫秒 = 2880。
GRANULE_PER_PACKET = 48000 * OPUS_FRAME_MS // 1000
OGG_SERIAL = 0x72680001   # Ogg 逻辑流编号，一个流里固定一个值就行（来源：RFC 3533 第 6 节）；值是实现者随便定的
READ_CHUNK = 4096         # 读 ffmpeg 输出一次最多多少字节。来源：实现者定，约 0.13 秒的 PCM
HEADER_PAGES = 2          # 来源：RFC 7845 第 3 节，头两页是 OpusHead、OpusTags，音频从第 2 页起
# ffmpeg 探测输入格式最多读多少字节：取它允许的最小值（`ffmpeg -h full`：-probesize from 32 to I64_MAX），
# 头两页 Ogg 就能定格式，不用等更多数据才开始出 PCM。
PROBESIZE = 32
# 关解码器时等 ffmpeg 退出多久（秒）：stdin 关掉后它把剩下的解完就自己退，正常几十毫秒（代码审查探针流式延迟 61 毫秒，
# ~/.claude/reviews/rh-board-mic-code.md）；超时就杀。来源：实现者定，留足余量。只在后台关闭线程里等，不在事件循环里。
CLOSE_WAIT_SEC = 2.0

_CRC = []
for _i in range(256):
    _r = _i << 24
    for _ in range(8):
        _r = ((_r << 1) ^ 0x04C11DB7) if _r & 0x80000000 else (_r << 1)
    _CRC.append(_r & 0xFFFFFFFF)


def ogg_crc(data: bytes) -> int:
    """Ogg 页校验：CRC-32，多项式 0x04C11DB7，不反射，初值 0（RFC 3533 第 6 节）。"""
    c = 0
    for b in data:
        c = ((c << 8) & 0xFFFFFFFF) ^ _CRC[((c >> 24) ^ b) & 0xFF]
    return c


def ogg_page(packet: bytes, serial: int, seq: int, granule: int, flags: int = 0) -> bytes:
    """一个包装成一页（包不超过 255×255 字节；板子一包 60 毫秒 Opus 远小于它）。页头格式 RFC 3533 第 6 节：
    校验和在页头第 22-26 字节。"""
    segs = [255] * (len(packet) // 255) + [len(packet) % 255]
    head = struct.pack("<4sBBqIIIB", b"OggS", 0, flags, granule, serial, seq, 0, len(segs)) + bytes(segs)
    page = bytearray(head + packet)
    struct.pack_into("<I", page, 22, ogg_crc(bytes(page)))
    return bytes(page)


def opus_head(rate: int = SAMPLE_RATE) -> bytes:
    """OpusHead：版本 1、单声道、pre-skip 0、原始采样率、增益 0、映射族 0（RFC 7845 第 5.1 节）。"""
    return struct.pack("<8sBBHIhB", b"OpusHead", 1, 1, 0, rate, 0, 0)


def opus_tags() -> bytes:
    vendor = b"role-household"
    return b"OpusTags" + struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", 0)   # RFC 7845 第 5.2 节，0 条注释


class OpusStream:
    """一个常驻 ffmpeg：Opus 包拼成 Ogg 流从 stdin 喂进去，16k 单声道 PCM 从 stdout 出来交给 on_pcm（读线程里调）。"""

    def __init__(self, on_pcm: Callable[[bytes], None], ffmpeg: str | None = None,
                 log: Callable[[str], None] = lambda s: print(s, flush=True)):
        self.on_pcm, self.log = on_pcm, log
        self.p = subprocess.Popen([ffmpeg or find_ffmpeg(), "-loglevel", "error", "-fflags", "nobuffer",
                                   "-probesize", str(PROBESIZE), "-analyzeduration", "0", "-f", "ogg", "-i", "pipe:0",
                                   "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-flush_packets", "1", "pipe:1"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        self.granule = 0
        self._mu = threading.Lock()
        # OpusHead 页带流开始标记 BOS（0x02，来源：RFC 3533 第 6 节）
        self._write(ogg_page(opus_head(), OGG_SERIAL, 0, 0, flags=0x02))
        self._write(ogg_page(opus_tags(), OGG_SERIAL, 1, 0))
        self.seq = HEADER_PAGES
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _write(self, b: bytes) -> bool:
        try:
            self.p.stdin.write(b)
            return True
        except (BrokenPipeError, ValueError, OSError):
            return False

    def feed(self, packet: bytes) -> bool:
        with self._mu:
            self.granule += GRANULE_PER_PACKET
            ok = self._write(ogg_page(packet, OGG_SERIAL, self.seq, self.granule))
            self.seq += 1
            return ok

    def _read(self) -> None:
        while True:
            try:
                b = self.p.stdout.read(READ_CHUNK)
            except (ValueError, OSError):
                return
            if not b:
                return
            self.on_pcm(b)

    def alive(self) -> bool:
        return self.p.poll() is None

    def close(self) -> None:
        """关 stdin 让 ffmpeg 解完剩下的退出，等 CLOSE_WAIT_SEC 不退就杀。会阻塞：BoardMic 在后台线程里调它。"""
        try:
            self.p.stdin.close()
        except OSError:
            pass
        try:
            self.p.wait(CLOSE_WAIT_SEC)
        except subprocess.TimeoutExpired:
            self.p.kill()
        self._reader.join(CLOSE_WAIT_SEC)
        self.p.stdout.close()


class BoardMic:
    """XiaozhiServer.on_mic / on_mic_end 接这里；frames(stop) 给 Listener 当音源。线程安全。
    on_packet / on_end 在事件循环里调，不阻塞：解码器的关闭放后台线程（_retire）。"""

    def __init__(self, decoder: Callable[[Callable[[bytes], None]], OpusStream] | None = None,
                 log: Callable[[str], None] = lambda s: print(s, flush=True), clock: Callable[[], float] = time.monotonic):
        self.decoder = decoder or (lambda on_pcm: OpusStream(on_pcm, log=log))
        self.log, self.clock = log, clock
        self._mu = threading.Lock()   # 只护 _owner / _last / _dec / _closers；锁内不做会等的事
        self._owner: str | None = None
        self._last = 0.0
        self._dec: OpusStream | None = None
        self._closers: list[threading.Thread] = []   # 正在后台关的解码器；close() 等它们
        self._q: queue.Queue[bytes] = queue.Queue()
        self.packets = 0   # 收到的 Opus 包数（日志、测试用）

    def on_packet(self, role: str, packet: bytes) -> None:
        if not packet:
            return
        with self._mu:
            now = self.clock()
            if self._owner != role:
                if self._owner is not None and now - self._last < OWNER_IDLE_SEC:
                    return   # 别的板子正在说：这块先不听
                self._switch(role)
            self._last = now
            if self._dec is not None and not self._dec.alive():
                # 原因看不到：ffmpeg 的 stderr 丢掉了（-loglevel error 也不收）；线上只会表现成「没转出字」，所以至少记一行
                self.log(f"[board-mic] 解码器 ffmpeg 退了，重开一个（{role} 的板子）")
                self._retire(self._dec)
                self._dec = None
            if self._dec is None:
                self._dec = self.decoder(self._sink())
            self.packets += 1
            first = self.packets == 1
            dec = self._dec
        if first:
            self.log(f"[board-mic] 开始收 {role} 的板子的麦克风")
        if not dec.feed(packet):
            self.log(f"[board-mic] 喂不进解码器（ffmpeg 的管道断了），下一包重开（{role} 的板子）")
            with self._mu:
                if self._dec is dec:
                    self._retire(dec)
                    self._dec = None

    def on_end(self, role: str) -> None:
        """板子断开：它的解码器摘下来、后台关掉。立刻返回（事件循环里调）。"""
        with self._mu:
            if self._owner == role:
                self._switch(None)

    def _switch(self, role: str | None) -> None:
        """锁内调：换占着收音的板子。旧解码器只摘下来，关闭交给后台线程。"""
        if self._dec is not None:
            self._retire(self._dec)
            self._dec = None
        if self._owner is not None or role is not None:
            self.log(f"[board-mic] 收音的板子 {self._owner or '无'} → {role or '无'}")
        self._owner = role

    def _retire(self, dec: OpusStream) -> None:
        """锁内调：解码器在后台线程里关（close() 会等 ffmpeg 退出，不能在事件循环里等）。"""
        t = threading.Thread(target=dec.close, daemon=True)
        t.start()
        self._closers = [c for c in self._closers if c.is_alive()] + [t]

    def _sink(self) -> Callable[[bytes], None]:
        """给一个解码器的 on_pcm：不满一帧的余量各解码器自己存（只有它的读线程调，不用锁），整帧进共用队列。
        换板子后旧解码器的尾巴（几十毫秒）可能还进队列，可忽略。"""
        buf = b""

        def on_pcm(pcm: bytes) -> None:
            nonlocal buf
            buf += pcm
            n = len(buf) - len(buf) % FRAME_BYTES
            for i in range(0, n, FRAME_BYTES):
                self._q.put(buf[i:i + FRAME_BYTES])
            buf = buf[n:]
        return on_pcm

    def frames(self, stop: threading.Event) -> Iterator[bytes]:
        """30 毫秒一帧。板子在上传时照原样出；GAP_SEC 没有新帧算它停了，一次性补 TAIL_FRAMES 帧静音让最后一句收尾，
        之后等下一包（不空转）。静音不按帧的节奏慢慢给：切句器只数帧不看墙钟，按节奏等会让这句的结束时刻
        （rh/voice.py Listener 切出时的 time.time()）比真实晚 0.7 秒以上——这台 Mac 2026-10-19 实测 sleep(0.01) 要 40 毫秒，
        25 帧拖 2.5 秒——唤醒模型按时间窗挂到句子上的命中就对不上，「暂停」会被同一路执行两遍。"""
        streaming = False
        while not stop.is_set():
            try:
                f = self._q.get(timeout=GAP_SEC if streaming else IDLE_POLL_SEC)
            except queue.Empty:
                if streaming:
                    streaming = False
                    for _ in range(TAIL_FRAMES):
                        yield bytes(FRAME_BYTES)
                continue
            streaming = True
            yield f

    def close(self) -> None:
        """主机退出、测试收尾：关掉解码器并等它退出（最多 CLOSE_WAIT_SEC）。板子断开走 on_end，不等。"""
        with self._mu:
            self._switch(None)
            closers = list(self._closers)
        for c in closers:
            c.join(CLOSE_WAIT_SEC)
