"""假的 rh_vpio 辅助进程（同 rh/vpio/rh_vpio.swift 的协议），不碰声卡。
FAKE_VPIO 环境变量：""（正常）/ "fail"（报 error 退出）/ "die_on_play"（收到 play 就退出）/ "hang"（不报 ready）。
收音：每 10 毫秒交一块 160 样本，样本值是块序号（不出声，只给测试数块）。播放：按 0.1 倍实际时长回 done；stop 回 stopped。"""
import json, os, struct, sys, threading, time
mode = os.environ.get("FAKE_VPIO", "")
out = sys.stdout.buffer
mu = threading.Lock()
def emit(kind, payload):
    with mu:
        out.write(kind + struct.pack("<I", len(payload)) + payload); out.flush()
def event(**e): emit(b"E", json.dumps(e).encode())
if mode == "fail":
    event(ev="error", msg="开不了系统语音处理：假的"); sys.exit(1)
if mode == "hang":
    time.sleep(60); sys.exit(0)
print("fake vpio up", file=sys.stderr, flush=True)
event(ev="ready", **{"in": "fake", "ducking": {"advanced": False, "level": 10}, "agc": True})
def mic():
    i = 0
    while True:
        emit(b"A", struct.pack("<h", i % 30000) * 160); i += 1; time.sleep(0.01)
threading.Thread(target=mic, daemon=True).start()
cur = {"id": None, "timer": None}
def finish(pid):
    with mu:
        if cur["id"] != pid: return
        cur["id"] = None
    event(ev="done", id=pid)
inp = sys.stdin.buffer
while True:
    line = inp.readline()
    if not line: sys.exit(0)
    cmd = json.loads(line)
    if cmd["cmd"] == "play":
        pcm = inp.read(cmd["bytes"])
        if mode == "die_on_play": sys.exit(3)
        with mu: cur["id"] = cmd["id"]
        t = threading.Timer(len(pcm) / 2 / cmd["sr"] * 0.1, finish, args=(cmd["id"],)); t.daemon = True; t.start()
        if os.environ.get("FAKE_VPIO_LOG"):
            open(os.environ["FAKE_VPIO_LOG"], "a").write(f"play {cmd['id']} {cmd['sr']} {len(pcm)}\n")
    elif cmd["cmd"] == "stop":
        with mu: pid, cur["id"] = cur["id"], None
        if pid is not None: event(ev="stopped", id=pid)
