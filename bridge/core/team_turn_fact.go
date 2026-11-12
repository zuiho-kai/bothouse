package core

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// #699 batch B: the turn fact. The engine writes it when a turn starts and ends
// (processInteractiveMessageWith), keyed by the chat of the turn ("<platform>:<chat>"), with the
// task the turn belongs to. Everything that asks "is this workspace running a turn" reads this one
// record: the watch, the auto return, claims and the idle-workspace list.
//
// Before, two implementations answered it and disagreed: the watch's workspaceBusy scanned only
// each engine's main session table, watchBusy also the workspace pool's. On 11-11 15:42 工作区3
// (#677) the watch's check found no busy session while the queue log showed the turn 9m23s in, so
// it parked a running turn (design §2 item 5). A turn registered here is running whichever session
// table holds it.

type teamTurnFact struct {
	Chat    string // "<platform>:<chat>"
	Session string // the session key of the turn
	Engine  string // project running it
	TaskID  int    // board id of the task the turn belongs to (0: not a task's turn)
	Started time.Time
	// lastEvent: unix nanos of the turn's last agent event (interactiveState.lastEventAt).
	lastEvent *atomic.Int64
}

// LastEvent is when the turn last received an agent event (its start when none came yet).
func (f teamTurnFact) LastEvent() time.Time {
	if f.lastEvent != nil {
		if at := f.lastEvent.Load(); at != 0 {
			return time.Unix(0, at)
		}
	}
	return f.Started
}

var teamTurns = struct {
	mu   sync.Mutex
	next uint64
	by   map[string]map[uint64]teamTurnFact
}{by: map[string]map[uint64]teamTurnFact{}}

// beginTeamTurn records a running turn and returns the function that ends it.
func beginTeamTurn(f teamTurnFact) (end func()) {
	chat := teamChatKey(f.Chat)
	f.Chat = chat
	if f.Started.IsZero() {
		f.Started = time.Now()
	}
	teamTurns.mu.Lock()
	teamTurns.next++
	id := teamTurns.next
	if teamTurns.by[chat] == nil {
		teamTurns.by[chat] = map[uint64]teamTurnFact{}
	}
	teamTurns.by[chat][id] = f
	teamTurns.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			teamTurns.mu.Lock()
			delete(teamTurns.by[chat], id)
			if len(teamTurns.by[chat]) == 0 {
				delete(teamTurns.by, chat)
			}
			teamTurns.mu.Unlock()
		})
	}
}

// teamTurnsOf returns the turns running in chat (any session, any engine).
func teamTurnsOf(chat string) []teamTurnFact {
	chat = teamChatKey(chat)
	teamTurns.mu.Lock()
	defer teamTurns.mu.Unlock()
	out := make([]teamTurnFact, 0, len(teamTurns.by[chat]))
	for _, f := range teamTurns.by[chat] {
		out = append(out, f)
	}
	return out
}

// teamTurnRunning: a turn is running in chat.
func teamTurnRunning(chat string) bool { return len(teamTurnsOf(chat)) > 0 }

// teamTurnEventSince: a turn running in chat received an agent event (or started) at or after since.
func teamTurnEventSince(chat string, since time.Time) bool {
	for _, f := range teamTurnsOf(chat) {
		if !f.LastEvent().Before(since) {
			return true
		}
	}
	return false
}

// teamTaskTurnStarted returns the board id of the task dispatched/working in workspace chat (0:
// none, or the state is unreadable) and moves a dispatched one to working: its first turn started
// (design §3.2, the engine's turn start is the event). The turn fact takes its task from here —
// the state record, not a title or the message text, says which task holds the workspace.
func (e *Engine) teamTaskTurnStarted(chat string) int {
	if e == nil || e.dataDir == "" {
		return 0
	}
	key := teamChatKey(chat)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		return 0
	}
	best := 0
	var bestAt time.Time
	for id, t := range st.Tasks {
		if teamTaskInWork(t.State) && t.WS == key && (best == 0 || t.Since.After(bestAt)) {
			best, bestAt = id, t.Since
		}
	}
	if best > 0 && st.Tasks[best].State == TeamTaskDispatched {
		if _, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: best, To: TeamTaskWorking, By: "turn start"}, time.Now()); err != nil {
			slog.Warn("team task: not moved to working at its turn start", "board", best, "error", err)
		}
	}
	return best
}

// teamTurnOfOtherTask: a turn running in chat belongs to a task other than id (a turn of no task
// does not count).
func teamTurnOfOtherTask(chat string, id int) bool {
	for _, f := range teamTurnsOf(chat) {
		if f.TaskID > 0 && f.TaskID != id {
			return true
		}
	}
	return false
}
