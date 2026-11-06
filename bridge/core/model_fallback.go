package core

import (
	"context"
	"log/slog"
	"strings"
)

// ---- #134: switch to a configured fallback model after repeated temporary failures ----
//
// 用户 2026-11-04 17:07「可以」to 「同角色连续429自动切备用中转/模型、保留会话」; 主区 17:3x 定案 A:
// each bot lists its fallback models in config (fallback_models, default empty = never switch).
// When a turn has failed capacityAttempts times in a row with a temporary error, the next model in
// the list after the current one is queued for this session (QueueModelSwitch: only ids the agent
// lists, conversation kept) and the message is re-sent on it shortly, instead of cooling the whole
// bot down. One switch per failure streak: if the fallback fails the same way, the normal cooldown
// follows, so two models backing each other up never ping-pong.

// SetFallbackModels sets the models to switch between (config fallback_models).
func (e *Engine) SetFallbackModels(models []string) {
	var list []string
	for _, m := range models {
		if m = strings.TrimSpace(m); m != "" {
			list = append(list, m)
		}
	}
	e.capMu.Lock()
	e.fallbackModels = list
	e.capMu.Unlock()
}

// nextFallbackModel: the entry after current in list (wrapping), or the first entry that is not
// current when current is not listed. "" when the list offers nothing else.
func nextFallbackModel(list []string, current string) string {
	for i, m := range list {
		if strings.EqualFold(m, current) {
			for j := 1; j < len(list); j++ {
				if n := list[(i+j)%len(list)]; !strings.EqualFold(n, current) {
					return n
				}
			}
			return ""
		}
	}
	for _, m := range list {
		if !strings.EqualFold(m, current) {
			return m
		}
	}
	return ""
}

// switchToFallbackModel queues the fallback model for key once per failure streak. It returns the
// model queued, or "" when there is none (no list, already switched this streak, or the agent
// rejects the id).
func (e *Engine) switchToFallbackModel(key string) string {
	e.capMu.Lock()
	list, used := e.fallbackModels, e.capFallbackUsed
	e.capMu.Unlock()
	if len(list) == 0 || used {
		return ""
	}
	agent, _ := e.sessionContextForKey(key)
	if agent == nil {
		return ""
	}
	current := e.currentSessionModel(key, agent)
	next := nextFallbackModel(list, current)
	if next == "" {
		return ""
	}
	res := e.QueueModelSwitch(context.Background(), key, next, "", false)
	if !res.OK {
		slog.Warn("fallback model rejected", "session_key", key, "model", next, "reason", res.Message)
		return ""
	}
	if res.Model != "" {
		next = res.Model
	}
	e.capMu.Lock()
	e.capFallbackUsed = true
	e.capSwitchedTo = next
	e.capNotified = nil // the switch gets its own notice per channel
	e.capMu.Unlock()
	slog.Warn("temporary failures: switching to fallback model", "session_key", key, "from", current, "to", next)
	return next
}
