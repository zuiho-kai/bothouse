package core

import (
	"log/slog"
	"os"
	"strings"
)

// ---- maomao fork: per-session model overrides ----
//
// [projects.session_models] maps a session key to a model, so one channel can
// run on a cheaper model while the rest of the project keeps the agent default.
// The shared agent keeps its defaults; startup context carries the channel model
// and effort. SessionModelInjector remains compatible with legacy consumers.

// SetSessionModels replaces the session key → model map. Blank keys and
// values are dropped.
func (e *Engine) SetSessionModels(m map[string]string) {
	clean := make(map[string]string, len(m))
	for k, v := range m {
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k != "" && v != "" {
			clean[k] = v
		}
	}
	e.sessionModelsMu.Lock()
	e.sessionModels = clean
	e.sessionModelsMu.Unlock()
}

// sessionModelFor returns the model mapped to sessionKey, or "" for the default.
func (e *Engine) sessionModelFor(sessionKey string) string {
	if model := e.sessionSelection(sessionKey).Model; model != "" {
		return model
	}
	e.sessionModelsMu.RLock()
	defer e.sessionModelsMu.RUnlock()
	return e.sessionModels[sessionKey]
}

// applySessionModel tells the agent which model the next StartSession uses.
// It always sets a value ("" included) so an override never leaks into the
// next session the shared agent starts.
func (e *Engine) applySessionModel(agent Agent, sessionKey string) {
	if inj, ok := agent.(SessionModelInjector); ok {
		inj.SetSessionModel(e.sessionModelFor(sessionKey))
	}
}

// setTurnModel makes the side turn under interactive key iKey start on model ("" clears it).
// Only scheduled side sessions use it (a task review on a tier model, TimerJob.Model): the key
// is unique to that run, so the channel session's model is untouched.
func (e *Engine) setTurnModel(iKey, model string) {
	e.sessionModelsMu.Lock()
	defer e.sessionModelsMu.Unlock()
	if model == "" {
		delete(e.turnModels, iKey)
		return
	}
	if e.turnModels == nil {
		e.turnModels = map[string]string{}
	}
	e.turnModels[iKey] = model
}

func (e *Engine) turnModelFor(iKey string) string {
	e.sessionModelsMu.RLock()
	defer e.sessionModelsMu.RUnlock()
	return e.turnModels[iKey]
}

// ---- maomao fork: per-session base instructions ----
//
// [projects.session_instructions] maps a session key to a file that replaces
// the agent's built-in base instructions, so a chat-only channel can drop the
// coding-agent prompt while work channels keep it. Same per-start injection as
// the session model. The text is read here, at config load, so a file that
// disappears later cannot fail a session start. Shares sessionModelsMu.

type sessionInstructions struct{ path, text string }

// SetSessionInstructions replaces the session key → instructions file map,
// reading each file now. Blank entries are dropped; config validation already
// rejects unreadable files, so a read error here is only logged.
func (e *Engine) SetSessionInstructions(m map[string]string) {
	clean := make(map[string]sessionInstructions, len(m))
	for k, v := range m {
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		b, err := os.ReadFile(v)
		if err != nil {
			slog.Error("session_instructions: read failed, session keeps built-in prompt", "session_key", k, "file", v, "error", err)
			continue
		}
		clean[k] = sessionInstructions{path: v, text: strings.TrimSpace(string(b))}
	}
	e.sessionModelsMu.Lock()
	e.sessionInstructions = clean
	e.sessionModelsMu.Unlock()
}

// applySessionInstructions tells the agent which instructions the next
// StartSession uses (empty = built-in), so an override never leaks across sessions.
func (e *Engine) applySessionInstructions(agent Agent, sessionKey string) {
	inj, ok := agent.(SessionInstructionsInjector)
	if !ok {
		return
	}
	e.sessionModelsMu.RLock()
	si := e.sessionInstructions[sessionKey]
	e.sessionModelsMu.RUnlock()
	inj.SetSessionInstructions(si.path, si.text)
}

// sessionSettingsFor returns sessionKey's per-session overrides without
// touching the shared agent (native compaction passes them as arguments).
func (e *Engine) sessionSettingsFor(sessionKey string) SessionSettings {
	selection := e.sessionSelection(sessionKey)
	e.sessionModelsMu.RLock()
	si := e.sessionInstructions[sessionKey]
	model := e.sessionModels[sessionKey]
	ws := e.workspaceExec
	e.sessionModelsMu.RUnlock()
	settings := SessionSettings{ReasoningEffort: selection.Effort, InstructionsPath: si.path, InstructionsText: si.text}
	switch {
	case selection.Model != "":
		settings.Model = selection.Model // picked by hand (model set / tiers) wins
	case model != "":
		settings.Model = model
	case ws.provider != "" && e.isTeamWorkspaceChat(sessionKey):
		if e.workspaceRouteFor(sessionKey, ws.model).cheap { // #1448: split or direct, per task
			settings.Provider, settings.Model = ws.provider, ws.model
		}
	}
	return settings
}

// ---- maomao fork: cheap workspace execution ----
//
// The lead (expensive model) writes the handoff and checks the [report]; the
// workspace that does the work starts on workspace_provider/workspace_model
// (e.g. a local Qwen behind an OpenAI-compatible endpoint, reached through the
// protoconv converter). Applies only to team workspace channels with no
// hand-picked model.
type workspaceExec struct{ provider, model string }

// SetWorkspaceExec sets the provider/model team workspaces start on ("" = off).
func (e *Engine) SetWorkspaceExec(provider, model string) {
	provider, model = strings.TrimSpace(provider), strings.TrimSpace(model)
	e.sessionModelsMu.Lock()
	e.workspaceExec = workspaceExec{provider: provider, model: model}
	e.sessionModelsMu.Unlock()
	if provider != "" {
		slog.Info("workspace exec: team workspaces run on a separate provider", "provider", provider, "model", model)
	}
}
