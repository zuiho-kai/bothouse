package core

import (
	"log/slog"
	"sync"
	"time"
)

// maomao fork: automatic model tiers. The gate tags each message "chat" or "task"; before an
// idle turn starts, the agent switches to the matching model the same way /model does (keep the
// agent session ID, drop the running process, the next turn resumes it with the new model).
// Small talk stays on a fast model and real work gets the stronger one. A task keeps the session
// on the task model for a sticky window, so a back-and-forth about the same work doesn't restart
// the agent on every message.

const (
	tierChat = "chat"
	tierTask = "task"

	defaultTierSticky = 10 * time.Minute
	// manualTierHold: after a chat command picks a model by hand, automatic tiers leave it alone.
	manualTierHold = time.Hour
)

type modelTiers struct {
	chatModel, taskModel   string
	chatEffort, taskEffort string // optional; only applied to agents that support reasoning effort
	sticky                 time.Duration

	mu          sync.Mutex
	lastTask    map[string]time.Time // interactiveKey → last task-tagged message
	manualUntil map[string]time.Time // interactiveKey → hand-picked model wins until then
}

func (t *modelTiers) setManual(key string, d time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.manualUntil[key] = time.Now().Add(d)
}

func (t *modelTiers) clearManual(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.manualUntil, key)
	delete(t.lastTask, key)
}

func (t *modelTiers) manual(key string, now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	until, ok := t.manualUntil[key]
	return ok && now.Before(until)
}

// SetModelTiers enables automatic model selection. Both models are required; otherwise the
// feature stays off. stickyMins <= 0 keeps the default 10 minutes.
func (e *Engine) SetModelTiers(chatModel, taskModel, chatEffort, taskEffort string, stickyMins int) {
	if chatModel == "" || taskModel == "" {
		e.tiers = nil
		return
	}
	sticky := defaultTierSticky
	if stickyMins > 0 {
		sticky = time.Duration(stickyMins) * time.Minute
	}
	e.tiers = &modelTiers{
		chatModel: chatModel, taskModel: taskModel,
		chatEffort: chatEffort, taskEffort: taskEffort,
		sticky: sticky, lastTask: map[string]time.Time{}, manualUntil: map[string]time.Time{},
	}
	slog.Info("model tiers enabled", "chat", chatModel, "task", taskModel,
		"chat_effort", chatEffort, "task_effort", taskEffort, "sticky", sticky)
}

// pick returns the tier this message should run on, or "" to leave the model alone
// (the gate gave no tag).
func (t *modelTiers) pick(key, tag string, now time.Time) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch tag {
	case tierTask:
		t.lastTask[key] = now
		return tierTask
	case tierChat:
		if last, ok := t.lastTask[key]; ok && now.Sub(last) < t.sticky {
			return tierTask
		}
		return tierChat
	}
	return ""
}

func (t *modelTiers) target(tier string) (model, effort string) {
	if tier == tierTask {
		return t.taskModel, t.taskEffort
	}
	return t.chatModel, t.chatEffort
}

// applyModelTier switches the agent for msg's session to the tier the gate asked for. It must
// only be called when the session is idle: switching drops the running agent process.
func (e *Engine) applyModelTier(p Platform, msg *Message, tag string) {
	t := e.tiers
	if t == nil || tag == "" {
		return
	}
	agent, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		slog.Warn("model tier: no session context", "session", msg.SessionKey, "error", err)
		return
	}
	switcher, ok := agent.(ModelSwitcher)
	if !ok {
		return
	}
	if t.manual(interactiveKey, time.Now()) {
		return // the user picked a model by hand (see model_command.go)
	}
	tier := t.pick(interactiveKey, tag, time.Now())
	if tier == "" {
		return
	}
	model, effort := t.target(tier)

	changed := false
	from := switcher.GetModel()
	if from != model {
		if _, err := e.switchModelOnAgent(agent, model, false); err != nil {
			slog.Warn("model tier: switch failed", "session", msg.SessionKey, "model", model, "error", err)
			return
		}
		changed = true
	}
	if effort != "" {
		if rs, ok := agent.(ReasoningEffortSwitcher); ok && rs.GetReasoningEffort() != effort {
			rs.SetReasoningEffort(effort)
			changed = true
		}
	}
	if !changed {
		return
	}
	// Same as /model: the next StartSession uses --resume <id> with the new model, so the CLI
	// restores the conversation natively.
	e.cleanupInteractiveState(interactiveKey)
	sessions.Save()
	slog.Info("model tier switch", "session", msg.SessionKey, "tag", tag, "tier", tier,
		"from", from, "to", model, "effort", effort)
}
