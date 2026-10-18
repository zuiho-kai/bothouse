"""发言权的离线规则：不连桥接、不播放、不读取正文猜意图。"""
import pytest

from voice.floor import (
    Availability,
    FloorControl,
    FloorError,
    FloorLimits,
    GroupModeSource,
    HumanUtterance,
    PartnerAvailability,
    ReplyMark,
    reply_is_current,
)

GGE = PartnerAvailability("gge", Availability.AVAILABLE)
CURSOR = PartnerAvailability("cursor", Availability.AVAILABLE)
GGE_DOWN = PartnerAvailability("gge", Availability.UNAVAILABLE)
CURSOR_DOWN = PartnerAvailability("cursor", Availability.UNAVAILABLE)
GGE_BUSY = PartnerAvailability("gge", Availability.BUSY)
CURSOR_BUSY = PartnerAvailability("cursor", Availability.BUSY)


def utterance(turn_id="turn-1", text="今天天气怎么样", **kwargs):
    return HumanUtterance(turn_id, text, **kwargs)


def decide(floor=None, item=None, **kwargs):
    floor = floor or FloorControl()
    item = item or utterance()
    options = {
        "device_partner": "gge",
        "partners": (GGE, CURSOR),
        "remaining_budget": 2,
    }
    options.update(kwargs)
    return floor, floor.decide(item, **options)


def test_default_is_only_the_device_partner():
    floor, decision = decide()
    assert decision.responder == "gge"
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == "当前设备伙伴gge回答。不补充。"
    assert floor.authorized_calls("turn-1") == 1
    assert floor.speaker() == "gge"
    assert floor.is_current("turn-1", decision.generation)


def test_text_that_mentions_a_name_does_not_select_that_partner():
    floor, decision = decide(item=utterance(text="Cursor，你也说说今天的安排"))
    assert decision.responder == "gge"
    assert decision.calls_authorized == 1
    assert floor.authorized_calls("turn-1") == 1


def test_named_partner_answers_and_device_partner_does_not():
    floor, decision = decide(item=utterance(addressed_project="cursor"))
    assert decision.responder == "cursor"
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == "用户点名cursor，由该伙伴回答。不补充。"
    assert floor.speaker() == "cursor"


def test_naming_the_device_partner_still_authorizes_one_call():
    _, decision = decide(item=utterance(addressed_project="gge"))
    assert decision.responder == "gge"
    assert decision.calls_authorized == 1
    assert decision.reason == "用户点名当前设备伙伴gge，由该伙伴回答。不补充。"


@pytest.mark.parametrize("source", [
    GroupModeSource.PARTNER,
    GroupModeSource.QUOTE,
    GroupModeSource.HISTORY,
    GroupModeSource.SCHEDULE,
    GroupModeSource.NONE,
])
def test_non_human_sources_cannot_enable_group_mode(source):
    _, decision = decide(item=utterance(group_mode=True, group_mode_source=source))
    assert decision.responder == "gge"
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == f"当前设备伙伴gge回答。群体模式来源为{source.value}，不补充。"


def test_group_flag_without_human_source_is_not_read_from_wording():
    _, decision = decide(item=utterance(text="我们开启群体模式吧", group_mode=False))
    assert decision.supplement_allowed is False
    assert decision.reason == "当前设备伙伴gge回答。不补充。"


def test_human_group_mode_allows_one_supplement_without_calling_them():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    assert decision.responder == "gge"
    assert decision.supplement_allowed is True
    assert decision.calls_authorized == 1
    assert decision.reason == "当前设备伙伴gge回答。允许一位伙伴补充一次。"
    assert floor.authorized_calls("turn-1") == 1

    primary = floor.review_reply("turn-1", decision.generation, "gge")
    assert primary.insert is True
    assert floor.speaker() == "gge"

    granted = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert granted.accepted is True
    assert granted.responder == "cursor"
    assert granted.calls_authorized == 1
    assert granted.floor_with_human is True
    assert granted.reason == "允许cursor补充一次，随后话语权交还用户。"
    assert floor.authorized_calls("turn-1") == 2
    assert floor.speaker() == "cursor"

    extra = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=3,
    )
    assert extra.duplicate is True
    assert extra.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 2

    other = floor.decide_supplement(
        "turn-1", decision.generation, "gge",
        partners=(GGE, CURSOR), remaining_budget=3,
    )
    assert other.rejected is True
    assert other.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 2


def test_no_supplement_is_valid_and_returns_the_floor():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    assert floor.review_reply("turn-1", decision.generation, "gge").insert is True
    declined = floor.decide_supplement(
        "turn-1", decision.generation, None,
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert declined.accepted is True
    assert declined.responder is None
    assert declined.calls_authorized == 0
    assert declined.floor_with_human is True
    assert declined.reason == "无人补充，话语权交还用户。"
    assert floor.speaker() == "gge"
    assert floor.review_reply("turn-1", decision.generation, "cursor").insert is False


def test_supplement_before_primary_reply_does_not_spend_a_call():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    early = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert early.rejected is True
    assert early.calls_authorized == 0
    assert early.reason == "主回答尚未记入，不能开始补充。"
    assert floor.authorized_calls("turn-1") == 1
    assert floor.review_reply("turn-1", decision.generation, "gge").insert is True
    granted = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert granted.calls_authorized == 1


def test_unavailable_supplement_candidate_does_not_relay():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    floor.review_reply("turn-1", decision.generation, "gge")
    refused = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR_DOWN), remaining_budget=1,
    )
    assert refused.rejected is True
    assert refused.responder is None
    assert refused.calls_authorized == 0
    assert refused.reason == "cursor不可用，不补充，话语权交还用户。"
    retry = floor.decide_supplement(
        "turn-1", decision.generation, "gge",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert retry.rejected is True
    assert retry.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1


def test_same_partner_cannot_take_the_supplement_slot():
    floor, decision = decide(item=utterance(
        addressed_project="cursor",
        group_mode=True,
        group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    assert decision.responder == "cursor"
    assert decision.supplement_allowed is True
    floor.review_reply("turn-1", decision.generation, "cursor")
    refused = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert refused.calls_authorized == 0
    assert refused.responder is None
    assert floor.speaker() == "cursor"


def test_zero_budget_has_no_responder_and_no_retry_loop():
    floor = FloorControl()
    item = utterance()
    first = floor.decide(item, device_partner="gge", partners=(GGE, CURSOR), remaining_budget=0)
    second = floor.decide(item, device_partner="gge", partners=(GGE, CURSOR), remaining_budget=0)
    assert first.responder is None
    assert first.supplement_allowed is False
    assert first.calls_authorized == 0
    assert first.reason == "发言预算已用尽，本轮没有回答者。"
    assert second.duplicate is True
    assert second.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 0
    assert floor.speaker() is None


def test_budget_for_one_call_does_not_open_a_supplement():
    _, decision = decide(
        item=utterance(group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT),
        remaining_budget=1,
    )
    assert decision.responder == "gge"
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == "当前设备伙伴gge回答。剩余预算只够这一次回应，不补充。"


def test_unavailable_device_partner_is_not_replaced():
    floor, decision = decide(partners=(GGE_DOWN, CURSOR))
    assert decision.responder is None
    assert decision.calls_authorized == 0
    assert decision.reason == "当前设备伙伴gge不可用，本轮没有回答者。"
    assert floor.speaker() is None
    assert floor.review_reply("turn-1", decision.generation, "cursor").insert is False


def test_unavailable_named_partner_is_not_replaced_by_device_partner():
    _, decision = decide(
        item=utterance(addressed_project="cursor"),
        partners=(GGE, CURSOR_DOWN),
    )
    assert decision.responder is None
    assert decision.calls_authorized == 0
    assert decision.reason == "被点名的cursor不可用，本轮没有回答者。"


def test_unknown_partner_is_unavailable():
    _, decision = decide(item=utterance(addressed_project="grok"))
    assert decision.responder is None
    assert decision.calls_authorized == 0
    assert "grok" in decision.reason


def test_duplicate_event_does_not_authorize_another_call():
    floor, first = decide()
    second = floor.decide(
        utterance(), device_partner="gge", partners=(GGE, CURSOR), remaining_budget=2,
    )
    assert second.duplicate is True
    assert second.responder == "gge"
    assert second.generation == first.generation
    assert second.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1


def test_same_turn_id_with_different_content_is_rejected():
    floor, first = decide()
    conflict = floor.decide(
        utterance(text="另一句话"),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    assert conflict.rejected is True
    assert conflict.responder is None
    assert conflict.calls_authorized == 0
    assert conflict.reason == "同一轮次编号已接纳过不同内容，拒绝另开调用。"
    assert floor.is_current("turn-1", first.generation)
    assert floor.authorized_calls("turn-1") == 1
    assert floor.speaker() == "gge"


def test_stop_makes_old_replies_stale_and_is_idempotent():
    floor, decision = decide()
    generation = decision.generation
    assert floor.review_reply("turn-1", generation, "gge").insert is True
    stopped = floor.stop("turn-1")
    assert stopped.stopped is True
    assert stopped.reason == "已停止本轮，过期回复不播放、不插入当前对话。"
    again = floor.stop("turn-1")
    assert again.reason == "本轮已经停止，不重复处理。"
    late = floor.review_reply("turn-1", generation, "gge")
    assert late.current is False
    assert late.insert is False
    assert late.play is False
    assert late.archive is False
    assert late.reason == "重复回复，不再归档。"
    assert floor.is_current("turn-1", generation) is False
    assert floor.speaker() is None
    stale = floor.decide_supplement(
        "turn-1", generation, "cursor", partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert stale.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1


def test_new_question_rejects_the_previous_generation():
    floor, old = decide()
    new_item = utterance(turn_id="turn-2", text="换一个问题", addressed_project="cursor")
    fresh = floor.decide(
        new_item, device_partner="gge", partners=(GGE, CURSOR), remaining_budget=2,
    )
    assert fresh.responder == "cursor"
    assert fresh.generation == old.generation + 1
    assert floor.is_current("turn-1", old.generation) is False
    assert floor.is_current("turn-2", fresh.generation) is True
    stale = floor.review_reply("turn-1", old.generation, "gge")
    assert stale.insert is False
    assert stale.play is False
    assert stale.current is False
    assert stale.archive is True
    assert stale.mark is ReplyMark.SUPERSEDED
    inserted = floor.review_reply("turn-2", fresh.generation, "cursor")
    assert inserted.insert is True
    wrong = floor.review_reply("turn-2", fresh.generation, "gge")
    assert wrong.current is True
    assert wrong.insert is False
    assert wrong.reason == "该伙伴没有本轮发言权，不插入。"
    assert floor.authorized_calls("turn-1") == 1
    assert floor.authorized_calls("turn-2") == 1


def test_reply_inserts_once():
    floor, decision = decide()
    first = floor.review_reply("turn-1", decision.generation, "gge")
    second = floor.review_reply("turn-1", decision.generation, "gge")
    assert first.insert is True
    assert first.play is True
    assert first.archive is True
    assert first.mark is None
    assert second.insert is False
    assert second.play is False
    assert second.archive is False
    assert second.current is True
    assert second.reason == "重复回复，不再插入。"


def test_supplement_reply_inserts_once_then_floor_is_human():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    generation = decision.generation
    floor.review_reply("turn-1", generation, "gge")
    floor.decide_supplement(
        "turn-1", generation, "cursor", partners=(GGE, CURSOR), remaining_budget=1,
    )
    added = floor.review_reply("turn-1", generation, "cursor")
    assert added.insert is True
    assert added.reason == "补充回复属于当前轮次，允许插入。"
    assert floor.review_reply("turn-1", generation, "cursor").insert is False
    assert floor.speaker() == "cursor"


def test_stopped_unknown_turn_does_not_clear_the_active_floor():
    floor, decision = decide()
    missing = floor.stop("turn-9")
    assert missing.stopped is False
    assert floor.is_current("turn-1", decision.generation) is True
    assert floor.speaker() == "gge"


def test_superseded_turn_stays_stale_when_stopped_later():
    floor, old = decide()
    floor.decide(
        utterance(turn_id="turn-2", text="新问题"),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    result = floor.stop("turn-1")
    assert result.stopped is True
    assert floor.is_current("turn-1", old.generation) is False
    assert floor.is_current("turn-2", old.generation + 1) is True
    assert floor.authorized_calls("turn-1") == 1


def test_reusing_a_stopped_turn_id_does_not_reopen_it():
    floor, _decision = decide()
    floor.stop("turn-1")
    again = floor.decide(
        utterance(), device_partner="gge", partners=(GGE, CURSOR), remaining_budget=2,
    )
    assert again.duplicate is True
    assert again.calls_authorized == 0
    assert floor.is_current("turn-1", again.generation) is False
    assert floor.authorized_calls("turn-1") == 1


def test_limits_are_explicit_config():
    defaults = FloorLimits()
    assert defaults.max_responders == 1
    assert defaults.max_supplements == 1
    assert defaults.max_partner_calls == 2
    quiet = FloorControl(FloorLimits(max_supplements=0))
    decision = quiet.decide(
        utterance(group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=4,
    )
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == "当前设备伙伴gge回答。补充上限为0，不补充。"
    with pytest.raises(FloorError, match="补充上限"):
        FloorLimits(max_supplements=2)
    with pytest.raises(FloorError, match="主回答者"):
        FloorLimits(max_responders=2)


def test_group_mode_with_no_other_available_partner_skips_supplement():
    _, decision = decide(
        item=utterance(group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT),
        partners=(GGE, CURSOR_DOWN),
    )
    assert decision.responder == "gge"
    assert decision.supplement_allowed is False
    assert decision.reason == "当前设备伙伴gge回答。没有其他可用伙伴，不补充。"


def test_reply_is_current_is_deterministic():
    assert reply_is_current(
        active_turn_id="turn-1", active_generation=3, closed=False, turn_id="turn-1", generation=3,
    ) is True
    assert reply_is_current(
        active_turn_id="turn-1", active_generation=3, closed=False, turn_id="turn-1", generation=2,
    ) is False
    assert reply_is_current(
        active_turn_id="turn-2", active_generation=4, closed=False, turn_id="turn-1", generation=3,
    ) is False
    assert reply_is_current(
        active_turn_id="turn-1", active_generation=3, closed=True, turn_id="turn-1", generation=3,
    ) is False
    assert reply_is_current(
        active_turn_id=None, active_generation=None, closed=True, turn_id="turn-1", generation=1,
    ) is False


def test_malformed_input_authorizes_nothing():
    floor = FloorControl()
    with pytest.raises(FloorError):
        HumanUtterance("", "你好")
    with pytest.raises(FloorError):
        HumanUtterance("turn-1", "   ")
    with pytest.raises(FloorError):
        HumanUtterance("turn-1", "你好", group_mode_source="human")  # type: ignore[arg-type]
    with pytest.raises(FloorError):
        floor.decide(
            utterance(),
            device_partner="gge",
            partners=(GGE, GGE),
            remaining_budget=1,
        )
    with pytest.raises(FloorError):
        floor.decide(
            utterance(),
            device_partner="gge",
            partners=(GGE,),
            remaining_budget=-1,
        )
    with pytest.raises(FloorError):
        floor.decide(
            utterance(),
            device_partner="gge",
            partners=(GGE,),
            remaining_budget=True,  # type: ignore[arg-type]
        )
    with pytest.raises(FloorError, match="伙伴状态"):
        PartnerAvailability("gge", True)  # type: ignore[arg-type]
    assert floor.authorized_calls("turn-1") == 0
    assert floor.speaker() is None


def test_budget_exhausted_during_supplement_does_not_pick_someone_else():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    floor.review_reply("turn-1", decision.generation, "gge")
    refused = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=0,
    )
    assert refused.responder is None
    assert refused.calls_authorized == 0
    assert refused.reason == "发言预算已用尽，不补充，话语权交还用户。"
    follow = floor.decide_supplement(
        "turn-1", decision.generation, None,
        partners=(GGE, CURSOR), remaining_budget=2,
    )
    assert follow.rejected is True
    assert follow.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1


def test_new_question_during_open_supplement_drops_the_old_slot():
    floor, old = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    floor.review_reply("turn-1", old.generation, "gge")
    floor.decide(
        utterance(turn_id="turn-2", text="先停一下"),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    stale = floor.decide_supplement(
        "turn-1", old.generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=2,
    )
    assert stale.rejected is True
    assert stale.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1
    assert floor.authorized_calls("turn-2") == 1


def _assert_same_decision_duplicate(floor, first):
    assert floor.authorized_calls("turn-1") == 1
    assert floor.speaker() == "gge"
    assert floor.is_current("turn-1", first.generation) is True


def test_same_turn_resend_with_budget_and_roster_change_stays_duplicate():
    floor, first = decide()
    assert first.responder == "gge"
    assert first.calls_authorized == 1
    assert first.reason == "当前设备伙伴gge回答。不补充。"
    retry = floor.decide(
        utterance(),
        device_partner="gge",
        partners=(GGE_BUSY, CURSOR_DOWN),
        remaining_budget=0,
    )
    assert retry.duplicate is True
    assert retry.rejected is False
    assert retry.responder == "gge"
    assert retry.calls_authorized == 0
    assert retry.generation == first.generation
    assert retry.supplement_allowed is False
    _assert_same_decision_duplicate(floor, first)

    budget_only, budget_first = decide()
    budget_retry = budget_only.decide(
        utterance(), device_partner="gge", partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert budget_retry.duplicate is True
    assert budget_retry.responder == "gge"
    assert budget_retry.calls_authorized == 0
    _assert_same_decision_duplicate(budget_only, budget_first)

    roster_only, roster_first = decide()
    roster_retry = roster_only.decide(
        utterance(), device_partner="gge", partners=(GGE_BUSY, CURSOR), remaining_budget=2,
    )
    assert roster_retry.duplicate is True
    assert roster_retry.responder == "gge"
    assert roster_retry.calls_authorized == 0
    assert roster_retry.rejected is False
    _assert_same_decision_duplicate(roster_only, roster_first)


def test_device_partner_or_group_mode_change_is_still_different_content():
    floor, first = decide()
    other_device = floor.decide(
        utterance(),
        device_partner="cursor",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    assert other_device.rejected is True
    assert other_device.duplicate is False
    assert other_device.responder is None
    assert other_device.calls_authorized == 0
    grouped = floor.decide(
        utterance(group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=0,
    )
    assert grouped.rejected is True
    assert grouped.calls_authorized == 0
    assert floor.speaker() == "gge"
    assert floor.authorized_calls("turn-1") == first.calls_authorized


def test_stopped_authorized_reply_is_archived_without_playback():
    floor, decision = decide()
    generation = decision.generation
    floor.stop("turn-1")
    late = floor.review_reply("turn-1", generation, "gge")
    assert late.current is False
    assert late.insert is False
    assert late.play is False
    assert late.archive is True
    assert late.mark is ReplyMark.STOPPED
    assert late.reason == "本轮已停止，正文归档为 stopped，不播放、不插入当前对话。"
    again = floor.review_reply("turn-1", generation, "gge")
    assert again.archive is False
    assert again.play is False
    assert again.insert is False
    assert again.reason == "重复回复，不再归档。"
    assert floor.authorized_calls("turn-1") == 1
    assert floor.speaker() is None


def test_superseded_authorized_reply_is_archived_without_playback():
    floor, old = decide()
    floor.decide(
        utterance(turn_id="turn-2", text="新问题"),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    late = floor.review_reply("turn-1", old.generation, "gge")
    assert late.current is False
    assert late.insert is False
    assert late.play is False
    assert late.archive is True
    assert late.mark is ReplyMark.SUPERSEDED
    assert "superseded" in late.reason
    fresh = floor.review_reply("turn-2", old.generation + 1, "gge")
    assert fresh.current is True
    assert fresh.insert is True
    assert fresh.play is True
    assert fresh.archive is True
    assert fresh.mark is None


def test_superseded_then_stopped_reply_archives_as_superseded():
    floor, old = decide()
    floor.decide(
        utterance(turn_id="turn-2", text="新问题"),
        device_partner="gge",
        partners=(GGE, CURSOR),
        remaining_budget=2,
    )
    floor.stop("turn-1")
    late = floor.review_reply("turn-1", old.generation, "gge")
    assert late.archive is True
    assert late.mark is ReplyMark.SUPERSEDED
    assert late.play is False
    assert late.insert is False
    assert floor.is_current("turn-2", old.generation + 1) is True


def test_late_supplement_is_archived_without_playback():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    generation = decision.generation
    assert floor.review_reply("turn-1", generation, "gge").insert is True
    granted = floor.decide_supplement(
        "turn-1", generation, "cursor",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert granted.accepted is True
    floor.stop("turn-1")
    late = floor.review_reply("turn-1", generation, "cursor")
    assert late.current is False
    assert late.insert is False
    assert late.play is False
    assert late.archive is True
    assert late.mark is ReplyMark.STOPPED
    assert floor.review_reply("turn-1", generation, "cursor").archive is False
    assert floor.authorized_calls("turn-1") == 2


def test_unauthorized_stale_reply_is_not_archived():
    floor, decision = decide()
    generation = decision.generation
    floor.stop("turn-1")
    stranger = floor.review_reply("turn-1", generation, "cursor")
    assert stranger.current is False
    assert stranger.archive is False
    assert stranger.play is False
    assert stranger.insert is False
    assert stranger.mark is None
    empty = FloorControl()
    nothing = empty.decide(
        utterance(), device_partner="gge", partners=(GGE, CURSOR), remaining_budget=0,
    )
    empty.stop("turn-1")
    unsent = empty.review_reply("turn-1", nothing.generation, "gge")
    assert unsent.archive is False
    assert unsent.play is False


def test_busy_device_partner_is_not_replaced():
    floor, decision = decide(partners=(GGE_BUSY, CURSOR))
    assert decision.responder is None
    assert decision.calls_authorized == 0
    assert decision.supplement_allowed is False
    assert decision.reason == "当前设备伙伴gge上一轮仍在收尾，本轮没有回答者。"
    assert "不可用" not in decision.reason
    assert floor.speaker() is None
    assert floor.review_reply("turn-1", decision.generation, "cursor").insert is False


def test_busy_named_partner_is_not_replaced():
    _, decision = decide(
        item=utterance(addressed_project="cursor"),
        partners=(GGE, CURSOR_BUSY),
    )
    assert decision.responder is None
    assert decision.calls_authorized == 0
    assert decision.reason == "被点名的cursor上一轮仍在收尾，本轮没有回答者。"
    assert "不可用" not in decision.reason


def test_busy_supplement_candidate_does_not_relay():
    floor, decision = decide(item=utterance(
        group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT,
    ))
    floor.review_reply("turn-1", decision.generation, "gge")
    refused = floor.decide_supplement(
        "turn-1", decision.generation, "cursor",
        partners=(GGE, CURSOR_BUSY), remaining_budget=1,
    )
    assert refused.rejected is True
    assert refused.responder is None
    assert refused.calls_authorized == 0
    assert refused.reason == "cursor上一轮仍在收尾，不补充，话语权交还用户。"
    retry = floor.decide_supplement(
        "turn-1", decision.generation, "gge",
        partners=(GGE, CURSOR), remaining_budget=1,
    )
    assert retry.rejected is True
    assert retry.calls_authorized == 0
    assert floor.authorized_calls("turn-1") == 1
    assert floor.speaker() == "gge"


def test_group_mode_with_only_busy_other_partner_skips_supplement():
    _, decision = decide(
        item=utterance(group_mode=True, group_mode_source=GroupModeSource.HUMAN_EXPLICIT),
        partners=(GGE, CURSOR_BUSY),
    )
    assert decision.responder == "gge"
    assert decision.supplement_allowed is False
    assert decision.calls_authorized == 1
    assert decision.reason == "当前设备伙伴gge回答。其他伙伴上一轮仍在收尾，不补充。"
