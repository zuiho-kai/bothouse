import pytest

from voice.modes import ModeRouter, RouteDecision, escalate_on_discontent, MODES, DEFAULT_MODE


@pytest.mark.parametrize('text', ['你好', '晚安', '谢谢', '音量调大一点', '今天几号'])
def test_companion_whitelist_routes_small(text):
    decision = ModeRouter().decide(text, 'companion')
    assert decision.route == 'small'
    assert isinstance(decision, RouteDecision)


@pytest.mark.parametrize('text', ['帮我改一下代码', '看看这个报错', '查一下任务进度', '这笔钱怎么付款'])
def test_tool_and_work_words_always_go_big(text):
    assert ModeRouter().decide(text, 'companion').route == 'big'
    assert ModeRouter().decide(text, 'auto').route == 'big'


def test_work_mode_never_uses_small_brain():
    assert ModeRouter().decide('你好', 'work').route == 'big'


def test_unknown_question_defaults_to_big():
    decision = ModeRouter().decide('你觉得宇宙的尽头是什么', 'auto')
    assert decision.route == 'big'
    assert '默认走大脑' in decision.reason


def test_long_greeting_is_not_a_device_command():
    text = '你好' + '啊' * 40
    assert ModeRouter().decide(text, 'companion').route == 'big'


def test_unknown_mode_refused():
    with pytest.raises(ValueError):
        ModeRouter().decide('你好', 'fast')


def test_discontent_escalates():
    assert escalate_on_discontent('不对，你刚才说错了')
    assert not escalate_on_discontent('今天天气怎么样')


def test_modes_contract():
    assert MODES == ('companion', 'work', 'auto')
    assert DEFAULT_MODE == 'work'
