package core

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"
)

// ---- maomao fork: a cheap workspace that failed moves to the lead model (#1562) ----
//
// User 11-13 「为什么搞一个小时都啥都没搞，这个怎么解决以后」: #1546 and #1548 ran on the local
// Qwen, outgrew its context after 12 and 7 minutes of work, then every request answered
// "Context size has been exceeded" for 45 minutes; the turn ended with an API error, the bridge
// only noted the turn as over, and the lead's forward went into the same broken session.
//
// Now a workspace turn on a cheap lane (DS or Qwen) that ends with an API error — including the
// provider proxy's stop after two context-exceeded answers in a row (providerproxy.go) — is
// re-run once on a fresh agent session on the lead model, carrying only the handoff file (no
// summary of the broken session), and a line in the chat the task came from says so.
// A forward (ws-forward) into a workspace whose last turn ended with an API error also starts a
// fresh session instead of appending to the old one.

// workspaceTurnFailed: workspace chat → the API error its last turn ended with ("" or absent:
// the last turn ended normally).
var workspaceTurnFailed = struct {
	sync.Mutex
	m map[string]string
}{m: map[string]string{}}

// sessionOfInteractiveKey drops a multi-workspace engine's "<workspace path>:" prefix
// (interactiveKeyForSessionKey) from an event loop's key.
func sessionOfInteractiveKey(key string) string {
	if i := strings.LastIndexAny(key, `/\`); i >= 0 {
		if _, rest, ok := strings.Cut(key[i:], ":"); ok {
			return rest
		}
	}
	return key
}

// isAPIErrorResult: a turn-ending result that is Claude Code's API error notice.
func isAPIErrorResult(event Event) bool {
	if event.Type != EventResult {
		return false
	}
	text := strings.TrimSpace(event.Content)
	isErr, _ := event.Metadata[MetaResultIsError].(bool)
	return strings.HasPrefix(text, "API Error") || (isErr && IsLocalContextExceededError(text))
}

// noteWorkspaceTurnOutcome records how a workspace turn ended: for the watch (a failed turn is
// no progress, team_turn_fact.go) and for forwards (freshForwardAfterFailure).
func (e *Engine) noteWorkspaceTurnOutcome(sessionKey string, event Event) {
	sessionKey = sessionOfInteractiveKey(sessionKey)
	if event.Type != EventResult || !event.Done || !e.isTeamWorkspaceChat(sessionKey) {
		return
	}
	key := teamChatKey(sessionKey)
	workspaceTurnFailed.Lock()
	defer workspaceTurnFailed.Unlock()
	if isAPIErrorResult(event) {
		workspaceTurnFailed.m[key] = strings.TrimSpace(event.Content)
		noteTeamTurnFailed(key)
		slog.Warn("workspace: turn ended with an API error", "session", sessionKey, "error", truncateStr(event.Content, 200))
		return
	}
	delete(workspaceTurnFailed.m, key)
	noteTeamTurnOK(key)
}

func workspaceLastTurnError(sessionKey string) string {
	workspaceTurnFailed.Lock()
	defer workspaceTurnFailed.Unlock()
	return workspaceTurnFailed.m[teamChatKey(sessionKey)]
}

func clearWorkspaceTurnError(sessionKey string) {
	workspaceTurnFailed.Lock()
	delete(workspaceTurnFailed.m, teamChatKey(sessionKey))
	workspaceTurnFailed.Unlock()
}

// takeCheapLaneFailure records (for the caller) a workspace turn on a cheap lane that ended with
// an API error, so it can be re-run on the lead model. Only ordinary turns, not cancelled.
func (e *Engine) takeCheapLaneFailure(state *interactiveState, input *inputTurn, event Event, chained *queuedMessage, sessionKey string) bool {
	sessionKey = sessionOfInteractiveKey(sessionKey)
	if input != nil || !isAPIErrorResult(event) || !e.isTeamWorkspaceChat(sessionKey) {
		return false
	}
	r, ok := cachedWorkspaceRoute(sessionKey)
	if !ok || !r.cheap {
		return false
	}
	if _, forced := forcedWorkspaceRoute(r.task); forced {
		return false // moved once already; a second failure is reported as usual
	}
	if e.isStoppingForJournal() {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.turnCancelled {
		return false
	}
	state.cheapFailed, state.cheapFailedQueued = strings.TrimSpace(event.Content), nil
	if chained != nil {
		q := *chained
		state.cheapFailedQueued = &q
	}
	return true
}

func (s *interactiveState) takeCheapFailed() (string, *queuedMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	errMsg, q := s.cheapFailed, s.cheapFailedQueued
	s.cheapFailed, s.cheapFailedQueued = "", nil
	return errMsg, q
}

// cheapFailureLabel: what the chat line calls the failure.
func cheapFailureLabel(errMsg string) string {
	if IsLocalContextExceededError(errMsg) || isLocalContextExceeded(errMsg) {
		return "上下文超限"
	}
	return "API 报错"
}

// retryOnLeadAfterCheapFailure re-runs a failed cheap-lane workspace turn once on a fresh session
// on the lead model, with only the handoff file. Must be called with the session locked; true
// when the re-run took over the lock.
func (e *Engine) retryOnLeadAfterCheapFailure(p Platform, msg Message, errMsg string, old *interactiveState, session *Session, sessions *SessionManager, agent Agent, interactiveKey, workspaceDir, ccSessionKey string) bool {
	if msg.freshRetried || e.isStoppingForJournal() {
		e.send(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), errMsg))
		return false
	}
	key := teamChatKey(msg.SessionKey)
	r, _ := cachedWorkspaceRoute(msg.SessionKey)
	lane := routeLaneName(r.lane)
	label := cheapFailureLabel(errMsg)
	forceWorkspaceRouteDirect(r.task, fmt.Sprintf("上一轮在%s上%s，换贵模型重做（#1562）", lane, label))
	workspaceRouteCache.Lock()
	delete(workspaceRouteCache.m, key)
	workspaceRouteCache.Unlock()
	clearWorkspaceTurnError(key)

	id := session.GetAgentSessionID()
	session.SetAgentSessionID("", agent.Name()) // no SetHandoffFrom: the new session gets the handoff file only
	sessions.Save()
	notes, title, chat := "", "", ""
	if it := e.workspaceBoardItem(msg.SessionKey, r.task); it != nil {
		notes, chat = strings.TrimSpace(it.Where), it.Chat
		title = it.Short
		if title == "" {
			title = it.What
		}
	}
	slog.Warn("workspace: cheap lane failed, re-running on the lead model", "session", interactiveKey, "task", r.task, "lane", r.lane, "old_agent_session", id, "error", truncateStr(errMsg, 200))
	e.appendRouteLog(routeLogLine{Event: "failover", Task: r.task, Session: key, Route: "direct", Lane: r.lane, Model: e.leadModelName(), Reason: label + "：" + truncateStr(errMsg, 160)})

	ws := channelLabel(p.Name(), teamChannelID(key))
	notice := fmt.Sprintf("⚠️ %s #%d %s：%s上%s，桥已停掉这轮，换贵模型开新会话重做（只带交接文件）", ws, r.task, title, lane, label)
	e.sendSystemNotice(p, msg.ReplyCtx, notice)
	if chat != "" && teamChatKey(chat) != key {
		if rec, ok := p.(ReplyContextReconstructor); ok {
			if rc, err := rec.ReconstructReplyCtx(chat); err == nil {
				if err := p.Send(e.ctx, rc, notice); err != nil {
					slog.Warn("workspace: failover notice to the chat failed", "chat", chat, "error", err)
				}
			}
		}
	}

	head := fmt.Sprintf("上一轮在%s上%s（%s），桥已换贵模型开新会话。", lane, label, truncateStr(errMsg, 160))
	if notes != "" {
		head += "只照交接文件 " + notes + " 做这件活"
		if r.task > 0 {
			head += fmt.Sprintf("（#%d）", r.task)
		}
		head += "：先看工作目录和分支里已有的改动，接着做没做完的，不要从头重来。"
	}
	msg.Content = head + "\n\n" + msg.Content
	return e.rerunOnFreshSession(p, msg, old, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey)
}

// freshForwardAfterFailure: a forward (ws-forward timer) into a workspace whose last turn ended
// with an API error starts a fresh agent session with the handoff file, instead of appending to
// the broken one. Returns the note to put before the forwarded text ("" = nothing done).
func (e *Engine) freshForwardAfterFailure(sessionKey string, session *Session, sessions *SessionManager, agent Agent) string {
	if !e.isTeamWorkspaceChat(sessionKey) {
		return ""
	}
	errMsg := workspaceLastTurnError(sessionKey)
	if errMsg == "" {
		return ""
	}
	clearWorkspaceTurnError(sessionKey)
	id := session.GetAgentSessionID()
	session.SetAgentSessionID("", agent.Name())
	sessions.Save()
	slog.Warn("workspace: forward into a failed session; starting fresh", "session", sessionKey, "old_agent_session", id)
	note := fmt.Sprintf("上一轮以报错结束（%s），这条转话开了新会话。", truncateStr(errMsg, 160))
	if it := e.workspaceBoardItem(sessionKey, 0); it != nil && strings.TrimSpace(it.Where) != "" {
		note += fmt.Sprintf("先读交接文件 %s（#%d），看工作目录和分支里已有的改动，再按下面这条做。", strings.TrimSpace(it.Where), it.ID)
	}
	return note
}
