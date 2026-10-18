"""发言权：决定这一轮谁可以回答。

Issue #33 的第一步。这里只做确定性调度，不调用伙伴、不识别语音、不播放音频，
也不读取正文来猜测点名或群体模式。调用方传入已经判定的事实；本模块给出唯一
回答者（或明确的“没有回答者”）、是否允许一次补充，以及一句可审查的原因。

同一轮次编号重复提交不会再次授权调用。判重只看这句话本身（正文、点名、
群体模式及来源、当前设备伙伴）；预算和名单变化不算另一句话。停止或新问题
会使旧世代失效：过期回复不播放、不插入当前对话，但仍归档并标成 stopped
或 superseded。伙伴正在收尾、不可用或预算用尽时直接结束，不换人、不接力。
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Sequence


class GroupModeSource(Enum):
    """群体模式的来源。只有真人显式开启才生效。"""

    NONE = "none"
    HUMAN_EXPLICIT = "human_explicit"
    PARTNER = "partner"
    QUOTE = "quote"
    HISTORY = "history"
    SCHEDULE = "schedule"


class Availability(Enum):
    """伙伴能否被这次调用选中。忙着收尾和不可用都不再改叫别人。"""

    AVAILABLE = "available"
    BUSY = "busy"
    UNAVAILABLE = "unavailable"


class ReplyMark(Enum):
    """过期回复写入共享记录时的标记。标记不是丢弃正文。"""

    STOPPED = "stopped"
    SUPERSEDED = "superseded"


_PROJECT_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
)
_TURN_CHARS = _PROJECT_CHARS


class FloorError(ValueError):
    """输入不符合发言权合同。尚未授权任何调用。"""


@dataclass(frozen=True)
class FloorLimits:
    """v1 的显式上限。调用点只读取这里的数字，不另写魔法数。"""

    max_responders: int = 1
    max_supplements: int = 1

    def __post_init__(self):
        if type(self.max_responders) is not int or self.max_responders != 1:
            raise FloorError("v1 每轮主回答者上限固定为 1。")
        if type(self.max_supplements) is not int or not 0 <= self.max_supplements <= 1:
            raise FloorError("v1 补充上限只能是 0 或 1。")

    @property
    def max_partner_calls(self) -> int:
        return self.max_responders + self.max_supplements


@dataclass(frozen=True)
class PartnerAvailability:
    """一位伙伴当前能否被调用。名单由调用方给出，本模块不发现伙伴。

    available 可以立即调用。busy 表示上一轮仍在收尾，本轮不调用。
    unavailable 表示不在或不能调用。后两者都不改叫下一位。
    """

    project: str
    state: Availability

    def __post_init__(self):
        _require_project(self.project, "伙伴")
        if not isinstance(self.state, Availability):
            raise FloorError("伙伴状态必须是 available、busy 或 unavailable。")


@dataclass(frozen=True)
class HumanUtterance:
    """真人这一句话，以及调用方已经判定的点名和群体模式。

    新的轮次编号会使当前轮次失效，即使这次没有回答者。调用方只能在真人
    显式动作（按住说话、确认发送）时构造它，不能来自声音活动检测、喇叭回声
    或伙伴消息。
    """

    turn_id: str
    text: str
    addressed_project: str | None = None
    group_mode: bool = False
    group_mode_source: GroupModeSource = GroupModeSource.NONE

    def __post_init__(self):
        _require_turn_id(self.turn_id)
        if not isinstance(self.text, str) or not self.text.strip():
            raise FloorError("用户发言不能为空。")
        if len(self.text) > 4000:
            raise FloorError("用户发言超过 4000 字。")
        if self.addressed_project is not None:
            _require_project(self.addressed_project, "被点名的伙伴")
        if type(self.group_mode) is not bool:
            raise FloorError("群体模式必须是布尔值。")
        if not isinstance(self.group_mode_source, GroupModeSource):
            raise FloorError("群体模式来源必须是已定义的来源。")


@dataclass(frozen=True)
class FloorDecision:
    """一轮真人发言的调度结果。calls_authorized 只计本次调用新授权的次数。"""

    turn_id: str
    generation: int
    responder: str | None
    supplement_allowed: bool
    reason: str
    calls_authorized: int
    duplicate: bool = False
    rejected: bool = False


@dataclass(frozen=True)
class SupplementDecision:
    """补充名额的一次决定。无人补充是有效结果，不会因此再找别人。"""

    turn_id: str
    generation: int
    responder: str | None
    accepted: bool
    reason: str
    calls_authorized: int
    floor_with_human: bool
    duplicate: bool = False
    rejected: bool = False


@dataclass(frozen=True)
class StopResult:
    turn_id: str
    stopped: bool
    reason: str


@dataclass(frozen=True)
class ReplyReview:
    """一条伙伴回复的处置。

    current、play、insert 只决定能否播放、能否进入当前对话。
    archive 为真时仍写入共享记录。过期但曾授权的回复用 mark 标成
    stopped 或 superseded，不因过期丢掉正文。
    """

    current: bool
    insert: bool
    play: bool
    archive: bool
    mark: ReplyMark | None
    reason: str


def reply_is_current(
    *,
    active_turn_id: str | None,
    active_generation: int | None,
    closed: bool,
    turn_id: str,
    generation: int,
) -> bool:
    """回复是否仍属于当前开放轮次。

    停止、被新问题取代或世代不一致时为假。为假时不得播放、不得插入当前对话、
    不得再授权补充。这不表示共享记录要丢掉正文。
    """
    if closed or active_turn_id is None or active_generation is None:
        return False
    return turn_id == active_turn_id and generation == active_generation


@dataclass
class _Supplement:
    candidate: str | None
    accepted: bool
    responder: str | None
    reason: str
    calls_authorized: int
    rejected: bool


@dataclass
class _Turn:
    turn_id: str
    generation: int
    fingerprint: tuple
    responder: str | None
    supplement_allowed: bool
    reason: str
    calls_authorized: int
    superseded: bool = False
    stopped: bool = False
    primary_inserted: bool = False
    primary_archived: bool = False
    supplement: _Supplement | None = None
    supplement_inserted: bool = False
    supplement_archived: bool = False


class FloorControl:
    """单房间的发言权。由服务在同一条顺序里调用；本类自己不加锁、不访问外设。"""

    def __init__(self, limits: FloorLimits | None = None):
        self.limits = limits if limits is not None else FloorLimits()
        if not isinstance(self.limits, FloorLimits):
            raise FloorError("上限必须使用 FloorLimits。")
        self._generation = 0
        self._turns: dict[str, _Turn] = {}
        self._active: str | None = None

    def decide(
        self,
        utterance: HumanUtterance,
        *,
        device_partner: str,
        partners: Sequence[PartnerAvailability],
        remaining_budget: int,
    ) -> FloorDecision:
        """为这句真人发言确定唯一回答者。重复的同一事件返回原决定且不再授权。

        判重不看名单和预算。第一次决定之后伙伴转入收尾，或预算已被扣掉，
        同一句话重发仍是重复事件。
        """
        if not isinstance(utterance, HumanUtterance):
            raise FloorError("发言必须是 HumanUtterance。")
        _require_project(device_partner, "当前设备伙伴")
        roster = _roster(partners)
        budget = _budget(remaining_budget)
        fingerprint = _event_fingerprint(utterance, device_partner)
        existing = self._turns.get(utterance.turn_id)
        if existing is not None:
            if existing.fingerprint == fingerprint:
                return FloorDecision(
                    existing.turn_id,
                    existing.generation,
                    existing.responder,
                    existing.supplement_allowed,
                    "重复事件，沿用原决定，不再次调用。",
                    0,
                    duplicate=True,
                )
            return FloorDecision(
                existing.turn_id,
                existing.generation,
                None,
                False,
                "同一轮次编号已接纳过不同内容，拒绝另开调用。",
                0,
                rejected=True,
            )

        if self._active is not None:
            self._turns[self._active].superseded = True
        self._generation += 1
        generation = self._generation
        responder, supplement_allowed, reason, calls = _choose_responder(
            utterance,
            device_partner,
            roster,
            budget,
            self.limits,
        )
        turn = _Turn(
            turn_id=utterance.turn_id,
            generation=generation,
            fingerprint=fingerprint,
            responder=responder,
            supplement_allowed=supplement_allowed,
            reason=reason,
            calls_authorized=calls,
        )
        self._turns[utterance.turn_id] = turn
        self._active = utterance.turn_id
        return FloorDecision(
            utterance.turn_id,
            generation,
            responder,
            supplement_allowed,
            reason,
            calls,
        )

    def decide_supplement(
        self,
        turn_id: str,
        generation: int,
        candidate: str | None,
        *,
        partners: Sequence[PartnerAvailability],
        remaining_budget: int,
    ) -> SupplementDecision:
        """使用或放弃唯一的补充名额。不会自动改选下一位伙伴。"""
        _require_turn_id(turn_id)
        if type(generation) is not int or generation < 1:
            raise FloorError("世代编号不正确。")
        if candidate is not None:
            _require_project(candidate, "补充候选")
        roster = _roster(partners)
        budget = _budget(remaining_budget)
        turn = self._turns.get(turn_id)
        if turn is None or turn.generation != generation or turn.stopped or turn.superseded:
            return _supplement_reject(turn_id, generation, "过期轮次或不存在的轮次，不能补充。")
        if not turn.supplement_allowed:
            return _supplement_reject(turn_id, generation, "本轮未开启补充。", floor_with_human=True)
        if not turn.primary_inserted:
            return _supplement_reject(turn_id, generation, "主回答尚未记入，不能开始补充。")
        if turn.supplement is not None:
            previous = turn.supplement
            if previous.candidate == candidate:
                return SupplementDecision(
                    turn_id,
                    generation,
                    previous.responder,
                    previous.accepted,
                    "重复的补充决定，不再次调用。",
                    0,
                    floor_with_human=True,
                    duplicate=True,
                    rejected=previous.rejected,
                )
            return _supplement_reject(turn_id, generation, "补充已经决定，不能改成另一位。", floor_with_human=True)

        decision = _choose_supplement(
            turn,
            candidate,
            roster,
            budget,
            self.limits,
        )
        turn.supplement = decision
        if decision.calls_authorized:
            turn.calls_authorized += decision.calls_authorized
        return SupplementDecision(
            turn_id,
            generation,
            decision.responder,
            decision.accepted,
            decision.reason,
            decision.calls_authorized,
            True,
            rejected=decision.rejected,
        )

    def stop(self, turn_id: str) -> StopResult:
        """结束一轮。之后该世代的回复都不再是当前回复。"""
        _require_turn_id(turn_id)
        turn = self._turns.get(turn_id)
        if turn is None:
            return StopResult(turn_id, False, "没有这一轮，未改变当前发言权。")
        if turn.stopped:
            return StopResult(turn_id, True, "本轮已经停止，不重复处理。")
        turn.stopped = True
        if self._active == turn_id:
            self._active = None
        if turn.superseded:
            return StopResult(turn_id, True, "该轮已被新问题取代，停止后仍保持过期。")
        return StopResult(turn_id, True, "已停止本轮，过期回复不播放、不插入当前对话。")

    def is_current(self, turn_id: str, generation: int) -> bool:
        turn = self._turns.get(turn_id)
        active = self._turns.get(self._active) if self._active else None
        return reply_is_current(
            active_turn_id=None if active is None else active.turn_id,
            active_generation=None if active is None else active.generation,
            closed=turn is None or turn.stopped or turn.superseded or active is None,
            turn_id=turn_id,
            generation=generation,
        )

    def review_reply(self, turn_id: str, generation: int, project: str) -> ReplyReview:
        """决定一条伙伴回复如何播放、进入当前对话，以及是否归档。

        同一授权只归档一次。过期不取消归档：曾授权的迟到正文仍写入共享记录，
        并标成 stopped 或 superseded；播放和插入当前对话仍然拒绝。
        没有授权过的伙伴不归档。
        """
        _require_turn_id(turn_id)
        _require_project(project, "回复伙伴")
        if type(generation) is not int:
            raise FloorError("世代编号不正确。")
        turn = self._turns.get(turn_id)
        if turn is None or turn.generation != generation:
            return _review(False, False, False, False, None, "没有这一轮或世代不一致，不归档、不播放。")
        current = self.is_current(turn_id, generation)
        if turn.responder is not None and project == turn.responder:
            return _review_primary(turn, current)
        supplement = turn.supplement
        if supplement is not None and supplement.accepted and supplement.responder == project:
            if current and not turn.primary_inserted and not turn.supplement_archived:
                return _review(True, False, False, False, None, "补充回复须等主回答记入后，本次不插入。")
            return _review_supplement(turn, current)
        if not current:
            return _review(False, False, False, False, None, "过期回复，且该伙伴没有本轮发言权，不归档、不播放。")
        if turn.responder is None:
            return _review(True, False, False, False, None, "本轮没有授权回答者，不插入。")
        return _review(True, False, False, False, None, "该伙伴没有本轮发言权，不插入。")

    def authorized_calls(self, turn_id: str) -> int:
        turn = self._turns.get(turn_id)
        if turn is None:
            return 0
        return turn.calls_authorized

    def speaker(self) -> str | None:
        """此刻唯一被授权出声的伙伴。

        补充尚未决定时仍是主回答者。补充被接受后改为那位补充者。
        无人补充不撤销已经授权的主回答。停止、被新问题取代或本轮没有回答者时为空。
        """
        if self._active is None:
            return None
        turn = self._turns[self._active]
        if turn.stopped or turn.superseded or turn.responder is None:
            return None
        supplement = turn.supplement
        if supplement is not None and supplement.accepted and supplement.responder:
            return supplement.responder
        return turn.responder


def _choose_responder(utterance, device_partner, roster, budget, limits):
    named = utterance.addressed_project is not None
    intended = utterance.addressed_project if named else device_partner
    group_on = _human_group_mode(utterance)
    ignored_source = utterance.group_mode and not group_on

    if budget <= 0 or limits.max_responders <= 0:
        return None, False, "发言预算已用尽，本轮没有回答者。", 0
    state = roster.get(intended)
    if state is not Availability.AVAILABLE:
        if state is Availability.BUSY:
            if named:
                reason = f"被点名的{intended}上一轮仍在收尾，本轮没有回答者。"
            else:
                reason = f"当前设备伙伴{intended}上一轮仍在收尾，本轮没有回答者。"
        elif named:
            reason = f"被点名的{intended}不可用，本轮没有回答者。"
        else:
            reason = f"当前设备伙伴{intended}不可用，本轮没有回答者。"
        return None, False, reason, 0

    supplement_allowed, supplement_note = _supplement_permission(
        utterance,
        intended,
        roster,
        budget - 1,
        limits,
        group_on,
        ignored_source,
    )
    if named and intended != device_partner:
        head = f"用户点名{intended}，由该伙伴回答。"
    elif named:
        head = f"用户点名当前设备伙伴{intended}，由该伙伴回答。"
    else:
        head = f"当前设备伙伴{intended}回答。"
    return intended, supplement_allowed, head + supplement_note, 1


def _supplement_permission(utterance, responder, roster, budget_after, limits, group_on, ignored_source):
    if ignored_source:
        source = utterance.group_mode_source.value
        return False, f"群体模式来源为{source}，不补充。"
    if not group_on:
        return False, "不补充。"
    if limits.max_supplements < 1:
        return False, "补充上限为0，不补充。"
    if budget_after < 1:
        return False, "剩余预算只够这一次回应，不补充。"
    others = [
        project for project, state in roster.items()
        if state is Availability.AVAILABLE and project != responder
    ]
    if not others:
        busy = [
            project for project, state in roster.items()
            if state is Availability.BUSY and project != responder
        ]
        if busy:
            return False, "其他伙伴上一轮仍在收尾，不补充。"
        return False, "没有其他可用伙伴，不补充。"
    return True, "允许一位伙伴补充一次。"


def _human_group_mode(utterance: HumanUtterance) -> bool:
    return utterance.group_mode and utterance.group_mode_source is GroupModeSource.HUMAN_EXPLICIT


def _choose_supplement(turn: _Turn, candidate, roster, budget, limits) -> _Supplement:
    if turn.calls_authorized >= limits.max_partner_calls:
        return _Supplement(candidate, False, None, "本轮调用已达上限，不补充，话语权交还用户。", 0, True)
    if candidate is None:
        return _Supplement(None, True, None, "无人补充，话语权交还用户。", 0, False)
    if budget <= 0:
        return _Supplement(candidate, False, None, "发言预算已用尽，不补充，话语权交还用户。", 0, True)
    if candidate == turn.responder:
        return _Supplement(
            candidate,
            False,
            None,
            f"{candidate}已是本轮回答者，不补充，话语权交还用户。",
            0,
            True,
        )
    candidate_state = roster.get(candidate)
    if candidate_state is Availability.BUSY:
        return _Supplement(
            candidate,
            False,
            None,
            f"{candidate}上一轮仍在收尾，不补充，话语权交还用户。",
            0,
            True,
        )
    if candidate_state is not Availability.AVAILABLE:
        return _Supplement(
            candidate,
            False,
            None,
            f"{candidate}不可用，不补充，话语权交还用户。",
            0,
            True,
        )
    return _Supplement(
        candidate,
        True,
        candidate,
        f"允许{candidate}补充一次，随后话语权交还用户。",
        1,
        False,
    )


def _supplement_reject(turn_id, generation, reason, floor_with_human=False) -> SupplementDecision:
    return SupplementDecision(
        turn_id,
        generation,
        None,
        False,
        reason,
        0,
        floor_with_human,
        rejected=True,
    )


def _roster(partners: Sequence[PartnerAvailability]) -> dict[str, Availability]:
    if not isinstance(partners, Sequence) or isinstance(partners, (str, bytes)):
        raise FloorError("伙伴名单必须是序列。")
    roster: dict[str, Availability] = {}
    for partner in partners:
        if not isinstance(partner, PartnerAvailability):
            raise FloorError("伙伴名单只能包含 PartnerAvailability。")
        if partner.project in roster:
            raise FloorError("伙伴名单中的 project 不得重复。")
        roster[partner.project] = partner.state
    return roster


def _event_fingerprint(utterance: HumanUtterance, device_partner: str) -> tuple:
    """判重只看这句话本身。预算、名单和忙闲都不参与。"""
    return (
        utterance.text,
        utterance.addressed_project,
        utterance.group_mode,
        utterance.group_mode_source,
        device_partner,
    )


def _review(current, insert, play, archive, mark, reason) -> ReplyReview:
    return ReplyReview(current, insert, play, archive, mark, reason)


def _review_primary(turn: _Turn, current: bool) -> ReplyReview:
    if turn.primary_archived:
        reason = "重复回复，不再插入。" if current else "重复回复，不再归档。"
        return _review(current, False, False, False, None, reason)
    turn.primary_archived = True
    if current:
        turn.primary_inserted = True
        return _review(True, True, True, True, None, "回复属于当前轮次，允许插入。")
    return _stale_archive(turn)


def _review_supplement(turn: _Turn, current: bool) -> ReplyReview:
    if turn.supplement_archived:
        reason = "重复回复，不再插入。" if current else "重复回复，不再归档。"
        return _review(current, False, False, False, None, reason)
    turn.supplement_archived = True
    if current:
        turn.supplement_inserted = True
        return _review(True, True, True, True, None, "补充回复属于当前轮次，允许插入。")
    return _stale_archive(turn)


def _stale_archive(turn: _Turn) -> ReplyReview:
    """曾授权的过期正文仍归档。既被新问题取代又已停止时，标记 superseded。"""
    if turn.superseded:
        return _review(
            False, False, False, True, ReplyMark.SUPERSEDED,
            "本轮已被新问题取代，正文归档为 superseded，不播放、不插入当前对话。",
        )
    return _review(
        False, False, False, True, ReplyMark.STOPPED,
        "本轮已停止，正文归档为 stopped，不播放、不插入当前对话。",
    )


def _budget(remaining_budget: int) -> int:
    if type(remaining_budget) is not int or remaining_budget < 0:
        raise FloorError("剩余预算必须是非负整数。")
    return remaining_budget


def _require_project(project: str, label: str) -> None:
    if not isinstance(project, str) or not 1 <= len(project) <= 64 or any(ch not in _PROJECT_CHARS for ch in project):
        raise FloorError(f"{label}的 project 必须是 1 至 64 位字母、数字、下划线或短横线。")


def _require_turn_id(turn_id: str) -> None:
    if not isinstance(turn_id, str) or not 1 <= len(turn_id) <= 64 or any(ch not in _TURN_CHARS for ch in turn_id):
        raise FloorError("轮次编号必须是 1 至 64 位字母、数字、下划线或短横线。")
