"""#1999 缩范围句要有用户原话撑腰：python3 -m pytest test_narrow_gate.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _narrow_gate as g

HEAD = "# 交接\n\n## 用户原话\n11-25 11:27「{u}」\n\n## 总目标\n改稿。\n\n## 范围\n{s}\n"


def t(u, s):
    return g.problems(HEAD.format(u=u, s=s))


def test_1996_only_review_blocked():
    # 11-25 #1996 原样：用户要以第一版为基准请人评，交接写成只评不改
    bad = t("你就以那个为基准，让其他模型看看，评价一下，以普通人身份看", "- 改：无（本活只评，不改稿；要不要按评价改，交回后用户定）")
    assert bad and bad[0][0] == 10
    assert "只评" in g.check(HEAD.format(u="评价一下", s="- 改：无（本活只评，不改稿）"))


def test_user_said_it_passes():
    assert not t("先只评一下，不改稿", "- 改：无（本活只评，不改稿）")


def test_quoted_user_words_pass():
    assert not t("这轮只评就行", "- 只评第一版（用户「这轮只评就行」）")


def test_negated_and_boundary_pass():
    assert not t("根据意见迭代", "- 改：按意见改稿，不要只评不改\n- 不改：配乐、封面")


def test_no_code_change_passes():
    assert not t("学一下这个", "- 改：无代码改动，写一份拆解")


def test_plan_only_backed_by_think():
    assert not t("你思考一下", "- 只出方案，不动手")
    assert t("做这个", "- 只出方案")


def test_program_sections_ignored():
    text = HEAD.format(u="做", s="- 改：按意见改稿") + "\n## 交回骨架（程序附）\n只评不改\n\n## 旧定案（程序搜出）\n- 只评\n"
    assert not g.problems(text)
