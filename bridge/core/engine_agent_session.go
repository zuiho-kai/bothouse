package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

func (e *Engine) cancelAgentSessionIdleClose(state *interactiveState) {
	if state == nil {
		return
	}
	state.mu.Lock()
	cancel := state.agentSessionIdleCancel
	state.agentSessionIdleCancel = nil
	state.agentSessionIdleToken = 0
	state.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Reports whether a close was scheduled, not whether the process has exited.
func (e *Engine) scheduleAgentSessionIdleClose(sessionKey string, state *interactiveState) bool {
	if state == nil {
		return false
	}
	// A resumable process belongs to its turn; retain the saved conversation ID.
	// Agents that cannot resume retain their configured idle timeout.
	state.mu.Lock()
	resumable := agentSessionResumable(state.agent, state.agentSession)
	state.mu.Unlock()
	timeout := time.Duration(e.agentSessionIdleTimeoutNanos.Load())
	if !resumable && timeout <= 0 {
		return false
	}

	e.cancelAgentSessionIdleClose(state)
	token := e.agentSessionIdleSeq.Add(1)
	state.mu.Lock()
	if state.stopped || state.processClaimed ||
		state.agentSession == nil ||
		!state.agentSession.Alive() ||
		(!resumable && state.eventsNeedResync) ||
		state.pending != nil ||
		len(state.pendingMessages) > 0 {
		state.mu.Unlock()
		return false
	}
	if resumable {
		// Same token protocol as the idle timer: a turn starting before the close runs
		// clears the token (cancelAgentSessionIdleClose) and the close is skipped.
		state.agentSessionIdleToken = token
		state.mu.Unlock()
		go e.cleanupInteractiveStateForIdleToken(sessionKey, state, token, 0)
		return true
	}
	ctx, cancel := context.WithCancel(e.ctx)
	e.armAgentSessionIdleTimerLocked(sessionKey, state, ctx, cancel, token, timeout, timeout)
	state.mu.Unlock()
	return true
}

// CloseIdleTeamWorkspaceAgents asks the same turn-lifetime policy to release idle
// teammate processes after a workspace is returned. It preserves conversation IDs
// and returns the number scheduled; actual shutdown is logged by the shared closer.
func (e *Engine) CloseIdleTeamWorkspaceAgents(key string) int {
	if e == nil || e.sessions == nil {
		return 0
	}
	free, err := e.teamWorkspaceFree(key)
	if err != nil {
		slog.Error("team workspace: state unreadable; idle agents not released", "workspace", key, "error", err)
		return 0
	}
	if !free {
		return 0
	}
	n := 0
	for _, k := range e.sessions.UserKeys() {
		if chatOf(k) != key {
			continue
		}
		if s := e.sessions.GetOrCreateActive(k); s != nil && s.Busy() {
			continue
		}
		iKey := e.interactiveKeyForSessionKey(k)
		e.interactiveMu.Lock()
		state := e.interactiveStates[iKey]
		e.interactiveMu.Unlock()
		if e.scheduleAgentSessionIdleClose(iKey, state) {
			n++
		}
	}
	return n
}

// agentSessionResumable reports whether closing as now loses nothing: the agent can
// resume an exact saved conversation without falling back to a new one
// (StrictResumeAgent), this session has an ID to resume, and, for agents whose resume
// support is only known from the running process (ACP advertises it in initialize),
// the process said it can.
func agentSessionResumable(agent Agent, as AgentSession) bool {
	if agent == nil || as == nil || as.CurrentSessionID() == "" {
		return false
	}
	if strict, ok := agent.(StrictResumeAgent); !ok || !strict.SupportsStrictResume() {
		return false
	}
	if r, ok := as.(ResumableSession); ok {
		return r.CanResume()
	}
	return true
}

// cleanupSideRunState ends a one-off scheduled run (cron/timer new_per_run) after its
// turn. When the agent still runs background work, the turn-end idle close has already
// kept the process until that work reports back; closing it here would kill the work
// and the turn that reads its result, and that turn closes the process when it ends.
// maomao fork, 2026-11-19 #1780: the 11-18 premarket cron put its data script in the
// background and ended its first turn; this cleanup stopped the process (SIGTERM after
// 2m) while the woken turn was still writing the judgment, so none was written.
func (e *Engine) cleanupSideRunState(iKey string) {
	e.interactiveMu.Lock()
	keep := false
	state := e.interactiveStates[iKey]
	if state != nil {
		state.mu.Lock()
		keep = state.agentSession != nil && state.agentSession.Alive() && agentHasBackgroundWork(state.agentSession)
		state.mu.Unlock()
	}
	e.interactiveMu.Unlock()
	if keep {
		slog.Info("scheduled run: agent still runs background work, process kept until it reports back", "session_key", iKey)
		e.journalBackgroundKeep(iKey, state)
		return
	}
	e.cleanupInteractiveState(iKey)
}

// journalBackgroundKeep writes the restart record for a process kept for background
// work (#1894): a restart stops that process, and the record makes the next start
// wake the session to pick the work up instead of losing it silently.
func (e *Engine) journalBackgroundKeep(iKey string, state *interactiveState) {
	j := e.turnJournalStore()
	if j == nil || state == nil {
		return
	}
	state.mu.Lock()
	as := state.agentSession
	state.mu.Unlock()
	ok, err := j.KeepBackground(iKey, describeBackgroundWork(as), time.Now())
	if err != nil {
		slog.Warn("turn journal: background keep failed", "key", iKey, "error", err)
	} else if !ok {
		slog.Warn("turn journal: background keep has no turn to copy the chat from", "key", iKey)
	}
}

// describeBackgroundWork names the work still running in as, for the wake-up text.
func describeBackgroundWork(as AgentSession) string {
	var parts []string
	if r, ok := as.(SubTaskReporter); ok {
		_, tasks, _ := r.SubTasks()
		for _, t := range tasks {
			if !t.Live() {
				continue
			}
			d := turnResumeOneLine(t.Description, 80)
			if t.Name != "" {
				d = t.Name + "：" + d
			}
			parts = append(parts, "子 agent「"+d+"」")
		}
	}
	if r, ok := as.(BackgroundTaskReporter); ok {
		if running, _ := r.BackgroundTasks(); running > 0 {
			parts = append(parts, fmt.Sprintf("%d 个后台命令", running))
		}
	}
	if len(parts) == 0 {
		return "后台活"
	}
	return strings.Join(parts, "、")
}

// agentHasBackgroundWork reports whether the agent process still runs work of its own
// after its turn ended: background tasks or live sub-agents. Closing it would kill them
// and lose their completion turn.
func agentHasBackgroundWork(as AgentSession) bool {
	if r, ok := as.(BackgroundTaskReporter); ok {
		if running, _ := r.BackgroundTasks(); running > 0 {
			return true
		}
	}
	if r, ok := as.(SubTaskReporter); ok {
		_, tasks, _ := r.SubTasks()
		for _, task := range tasks {
			if task.Live() {
				return true
			}
		}
	}
	return false
}

// armAgentSessionIdleTimerLocked stores cancel/token on state and starts the
// timer goroutine. Caller holds state.mu.
func (e *Engine) armAgentSessionIdleTimerLocked(sessionKey string, state *interactiveState, ctx context.Context, cancel context.CancelFunc, token uint64, wait, timeout time.Duration) {
	state.agentSessionIdleCancel = cancel
	state.agentSessionIdleToken = token

	go func() {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		e.cleanupInteractiveStateForIdleToken(sessionKey, state, token, timeout)
	}()
}

// agentSessionIdleDeferral reports how much longer the idle close must wait
// because of background tasks inside the agent process (maomao fork): a full
// timeout while any is running (re-checked then), or the rest of the timeout
// counted from when the last one ended. 0 means close now.
func agentSessionIdleDeferral(agentSession AgentSession, timeout time.Duration) (time.Duration, int) {
	r, ok := agentSession.(BackgroundTaskReporter)
	if !ok {
		return 0, 0
	}
	running, lastEndedAt := r.BackgroundTasks()
	if running > 0 {
		return timeout, running
	}
	if !lastEndedAt.IsZero() {
		if left := timeout - time.Since(lastEndedAt); left > 0 {
			return left, 0
		}
	}
	return 0, 0
}

// timeout 0 closes now (the turn ended; see scheduleAgentSessionIdleClose) unless the
// agent still runs background work: its completion turn ends here again and closes then.
func (e *Engine) cleanupInteractiveStateForIdleToken(sessionKey string, expected *interactiveState, token uint64, timeout time.Duration) {
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[sessionKey]
	if !ok || state == nil || state != expected {
		e.interactiveMu.Unlock()
		return
	}

	var agentSession AgentSession
	state.mu.Lock()
	if state.agentSessionIdleToken != token ||
		state.processClaimed ||
		state.agentSession == nil ||
		!state.agentSession.Alive() ||
		state.stopped ||
		(timeout > 0 && state.eventsNeedResync) ||
		state.pending != nil ||
		len(state.pendingMessages) > 0 {
		state.mu.Unlock()
		e.interactiveMu.Unlock()
		return
	}
	if timeout <= 0 {
		if agentHasBackgroundWork(state.agentSession) {
			state.mu.Unlock()
			e.interactiveMu.Unlock()
			slog.Info("turn ended: agent still runs background work, process kept until it reports back", "session_key", sessionKey)
			e.journalBackgroundKeep(sessionKey, state)
			return
		}
	} else if wait, running := agentSessionIdleDeferral(state.agentSession, timeout); wait > 0 {
		// maomao fork: closing now would kill a background task and lose its
		// completion notification. Re-arm under the same lock so a turn that
		// starts afterwards cancels the new timer like any other.
		oldCancel := state.agentSessionIdleCancel
		ctx, cancel := context.WithCancel(e.ctx)
		e.armAgentSessionIdleTimerLocked(sessionKey, state, ctx, cancel, e.agentSessionIdleSeq.Add(1), wait, timeout)
		state.mu.Unlock()
		e.interactiveMu.Unlock()
		if oldCancel != nil {
			oldCancel()
		}
		slog.Info("agent session idle timeout: deferred for background tasks",
			"session_key", sessionKey, "running", running, "wait", wait)
		return
	}
	agentSession = state.agentSession
	closed := make(chan struct{})
	state.agentCloseDone = closed
	state.agentSession = nil
	idleCancel := state.agentSessionIdleCancel
	state.agentSessionIdleCancel = nil
	state.agentSessionIdleToken = 0
	state.mu.Unlock()
	e.interactiveMu.Unlock()
	if idleCancel != nil {
		idleCancel()
	}

	if timeout <= 0 {
		slog.Info("turn ended: closing agent process; its saved session ID stays for resume",
			"session_key", sessionKey, "agent_session", agentSession.CurrentSessionID())
	} else {
		slog.Info("agent session idle timeout: closing live agent session",
			"session_key", sessionKey, "timeout", timeout)
	}
	e.stopUnsolicitedReader(state)
	state.markStopped()

	state.mu.Lock()
	pending := state.pending
	state.pending = nil
	state.mu.Unlock()
	if pending != nil {
		pending.resolve()
	}
	// This is a process close, not a conversation reset. A message queued during
	// close must be adopted by the replacement state, not reported as dropped.
	e.closeAgentSessionAndSignal(sessionKey, agentSession, closed)
	<-closed

	e.interactiveMu.Lock()
	if currentState, currentOk := e.interactiveStates[sessionKey]; currentOk && currentState == expected {
		state.mu.Lock()
		if len(state.pendingMessages) == 0 {
			delete(e.interactiveStates, sessionKey)
		}
		state.mu.Unlock()
	}
	e.interactiveMu.Unlock()
}

func (e *Engine) closeAgentSessionWithTimeout(sessionKey string, agentSession AgentSession) {
	e.closeAgentSessionAndSignal(sessionKey, agentSession, nil)
}

// closed is owned by this call and signals actual Close completion, even when
// the cleanup budget expires first. A replacement must not resume earlier.
func (e *Engine) closeAgentSessionAndSignal(sessionKey string, agentSession AgentSession, closed chan struct{}) {
	if agentSession == nil {
		if closed != nil {
			close(closed)
		}
		return
	}
	e.closeAgentSessionBy(sessionKey, agentSession, closed, agentSession.Close)
}

// closeAgentSessionBy is closeAgentSessionAndSignal with the close call given:
// Close, or CloseForRestart of an AgentSessionRestartCloser.
func (e *Engine) closeAgentSessionBy(sessionKey string, agentSession AgentSession, closed chan struct{}, closeFn func() error) {
	// #1894: the process closes while the bridge runs, so the restart record of its
	// background work is no longer needed. While stopping it stays: the next start
	// wakes the session.
	if j := e.turnJournalStore(); j != nil && !e.isStoppingForJournal() {
		if err := j.BackgroundDone(sessionKey); err != nil {
			slog.Warn("turn journal: background done failed", "key", sessionKey, "error", err)
		}
	}
	// Allow enough time for the agent's own graceful shutdown sequence:
	// stdin close → Stop hooks (claude-mem summary etc.) → SIGTERM → SIGKILL.
	// Claude Code's Stop hooks can take up to 120s (claude-mem uses a
	// sonnet summarizer). The 130s budget covers the default 120s graceful
	// phase + 5s SIGTERM + 5s buffer. The wait ends early if the process
	// exits sooner — this is the ceiling, not the typical duration.
	const closeTimeout = 130 * time.Second

	slog.Debug("cleanupInteractiveState: closing agent session", "session", sessionKey)
	closeStart := time.Now()
	agentID := agentSession.CurrentSessionID()
	// maomao fork: tell hooks once the process is gone (sub bots export + ingest their wiki here, like 橘's
	// SessionEnd hook; user 2026-10-20 「让他们和你一样的待遇，不要区分」)
	defer e.emitEvent(HookEvent{Event: HookEventAgentClosed, SessionKey: sessionKey,
		Extra: map[string]any{"agent_session_id": agentID}})

	done := closed
	if done == nil {
		done = make(chan struct{})
	}
	go func() {
		closeFn()
		close(done)
	}()

	select {
	case <-done:
		if elapsed := time.Since(closeStart); elapsed >= slowAgentClose {
			slog.Warn("slow agent session close", "elapsed", elapsed, "session", sessionKey)
		}
	case <-time.After(closeTimeout):
		slog.Error("agent session close timed out, abandoning",
			"timeout", closeTimeout, "session", sessionKey)
	}
}

const defaultEventIdleTimeout = 2 * time.Hour

// DefaultEventIdleTimeout is the event idle timeout an engine has when the config sets none.
const DefaultEventIdleTimeout = defaultEventIdleTimeout

// cardToolEntry stores a tool call record for card content rendering.
type cardToolEntry struct {
	Index int
	Name  string
	Input string
}

// buildCardContent constructs the full markdown for the streaming card.
func buildCardContent(thinking string, tools []cardToolEntry, answer string) string {
	var sb strings.Builder
	if thinking != "" {
		sb.WriteString("💭 **Thinking**\n\n")
		sb.WriteString(thinking)
		sb.WriteString("\n\n---\n\n")
	}
	for _, t := range tools {
		sb.WriteString(fmt.Sprintf("🔧 **Tool #%d**: `%s`\n", t.Index, t.Name))
		if t.Input != "" {
			sb.WriteString(t.Input)
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}
	if answer != "" {
		if len(tools) > 0 || thinking != "" {
			sb.WriteString("---\n\n")
		}
		sb.WriteString(answer)
	}
	return sb.String()
}

// unsolicitedReaderStopTimeout bounds how long stopUnsolicitedReader waits
// for the reader goroutine to exit. The reader is structured so its iterations
// are short (blocking adapter calls like RespondPermission are offloaded), so
// this timeout should almost always be non-binding. If it does fire, callers
// force a resync of the Events channel to preserve single-reader correctness.
const unsolicitedReaderStopTimeout = 5 * time.Second

// stopUnsolicitedReader cancels any running unsolicited reader goroutine and
// waits (bounded) for it to exit. If the reader does not exit in time, the
// caller is responsible for draining/resyncing the Events channel before a
// new foreground turn reads from it — we set eventsNeedResync here so that
// any downstream consumer drains before resuming. We do NOT wait unbounded:
// some callers hold interactiveMu, and a reader stuck in a blocking adapter
// call would stall unrelated sessions.
func (e *Engine) stopUnsolicitedReader(state *interactiveState) {
	state.mu.Lock()
	cancel := state.unsolicitedCancel
	done := state.unsolicitedDone
	state.unsolicitedCancel = nil
	state.unsolicitedDone = nil
	state.mu.Unlock()

	if cancel == nil {
		return
	}
	cancel()
	if done == nil {
		return
	}
	select {
	case <-done:
	case <-time.After(unsolicitedReaderStopTimeout):
		slog.Warn("unsolicited reader stop timed out; forcing resync",
			"timeout", unsolicitedReaderStopTimeout)
		// Force the next foreground turn to drain Events() defensively.
		// The old reader may still be alive; its ctx-double-check will drop
		// any event read after cancellation, so concurrent consumers cannot
		// silently steal foreground events.
		state.mu.Lock()
		state.eventsNeedResync = true
		state.mu.Unlock()
	}
}

// startUnsolicitedReader launches a background goroutine that consumes agent
// events produced between user-initiated turns (e.g. background task
// completions in Claude Code). Events are relayed to the platform immediately.
// The goroutine exits when its context is cancelled (by a new foreground turn
// or session cleanup) or when the Events channel is closed.
func (e *Engine) startUnsolicitedReader(state *interactiveState, session *Session, sessions *SessionManager, sessionKey string, workspaceDir string) {
	// Ensure no previous reader is still running.
	e.stopUnsolicitedReader(state)

	// Capture the agent session under lock. cleanupInteractiveState may nil
	// state.agentSession concurrently, so reading it inside the goroutine
	// without synchronisation is a data race.
	state.mu.Lock()
	agentSession := state.agentSession
	ref := state.authorization
	state.mu.Unlock()
	if agentSession == nil {
		return
	}

	outputCtx, err := e.turnOutputContext(ref)
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(outputCtx)
	done := make(chan struct{})

	state.mu.Lock()
	state.unsolicitedCancel = cancel
	state.unsolicitedDone = done
	state.mu.Unlock()

	if !e.startMessageWorker(func() {
		e.runUnsolicitedReader(ctx, cancel, done, state, agentSession, session, sessions, sessionKey, workspaceDir)
	}) {
		cancel()
		close(done)
	}
}

// runUnsolicitedReader is the goroutine body for the unsolicited event reader.
// agentSession is captured by the caller so we don't race with
// cleanupInteractiveState nilling state.agentSession.
func (e *Engine) runUnsolicitedReader(ctx context.Context, cancel context.CancelFunc, done chan struct{}, state *interactiveState, agentSession AgentSession, session *Session, sessions *SessionManager, sessionKey string, workspaceDir string) {
	defer close(done)
	defer cancel()

	send := func(p Platform, replyCtx any, content string) {
		_ = e.sendWithContextForWorkspace(ctx, p, replyCtx, content, workspaceDir)
	}
	events := agentSession.Events()

	var turnActive bool // true after first event, cleared on EventResult
	defer func() {
		if turnActive {
			if workspaceDir != "" && e.workspacePool != nil {
				if ws := e.workspacePool.Get(workspaceDir); ws != nil {
					ws.EndTurn()
				}
			}
			e.endResetTurn(sessionKey)
			go e.applyPendingReset(sessionKey)
		}
	}()

	var textParts []string
	var toolsUsed []string

	for {
		select {
		case <-ctx.Done():
			// Context cancelled (new foreground turn or cleanup). Don't set
			// eventsNeedResync — the caller (stopUnsolicitedReader) knows the
			// channel state is clean because it just took ownership.
			return

		case event, ok := <-events:
			if !ok {
				// Channel closed — agent process exited. Log any buffered
				// tool/text context so it isn't lost silently.
				if len(toolsUsed) > 0 || len(textParts) > 0 {
					slog.Warn("unsolicited reader: agent channel closed mid-turn",
						"session", sessionKey,
						"tools_used", toolsUsed,
						"text_fragments", len(textParts))
				}
				state.mu.Lock()
				state.eventsNeedResync = true
				state.mu.Unlock()
				return
			}

			// Go's select is non-deterministic when multiple cases are
			// ready, so even after ctx is cancelled we may still read one
			// last event from the channel. If ownership has been handed
			// off, drop the event rather than processing it — otherwise we
			// could relay (or worse, respond to) an event that belongs to
			// the incoming foreground turn. The caller has already set
			// eventsNeedResync on timeout, so any buffered events will be
			// drained before the foreground turn reads them.
			select {
			case <-ctx.Done():
				slog.Warn("unsolicited reader: event received after cancellation, dropping",
					"session", sessionKey, "event_type", event.Type)
				state.mu.Lock()
				state.eventsNeedResync = true
				state.mu.Unlock()
				return
			default:
			}

			if err := checkProactiveExecution(ctx, "task.resume"); err != nil {
				return
			}

			// Mark workspace active on first event.
			if !turnActive {
				turnActive = true
				if workspaceDir != "" && e.workspacePool != nil {
					if ws := e.workspacePool.Get(workspaceDir); ws != nil {
						ws.BeginTurn()
					}
				}
				// A background-notification turn is a turn like a foreground one:
				// `session new --after-turn` run inside it queues until its reply is
				// delivered instead of resetting (and killing) the agent mid-turn.
				e.beginResetTurn(sessionKey)
				slog.Info("unsolicited events detected, relaying to platform",
					"session", sessionKey)
			}

			state.mu.Lock()
			p := state.platform
			replyCtx := state.replyCtx
			state.mu.Unlock()

			if c, _ := event.Metadata[MetaContextCompacted].(bool); c {
				session.ResetTurnCtx() // maomao fork
			}
			e.observeQuotaEventFor(event, sessionKey, agentSession, state.quotaScope)
			e.observeRoleAgentEvent(sessionKey, event, textParts)
			switch event.Type {
			case EventText:
				if event.Content != "" {
					textParts = append(textParts, event.Content)
				}

			case EventToolUse:
				// Record tool name so we can log or surface context if the
				// channel closes before a clean EventResult. Output is
				// delivered via EventResult; we intentionally do not relay
				// per-tool progress here (no active user turn to observe it).
				if event.ToolName != "" {
					toolsUsed = append(toolsUsed, event.ToolName)
				}
				slog.Debug("unsolicited tool use",
					"session", sessionKey,
					"tool", event.ToolName)

			case EventToolResult:
				slog.Debug("unsolicited tool result",
					"session", sessionKey,
					"status", event.ToolStatus)

			case EventResult:
				fullResponse := event.Content
				if fullResponse == "" && len(textParts) > 0 {
					fullResponse = joinReplyParts(textParts)
				}
				if reset, ok := QuotaExhaustedReset(event); ok {
					fullResponse = e.quotaExhaustedMessage(reset, agentSession, nil)
				}

				// Honour the NO_REPLY marker here too: background task
				// notifications often end in or start with NO_REPLY, which must
				// not be relayed to the chat as literal text.
				if isSilentReply(fullResponse) {
					fullResponse = ""
				} else {
					fullResponse = stripSilentReply(fullResponse)
				}

				if fullResponse != "" {
					for _, chunk := range SplitMessageCodeFenceAware(fullResponse, maxPlatformMessageLen) {
						send(p, markAgentReply(p, replyCtx, session), chunk)
					}
				}
				// #699 C: a reply is not a handback; the workspace hands back with ws-up --report
				// (WorkspaceExit), so nothing in this text is forwarded as a [report]/[ask].

				e.watchTurnEnded(p, sessionKey, fullResponse, len(toolsUsed) > 0, false, false, false, time.Time{})

				// Safety note: concurrent writes to session.History by the
				// unsolicited reader and a foreground turn cannot overlap.
				// Session.AddHistory takes session.mu internally, and
				// stopUnsolicitedReader (called before any foreground turn
				// takes event-channel ownership) blocks until this goroutine
				// exits — so a foreground AddHistory is always ordered after
				// any unsolicited AddHistory.
				session.AddHistory("assistant", fullResponse)
				sessions.Save()

				// Reset for potential subsequent unsolicited turn.
				textParts = nil
				toolsUsed = nil
				turnActive = false
				if workspaceDir != "" && e.workspacePool != nil {
					if ws := e.workspacePool.Get(workspaceDir); ws != nil {
						ws.EndTurn()
					}
				}

				// Mark clean exit so next foreground turn preserves events.
				state.mu.Lock()
				state.eventsNeedResync = false
				state.mu.Unlock()

				// Reset the per-session idle close timer so a series of
				// background task completions does not get cut short by the
				// idle timeout armed at the end of the last foreground turn.
				// Without this, a long-running background turn (e.g. cron task
				// that reports progress every minute) can be killed mid-flight
				// when the original idle timer fires. See #1686 P1-C P1-1.
				e.scheduleAgentSessionIdleClose(sessionKey, state)

				slog.Info("unsolicited turn complete",
					"session", sessionKey,
					"response_len", len(fullResponse))

				// `session new --after-turn` run inside a background-notification turn is
				// applied now that its reply (and any [report]) has been delivered, like a
				// foreground turn does. Async: the reset stops this agent session, which
				// waits for this reader to exit.
				e.endResetTurn(sessionKey)
				go e.applyPendingReset(sessionKey)

			case EventPermissionRequest:
				// If approveAll (/yolo) is set, grant the request. Otherwise
				// deny — there is no active user turn to consult — and notify
				// the user on the platform so a silently blocked background
				// task is not invisible. RespondPermission may make a slow
				// adapter call, so we run it in a detached goroutine to keep
				// reader iterations fast (stopUnsolicitedReader relies on a
				// bounded wait for the reader to exit).
				state.mu.Lock()
				autoApprove := state.approveAll || isYoloMode(state.agent)
				state.mu.Unlock()
				autoApprove = autoApprove || e.turnAutoApproves(state)

				result := PermissionResult{Behavior: "deny", Message: "denied: no active user turn"}
				if autoApprove {
					result = PermissionResult{Behavior: "allow", UpdatedInput: event.ToolInputRaw}
				}
				reqID := event.RequestID
				respondCtx := ctx // capture current unsolicited reader context
				go func() {
					// Run in a goroutine to keep reader iterations fast, but honour
					// the reader's context so we don't call into a dead session after
					// stopUnsolicitedReader cancels the context.
					select {
					case <-respondCtx.Done():
						return
					default:
					}
					if err := respondTaskPermission(respondCtx, agentSession, reqID, result); err != nil {
						if respondCtx.Err() == nil {
							slog.Error("unsolicited: failed to respond permission", "error", err)
						}
					}
				}()
				if !autoApprove {
					toolName := event.ToolName
					if toolName == "" {
						toolName = "(unknown)"
					}
					send(p, replyCtx, fmt.Sprintf(e.i18n.T(MsgBackgroundAutoDenied), toolName))
				}

			case EventError:
				if event.Error != nil {
					if until, ok := e.quotaCoolingUntilFor(state.quotaScope, event.Error.Error()); ok {
						slog.Warn("provider quota exhausted, cooling down until reset", "session_key", sessionKey, "cooling_until", until.Format(time.RFC3339))
					}
					slog.Error("unsolicited agent error", "error", event.Error, "session", sessionKey)
					userMsg := e.agentErrorMessage(event.Error)
					if backendMsg, ok := BackendUnavailableText(event.Error, e.i18n.CurrentLang()); ok {
						userMsg = backendMsg
					}
					if errors.Is(event.Error, ErrNoPublicAnswer) {
						userMsg = e.i18n.T(MsgNoPublicAnswer)
					}
					if reset, ok := QuotaExhaustedReset(event); ok {
						userMsg = e.quotaExhaustedMessage(reset, agentSession, nil)
					}
					// The message embeds the backend's own error text. In a group
					// that text must not reach the chat (upstream safety-filter
					// output, account ids); private chats keep it for diagnosis.
					if !e.errorKeptOutOfChat(p, replyCtx, userMsg) {
						send(p, replyCtx, userMsg)
					}
				}
				state.mu.Lock()
				state.eventsNeedResync = true
				state.mu.Unlock()
				return
			}
		}
	}
}
