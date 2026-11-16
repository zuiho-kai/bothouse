package core

import (
	"fmt"
	"log/slog"
	"os"
	"sync/atomic"
	"time"
)

// Per-turn spend cap (#1701). A cron turn, a timer turn and any turn in a workspace channel
// may cost at most a fixed amount; a turn that goes over is stopped mid-way, the way /stop
// stops it, and its chat is told which task, how much it spent and what the cap is.
//
// The spend of a running turn is read from the CLI's own session log (UsageLogSource, the
// logs the usage page imports): the lines written since the turn started, priced with the
// usage price table. A backend without such a log cannot be measured mid-turn and keeps
// only its time limit.

// TurnSpendCaps is the most one turn may cost, in USD, by kind of turn. Zero means the
// built-in value.
type TurnSpendCaps struct {
	Cron      float64 `toml:"cron"`
	Timer     float64 `toml:"timer"`
	Workspace float64 `toml:"workspace"` // any turn in a workspace channel, whoever started it
}

// defaultTurnSpendCaps is 5x what a normal (p75) turn of each kind costs, rounded. At these
// values about 1% of cron turns, 4% of timer turns and 2-3% of workspace turns are stopped.
// 数据：11-16 线上日志统计，一轮花费 p75 为 cron 0.23、timer 1.04、工作区 4.16 美元，取 5 倍取整。
var defaultTurnSpendCaps = TurnSpendCaps{Cron: 1, Timer: 5, Workspace: 20} // 数据：同上一行，5 倍 p75 取整

// turnSpendCheckEvery is how often a capped turn's spend is read from the logs.
// 沿用已有配置：和 boardAutostartEvery 一样的 15 秒轮询。
const turnSpendCheckEvery = boardAutostartEvery

const (
	turnSpendCron      = "cron"
	turnSpendTimer     = "timer"
	turnSpendWorkspace = "workspace"
)

type turnSpendSetup struct {
	sources []UsageLogSource
	prices  map[string]TokenPrice
	caps    TurnSpendCaps
}

var turnSpendCfg atomic.Pointer[turnSpendSetup]

// SetTurnSpendCap turns the per-turn spend cap on: sources are the CLI logs spend is read
// from, prices the usage price table (UsagePricesWithDefaults), caps the configured limits.
func SetTurnSpendCap(sources []UsageLogSource, prices map[string]TokenPrice, caps TurnSpendCaps) {
	if caps.Cron <= 0 {
		caps.Cron = defaultTurnSpendCaps.Cron
	}
	if caps.Timer <= 0 {
		caps.Timer = defaultTurnSpendCaps.Timer
	}
	if caps.Workspace <= 0 {
		caps.Workspace = defaultTurnSpendCaps.Workspace
	}
	turnSpendCfg.Store(&turnSpendSetup{sources: sources, prices: prices, caps: caps})
}

// turnSpendMeter adds up what one turn has cost so far.
type turnSpendMeter struct {
	sources []UsageLogSource
	prices  map[string]TokenPrice
	since   time.Time                  // the turn's start: older log lines belong to earlier turns
	files   map[string]*UsageFileState // log file -> how far it was read
	costs   map[string]float64         // record key -> USD; one response is logged on several lines
	total   float64
	warned  map[string]bool // models without a price, logged once
}

func newTurnSpendMeter(cfg *turnSpendSetup, since time.Time) *turnSpendMeter {
	return &turnSpendMeter{sources: cfg.sources, prices: cfg.prices, since: since,
		files: map[string]*UsageFileState{}, costs: map[string]float64{}, warned: map[string]bool{}}
}

// read adds the usage logged since the last call by the agent sessions ids and returns the
// turn's total. skipExisting (the call at turn start) only notes how long each log already
// is, so a long session's history is not parsed again every turn; a log first seen later
// (a subagent, a new session) is read from its start, and since drops its older lines.
func (m *turnSpendMeter) read(ids map[string]bool, skipExisting bool) float64 {
	for _, src := range m.sources {
		files, err := src.Files()
		if err != nil {
			continue
		}
		for _, f := range files {
			st := m.files[f]
			if st == nil {
				if sid := src.SessionID(f); sid == "" || !ids[sid] {
					continue
				}
				st = &UsageFileState{}
				m.files[f] = st
				if skipExisting {
					if fi, err := os.Stat(f); err == nil {
						st.Offset = fi.Size()
					}
					continue
				}
			}
			sid := src.SessionID(f)
			var recs []UsageRecord
			if r, ok := src.(UsageFileReader); ok {
				recs, _ = r.ReadUsage(f, sid, st)
			} else {
				recs, _ = readUsageLines(f, src, sid, st)
			}
			for _, r := range recs {
				m.add(r)
			}
		}
	}
	return m.total
}

func (m *turnSpendMeter) add(r UsageRecord) {
	if r.Time.Before(m.since) || r.Model == syntheticModel {
		return
	}
	price, ok := lookupPrice(m.prices, r.Model)
	if !ok {
		if !m.warned[r.Model] {
			m.warned[r.Model] = true
			slog.Warn("turn spend cap: model has no price, its usage is not counted", "model", r.Model)
		}
		return
	}
	cost := (float64(r.Input)*price.Input + float64(r.Output)*price.Output + float64(r.CacheRead)*price.CacheRead + float64(r.CacheWrite)*price.CacheWrite) / 1e6 // SPEC: TokenPrice is per million tokens
	if r.Key == "" {
		m.total += cost
		return
	}
	m.total += cost - m.costs[r.Key]
	m.costs[r.Key] = cost
}

// turnSpendWatch is the cap armed for one turn.
type turnSpendWatch struct {
	state   *interactiveState
	session *Session
	iKey    string
	tok     uint64
	kind    string
	limit   float64
	name    string // the job's description, or the workspace turn's task line
	id      string // the job id, or the workspace channel
	meter   *turnSpendMeter
}

// turnSpendKind is the cap a turn runs under: the workspace one for any turn in a workspace
// channel and for a workspace wake-up, else its cron or timer one; "" for every other turn.
func (e *Engine) turnSpendKind(trigger, chatKey string) string {
	switch {
	case trigger == TurnTriggerWorkspace || e.isTeamWorkspaceChat(chatKey):
		return turnSpendWorkspace
	case trigger == TurnTriggerCron:
		return turnSpendCron
	case trigger == TurnTriggerTimer:
		return turnSpendTimer
	}
	return ""
}

// armTurnSpendCap runs as every turn starts, next to armScheduledTurnTimeout, and watches a
// capped turn's spend until the turn ends (disarmTurnSpendCap) or goes over.
func (e *Engine) armTurnSpendCap(state *interactiveState, session *Session, iKey, trigger, timerJobID, cronJobID, chatKey string) {
	if w := e.newTurnSpendWatch(state, session, iKey, trigger, timerJobID, cronJobID, chatKey); w != nil {
		go e.watchTurnSpend(w, turnSpendCheckEvery)
	}
}

// newTurnSpendWatch arms the cap of the turn starting on state; nil for a turn without one.
func (e *Engine) newTurnSpendWatch(state *interactiveState, session *Session, iKey, trigger, timerJobID, cronJobID, chatKey string) *turnSpendWatch {
	cfg := turnSpendCfg.Load()
	if cfg == nil || state == nil {
		return nil
	}
	w := &turnSpendWatch{state: state, session: session, iKey: iKey, kind: e.turnSpendKind(trigger, chatKey)}
	switch w.kind {
	case turnSpendCron:
		w.limit, w.id = cfg.caps.Cron, cronJobID
		if e.cronScheduler != nil && e.cronScheduler.store != nil {
			if job := e.cronScheduler.store.Get(cronJobID); job != nil {
				w.name = turnSpendJobName(job.Description, job.Prompt)
			}
		}
	case turnSpendTimer:
		w.limit, w.id = cfg.caps.Timer, timerJobID
		if e.timerScheduler != nil && e.timerScheduler.store != nil {
			if job := e.timerScheduler.store.Get(timerJobID); job != nil {
				w.name = turnSpendJobName(job.Description, job.Prompt)
			}
		}
	case turnSpendWorkspace:
		w.limit, w.id = cfg.caps.Workspace, chatKey
	default:
		return nil
	}
	w.tok = scheduledWatchSeq.Add(1)
	w.meter = newTurnSpendMeter(cfg, time.Now())
	state.mu.Lock()
	state.spendWatch = w.tok
	if w.kind == turnSpendWorkspace {
		w.name = state.turnDesc
	}
	state.mu.Unlock()
	return w
}

// turnSpendJobName names a job the way noticeMissed does: its description, else the start
// of its prompt.
func turnSpendJobName(desc, prompt string) string {
	if desc == "" {
		desc = truncateStr(prompt, 40) // 沿用已有配置：noticeMissed 的 40 字
	}
	return desc
}

// disarmTurnSpendCap ends the watch of the turn that just finished on state.
func (e *Engine) disarmTurnSpendCap(state *interactiveState) {
	state.mu.Lock()
	state.spendWatch = 0
	state.mu.Unlock()
}

// sessionIDs lists the agent session ids the turn runs under right now (a new session gets
// its id after the first event; a fork changes it).
func (w *turnSpendWatch) sessionIDs() map[string]bool {
	ids := map[string]bool{}
	if w.session != nil {
		ids[w.session.GetAgentSessionID()] = true
	}
	w.state.mu.Lock()
	as := w.state.agentSession
	w.state.mu.Unlock()
	if as != nil {
		ids[as.CurrentSessionID()] = true
	}
	delete(ids, "")
	return ids
}

func (e *Engine) watchTurnSpend(w *turnSpendWatch, every time.Duration) {
	w.meter.read(w.sessionIDs(), true)
	t := time.NewTicker(every)
	defer t.Stop()
	for range t.C {
		if !e.checkTurnSpend(w) {
			return
		}
	}
}

// checkTurnSpend reads the turn's spend once and stops the turn when it is over the cap.
// It returns false when the watch is over (the turn ended, or was stopped here).
func (e *Engine) checkTurnSpend(w *turnSpendWatch) bool {
	w.state.mu.Lock()
	live := w.state.spendWatch == w.tok
	w.state.mu.Unlock()
	if !live || (e.ctx != nil && e.ctx.Err() != nil) {
		return false
	}
	spent := w.meter.read(w.sessionIDs(), false)
	if spent <= w.limit {
		return true
	}
	e.fireTurnSpendCap(w, spent)
	return false
}

// fireTurnSpendCap stops the turn the cap was armed for, and only that turn, then tells its
// chat. The claim follows fireScheduledTurnTimeout: token check and claim are one step under
// state.mu, and the next turn on this state waits at its start until the stop is done.
func (e *Engine) fireTurnSpendCap(w *turnSpendWatch, spent float64) bool {
	state := w.state
	state.mu.Lock()
	if state.spendWatch != w.tok || state.scheduledCancel != nil {
		state.mu.Unlock()
		return false
	}
	done := make(chan struct{})
	state.scheduledCancel = done
	state.spendWatch = 0 // claimed: the cap fires once
	p, replyCtx := state.platform, state.replyCtx
	state.mu.Unlock()
	stopped := e.stopInteractiveStateWithQueue(w.iKey, state, true, false)
	state.mu.Lock()
	state.scheduledCancel = nil
	state.mu.Unlock()
	close(done)
	slog.Warn("turn over its spend cap; stopping it", "project", e.name, "session", w.iKey, "kind", w.kind,
		"id", w.id, "spent_usd", spent, "cap_usd", w.limit, "stopped", stopped)
	if !stopped {
		return false
	}
	e.sendTurnSpendNotice(p, replyCtx, w, spent)
	return true
}

// sendTurnSpendNotice posts the notice to the turn's chat. A chat that keeps bridge notices
// out gets nothing; the owner's private chat gets it instead (as sendCronFailureNotice).
func (e *Engine) sendTurnSpendNotice(p Platform, replyCtx any, w *turnSpendWatch, spent float64) {
	key := map[string]MsgKey{turnSpendCron: MsgTurnSpendCapCron, turnSpendTimer: MsgTurnSpendCapTimer,
		turnSpendWorkspace: MsgTurnSpendCapWorkspace}[w.kind]
	text := e.i18n.Tf(key, w.name, w.id, fmt.Sprintf("%.2f", spent), fmt.Sprintf("%.2f", w.limit))
	if p == nil {
		slog.Error("turn spend cap: no chat to notify", "project", e.name, "session", w.iKey, "notice", text)
		return
	}
	if q, ok := p.(SystemNoticeQuieter); ok && q.QuietSystemNotices(replyCtx) {
		dmKey, err := e.OpenDMSession()
		if err == nil {
			err = e.SendToSession(dmKey, text)
		}
		if err != nil {
			slog.Error("turn spend cap: notice kept out of quiet chat and owner DM failed", "project", e.name, "session", w.iKey, "notice", text, "error", err)
		}
		return
	}
	e.send(p, replyCtx, text)
}
