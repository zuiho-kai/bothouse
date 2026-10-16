"""scorer.py 的 CUDA 版（PyTorch + transformers），接口完全一样，给没有苹果芯片的机器用。

部署时把它放在 scorer.py 的位置（或改名为 scorer.py），gate.py 不用改：

    scorer = Scorer("/path/to/Qwen3.5-4B")      # 本地目录或 HF repo id
    task = scorer.prepare(prefix="…指令…", options=["A", "B", "C"], prefill="答案：")
    task.score("…这次的状态和消息…")
    → Score(choice=1, probs=[…], logprobs=[…], option_mass=0.97, cached_tokens=119, input_tokens=39, ms=28.1)

显存不够放全精度时默认 4-bit（bitsandbytes NF4）：Qwen3.5-4B 约占 4 GB，6 GB 的卡能放下。
GATE_QUANT=none 用 bf16 全精度（约 9 GB）。

和 MLX 版一样：prepare 时算好固定前缀的缓存（KV + 线性注意力状态），score 时拷一份接着算这次的输入。
"""
import copy
import os
import threading
import time
from dataclasses import dataclass

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


@dataclass
class Score:
    choice: int            # probs 最大的选项下标
    probs: list            # 只在这几个选项里归一化
    logprobs: list         # 全词表 log 概率
    option_mass: float     # 这几个选项占全词表的概率之和；低说明模型想答的不是这些选项
    cached_tokens: int
    input_tokens: int      # 本次实际算的 token 数
    ms: float


def _load_model(model_path):
    quant = os.environ.get("GATE_QUANT", "nf4")
    kwargs = {"dtype": torch.bfloat16, "device_map": "cuda"}
    if quant == "nf4":
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    elif quant != "none":
        raise ValueError(f"GATE_QUANT 只能是 nf4 或 none，现在是 {quant!r}")
    return AutoModelForCausalLM.from_pretrained(model_path, **kwargs).eval()


class Scorer:
    def __init__(self, model_path, max_input_tokens=2048):
        self.tok = AutoTokenizer.from_pretrained(model_path)
        self.model = _load_model(model_path)
        self.device = next(self.model.parameters()).device
        self.max_input_tokens = max_input_tokens
        self.lock = threading.Lock()  # 前向串行

    def prompt_ids(self, text, prefill=""):
        s = self.tok.apply_chat_template([{"role": "user", "content": text}], add_generation_prompt=True,
                                         tokenize=False, enable_thinking=False) + prefill
        return self.tok.encode(s, add_special_tokens=False)

    def prepare(self, prefix, options, prefill=""):
        return Task(self, prefix, options, prefill)

    @torch.inference_mode()
    def forward(self, ids, cache=None):
        """返回 (最后一个位置的 logits, 缓存)。"""
        out = self.model(input_ids=torch.tensor([ids], device=self.device),
                         past_key_values=cache, use_cache=True)
        return out.logits[0, -1].float(), out.past_key_values


class Task:
    def __init__(self, scorer, prefix, options, prefill):
        self.s, self.prefix, self.prefill = scorer, prefix, prefill
        self.options = list(options)
        self.opt_ids = []
        for o in self.options:
            ids = scorer.tok.encode(o, add_special_tokens=False)
            if len(ids) != 1:
                raise ValueError(f"选项 {o!r} 不是单 token：{ids}")
            self.opt_ids.append(ids[0])
        # 缓存的 token 前缀 = 两个不同输入的提示词共同的开头（不单独 encode 前缀，避免分词边界对不上）
        a, b = scorer.prompt_ids(prefix + "\x00", prefill), scorer.prompt_ids(prefix + "\x01", prefill)
        self.ids = a[:next(i for i, (x, y) in enumerate(zip(a, b)) if x != y)]
        with scorer.lock:
            _, self.cache = scorer.forward(self.ids)

    def score(self, text, use_cache=True):
        t = time.perf_counter()
        ids = self.s.prompt_ids(self.prefix + text, self.prefill)
        n = len(self.ids)
        hit = use_cache and ids[:n] == self.ids
        todo = ids[n:] if hit else ids
        if len(todo) > self.s.max_input_tokens:
            raise ValueError(f"输入 {len(todo)} token，超过上限 {self.s.max_input_tokens}")
        with self.s.lock:
            cache = copy.deepcopy(self.cache) if hit else None
            logits, _ = self.s.forward(todo, cache)
            lp_all = torch.log_softmax(logits, dim=-1)
            lp = lp_all[torch.tensor(self.opt_ids, device=lp_all.device)]
            torch.cuda.synchronize()
        logprobs = [round(float(x), 4) for x in lp]
        mass = float(lp.exp().sum())
        probs = [round(float(x), 3) for x in torch.softmax(lp, dim=-1)]
        return Score(choice=max(range(len(probs)), key=probs.__getitem__), probs=probs, logprobs=logprobs,
                     option_mass=round(mass, 3), cached_tokens=n if hit else 0, input_tokens=len(todo),
                     ms=round((time.perf_counter() - t) * 1000, 1))
