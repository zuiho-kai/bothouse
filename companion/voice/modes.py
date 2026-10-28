"""Three voice modes and the rule router between the small and big brain.

The router is deliberately lexical. The research note leaves the semantic
router and its similarity threshold to a later, data-calibrated step
(notes/voice-latency-plan-b-20261028.md §5.3), so nothing here invents a
confidence number: a rule either matches and the small brain answers, or it
does not and the request goes to the big brain. "Not sure" therefore means
"big brain", which is the documented default.
"""
from __future__ import annotations

from dataclasses import dataclass

MODES = ('companion', 'work', 'auto')
DEFAULT_MODE = 'work'

# Device commands and pleasantries are fixed, short interactions. These lists
# are the whitelist from the research note §5.3 (走小脑 / 走大脑), not a guess
# at a model threshold.
SMALL_PREFIXES = (
    '你好', '您好', '早上好', '晚上好', '晚安', '再见', '拜拜', '谢谢', '多谢',
    '辛苦了', '好的', '好呀', '收到', '在吗', '你在吗', '没事',
    '音量', '大声点', '小声点', '静音', '亮度', '亮一点', '暗一点',
    '播放', '暂停', '继续', '下一首', '打开网页', '拍张照',
)
SMALL_EXACT = {
    '今天几号', '今天星期几', '现在几点', '几点了', '今天天气怎么样',
    '你是谁', '你叫什么名字',
}
# Anything that needs tools, files, commands or multi-step work belongs to the
# big brain even inside companion mode; the note forbids the small brain from
# pretending it ran a tool.
BIG_MARKERS = (
    '代码', '分支', '提交', '合并', '部署', '编译', '测试', '报错', '日志',
    '命令', '终端', '文件', '目录', '仓库', '任务', '进度', 'PR', 'issue',
    '帮我写', '帮我改', '帮我查', '帮我跑', '看一下这个', '打开项目',
    '多少钱', '付款', '转账', '医院', '医生', '药', '律师', '合同',
)


@dataclass(frozen=True)
class RouteDecision:
    route: str          # 'small' or 'big'
    reason: str
    confidence: float   # rule hits are exact; 1.0 means the rule decided
    escalated: bool = False


class ModeRouter:
    """Decide who owns the answer. Default is always the big brain."""

    def __init__(self, modes=MODES):
        self.modes = tuple(modes)

    def decide(self, text: str, mode: str) -> RouteDecision:
        if mode not in self.modes:
            raise ValueError(f'未知语音模式：{mode}')
        value = (text or '').strip()
        if not value:
            return RouteDecision('big', '空输入交给大脑', 1.0)
        if mode == 'work':
            return RouteDecision('big', '工作模式固定走现有 Agent', 1.0)
        if any(marker in value for marker in BIG_MARKERS):
            return RouteDecision('big', '命中工具/多步工作词', 1.0)
        if value in SMALL_EXACT:
            return RouteDecision('small', '命中固定小问题', 1.0)
        if len(value) <= 20 and value.startswith(SMALL_PREFIXES):
            return RouteDecision('small', '命中问候/设备口令白名单', 1.0)
        # companion and auto behave the same: only a hit goes small, everything
        # else escalates to the big brain rather than guessing.
        return RouteDecision('big', '未命中白名单，默认走大脑', 1.0)


def escalate_on_discontent(text: str) -> bool:
    """The user's explicit "that is wrong" always means the big brain."""
    value = (text or '').strip()
    return any(word in value for word in ('不对', '不是', '错了', '认真点', '别糊弄', '胡说'))
