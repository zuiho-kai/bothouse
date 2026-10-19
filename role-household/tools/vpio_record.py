"""真机录音（会出声、会收音，只在用户同意的时段跑）：按 tools/voice_offline.py 的场景，
角色台词经系统语音处理辅助进程（rh/vpio）从 Mac 喇叭播，“用户的话”从 Jabra 耳麦的听筒放，
录下系统语音处理后的收音，存成 DIR/<场景>.u<档>.vpio.wav，之后 `voice_offline.py eval DIR` 会多评“真机系统语音处理”一栏。

    uv run python tools/vpio_record.py DIR            # DIR = voice_offline.py sim 生成的目录（要它的 meta.json、ref.wav）

为什么用耳麦听筒放用户的话：系统语音处理会把同一个喇叭放出的别的 app 声音也当回声减掉（2026-10-19 原型实测，
afplay 从喇叭放的「暂停」处理后只剩底噪），所以不能用喇叭冒充用户；耳麦听筒不是它的输出设备，放出的声音算“近端人声”。
局限：听筒贴着耳麦的麦，是近场声、没有房间混响，比真人一米外说话干净；最终还要用户本人说一遍。
跑之前先停掉 rh.host（两边都会收到声音、都会出声）。
"""
from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import voice_offline as vo  # noqa: E402
from rh import vpio  # noqa: E402

# 听筒放出的声音到耳麦麦克风：麦克风有声帧 p90 / 放的数字信号有声帧 p90（增益 1 时）。
EARPIECE_COUPLING = 55 / (0.013 * 3504)   # 来源：2026-10-19 实测 /tmp/rhvpio/raw6.wav：增益 0.013 放 p90 3504 的「暂停」，麦克风 p90 约 55
GAP_SEC = 2.0   # 场景之间留的安静秒数，免得上一段的尾巴进来。来源：实现者定（比 rh/voice.py END_SILENCE_MS 长）


def earpiece() -> int:
    import sounddevice as sd
    for i, d in enumerate(sd.query_devices()):
        if "Jabra" in d["name"] and d["max_output_channels"] > 0:
            return i
    raise SystemExit("找不到 Jabra 耳麦的输出（听筒）")


def p90(x: np.ndarray) -> float:
    r = vo.frame_rms(x)
    return float(np.percentile(r[r > r.max() * 0.05], 90))   # 同 voice_offline.sim 的算法


def record(d: Path) -> None:
    import sounddevice as sd
    meta = json.loads((d / "meta.json").read_text())
    dev = earpiece()
    proc = subprocess.Popen([str(vpio.build_helper())], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    got = bytearray()
    ready = threading.Event()

    def rd():
        while True:
            h = proc.stdout.read(5)
            if len(h) < 5:
                return
            body = proc.stdout.read(struct.unpack("<I", h[1:])[0])
            if h[0] == ord("A"):
                got.extend(body)
            elif json.loads(body).get("ev") == "ready":
                ready.set()
    threading.Thread(target=rd, daemon=True).start()
    if not ready.wait(vpio.READY_TIMEOUT):
        raise SystemExit("系统语音处理没就绪")
    try:
        for sc in meta["scenarios"]:
            ref = vo.read_pcm(d / f"{sc['name']}.ref.wav")
            secs = len(ref) / vo.SR
            pcm = np.clip(np.round(ref), -32768, 32767).astype("<i2").tobytes()
            for lvl, f in sc["levels"].items():
                users = [(u["t0"], vo.synth_user(u["text"])) for u in f["user"]]
                time.sleep(GAP_SEC)
                start = len(got)
                proc.stdin.write((json.dumps({"cmd": "play", "id": 1, "sr": vo.SR, "bytes": len(pcm)}) + "\n").encode() + pcm)
                proc.stdin.flush()
                t0 = time.time()
                for at, u in users:
                    g = int(lvl) / (EARPIECE_COUPLING * p90(u))
                    while time.time() - t0 < at:
                        time.sleep(0.005)
                    sd.play(np.clip(u * g / 32768, -1, 1).astype(np.float32), vo.SR, device=dev)
                while time.time() - t0 < secs:
                    time.sleep(0.05)
                out = bytes(got[start:start + int(secs * vo.SR) * 2])
                (d / f"{f['base']}.vpio.wav").write_bytes(vo.wav_bytes(np.frombuffer(out, dtype="<i2").astype(np.float64)))
                print(f"[rec] {f['base']} {len(out) / 2 / vo.SR:.1f} 秒", flush=True)
    finally:
        proc.stdin.close()
        proc.wait(timeout=5)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    record(Path(ap.parse_args().dir))


if __name__ == "__main__":
    main()
