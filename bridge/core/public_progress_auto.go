package core

import (
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"
)

// Automatic task cards: a turn that does real work gets a card even when the
// agent never calls the progress command, so an installation with no prompt
// tuning still shows progress. "Real work" follows the team board (team.go):
// several tool calls, or a turn still running after teamBoardWorkAfter.
//
// The automatic card never takes the agent's report sequence: it only appends
// card events, so the agent's own --seq 1 --kind start lands on the same card
// (renamed, edited in place) instead of opening a second one.

// autoProgressTools is how many non-progress tool calls make a turn "multi-step".
// The agent's own progress start is itself one shell call, so 1 would race it.
const autoProgressTools = 2 // source: approved design (multi-step = 2 tool calls)

// autoProgressAfter is the elapsed-time trigger; a var only so tests can shorten it.
var autoProgressAfter = teamBoardWorkAfter // source: reuses the team board threshold

type autoProgressReason int

const (
	autoProgressByTools autoProgressReason = iota
	autoProgressByTime
)

// autoProgressTitle cuts the turn's board text to the card title limit
// (PublicProgressRequest.Validate allows 60 runes).
func autoProgressTitle(desc string, lang Language) string {
	desc = strings.Join(strings.Fields(desc), " ")
	if desc == "" {
		return NewI18n(lang).T(MsgPublicAutoTitle)
	}
	if utf8.RuneCountInString(desc) > 60 { // source: Validate's title limit
		desc = string([]rune(desc)[:59]) + "…"
	}
	return desc
}

// scheduledTurnUser marks routine turns (cron, timers, heartbeat). They run
// tools every time and are not work a human handed over, so they get no
// automatic card; the agent may still open one itself.
func scheduledTurnUser(userID string) bool {
	switch userID {
	case "cron", "timer", "heartbeat":
		return true
	}
	return false
}

// armAuto prepares the automatic card for a freshly issued run. scheduled runs
// never open one automatically.
func (p *PublicProgress) armAuto(token, desc string, scheduled bool) {
	p.mu.Lock()
	r := p.runs[token]
	p.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if scheduled {
		r.autoOff = true
		return
	}
	r.autoTitle = autoProgressTitle(desc, r.record.Lang)
	r.autoTimer = time.AfterFunc(autoProgressAfter, func() { p.autoStart(token, autoProgressByTime) })
}

// noteTool counts one tool call of the run. A call that carries the run token is
// the agent managing its own card (progress, task assign, relay send): it is not
// counted, and from then on this turn never opens a card automatically, even if
// that command failed.
func (p *PublicProgress) noteTool(token, input string) {
	p.mu.Lock()
	r := p.runs[token]
	p.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.autoOff {
		r.mu.Unlock()
		return
	}
	if strings.Contains(input, token) {
		r.autoOff = true
		r.mu.Unlock()
		return
	}
	r.autoTools++
	n := r.autoTools
	r.mu.Unlock()
	if n >= autoProgressTools {
		p.autoStart(token, autoProgressByTools)
	}
}

// autoStart opens the automatic card unless the agent already has one this turn:
// its own start, a continued earlier card, or a delegation batch.
func (p *PublicProgress) autoStart(token string, reason autoProgressReason) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.runs[token]
	delegated := len(p.delegations[token]) > 0
	p.mu.Unlock()
	if r == nil || delegated {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.autoOff || r.record.Task.Seq != 0 || r.record.Closed || r.record.Accepted || (r.stopped != nil && r.stopped()) {
		return
	}
	r.autoOff = true // at most one automatic card per run
	if r.autoTimer != nil {
		r.autoTimer.Stop()
	}
	i := NewI18n(r.record.Lang)
	summary := i.T(MsgPublicAutoStartedTools)
	if reason == autoProgressByTime {
		summary = i.T(MsgPublicAutoStartedTime)
	}
	old := r.record
	old.Task = r.record.Task.Clone()
	t := r.record.Task
	title := r.autoTitle
	if title == "" {
		title = i.T(MsgPublicAutoTitle)
	}
	t.Title = title
	t.Agent = p.project
	t.CreatedAt = time.Now().UTC()
	t.State = TaskStateInProgress
	r.record.Auto = true
	// LastSeq and Reports stay untouched: the agent's numbering still starts at 1.
	p.appendEvent(r, TaskEventCreated, summary, true)
	if err := p.save(r); err != nil {
		slog.Warn("public progress: automatic card not saved", "error", err)
		r.record = old
		return
	}
	p.mu.Lock()
	// Never registered in p.open: a later turn must not be told to continue a
	// card titled with the owner's raw words. It is still listed and acceptable.
	p.records[t.ID] = r
	p.pending[t.ID] = r
	p.indexRun(r)
	p.mu.Unlock()
}

// autoUntouched reports an automatic card the agent has not reported on yet.
// Caller holds r.mu.
func (r *publicRun) autoUntouched() bool {
	return r.record.Auto && r.record.LastSeq == 0
}

// mergeAuto closes an untouched automatic card because the agent put this
// turn's work on another card. Caller holds transitionMu and auto.mu.
func (p *PublicProgress) mergeAuto(auto *publicRun, intoTitle string) {
	if !auto.autoUntouched() || IsTerminalState(auto.record.Task.State) {
		return
	}
	t := auto.record.Task
	auto.record.Closed = true
	t.State = TaskStateCancelled
	p.appendEvent(auto, TaskEventBlocked, NewI18n(auto.record.Lang).Tf(MsgPublicAutoMerged, intoTitle), true)
	if err := p.save(auto); err != nil {
		slog.Error("public progress: merged automatic card not saved", "error", err)
	}
	p.mu.Lock()
	p.pending[t.ID] = auto
	p.indexRun(auto)
	p.mu.Unlock()
}

// notePublicProgressTool feeds one tool call of the running turn to the
// automatic card trigger.
func (e *Engine) notePublicProgressTool(state *interactiveState, input string) {
	if e.publicProgress == nil {
		return
	}
	state.mu.Lock()
	token := state.publicProgressRun
	state.mu.Unlock()
	if token != "" {
		e.publicProgress.noteTool(token, input)
	}
}
