"""jev / 任意 OpenAI 兼容模型当打分器：一次只要 1 个 token，读 top_logprobs 里几个选项的概率。

接口和 scorer.py 的本地 Qwen 打分器一样（prepare → task.score → Score），gate.py 按这个顺序选：
  1. <GATE_SETUP_DIR>/jev.json（安装向导写的；logprobs 测试没过的不用）→ RemoteScorer
  2. 显式设了 GATE_MODEL → 本机 scorer.Scorer（不设就不用，不自动下载）
  3. 都没有 → gate 启动时报错退出，提示去向导填 jev
不打日志、不记 key。
"""
import json, math, re, time, urllib.error, urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Score:  # 和 scorer.Score 同字段
    choice: int
    probs: list
    logprobs: list
    option_mass: float
    cached_tokens: int
    input_tokens: int
    ms: float


def load_jev(path):
    """读向导写的 jev.json；没有、没 url、或测试时没拿到概率 → None。"""
    try:
        j = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not j.get("url") or not j.get("logprobs"):
        return None
    return j


# OpenAI 接口 top_logprobs 的上限是 20（来源：OpenAI chat completions 文档）；选项要落在前 20 个候选里才读得到。
TOP_LOGPROBS = 20
# 来源：沿用 cc-connect gate_timeout_ms 默认 3000ms（core/gate.go SetGate），打分要比它快才有意义。
TIMEOUT_S = 2.5


# 服务在 400 里写明的 top_logprobs 上限（mlx_lm.server："top_logprobs must be at most 11"）。
TOP_LIMIT = re.compile(r"top_logprobs[^0-9]*(?:at most|<=|maximum(?: of)?|max(?:imum)?)\s*(\d+)", re.I)


class RemoteScorer:
    def __init__(self, jev, opener=urllib.request.urlopen):
        self.url = jev["url"].rstrip("/") + "/chat/completions"
        self.key, self.model, self.open = jev.get("api_key", ""), jev.get("model", ""), opener
        # 安装向导测试时找到的请求参数（jev.json），和 cc-connect 的 TestJevEndpoint 一致：
        # top_logprobs 用服务允许的数；no_thinking = 传 chat_template_kwargs enable_thinking=false，
        # Qwen3 类模板否则先出 <think>，第一个 token 不是选项。
        self.top = int(jev.get("top_logprobs") or TOP_LOGPROBS)
        self.no_thinking = bool(jev.get("no_thinking", True))

    def adjust(self, err_body):
        """服务回 400 并说明了原因时调整参数，返回是否值得重试。"""
        m = TOP_LIMIT.search(err_body)
        if m and 0 < int(m.group(1)) < self.top:
            self.top = int(m.group(1))
            return True
        if self.no_thinking and "chat_template_kwargs" in err_body:
            self.no_thinking = False
            return True
        return False

    def prepare(self, prefix, options, prefill=""):
        return RemoteTask(self, prefix, list(options), prefill)


class RemoteTask:
    def __init__(self, s, prefix, options, prefill):
        self.s, self.prefix, self.options, self.prefill = s, prefix, options, prefill

    def score(self, text):
        t = time.perf_counter()
        for _ in range(3):  # 最多按服务的 400 说明调整两次（上限、chat_template_kwargs）
            body = {"model": self.s.model, "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": self.s.top,
                    "messages": [{"role": "user", "content": self.prefix + text + "\n" + self.prefill}]}
            if self.s.no_thinking:
                body["chat_template_kwargs"] = {"enable_thinking": False}
            req = urllib.request.Request(self.s.url, json.dumps(body).encode(), {"Content-Type": "application/json",
                                         **({"Authorization": "Bearer " + self.s.key} if self.s.key else {})})
            try:
                with self.s.open(req, timeout=TIMEOUT_S) as r:
                    out = json.loads(r.read())
                top = out["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace") if e.code == 400 else ""
                if e.code == 400 and self.s.adjust(detail):
                    continue
                raise ValueError(f"jev: HTTP {e.code}") from None
            except Exception as e:  # 网络、超时、没给概率：交给 gate 的出错路径
                raise ValueError(f"jev: {type(e).__name__}") from None
        else:
            raise ValueError("jev: 服务一直拒绝请求")
        best = {}
        for c in top:
            tok = c.get("token", "").strip()
            if tok in self.options and tok not in best:
                best[tok] = c["logprob"]
        if not best:
            raise ValueError("jev: 前几个候选里没有选项")
        lps = [best.get(o, -1e9) for o in self.options]
        mass = sum(math.exp(x) for x in lps)
        probs = [round(math.exp(x) / mass, 3) for x in lps]
        return Score(choice=max(range(len(probs)), key=probs.__getitem__), probs=probs, logprobs=[round(x, 4) for x in lps],
                     option_mass=round(mass, 3), cached_tokens=0, input_tokens=0, ms=round((time.perf_counter() - t) * 1000, 1))
