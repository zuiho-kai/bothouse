package core

import (
	"fmt"
	"log/slog"
	"strings"
)

// #1414: a relay (yibuapi) routes some Claude requests to an upstream whose
// safety classifier refuses ordinary turns ("API Error: Opus 5.5's safeguards
// flagged this message ..."); live agentm 2026-11-10 it refused even "你好，今天
// 天气怎么样" about 1 in 4 times, and a session refused once kept being refused.
// Such a turn is re-run once on a fresh session (old one handed over), like a
// prompt-too-long turn. A second refusal is reported as usual.

// isSafeguardRefusal matches Claude Code's text for a classifier refusal.
func isSafeguardRefusal(text string) bool {
	return strings.Contains(strings.ToLower(text), "safeguards flagged this message")
}

// takeRefusalResult records (for the caller) a turn whose result is a classifier
// refusal, so it can be re-run on a fresh session. Only ordinary turns (no input
// turn, not cancelled). retryFreshOnRefusal reports a re-run refused again.
func (e *Engine) takeRefusalResult(state *interactiveState, input *inputTurn, event Event, chained *queuedMessage) bool {
	if input != nil {
		return false
	}
	// Claude Code's result for it is the API error text; whether it also carries
	// is_error is not relied on, so the text must be the whole error notice.
	isErr, _ := event.Metadata[MetaResultIsError].(bool)
	text := strings.TrimSpace(event.Content)
	if !isSafeguardRefusal(text) || (!isErr && !strings.HasPrefix(text, "API Error:")) {
		return false
	}
	if e.isStoppingForJournal() {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.turnCancelled {
		return false
	}
	state.refused, state.refusedQueued = strings.TrimSpace(event.Content), nil
	if chained != nil {
		q := *chained
		state.refusedQueued = &q
	}
	return true
}

func (s *interactiveState) takeRefused() (string, *queuedMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	errMsg, q := s.refused, s.refusedQueued
	s.refused, s.refusedQueued = "", nil
	return errMsg, q
}

// retryFreshOnRefusal re-runs a refused turn once on a fresh session. Must be
// called with the session locked; true when the re-run took over the lock.
func (e *Engine) retryFreshOnRefusal(p Platform, msg Message, errMsg string, old *interactiveState, session *Session, sessions *SessionManager, agent Agent, interactiveKey, workspaceDir, ccSessionKey string) bool {
	if msg.freshRetried || e.isStoppingForJournal() {
		e.send(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), errMsg))
		return false
	}
	id := session.GetAgentSessionID()
	session.SetAgentSessionID("", agent.Name())
	if id != "" && id != ContinueSession {
		if _, ok := agent.(SessionHandoffReader); ok {
			session.SetHandoffFrom(id, "上游安全检查误拒，换新会话重答")
		}
	}
	sessions.Save()
	slog.Warn("safeguard refusal: re-running on a fresh session", "old_agent_session", id, "session", interactiveKey)
	e.sendSystemNotice(p, msg.ReplyCtx, "♻️ 上游安全检查误拒了这条，开新会话重答一次")
	return e.rerunOnFreshSession(p, msg, old, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey)
}
