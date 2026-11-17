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

// turnWarnAt is the share of a turn's spend cap, and of a scheduled turn's time limit, at which
// the turn is told to hand in what it has (#1744). Before, a turn over its limit was only
// stopped: 11-16 23:02 a cron turn at 1.016 USD of 1 was cut and left nothing.
// 数据：上限是一轮正常花费（p75）的 5 倍（见 defaultTurnSpendCaps），八成处提醒，留下的两成正好是一轮正常花费，够写完答复。
const turnWarnAt = 0.8

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
	warned  map[string]bool // models without a price; each is warned about once

	// fallback is what a model without a price is charged (#1754): the highest rate in the
	// table. Such a model used to count as zero, so its turns never reached the cap or the
	// hand-in reminder. hasFallback is false only when the price table is empty.
	fallback    TokenPrice
	hasFallback bool
}

func newTurnSpendMeter(cfg *turnSpendSetup, since time.Time) *turnSpendMeter {
	m := &turnSpendMeter{sources: cfg.sources, prices: cfg.prices, since: since,
		files: map[string]*UsageFileState{}, costs: map[string]float64{}, warned: map[string]bool{}}
	m.fallback, m.hasFallback = highestTokenPrice(cfg.prices)
	return m
}

// highestTokenPrice returns the most expensive rate in the price table, column by column:
// the highest input, output, cache read and cache write rate, each taken over the whole
// table. ok is false when the table is empty.
//
// It is not the single most expensive row. Cache reads and writes are often most of a turn's
// tokens, and many rows price them at zero; a fallback row with a zero cache rate would still
// count a cache-heavy turn as almost free. The column-wise maximum is never below any row of
// the table, so a model without a price is stopped early rather than never.
func highestTokenPrice(prices map[string]TokenPrice) (TokenPrice, bool) {
	var top TokenPrice
	for _, p := range prices {
		top.Input = max(top.Input, p.Input)
		top.Output = max(top.Output, p.Output)
		top.CacheRead = max(top.CacheRead, p.CacheRead)
		top.CacheWrite = max(top.CacheWrite, p.CacheWrite)
	}
	return top, len(prices) > 0
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
		first := !m.warned[r.Model]
		m.warned[r.Model] = true
		if !m.hasFallback { // an empty price table: nothing to charge at
			if first {
				slog.Warn("turn spend cap: model has no price, its usage is not counted", "model", r.Model)
			}
			return
		}
		price = m.fallback
		if first {
			slog.Warn("turn spend cap: model has no price, charging it at the highest rate in the table", "model", r.Model,
				"input_usd_per_mtok", m.fallback.Input, "output_usd_per_mtok", m.fallback.Output,
				"cache_read_usd_per_mtok", m.fallback.CacheRead, "cache_write_usd_per_mtok", m.fallback.CacheWrite)
		}
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
	warned  bool    // the hand-in reminder went out, or could not be delivered; it is tried once
	stopAt  float64 // the spend the turn is stopped over: limit, or more for a late reminder
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
	w.stopAt = w.limit
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

// checkTurnSpend reads the turn's spend once. At turnWarnAt of the cap the turn is told, once,
// to hand in what it has; over the cap it is stopped. Spend is read every turnSpendCheckEvery,
// so one reading can jump from under turnWarnAt to over the cap: that turn is told then, and
// stopped only after the room an on-time reminder leaves (the cap's last 1-turnWarnAt). A turn
// that cannot be told (the agent takes no mid-turn input) is stopped at the cap as before.
// It returns false when the watch is over (the turn ended, or was stopped here).
func (e *Engine) checkTurnSpend(w *turnSpendWatch) bool {
	w.state.mu.Lock()
	live := w.state.spendWatch == w.tok
	w.state.mu.Unlock()
	if !live || (e.ctx != nil && e.ctx.Err() != nil) {
		return false
	}
	spent := w.meter.read(w.sessionIDs(), false)
	if !w.warned && spent >= w.limit*turnWarnAt {
		w.warned = true
		told := e.tellTurnToHandIn(w.state, w.iKey, e.i18n.Tf(MsgTurnSpendWarn, spendUSD(spent), spendUSD(w.limit)))
		if told && spent > w.limit {
			w.stopAt = w.limit * (2 - turnWarnAt)
		}
		slog.Info("turn near its spend cap; told it to hand in", "project", e.name, "session", w.iKey, "kind", w.kind,
			"id", w.id, "spent_usd", spent, "cap_usd", w.limit, "told", told)
	}
	if spent <= w.stopAt {
		return true
	}
	e.fireTurnSpendCap(w, spent)
	return false
}

// tellTurnToHandIn puts note into the turn running under iKey, the way a message sent during a
// turn joins it (injectIntoRunningTurn). state, when given, must still be the one under iKey:
// a reminder armed for a turn never reaches a later turn's agent. It returns false when the
// agent takes no mid-turn input or the turn is gone; the caller then keeps its hard stop only.
func (e *Engine) tellTurnToHandIn(state *interactiveState, iKey, note string) bool {
	if state != nil {
		e.interactiveMu.Lock()
		cur := e.interactiveStates[iKey]
		e.interactiveMu.Unlock()
		if cur != state {
			return false
		}
	}
	return e.canInjectInto(e.agent, iKey) && e.injectIntoRunningTurn(iKey, note, nil, nil, nil)
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
	text := e.i18n.Tf(key, w.name, w.id, spendUSD(spent), spendUSD(w.limit))
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

// spendUSD prints dollars with two decimals, or more when the amount is under a cent.
func spendUSD(v float64) string {
	if v < 0.01 {
		return fmt.Sprintf("%.4f", v)
	}
	return fmt.Sprintf("%.2f", v)
}
