package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A pause of a handoff that the bridge itself could not hand to its workspace because the quota is
// cooling is a wait with a set end, not a stop (#2095: #2086 was handed over 16:15, the handoff job
// was held until the 18:40 reset, the lead paused it 16:32 「Claude 额度耗尽到 18:40；工作区派不进去…」
// and the user got 「②停了」). The timer leaves a mark when it holds a handoff for a cooldown
// (noteHandoffQuotaHeld, kept in the team dir so a restart does not lose it); a pause of an item
// bound to that workspace after the mark, while the cooldown runs, is recorded the way any wait
// with a time is (board wait: 「等外部」 with wait_until at the reset). The board shows it 在等 with
// the time and retryWaitingExternal hands it back once the cooldown is over. Only that mark counts,
// not the words of the pause reason nor a cooldown of some role at pause time: a stop made for its
// own sake (10-28 #684 「橘额度死了…用户要求不在工作区搞，鲸鱼娘在本频道自己做」) has no held
// handoff and stays a stop.

// quotaHeldFile: per workspace session key, the handoff the timer held for a quota cooldown.
const quotaHeldFile = "quota-held.json"

type quotaHeld struct {
	At    time.Time `json:"at"`    // when the timer held the handoff
	Until time.Time `json:"until"` // when the cooldown ends (the held job runs then)
}

var quotaHeldMu sync.Mutex

var coolingPauseTried = struct {
	sync.Mutex
	at map[string]bool
}{at: map[string]bool{}}

func quotaHeldPath(e *Engine) string {
	if e == nil || e.team == nil || e.team.dir == "" {
		return ""
	}
	return filepath.Join(e.team.dir, quotaHeldFile)
}

func readQuotaHeld(path string) map[string]quotaHeld {
	m := map[string]quotaHeld{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

// setQuotaHeld writes (held != nil) or drops the mark of workspace ws.
func setQuotaHeld(e *Engine, ws string, held *quotaHeld) {
	path := quotaHeldPath(e)
	if path == "" || ws == "" {
		return
	}
	quotaHeldMu.Lock()
	defer quotaHeldMu.Unlock()
	m := readQuotaHeld(path)
	if held == nil {
		if _, ok := m[ws]; !ok {
			return
		}
		delete(m, ws)
	} else {
		m[ws] = *held
	}
	b, _ := json.Marshal(m)
	if err := os.WriteFile(path, b, 0o600); err != nil {
		slog.Warn("team task: write quota-held mark failed", "workspace", ws, "error", err)
	}
}

// noteHandoffQuotaHeld: the timer held the handoff of workspace ws until the cooldown ends.
func noteHandoffQuotaHeld(e *Engine, ws string, now time.Time, wait time.Duration) {
	setQuotaHeld(e, ws, &quotaHeld{At: now, Until: now.Add(wait)})
}

// clearHandoffQuotaHeld: the handoff of workspace ws runs; it is no longer held.
func clearHandoffQuotaHeld(e *Engine, ws string) { setQuotaHeld(e, ws, nil) }

// coolingWaitRun runs board.py wait for item id; a variable so tests need no Python.
var coolingWaitRun = func(e *Engine, chat string, id int, why string, minutes int) error {
	out, err := e.runLeadScript(chat, "board", "wait", strconv.Itoa(id), why, strconv.Itoa(minutes))
	if err != nil {
		slog.Warn("team task: record pause during quota cooldown as a wait failed", "board_item", id, "error", err, "output", strings.TrimSpace(string(out)))
	}
	return err
}

// coolingPauseHeld: the cooldown end when item it is a plain pause (counted as a ② stop) of a
// handoff the timer held for that cooldown before the pause; zero otherwise.
func coolingPauseHeld(it teamTaskBoardItem, held map[string]quotaHeld, now time.Time) time.Time {
	if it.Paused == "" || it.Backlog != "" || it.Probe || it.waitsAnswer() {
		return time.Time{}
	}
	if state, _ := teamTaskBoardStateOf(it, now); state != teamTaskPaused {
		return time.Time{}
	}
	ws := it.WSWas
	if ws == "" {
		ws = it.WS
	}
	h, ok := held[ws]
	if !ok || !h.Until.After(now) {
		return time.Time{}
	}
	if at, ok := teamTaskTableAsked(it, now); !ok || at.Before(h.At) {
		return time.Time{}
	}
	return h.Until
}

// parkCoolingPauses records each pause of a handoff held for a quota cooldown as a wait until the
// cooldown ends; true when one was recorded (the board is to be read again).
func (e *Engine) parkCoolingPauses(items []teamTaskBoardItem, now time.Time) bool {
	path := quotaHeldPath(e)
	if path == "" {
		return false
	}
	quotaHeldMu.Lock()
	held := readQuotaHeld(path)
	quotaHeldMu.Unlock()
	if len(held) == 0 {
		return false
	}
	done := false
	for _, it := range items {
		until := coolingPauseHeld(it, held, now)
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
			slog.Info("team task: handoff held for the quota cooldown was paused, recorded as a wait until it ends", "board_item", it.ID, "until", until)
			done = true
		}
	}
	return done
}
