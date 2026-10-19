"""语音口令：唤醒词（角色名、产品名）、安全词「暂停」、闭麦/开麦。

用户 2026-10-19：「你可能指定跟他们说他们才会应你，否则就当不存在」「有个呃安全词啊去暂停声音」
「我没有一个闭麦按钮，或者我希望可以语音闭麦」。

语音转出的字按拼音比，不按字比：ASR 常把名字转成同音字。2026-10-19 实测（say/Qwen 合成人声过 gateway ASR）：
「橘」→「菊」「局」，「鲸鱼娘」→「金鱼娘」「金玉娘」，「小家」→「小佳」，「闭麦」→「必卖」「碧麦」，「开麦」→「开买」「开卖」。
比法：两个字以上的词不看声调（开麦 kai1 mai4 被转成开买 kai1 mai3）；一个字的词（橘）要声调也对，
不然「一句话」「举手」的 ju 都会叫醒橘。前后鼻音当一样：in/ing、en/eng、an/ang（连带 ian/iang、uan/uang；ong 不动），
鲸 jing 被转成金 jin。声母 n 和 l 当一样。用户 2026-10-19：「你应该比较宽的就是nl，有没有g都能识别」
（用户口音 n/l 不分，真机说「鲸鱼娘在吗」两次被转成「金玉良在吗」，logs/utter-20261019-145817/150201-894.wav、150219-590.wav）。
所有口令词（角色名、产品名、暂停、闭麦、开麦）都按这个比。
「橘」还常被转成「姐」「鱼」「徐」（不同音），故意不加：「姐」「鱼」日常常见，加了会在没叫她时被叫醒。
网页上打字的话不用拼音，按字找名字（打字没有同音字问题，「结局」不该只叫橘）。

角色可以单独配语音唤醒词（roles.toml 里角色的 wake）：配了语音就只认它，网页打字照旧按名字。
橘的语音唤醒词是「小橘」：单字「橘」语音几乎叫不醒（2026-10-19 say 合成过系统 ASR 0/30，/tmp/asrctx/report.md），
还会被「结局」叫醒。用户 2026-10-19：「橘作为首字在音韵不好发言」「小橘怎么样」「就这样吧，小橘和小家」。
「小橘」两个字不看声调，「小菊」「小局」也算叫她；单说「橘」「菊」语音不再叫醒她。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pypinyin import Style, lazy_pinyin

_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)
_TONE = re.compile(r"[1-5]$")
_NL = re.compile(r"^n(?=[aeiouv])")          # 声母 n -> l（「娘」niang 和「良」liang 一样）
_NASAL = re.compile(r"([iea])ng(?=[1-5]?$)")  # 后鼻音 -> 前鼻音：ing/eng/ang（含 iang、uang）；ong、iong 不动

# 动作
PAUSE, MUTE, UNMUTE, SAY, IGNORE = "pause", "mute", "unmute", "say", "ignore"
LOUDER, QUIETER = "louder", "quieter"   # 板子音量调大/调小

# 调音量的口令。用户 2026-10-19：「声音太小了，预期可以我通过语音让它调大」；任务给的词「大声点/声音大一点」「小声点」，
# 另加几种同义说法（「大点声」「声音大点」「小点声」「声音小一点」「声音小点」），实现者定。
LOUDER_WORDS = ("大声点", "大点声", "声音大一点", "声音大点")
QUIETER_WORDS = ("小声点", "小点声", "声音小一点", "声音小点")


def _syllables(text: str) -> list[str]:
    """文字 -> 拼音音节（带声调数字，轻声 5）；非汉字的一段原样小写。前后鼻音合并、声母 n 并入 l（见文件头）。"""
    return [_NASAL.sub(r"\1n", _NL.sub("l", s))
            for s in lazy_pinyin(_PUNCT.sub("", text).lower(), style=Style.TONE3, neutral_tone_with_five=True)]


_HAN = re.compile(r"[\u3400-\u9fff]")


def _tokens(text: str) -> list[tuple[int, int]]:
    """把一句话切成和 _syllables 一一对应的片段 (起, 止)：每个汉字一段，连着的非汉字（字母、数字）一段，标点空白跳过。"""
    spans, i = [], 0
    while i < len(text):
        c = text[i]
        if _PUNCT.fullmatch(c):
            i += 1
        elif _HAN.match(c):
            spans.append((i, i + 1))
            i += 1
        else:
            j = i
            while j < len(text) and not _HAN.match(text[j]) and not _PUNCT.fullmatch(text[j]):
                j += 1
            spans.append((i, j))
            i = j
    return spans


def _aligned(text: str) -> tuple[list[str], list[tuple[int, int]]] | None:
    """音节和它在原文里的位置。对不齐（pypinyin 切法和 _tokens 不同）就返回 None，不替换。"""
    syl, spans = _syllables(text), _tokens(text)
    return (syl, spans) if len(syl) == len(spans) else None


def _toneless(syl: list[str]) -> list[str]:
    return [_TONE.sub("", s) for s in syl]


class Term:
    """一个口令词（可带几种写法）：按拼音在一句话里找。"""

    def __init__(self, *spellings: str):
        self.spellings = [s for s in spellings if s]
        self._pats = []
        for s in self.spellings:
            syl = _syllables(s)
            if syl:
                self._pats.append((syl, len(syl) == 1))

    def _hits(self, syl: list[str]):
        """命中的音节区间 (起, 止)。"""
        bare = _toneless(syl)
        for pat, toned in self._pats:
            hay, needle = (syl, pat) if toned else (bare, _toneless(pat))
            n = len(needle)
            for i in range(len(hay) - n + 1):
                if hay[i:i + n] == needle:
                    yield i, i + n

    def heard_in(self, text: str) -> bool:
        return next(self._hits(_syllables(text)), None) is not None

    def found_at(self, text: str) -> list[tuple[int, int]]:
        """命中片段在原文里的字位置 (起, 止)，给 Words.correct 换成标准写法用。"""
        al = _aligned(text)
        if al is None:
            return []
        syl, spans = al
        return [(spans[a][0], spans[b - 1][1]) for a, b in self._hits(syl)]

    def typed_in(self, text: str) -> bool:
        return any(s in text for s in self.spellings)


@dataclass
class Heard:
    action: str                      # pause / mute / unmute / say / ignore
    targets: list[str] | None = None  # say 时：只让这几个角色回；None = 按轮流（叫的是产品名）
                                     # louder/quieter 时：叫了名字就只调她们的板子；None = 没指定
    why: str = ""                    # ignore 的原因，打日志用


@dataclass
class Words:
    """roles: [(角色 id, [名字, 别名...])]，按角色顺序；其余是口令词。
    voice: {角色 id: [语音唤醒词...]}：有的角色语音只认这几个；没写的角色语音也按 roles 里的名字。打字只看 roles。"""
    roles: list[tuple[str, list[str]]]
    product: list[str] = field(default_factory=list)
    pause: str = "暂停"
    mute: str = "闭麦"
    unmute: str = "开麦"
    voice: dict[str, list[str]] = field(default_factory=dict)
    louder: tuple[str, ...] = LOUDER_WORDS
    quieter: tuple[str, ...] = QUIETER_WORDS

    def __post_init__(self):
        self._roles = [(rid, Term(*names)) for rid, names in self.roles]
        self._voice = [(rid, Term(*(self.voice.get(rid) or names))) for rid, names in self.roles]
        self._product = Term(*self.product)
        self._pause, self._mute, self._unmute = Term(self.pause), Term(self.mute), Term(self.unmute)
        self._louder, self._quieter = Term(*self.louder), Term(*self.quieter)

    @classmethod
    def from_config(cls, cfg) -> "Words":
        return cls([(r.id, [r.name, *r.aliases]) for r in cfg.roles], product=cfg.wake_product,
                   pause=cfg.wake_pause, mute=cfg.wake_mute, unmute=cfg.wake_unmute,
                   voice={r.id: list(r.wake) for r in cfg.roles if r.wake})

    def stop_word(self, text: str) -> bool:
        """有没有「暂停」「闭麦」：这两句要能停住正在说的，不被置信度、回声过滤挡掉（见 rh.voice.Listener）。"""
        return self._pause.heard_in(text) or self._mute.heard_in(text)

    def classify(self, text: str, muted: bool) -> Heard:
        """一句语音转写该怎么处理。闭麦时只认「开麦」「暂停」「闭麦」（后两个停下正在念的，如 Discord 回应，
        用户 2026-10-19「我暂停闭麦他都没有反应」）；别的话不认。安全词、闭麦不用叫名字。"""
        if muted:
            if self._unmute.heard_in(text):
                return Heard(UNMUTE)
            if self._mute.heard_in(text):
                return Heard(MUTE)
            if self._pause.heard_in(text):
                return Heard(PAUSE)
            return Heard(IGNORE, why="闭麦中")
        if self._mute.heard_in(text):
            return Heard(MUTE)
        if self._pause.heard_in(text):
            return Heard(PAUSE)
        named = [rid for rid, t in self._voice if t.heard_in(text)]
        # 调音量不用叫名字；叫了名字（「小橘大声点」）就只调她的。不进频道。
        if self._louder.heard_in(text):
            return Heard(LOUDER, named or None)
        if self._quieter.heard_in(text):
            return Heard(QUIETER, named or None)
        if named:
            return Heard(SAY, named)
        if self._product.heard_in(text):
            return Heard(SAY, None)
        return Heard(IGNORE, why="没叫名字")

    def correct(self, text: str) -> str:
        """语音转写里按拼音认出的口令词，换成标准写法（「金玉良在吗」→「鲸鱼娘在吗」）。
        用户 2026-10-19：「我预期他是应该可以帮我转成我们比较适配的，不是直接显示傻逼金玉良」。
        标准写法：角色取语音唤醒词（没配取名字）的第一个，产品名、暂停、闭麦、开麦取配置里的写法。
        只换命中的那几个字；几个词抢同一段字时长的优先。"""
        terms = [t for _, t in self._voice] + [self._product, self._pause, self._mute, self._unmute]
        cands = sorted(((a, b, t.spellings[0]) for t in terms if t.spellings for a, b in t.found_at(text)),
                       key=lambda x: (x[0], -(x[1] - x[0])))
        out, pos = [], 0
        for a, b, word in cands:
            if a < pos:
                continue                 # 和前面已换的重叠
            out += [text[pos:a], word]
            pos = b
        return "".join(out) + text[pos:]

    def typed_targets(self, text: str) -> list[str] | None:
        """网页打字：按字找角色名，找到就只让她们回；没有（或叫的是产品名）按轮流。"""
        named = [rid for rid, t in self._roles if t.typed_in(text)]
        return named or None
