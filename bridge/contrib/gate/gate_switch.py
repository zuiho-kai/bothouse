"""闸门切换器：cc-connect 只连这里（127.0.0.1:9930），由它决定闸门在哪跑。

- 和 GPU 机器在同一个局域网（tailscale 直连）→ 通过 SSH 在对面的 WSL 里前台跑 gate.py，
  端口转发回本机，请求原样转过去；
- 不在同一个局域网（走 DERP 中继或连不上）→ 断开那条 SSH，本地按规则立即回答，
  效果等于没开闸门：主 bot 一律回复，sub 只在被 @ 时回复。
- 转发出错或超时也立即按规则回答，不让 cc-connect 等满 gate_timeout_ms。

只用标准库：python3 contrib/gate/gate_switch.py
配置用环境变量（见下面 CONFIG），日志写到 SWITCH_LOG。
"""
import ipaddress
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONFIG = {
    "listen_port": int(os.environ.get("SWITCH_PORT", "9930")),          # cc-connect 的 gate_url 指向这里
    "tunnel_port": int(os.environ.get("SWITCH_TUNNEL_PORT", "19930")),  # 本机这头的转发端口
    "remote_port": int(os.environ.get("SWITCH_REMOTE_PORT", "9930")),   # 对面 gate.py 的端口
    # GPU 机器（SSH 目标 user@host）和它的 tailscale IP：没有默认值，必须给（见 main 里的检查）
    "host": os.environ.get("SWITCH_HOST", ""),
    "tailscale_ip": os.environ.get("SWITCH_TS_IP", ""),
    "start_script": os.environ.get("SWITCH_START_SCRIPT",
                                   str(Path(__file__).with_name("start_gate_wsl.sh"))),
    "stop_script": os.environ.get("SWITCH_STOP_SCRIPT",
                                  str(Path(__file__).with_name("stop_gate_wsl.sh"))),
    "check_every": float(os.environ.get("SWITCH_CHECK_EVERY", "10")),
    "forward_timeout": float(os.environ.get("SWITCH_FORWARD_TIMEOUT", "2.5")),
    "log": Path(os.environ.get("SWITCH_LOG", Path.home() / ".cc-connect-gate-switch/switch.jsonl")),
}
TAILSCALE = os.environ.get("TAILSCALE", "tailscale")
LAN_MAX_MS = float(os.environ.get("SWITCH_LAN_MAX_MS", "30"))  # 直连且延迟不超过这个，就当同一个局域网
GATE_PY = Path(os.environ.get("SWITCH_GATE_PY", Path(__file__).with_name("gate.py")))
# 团队文件：GATE_TEAM 给就用它；不给由 gate.py 自己找向导写的 gate-team.json（同 gate.py 的默认）。


class NeedModel(Exception):
    """这条要 4B 判断，本地没有模型。"""


def load_rules():
    """加载 gate.py 的确定性规则（@、点名、应答、提问…），但不加载模型。

    用一个假的 scorer 模块顶替：任何需要模型打分的地方都抛 NeedModel，
    由 local_rule 退回原来的兜底。规则只有 gate.py 一份，不会两处不一致。
    """
    import importlib.util
    import sys
    import types

    class _Task:
        def score(self, *a, **k):
            raise NeedModel()

    class _Scorer:
        def __init__(self, *a, **k):
            pass

        def prepare(self, *a, **k):
            return _Task()

    stub = types.ModuleType("scorer")
    stub.Scorer = _Scorer
    saved = sys.modules.get("scorer")
    sys.modules["scorer"] = stub
    try:
        spec = importlib.util.spec_from_file_location("gate_rules", GATE_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        if saved is None:
            sys.modules.pop("scorer", None)
        else:
            sys.modules["scorer"] = saved


try:
    RULES = load_rules()
except Exception as e:  # gate.py 读不了就只用最简单的兜底
    RULES = None
    print(f"gate.py 规则加载失败，off 模式只用简单兜底：{e!r}", flush=True)

state = {"mode": "off", "why": "starting", "tunnel": None, "upstream_ok": False, "since": time.time(),
         "tunnel_started": 0.0, "backoff": 0.0, "retry_at": 0.0, "remote_running": False}
QUICK_DEATH = 60      # 隧道启动后这么多秒内就断，算启动失败，开始退避
BACKOFF_MIN, BACKOFF_MAX = 30, 300
lock = threading.Lock()


def log(**fields):
    CONFIG["log"].parent.mkdir(parents=True, exist_ok=True)
    with CONFIG["log"].open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": time.strftime("%F %T"), **fields}, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- 在不在一个局域网

def on_same_lan():
    """tailscale ping 直连且对面是私网地址 → 同一个局域网。返回 (bool, 说明)。"""
    try:
        out = subprocess.run([TAILSCALE, "ping", "-c", "1", "--timeout", "2s", CONFIG["tailscale_ip"]],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception as e:
        return False, f"tailscale ping 失败：{e}"
    m = re.search(r"via \[?([0-9A-Fa-f:.]+?)\]?:\d+ in (\d+(?:\.\d+)?)ms", out)
    if not m:
        return False, ("走中继" if "DERP" in out else "ping 不通") + f"：{out.strip()[:80]}"
    addr, ms = m.group(1), float(m.group(2))
    try:
        private = ipaddress.ip_address(addr).is_private
    except ValueError:
        private = False
    # 同一个家里网络，tailscale 有时走 IPv6 公网地址直连（2026-10-16 实测 7ms），也算局域网
    lan = private or ms <= LAN_MAX_MS
    kind = "局域网" if private else ("同网 IPv6 " if lan else "公网")
    return lan, f"{kind}直连 {addr}，{m.group(2)}ms"


# ---------------------------------------------------------------- SSH 隧道 + 远端 gate

def tunnel_alive():
    p = state["tunnel"]
    return p is not None and p.poll() is None


def start_tunnel():
    log_path = CONFIG["log"].with_name("tunnel.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    out = log_path.open("a", encoding="utf-8")
    p = subprocess.Popen(
        ["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-o", "ExitOnForwardFailure=yes",
         "-L", f"{CONFIG['tunnel_port']}:127.0.0.1:{CONFIG['remote_port']}",
         CONFIG["host"], "wsl", "bash", "-s"],
        stdin=open(CONFIG["start_script"], "rb"), stdout=out, stderr=subprocess.STDOUT,
        start_new_session=True)
    state["tunnel"] = p
    state["tunnel_started"] = time.time()
    state["remote_running"] = True
    log(event="tunnel_start", pid=p.pid)


def last_tunnel_line():
    try:
        lines = [l for l in CONFIG["log"].with_name("tunnel.log").read_text(encoding="utf-8").splitlines()
                 if l.strip() and "Loading weights" not in l]
        return lines[-1][:200] if lines else ""
    except OSError:
        return ""


def stop_remote_gate(why):
    """按 PID 结束远端闸门（WSL 不一定会随 SSH 断开结束它）。连不上就算了，下次启动前会清理。"""
    if not state["remote_running"]:
        return
    try:
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                            CONFIG["host"], "wsl", "bash", "-s"],
                           stdin=open(CONFIG["stop_script"], "rb"), capture_output=True, text=True, timeout=20)
        log(event="remote_stop", why=why, out=(r.stdout + r.stderr).strip()[:200])
        state["remote_running"] = False
    except Exception as e:
        log(event="remote_stop_failed", why=why, error=repr(e))


def stop_tunnel(why, stop_remote=True):
    p = state["tunnel"]
    if p is not None and p.poll() is None:
        p.terminate()  # 按 PID 结束这一个 ssh；对面的 gate 随 SSH 断开被 WSL 收走
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()
        log(event="tunnel_stop", pid=p.pid, why=why)
    state["tunnel"] = None
    state["upstream_ok"] = False
    if stop_remote:
        stop_remote_gate(why)


def probe_upstream():
    """用一条被 @ 的消息探活：gate 走规则立即回 reply，不碰模型。"""
    try:
        r = forward("/decide", b'{"content":"ping","mentioned":true}', timeout=2)
        return r.get("action") == "reply"
    except Exception:
        return False


def supervise():
    while True:
        try:
            check_once()
        except Exception as e:  # 监控线程不能死，出错记下来下一轮接着查
            log(event="supervise_error", error=repr(e))
        time.sleep(CONFIG["check_every"])


def check_once():
    if True:
        lan, why = on_same_lan()
        with lock:
            if lan:
                p = state["tunnel"]
                if p is not None and p.poll() is not None:  # 隧道自己断了
                    lived = time.time() - state["tunnel_started"]
                    if lived < QUICK_DEATH:
                        state["backoff"] = min(BACKOFF_MAX, max(BACKOFF_MIN, state["backoff"] * 2))
                        state["retry_at"] = time.time() + state["backoff"]
                    else:
                        state["backoff"] = 0
                    log(event="tunnel_died", pid=p.pid, code=p.returncode, lived=round(lived),
                        backoff=state["backoff"], last=last_tunnel_line())
                    state["tunnel"] = None
                if not tunnel_alive() and time.time() >= state["retry_at"]:
                    start_tunnel()
                ok = tunnel_alive() and probe_upstream()
                mode = "gpu" if ok else "starting"
                if not ok:
                    wait = state["retry_at"] - time.time()
                    why = f"{why}；" + (f"远端启动失败，{wait:.0f} 秒后重试（{last_tunnel_line()[:60]}）"
                                       if wait > 0 and not tunnel_alive() else "远端闸门还在加载")
                state["upstream_ok"] = ok
            else:
                stop_tunnel(why)
                state["backoff"], state["retry_at"] = 0, 0
                mode = "off"
            if mode != state["mode"]:
                log(event="mode", mode=mode, why=why)
                print(f"[{time.strftime('%T')}] 闸门 → {mode}（{why}）", flush=True)
                state["mode"], state["since"] = mode, time.time()
            state["why"] = why


# ---------------------------------------------------------------- 转发与本地规则

def forward(path, body, timeout):
    req = urllib.request.Request(f"http://127.0.0.1:{CONFIG['tunnel_port']}{path}", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def local_rule(req, bot):
    """闸门关不了模型时：先走 gate.py 里不需要模型的规则；需要模型的再用简单兜底。"""
    if RULES is not None and (not bot or bot in RULES.SUBS):
        try:
            action, reason, _ = RULES.decide_sub(req, bot) if bot else RULES.decide(req)
            return {"action": action, "reason": f"switch 本地规则（{state['why']}）: {reason}"}
        except NeedModel:
            pass
        except Exception as e:
            log(event="local_rule_error", bot=bot, error=repr(e))
    return simple_fallback(req, bot)


def with_tier(resp, req):
    """本地判断时补上 tier：规则能判就判，需要模型的一律 chat（和远端闸门同一套规则）。"""
    if resp.get("action") not in ("reply", "insert") or "tier" in resp:
        return resp
    if RULES is not None and hasattr(RULES, "tier_of"):
        try:
            tier, why, _ = RULES.tier_of(req)
            resp["tier"], resp["tier_reason"] = tier, f"switch 本地: {why}"
            return resp
        except NeedModel:
            pass
        except Exception as e:
            log(event="tier_error", error=repr(e))
    resp["tier"], resp["tier_reason"] = "chat", "switch 本地: 需要模型判断，按 chat"
    return resp


def simple_fallback(req, bot):
    """需要模型但模型不在：和 cc-connect 不配 gate 时一致。"""
    if not bot:
        return {"action": "reply", "reason": f"switch: 闸门关闭（{state['why']}）"}
    if req.get("mentioned"):
        return {"action": "reply", "reason": "switch: 闸门关闭，sub 被@"}
    return {"action": "context", "reason": "switch: 闸门关闭，sub 只听"}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/status":
            self.send_error(404); return
        self._send({"mode": state["mode"], "why": state["why"], "since": state["since"],
                    "tunnel_pid": state["tunnel"].pid if tunnel_alive() else None})

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/decide":
            self.send_error(404); return
        bot = urllib.parse.parse_qs(url.query).get("bot", [""])[0]
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}"
        req = json.loads(body)
        t = time.time()
        if state["upstream_ok"]:
            try:
                resp = forward(self.path, body, CONFIG["forward_timeout"])
                route = "gpu"
            except Exception as e:
                state["upstream_ok"] = False  # 下一轮 supervise 再探
                resp, route = local_rule(req, bot), f"fallback: {type(e).__name__}"
        else:
            resp, route = local_rule(req, bot), "off"
        if route != "gpu":
            resp = with_tier(resp, req)
        log(event="decide", bot=bot or "lead", route=route, action=resp.get("action"),
            tier=resp.get("tier"), tier_reason=resp.get("tier_reason"),
            content=(req.get("content") or "")[:120], ms=round((time.time() - t) * 1000))
        self._send(resp)

    def _send(self, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def main():
    missing = [k for k, v in (("SWITCH_HOST", CONFIG["host"]), ("SWITCH_TS_IP", CONFIG["tailscale_ip"])) if not v]
    if missing:
        raise SystemExit("gate_switch: 先设 " + "、".join(missing) +
                         "（GPU 机器的 SSH 目标 user@host 和它的 tailscale IP），例如 SWITCH_HOST=me@100.x.y.z SWITCH_TS_IP=100.x.y.z")
    def bye(*_):
        stop_tunnel("切换器退出")
        os._exit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    threading.Thread(target=supervise, daemon=True).start()
    print(f"gate switch on 127.0.0.1:{CONFIG['listen_port']} → {CONFIG['host']}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", CONFIG["listen_port"]), H).serve_forever()


if __name__ == "__main__":
    main()
