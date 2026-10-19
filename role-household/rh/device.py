"""把角色的话推给“该角色的设备”播放，等设备回执才交棒（主机这一侧）。

设备 = 一个角色的躯体（现在是网页里的虚拟头，以后是真机）：只负责播，灵魂（claude、发言锁）留在主机。
主机经 hub 和设备之间只有四种事件（JSON，经 hub 的 WebSocket 转发）：

    主机 -> 设备  {"type":"device","event":"start","role":角色 id,"play_id":...,"text":...}               开始说
    主机 -> 设备  {"type":"device","event":"audio","role":...,"play_id":...,"index":n,"last":bool,
                   "duration":秒,"mime":"audio/wav","data":base64}                                     音频（一句一块）
    主机 -> 设备  {"type":"device","event":"stop","role":...,"play_id":...}                             停止（打断）
    设备 -> 主机  {"type":"receipt","play_id":...,"result":"done"|"stopped"|"failed"}                  回执
                  hub 自己也会代发回执：该角色没有设备在线 "no_device"，播到一半设备断线 "lost"。

音频按句切块、合成一句发一句（同 conest 的分块播放：第一句合成好就开始播，后面的边播边合成）。
做法参考 conest（Zssan12/conest，src/companion/voice/device_app.py 的 DeviceRoom）：每个页面一个设备身份、
播完回执才释放、停止后不续播。和它不同的一点：conest 没有回执就一直占着，这里按“音频时长 + RECEIPT_GRACE”兜底交棒，
免得一个网页卡住整场讨论。
"""
from __future__ import annotations

import base64
import re
import threading
import time
import uuid
from typing import Callable, Protocol

from .voice import TTS, Synth, wav_secs

# 回执超时 = 音频时长 + 这么多秒；到了还没回执就当设备卡住，给设备发 stop、交棒。
# 来源：2026-10-18 真跑实测“推送到回执”比音频时长多 0.6–1.3 秒（云端 hub）、0.1–0.4 秒（本机 hub），
# 见 docs/evidence/device-*.log；取约 4 倍余量。
RECEIPT_GRACE = 5.0
# 等回执时多久看一次打断。来源：沿用 rh/meeting.py _acquire 的 0.02 秒重试间隔。
POLL_SEC = 0.02

_SENTENCE = re.compile(r"[^。！？!?；;…\n]+[。！？!?；;…\n]*")


def sentences(text: str) -> list[str]:
    """按句末标点切句（标点留在句尾）；没有标点就整段一句。"""
    out = [s.strip() for s in _SENTENCE.findall(text)]
    return [s for s in out if s] or [text]


class DeviceLink(Protocol):
    """主机连 hub 的那条线（rh.host.Host 实现）。"""

    def device_online(self, role: str) -> bool: ...
    def send_device(self, frames: list[dict]) -> bool: ...


class DeviceSpeaker:
    """TTS 实现：角色有设备在线就合成音频推给设备、等回执；没有就交给本机设备 local（Mac 喇叭）。

    返回值同 TTS：True = 交棒，False = 被用户打断（cancel 响了，已给设备发 stop）。
    设备自己停了、播放失败、断线、回执超时都算交棒（True），日志里留一笔，不能让发言锁卡住。
    """

    def __init__(self, synth: Synth, local: TTS | None, log: Callable[[str], None] = lambda s: print(s, flush=True),
                 grace: float = RECEIPT_GRACE):
        self.synth, self.local, self.log, self.grace = synth, local, log, grace
        self.link: DeviceLink | None = None
        self._mu = threading.Lock()
        self._waiters: dict[str, tuple[threading.Event, list]] = {}
        # 回执超时过的角色：它的设备收了音频却既不播也不回执（2026-10-19 logs/host-device-20261019-000124.log 每句都超时、
        # Mac 上没声音）。之后直接在本机播，不再每句先空等“音频时长 + 余量”；hub 发来新的设备名单时清空，重新试设备。
        # 小智板子的回执是主机自己的服务代发的，板子连着就一定会回（停下回 stopped、播完回 done）。所以板子那次超时后
        # 只要对那次播放还有回执，就说明连接是好的、只是偶发慢了：清掉卡住标记，下一句照常推给板子（rh/xiaozhi.py）。
        self._late: dict[str, str] = {}   # 回执超时的 play_id -> 角色
        self._stuck: set[str] = set()

    def devices_changed(self) -> None:
        """hub 发来设备名单（有页面开了/关了声音、重连）或小智板子连上/断开：之前卡住的设备重新试。"""
        with self._mu:
            self._stuck.clear()
            self._late.clear()

    def on_receipt(self, play_id: str, result: str, started: bool | None = None, board: bool = False) -> None:
        """hub 或小智服务转来的回执（主机事件循环线程里调用）。started：设备有没有真的开始播（failed 时用）。
        board：回执来自小智板子（见上面 _late 的说明）。"""
        with self._mu:
            w = self._waiters.get(play_id)
            # 只认板子的：网页设备停下时也可能回 stopped，但它卡住是“收了音频不播”，不能因此重新用它
            role = self._late.pop(play_id, None) if board and result in ("done", "stopped") else None
            if role is not None and role in self._stuck:
                self._stuck.discard(role)
                self.log(f"[device] {role} 的板子对超时那次有回执 {result}（连接正常），下一句起照常推给板子")
        if w is not None:
            w[1].append((result, started))
            w[0].set()

    def close(self) -> None:
        if self.local is not None and hasattr(self.local, "close"):
            self.local.close()
        if hasattr(self.synth, "close"):   # Qwen 常驻合成进程
            self.synth.close()

    def _local(self, text: str, voice: str, cancel: threading.Event, role: str) -> bool:
        if self.local is None:
            return True
        self.log(f"[device] {role} 在本机喇叭播放（{len(text)} 字）")
        return self.local.speak(text, voice, cancel, role=role)

    def speak(self, text: str, voice: str, cancel: threading.Event, role: str = "") -> bool:
        link = self.link
        if link is None or not link.device_online(role) or role in self._stuck:
            return self._local(text, voice, cancel, role)
        play_id = uuid.uuid4().hex
        base = {"type": "device", "role": role, "play_id": play_id}
        ev, box = threading.Event(), []
        with self._mu:
            self._waiters[play_id] = (ev, box)
        stopped = False

        def stop() -> None:
            nonlocal stopped
            stopped = True
            link.send_device([{**base, "event": "stop"}])

        t0 = None
        try:
            parts = sentences(text)
            # 先单独发“开始说”再合成第一句（审查第 8 条）：设备刚下线时 hub 回的 no_device 在合成第一句期间就到了，
            # 合成完一看就改用本机，不用再多合成一句才发现。
            if not link.send_device([{**base, "event": "start", "text": text}]):
                self.log(f"[device] {role} 推给设备失败（和 hub 断了），改用本机播放")
                return self._local(text, voice, cancel, role)
            t0 = time.monotonic()
            self.log(f"[device] {role} 开始推给设备 play={play_id[:8]}，共 {len(parts)} 句")
            duration, end, n = 0.0, 0.0, 0   # end：按逐句送达时间累计的预计播完时刻；n：已发的块数
            marked = False   # 已发过 last=True 的块
            for i, part in enumerate(parts):
                if ev.is_set():
                    break   # 设备已回执（停了、断了、刚下线），后面的不再合成
                wav = self.synth.synth(part, voice)   # 出错：下面 except 里先给设备发 stop 再抛，meeting 记 tts_error
                secs = wav_secs(wav)
                if cancel.is_set():
                    stop()
                    self.log(f"[device] {role} 合成途中被打断，给设备发 stop play={play_id[:8]}")
                    return False
                if ev.is_set():
                    break   # 合成这一句期间设备已回执（如 no_device），这句不再发
                if secs <= 0:
                    continue   # 纯符号片段（如“——”）合成出 0 帧：跳过，不发给设备（播放器把 0 秒当致命错误）
                marked = i == len(parts) - 1
                if not link.send_device([{**base, "event": "audio", "index": n, "last": marked, "duration": round(secs, 3),
                                          "mime": "audio/wav", "data": base64.b64encode(wav).decode()}]):
                    break   # 播到一半断线：meeting 会被 host 停掉，下面等 cancel
                # 设备按顺序播：这一句最早在它送到时开始，也要等上一句播完。
                end = max(end, time.monotonic()) + secs
                duration += secs
                n += 1
            if n == 0 and not ev.is_set():
                stop()   # 一句能出声的都没有（全是符号）：让设备结束这次播放，不等回执
                return True
            if not marked and not ev.is_set():
                # 结束标记：不带音频的最后一块（最后几句是 0 秒被跳过时，前面发的块都没标 last）
                link.send_device([{**base, "event": "audio", "index": n, "last": True}])
            deadline = end + self.grace
            while not ev.wait(POLL_SEC):
                if cancel.is_set():
                    stop()
                    self.log(f"[device] {role} 被打断，给设备发 stop play={play_id[:8]}")
                    return False
                if time.monotonic() > deadline:
                    with self._mu:
                        self._late[play_id] = role
                    stop()
                    # 一个回执都没有：主机看不到它播没播，按没播出来处理（用户在 Mac 前听不到声音），
                    # 同“failed 且 started=false”改用本机喇叭，不静默交棒；这个角色之后也先用本机，直到设备名单变了。
                    with self._mu:
                        if play_id in self._late:   # 发 stop 期间板子已回了执就不标卡住
                            self._stuck.add(role)
                    self.log(f"[device] {role} 回执超时（音频 {duration:.1f} 秒 + {self.grace:g} 秒），发 stop，改用本机播放"
                             f" play={play_id[:8]}")
                    return self._local(text, voice, cancel, role)
            result, started = box[0]
            if result == "no_device":
                self.log(f"[device] {role} 设备刚下线，改用本机播放")
                return self._local(text, voice, cancel, role)
            if result == "failed" and started is False:
                self.log(f"[device] {role} 设备一句都没播出来就失败（浏览器拒绝播放？），改用本机播放 play={play_id[:8]}")
                return self._local(text, voice, cancel, role)
            self.log(f"[device] {role} 回执 {result}，推送到回执 {time.monotonic() - t0:.2f} 秒（音频 {duration:.2f} 秒），"
                     f"交棒 play={play_id[:8]}")
            return True
        except BaseException:
            # 已经发了“开始说”却出错（合成失败、超时）：先让设备停下，否则下一个角色开口时它还在播。
            if t0 is not None and not stopped and not ev.is_set():
                stop()
                self.log(f"[device] {role} 推送途中出错，给设备发 stop play={play_id[:8]}")
            raise
        finally:
            with self._mu:
                self._waiters.pop(play_id, None)
