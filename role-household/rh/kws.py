"""本地唤醒模型（sherpa-onnx 关键词检测，KWS）：直接听声音找唤醒词和口令，和「整句转文字 -> 拼音比名字」（rh/wake.py）并联。

用户 2026-10-19：「还是没反应，我说了个鲸鱼娘在吗？他没有反应」「你看别人小爱音箱怎么玩的…小艺小度」，
橘提出用本地唤醒模型后用户：「那你继续」。

- 一直听：收音线程（rh/voice.py Listener）把系统回声消除之后的每一帧也喂给它，和切句、转文字并行。
- 词表从 roles.toml 生成（rh.wake.Words，不另设一套）：每个角色的语音唤醒词（有 wake 用 wake，否则 name+aliases）、
  产品名、暂停、闭麦、开麦。用户 2026-10-19：「小橘和小家，预期后面用户也能自定义，无所谓」。
- 每个词按 rh/wake.py 同样的放宽规则（声母 n/l、前后鼻音）多写几行发音，标签都是原词，命中算原词。
  用户 2026-10-19：「你应该比较宽的就是nl，有没有g都能识别」（真机「鲸鱼娘在吗」被听成「金玉良在吗」，
  离线试 /tmp/kwsvar/run.py：加「金玉良」那行默认阈值就能叫醒 logs/utter-20261019-145817/150201-894.wav）。
- 模型不进 git：放在 roles.toml [wake] kws_model 指的目录（默认 ~/ai-voice/models/ 下，和 Qwen3-TTS 模型同处），
  下载命令见 README「本地唤醒模型」。
"""
from __future__ import annotations

import array
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import wake as wakemod

# 模型：sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 的 fp32、chunk-16 那组文件。
# 来源：2026-10-19 离线评估 /tmp/kws/report.md「结论」1：同批 240 条含口令合成音认对 142 条（现路 103），负样本零误唤醒。
MODEL_TAG = "epoch-13-avg-2-chunk-16-left-64"
MODEL_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/"
             "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2")
# 阈值：threshold 0.10、score 1.0。来源：/tmp/kws/report.md「推荐」，按「240 条命中最多且负样本 0 误唤醒」选的档。
THRESHOLD = 0.10
SCORE = 1.0
# 单个词另调的 (score, threshold)，键是词（如 "鲸鱼娘"）。现在为空：不先硬调。
# 来源：派活要求「不先硬调鲸鱼娘阈值」；真人录音到手后按 README「本地唤醒模型」里的调参步骤只给那一个词填这里。
WORD_TUNE: dict[str, tuple[float, float]] = {}
NUM_THREADS = 1   # 来源：/tmp/kws/report.md perf.log，单线程单路实时只占约 0.8% 个核，不用多开。
SAMPLE_RATE = 16000   # 和 rh/voice.py SAMPLE_RATE 一致（收音格式）。


@dataclass
class Hit:
    """KWS 听到一个词。action：wake 里的 say / pause / mute / unmute；role：叫到的角色 id（叫产品名为 None）。
    done：主机已经当场执行了的动作（暂停、闭麦、开麦当场执行，见 rh/host.py on_kws）；名字要等这句转完文字一起处理。"""
    label: str
    action: str
    role: str | None
    t: float                  # 检出时刻（time.time()）
    term: wakemod.Term        # 判断正在念的话里有没有这个词（回声）
    done: str | None = None


def entries(words: wakemod.Words) -> list[tuple[str, str, str | None]]:
    """词表：[(词, 动作, 角色 id)]。角色的语音唤醒词和 Words.classify 用的一样（有 wake 用 wake，否则 name+aliases）。"""
    out: list[tuple[str, str, str | None]] = []
    for rid, names in words.roles:
        for w in (words.voice.get(rid) or names):
            out.append((w, wakemod.SAY, rid))
    out += [(w, wakemod.SAY, None) for w in words.product]
    out += [(words.pause, wakemod.PAUSE, None), (words.mute, wakemod.MUTE, None), (words.unmute, wakemod.UNMUTE, None)]
    return [e for e in out if e[0]]


def model_files(model_dir: str | Path) -> dict[str, str]:
    d = Path(os.path.expanduser(str(model_dir)))
    return {"tokens": str(d / "tokens.txt"), "encoder": str(d / f"encoder-{MODEL_TAG}.onnx"),
            "decoder": str(d / f"decoder-{MODEL_TAG}.onnx"), "joiner": str(d / f"joiner-{MODEL_TAG}.onnx")}


def ppinyin(text: str) -> list[str]:
    """词 -> 带声调的声母、韵母（模型的 token）。照抄 sherpa_onnx.utils.text2token 的 ppinyin 分支（1.13.8）：
    官方函数一进来就 import sentencepiece，我们用不到它，不为它多装一个依赖。"""
    from pypinyin import pinyin
    from pypinyin.contrib.tone_convert import to_finals_tone, to_initials
    out = []
    for x in (p[0] for p in pinyin(text)):
        initial, final = to_initials(x, strict=False), to_finals_tone(x, strict=False)
        out += [x] if not initial and not final else [t for t in (initial, final) if t]
    return out


def _syllable_tokens(text: str) -> list[list[str]]:
    """词 -> 每个字的 [声母, 韵母]（零声母只有韵母）。拆法同 ppinyin。"""
    from pypinyin import pinyin
    from pypinyin.contrib.tone_convert import to_finals_tone, to_initials
    out = []
    for x in (p[0] for p in pinyin(text)):
        initial, final = to_initials(x, strict=False), to_finals_tone(x, strict=False)
        out.append([x] if not initial and not final else [t for t in (initial, final) if t])
    return out


def _bare(final: str) -> str:
    """去掉声调符号（ü 也成 u，只用来判断韵母是哪一类）。"""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", final) if not unicodedata.combining(c))


_FRONT = {"in", "en", "an", "ian", "uan"}   # 能加 g 变后鼻音的前鼻音韵母（ong 一类不动，同 rh/wake.py）


def _alts(syl: list[str]) -> list[list[str]]:
    """一个字的发音变体（含原样，排第一）：声母 n<->l，前后鼻音互换。同 rh/wake.py 的放宽规则。"""
    if len(syl) == 2:
        initial, final = syl
    else:
        initial, final = "", syl[0]
    inits = {"n": ["n", "l"], "l": ["l", "n"]}.get(initial, [initial])
    finals = [final]
    b = _bare(final)
    if b.endswith("ng") and b[:-2] + "n" in _FRONT:
        finals.append(final[:-1])
    elif b in _FRONT and not (b == "uan" and initial in ("j", "q", "x", "y")):   # juan 等其实是 üan，没有 üang
        finals.append(final + "g")
    return [[t for t in (i, f) if t] for i in inits for f in finals]


def variants(label: str) -> list[list[str]]:
    """词 -> 所有发音变体的 token 串（原样排第一，去重）。"""
    out: list[list[str]] = [[]]
    for syl in _syllable_tokens(label):
        out = [head + alt for head in out for alt in _alts(syl)]
    seen, uniq = set(), []
    for v in out:
        if tuple(v) not in seen:
            seen.add(tuple(v))
            uniq.append(v)
    return uniq


def keyword_lines(labels: list[str], tokens: str, tune: dict[str, tuple[float, float]] | None = None) -> list[str]:
    """词 -> sherpa-onnx 关键词行（同 /tmp/kws/scripts/kw.txt 的写法）。tune 里有的词加 `:score #threshold`。
    每个词先写原样一行，再写放宽规则下的变体（variants），标签都是原词；变体里有 token 表没有的音就跳过那一行。
    原词的音不在 token 表里（比如英文、生僻音）直接报错，不悄悄漏掉这个词。"""
    tune = WORD_TUNE if tune is None else tune
    with open(tokens, encoding="utf-8") as f:
        table = {line.split()[0] for line in f if line.strip()}
    lines = []
    for label in labels:
        toks = ppinyin(label)
        bad = [t for t in toks if t not in table]
        if bad:
            raise ValueError(f"唤醒词「{label}」的音 {bad} 不在唤醒模型的 token 表里")
        extra = f" :{tune[label][0]:g} #{tune[label][1]:g}" if label in tune else ""
        for v in variants(label):
            if all(t in table for t in v):
                lines.append(f"{' '.join(v)}{extra} @{label}")
    return lines


class Spotter:
    """一路常开的关键词检测。feed(一帧 16 kHz 16 位 PCM) -> 这帧之后检出的词（Hit 列表）。只在一个线程里用。"""

    def __init__(self, words: wakemod.Words, model_dir: str | Path,
                 threshold: float = THRESHOLD, score: float = SCORE,
                 tune: dict[str, tuple[float, float]] | None = None):
        import sherpa_onnx
        files = model_files(model_dir)
        missing = [p for p in files.values() if not Path(p).is_file()]
        if missing:
            raise FileNotFoundError(f"本地唤醒模型缺文件 {missing[0]}；下载：{MODEL_URL}（见 README「本地唤醒模型」）")
        self._entries: dict[str, list[tuple[str, str | None]]] = {}
        for label, action, role in entries(words):
            self._entries.setdefault(label, []).append((action, role))
        self.labels = list(self._entries)
        self.lines = keyword_lines(self.labels, files["tokens"], tune)
        with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as f:
            f.write("\n".join(self.lines) + "\n")
        try:
            self._ks = sherpa_onnx.KeywordSpotter(**files, keywords_file=f.name, num_threads=NUM_THREADS,
                                                  keywords_threshold=threshold, keywords_score=score)
        finally:
            os.unlink(f.name)
        self._terms = {label: wakemod.Term(label) for label in self.labels}
        self.reset()

    def reset(self) -> None:
        """换音源（文件喂完换麦克风、麦克风重开）时重开一路，旧的半个词不带过去。"""
        self._st = self._ks.create_stream()

    def feed(self, frame: bytes, now: Callable[[], float] = time.time) -> list[Hit]:
        a = array.array("h", frame)
        self._st.accept_waveform(SAMPLE_RATE, [x / 32768 for x in a])
        hits: list[Hit] = []
        while self._ks.is_ready(self._st):
            self._ks.decode_stream(self._st)
            label = self._ks.get_result(self._st)
            if label:
                self._ks.reset_stream(self._st)   # 检出后重开，同一个词不连报（同 /tmp/kws/scripts/eval_kws.py）
                t = now()
                hits += [Hit(label, action, role, t, self._terms[label]) for action, role in self._entries.get(label, [])]
        return hits
