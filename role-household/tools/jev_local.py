# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-lm"]
# ///
"""本机冒充 jev 的 System One 接口：用本地 Qwen 读选项 logits 答 choice 题。不是 jev 本身。

用户 2026-10-20：「本身我们现在有的jev也是llm冒充的」。真 jev 是 TypeSafe 托管的模型（https://api.typesafe.ai，
POST /v1/systemone）。这个脚本只实现同一个接口里主机用到的那一种题（choice），让没有 jev 账号的人也能用
[discord.router] backend = "jev" 跑通；打分直接复用 gate 的 scorer.py（cc-connect maomao 分支的 bridge/contrib/gate/，
一次前向读几个单 token 选项的概率），不复制它的代码。只在 Apple 芯片的 Mac 上能跑（mlx）。

    uv run tools/jev_local.py --scorer <gate 目录>/scorer.py [--model mlx-community/Qwen3.5-4B-MLX-4bit] [--port 9931]

roles.toml：
    [discord.router]
    backend = "jev"
    url = "http://127.0.0.1:9931"
    model = "local-qwen"     # 这个脚本不看 model，随便填；真 jev 填 jev-latest

只听 127.0.0.1。选项名就用主机给的 A、B、C……（单 token）；不是单 token 的选项名回 400。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 默认模型。来源：gate.py 用的同一个（bridge/contrib/gate/gate.py MODEL 默认值）。
DEFAULT_MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit"
# 默认端口。来源：gate.py 的 PORT 是 9930，这个紧挨着用下一个，两个都只听本机。
DEFAULT_PORT = 9931
PREFILL = "答案："   # 同 gate.py：预填「答案：」再读下一个 token 的选项概率


def prompt_prefix(instructions: str, criteria: dict) -> str:
    """把 choice 题拼成提示词前缀（每次变的「主人说的话」接在后面）。"""
    lines = [str(instructions).strip(), ""]
    for k, v in criteria.items():
        lines.append(f"{k} {v}" if v else str(k))
    lines += ["", "只答一个选项。", ""]
    return "\n".join(lines)


def answer(req: dict, prepare) -> dict:
    """System One 请求 → 回复。prepare(prefix, options, prefill) 返回带 score(text) 的对象（gate scorer 的 Task）。
    只答 choice 题；别的题型抛 ValueError（回 400）。"""
    qs = req.get("questions")
    if not isinstance(qs, dict) or not qs:
        raise ValueError("questions 要是非空对象")
    state = req.get("state")
    state = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
    answers = {}
    for name, q in qs.items():
        if not isinstance(q, dict) or q.get("type") != "choice":
            raise ValueError(f"{name}：这个本机实现只答 choice 题")
        crit = q.get("criteria")
        if not isinstance(crit, dict) or not crit:
            raise ValueError(f"{name}：criteria 要是非空对象")
        task = prepare(prompt_prefix(q.get("instructions", ""), crit), list(crit), PREFILL)
        sc = task.score(f"\n{state}\n\n")
        opts = list(crit)
        probs = {k: float(p) for k, p in zip(opts, sc.probs)}
        answers[name] = {"type": "choice", "choice": opts[sc.choice], "confidence": max(probs.values()),
                         "probabilities": probs}
    return {"model": str(req.get("model", "")), "provider": "local-qwen-logits", "answers": answers,
            "usage": {"input_tokens": 0, "output_tokens": 0}}


class Tasks:
    """前缀没变就复用上一次 scorer 算好的前缀状态（gate scorer.prepare 要算整段前缀，score 只算新的那句）。
    只留最近一套：频道列表最多 300 秒才变一次（rh/discord_route.py CHANNELS_TTL），一直在用的前缀就一套。"""

    def __init__(self, scorer):
        self.scorer = scorer
        self.key, self.task = None, None
        self.mu = threading.Lock()

    def __call__(self, prefix: str, options: list[str], prefill: str):
        key = (prefix, tuple(options), prefill)
        with self.mu:
            if key != self.key:
                self.task, self.key = self.scorer.prepare(prefix, options, prefill), key
            return self.task


def load_scorer(path: str):
    """按路径加载 gate 的 scorer.py（只加载这一个文件，不把 gate 目录加进 sys.path）。"""
    spec = importlib.util.spec_from_file_location("gate_scorer", Path(path).expanduser())
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser(description="本机冒充 jev System One 接口（Qwen 读选项 logits）")
    ap.add_argument("--scorer", required=True, help="gate 的 scorer.py 路径（bridge/contrib/gate/scorer.py）")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="mlx 模型（Hugging Face 名或本地目录）")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    a = ap.parse_args()
    tasks = Tasks(load_scorer(a.scorer).Scorer(a.model))
    answer({"questions": {"warm": {"type": "choice", "instructions": "预热", "criteria": {"A": "", "B": ""}}},
            "state": "你好"}, tasks)   # 先跑一次前向（同 gate.py 启动时的 warm up）

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path.rstrip("/") != "/v1/systemone":
                self.send_error(404)
                return
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                out, code = answer(req, tasks), 200
            except ValueError as e:
                out, code = {"error": str(e)}, 400
            body = json.dumps(out, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    print(f"jev_local（Qwen 读 logits 冒充 jev System One）on 127.0.0.1:{a.port}，模型 {a.model}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    sys.exit(main())
