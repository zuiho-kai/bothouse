package core

import (
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A pause made while the role that carries the item is cooling down after quota exhaustion is a
// wait with a set end, not a stop (#2095: #2086 was paused 16:32 「Claude 额度耗尽到 18:40；工作区派
// 不进去…」 and the user got 「②停了」). The bridge knows when the cooldown ends, so the pause is
// recorded the way any wait with a time is (board wait: 「等外部」 with wait_until at the reset): the
// board shows it 在等 with the time, and retryWaitingExternal hands it to a workspace once the
// cooldown is over (it skips while still cooling). Recorded from the cooldown itself, not from the
// words of the pause reason (user 11-27「是要更好的一个状态，不是说增加状态吗」).

// coolingPauseFresh: only a pause this young is taken as made because of the cooldown. The board
// pass runs every teamBoardInterval, so it is caught before chatStopSettle would make it a ②; an
// older pause was a stop before the cooldown began and stays one.
const coolingPauseFresh = chatStopSettle

var coolingPauseTried = struct {
	sync.Mutex
	at map[string]bool
}{at: map[string]bool{}}

// coolingWaitRun runs board.py wait for item id; a variable so tests need no Python.
var coolingWaitRun = func(e *Engine, chat string, id int, why string, minutes int) error {
	out, err := e.runLeadScript(chat, "board", "wait", strconv.Itoa(id), why, strconv.Itoa(minutes))
	if err != nil {
		slog.Warn("team task: record pause during quota cooldown as a wait failed", "board_item", id, "error", err, "output", strings.TrimSpace(string(out)))
	}
	return err
}

// taskCoolingUntil: when the quota cooldown of the role that dispatched item it ends (zero = not
// cooling). The dispatcher's engine, else this one.
func (e *Engine) taskCoolingUntil(it teamTaskBoardItem, now time.Time) time.Time {
	x := e
	for _, peer := range e.watchEngines() {
		if peer != nil && peer.name == it.Dispatcher {
			x = peer
			break
		}
	}
	if x.agent == nil {
		return time.Time{}
	}
	chat := it.Chat
	if chat != "" && !strings.Contains(chat, ":") {
		chat = "discord:" + chat
	}
	model := x.sessionModelFor(chat)
	if model == "" {
		model = modelOf(x.agent)
	}
	until := x.quotaCoolingForAt(x.quotaScopeFor(x.agent, model), now)
	x.capMu.Lock()
	if x.capUntil.After(until) && x.capUntil.After(now) {
		until = x.capUntil
	}
	x.capMu.Unlock()
	return until
}

// coolingPauseCandidate: a plain pause (counted as a ② stop) of a role, fresh.
func coolingPauseCandidate(it teamTaskBoardItem, now time.Time) bool {
	if it.Paused == "" || it.Backlog != "" || it.Probe || it.waitsAnswer() || strings.HasPrefix(strings.TrimSpace(it.PauseWhy), "用户") {
		return false
	}
	if state, _ := teamTaskBoardStateOf(it, now); state != teamTaskPaused {
		return false
	}
	at, ok := teamTaskTableAsked(it, now)
	return ok && now.Sub(at) < coolingPauseFresh
}

// parkCoolingPauses records each fresh pause made during its dispatcher's quota cooldown as a wait
// until the cooldown ends; true when one was recorded (the board is to be read again).
func (e *Engine) parkCoolingPauses(items []teamTaskBoardItem, now time.Time) bool {
	done := false
	for _, it := range items {
		if !coolingPauseCandidate(it, now) {
			continue
		}
		until := e.taskCoolingUntil(it, now)
		if until.IsZero() {
			continue
		}
		key := e.team.dir + "#" + strconv.Itoa(it.ID) + "#" + it.PausedAt + it.Paused
		coolingPauseTried.Lock()
		tried := coolingPauseTried.at[key]
		coolingPauseTried.at[key] = true
		coolingPauseTried.Unlock()
		if tried {
			continue
		}
		why := "额度冷却到 " + teamTaskBoardClock(until, now)
		if r := strings.TrimSpace(it.PauseWhy); r != "" {
			why += "：" + r
		}
		mins := int(until.Sub(now)/time.Minute) + 1
		if coolingWaitRun(e, it.Chat, it.ID, why, mins) == nil {
			slog.Info("team task: paused during quota cooldown, recorded as a wait until it ends", "board_item", it.ID, "until", until)
			done = true
		}
	}
	return done
}
