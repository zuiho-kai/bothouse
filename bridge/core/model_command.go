package core

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
)

// maomao fork: agents switch their own model / reasoning effort. When the user asks ("换成
// opus5.5", "推理强度调到 high"), the agent itself runs `cc-connect model list` / `model set …`
// (see AgentSystemPrompt and cmd/cc-connect/model.go). The agent is mid-turn when it calls, so the
// switch is queued and applied right before the session's next turn starts.
// Model IDs must come from the backend catalog; the agent handles natural language.

var effortWords = map[string]string{
	"超高": "xhigh", "极高": "max", "最高": "max", "最强": "max", "最低": "low",
	"中等": "medium", "中档": "medium", "中": "medium", "高档": "high", "高": "high", "调高": "high",
	"低档": "low", "低": "low", "调低": "low",
}

func normEffort(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if v, ok := effortWords[s]; ok {
		return v
	}
	return s
}

func normModelKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// resolveModelQuery validates an exact advertised ID. Semantic selection belongs
// to the agent's model-switch skill, never to fuzzy matching in the bridge.
func resolveModelQuery(query string, options []ModelOption) (string, []ModelOption) {
	for _, option := range options {
		if query == option.Name {
			return option.Name, nil
		}
	}
	return "", options
}

// effortVariant finds the model whose name is current with its effort level swapped, for agents
// that encode effort in the model id (Gemini "-medium", Cursor "effort=high").
func effortVariant(current, effort string, options []ModelOption) string {
	re := regexp.MustCompile(`(?i)(xhigh|low|medium|high|max)`)
	if !re.MatchString(current) {
		return ""
	}
	want := normModelKey(re.ReplaceAllString(current, effort))
	for _, o := range options {
		if normModelKey(o.Name) == want {
			return o.Name
		}
	}
	return ""
}

func listModels(opts []ModelOption, max int) string {
	var names []string
	for i, o := range opts {
		if i == max {
			names = append(names, fmt.Sprintf("…（共 %d 个，发 /model 看全部）", len(opts)))
			break
		}
		if strings.HasPrefix(o.Name, "[") && o.Alias != "" {
			names = append(names, o.Alias) // dsh ids are JSON arrays; the label reads better
			continue
		}
		names = append(names, "`"+o.Name+"`")
	}
	return strings.Join(names, "、")
}

func modelOf(agent Agent) string {
	if s, ok := agent.(ModelSwitcher); ok {
		if m := s.GetModel(); m != "" {
			return m
		}
	}
	return "默认模型"
}

func containsFold(list []string, s string) bool {
	for _, v := range list {
		if strings.EqualFold(v, s) {
			return true
		}
	}
	return false
}

// --- queued switches requested by the agent itself ---

type pendingModelSwitch struct {
	model, effort string
	auto          bool
}

// ModelStatus is what `cc-connect model list` shows the agent.
type ModelStatus struct {
	Agent         string        `json:"agent"`
	Model         string        `json:"model"`
	Source        string        `json:"source,omitempty"` // local_session means catalog/switch state is unavailable
	Effort        string        `json:"effort,omitempty"`
	Models        []ModelOption `json:"models"`
	Efforts       []string      `json:"efforts,omitempty"`
	EffortInModel bool          `json:"effort_in_model,omitempty"` // effort is chosen by picking a model variant
	AutoChat      string        `json:"auto_chat,omitempty"`
	AutoTask      string        `json:"auto_task,omitempty"`
	AutoPaused    bool          `json:"auto_paused,omitempty"` // a hand-picked model is holding off auto switching
	Pending       string        `json:"pending,omitempty"`
}

func (e *Engine) ModelStatus(ctx context.Context, sessionKey string) ModelStatus {
	agent, _ := e.sessionContextForKey(sessionKey)
	st := ModelStatus{Agent: agent.Name(), Model: modelOf(agent)}
	if sw, ok := agent.(ModelSwitcher); ok {
		st.Models = sw.AvailableModels(ctx)
		st.Model = modelOf(agent) // ACP agents learn the current model while listing
	}
	if rs, ok := agent.(ReasoningEffortSwitcher); ok {
		st.Effort = rs.GetReasoningEffort()
		st.Efforts = rs.AvailableReasoningEfforts()
	}
	if model := e.currentSessionModel(sessionKey, agent); model != "" {
		st.Model = model
	}
	if len(st.Efforts) == 0 && effortVariant(st.Model, "high", st.Models) != "" {
		st.EffortInModel = true
	}
	if t := e.tiers; t != nil {
		st.AutoChat, st.AutoTask = t.chatModel, t.taskModel
		st.AutoPaused = t.manual(sessionKey, time.Now())
	}
	e.modelSwitchMu.Lock()
	if p, ok := e.pendingSwitch[sessionKey]; ok {
		st.Pending = strings.TrimSpace(fmt.Sprintf("%s %s", p.model, p.effort))
		if p.auto {
			st.Pending = "auto"
		}
	}
	e.modelSwitchMu.Unlock()
	return st
}

// Snapshot the current channel's session before querying runtime metadata;
// agent getters may perform I/O and must not hold engine/state locks.
func (e *Engine) currentSessionModel(sessionKey string, agent Agent) string {
	key := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[key]
	e.interactiveMu.Unlock()
	var session AgentSession
	if state != nil {
		state.mu.Lock()
		session = state.agentSession
		state.mu.Unlock()
	}
	return replyFooterModel(session, agent)
}

// ModelSwitchResult tells the agent what was queued, or why not.
type ModelSwitchResult struct {
	OK         bool          `json:"ok"`
	Model      string        `json:"model,omitempty"`
	Effort     string        `json:"effort,omitempty"`
	Message    string        `json:"message"`
	Candidates []ModelOption `json:"candidates,omitempty"`
}

// QueueModelSwitch validates the request and queues it for the session's next turn.
func (e *Engine) QueueModelSwitch(ctx context.Context, sessionKey, model, effort string, auto bool) ModelSwitchResult {
	agent := e.agent
	if auto {
		if e.tiers == nil {
			return ModelSwitchResult{Message: "this bot has no automatic model tiers configured"}
		}
		e.queueSwitch(sessionKey, pendingModelSwitch{auto: true})
		return ModelSwitchResult{OK: true, Message: fmt.Sprintf("from the next message, models are picked automatically again: chat %s, task %s", e.tiers.chatModel, e.tiers.taskModel)}
	}
	sw, canModel := agent.(ModelSwitcher)
	var options []ModelOption
	if canModel {
		options = sw.AvailableModels(ctx)
	}
	current := modelOf(agent)
	target := ""
	if model = strings.TrimSpace(model); model != "" {
		if !canModel {
			return ModelSwitchResult{Message: "this agent cannot switch models"}
		}
		if len(options) == 0 {
			return ModelSwitchResult{Message: e.i18n.T(MsgModelListUnavailable)}
		}
		var cands []ModelOption
		target, cands = resolveModelQuery(model, options)
		if target == "" {
			if len(cands) == 0 {
				cands = options
			}
			return ModelSwitchResult{Message: fmt.Sprintf("no unique model matches %q; pick an exact id from candidates (or ask the user)", model), Candidates: cands}
		}
	}
	eff := ""
	if effort = normEffort(effort); effort != "" {
		rs, ok := agent.(ReasoningEffortSwitcher)
		var levels []string
		if ok {
			levels = rs.AvailableReasoningEfforts()
		}
		switch {
		case ok && (containsFold(levels, effort) || len(levels) == 0 && agent.Name() != "acp"):
			eff = effort
		default:
			base := target
			if base == "" {
				base = current
			}
			if v := effortVariant(base, effort, options); v != "" {
				target = v // effort is part of the model id (Gemini "-high", Cursor "effort=high")
			} else if len(levels) > 0 {
				return ModelSwitchResult{Message: "supported reasoning efforts: " + strings.Join(levels, ", ")}
			} else {
				return ModelSwitchResult{Message: "this agent has no separate reasoning effort setting; switch to a model variant that carries the level instead"}
			}
		}
	}
	if target == "" && eff == "" {
		return ModelSwitchResult{Message: "nothing to change: give a model and/or --effort"}
	}
	e.queueSwitch(sessionKey, pendingModelSwitch{model: target, effort: eff})
	return ModelSwitchResult{OK: true, Model: target, Effort: eff,
		Message: "queued: takes effect from the user's next message (the conversation is kept)"}
}

func (e *Engine) queueSwitch(key string, p pendingModelSwitch) {
	e.modelSwitchMu.Lock()
	defer e.modelSwitchMu.Unlock()
	if e.pendingSwitch == nil {
		e.pendingSwitch = map[string]pendingModelSwitch{}
	}
	e.pendingSwitch[key] = p
	slog.Info("model switch queued", "session", key, "model", p.model, "effort", p.effort, "auto", p.auto)
}

// applyPendingSwitch runs before an idle turn starts. keys: the session's interactive key and
// its session key (CC_SESSION_KEY may be either).
func (e *Engine) applyPendingSwitch(interactiveKey string, keys ...string) {
	_ = e.applyPendingSwitchOnAgent(e.agent, interactiveKey, keys...)
}

func (e *Engine) applyPendingSwitchOnAgent(agent Agent, interactiveKey string, keys ...string) error {
	e.modelSwitchMu.Lock()
	var p pendingModelSwitch
	found := false
	for _, k := range append([]string{interactiveKey}, keys...) {
		if v, ok := e.pendingSwitch[k]; ok {
			p, found = v, true
			delete(e.pendingSwitch, k)
		}
	}
	e.modelSwitchMu.Unlock()
	if !found {
		return nil
	}
	if p.auto {
		if e.tiers != nil {
			e.tiers.clearManual(interactiveKey)
		}
		slog.Info("model switch applied", "session", interactiveKey, "auto", true)
		return nil
	}
	from := modelOf(agent)
	changed := false
	if p.model != "" && p.model != from {
		// Persist like /model does: a restart must not fall back to the config default.
		if _, err := e.switchModelOnAgent(agent, p.model, agent == e.agent); err != nil {
			slog.Warn("model switch failed", "session", interactiveKey, "model", p.model, "error", err)
			return err
		}
		changed = true
	}
	if p.effort != "" {
		if rs, ok := agent.(ReasoningEffortSwitcher); ok && rs.GetReasoningEffort() != p.effort {
			rs.SetReasoningEffort(p.effort)
			e.persistReasoningEffort(agent, p.effort)
			changed = true
		}
	}
	if e.tiers != nil {
		e.tiers.setManual(interactiveKey, manualTierHold)
	}
	if !changed {
		slog.Info("model switch: already on the requested model", "session", interactiveKey, "model", from)
		return nil // nothing to restart
	}
	// Applying a queued model is part of native compaction setup when called
	// from /compact; preserve its cancellation record while closing the reader.
	e.cleanupInteractiveState(interactiveKey, nil)
	e.sessions.Save()
	slog.Info("model switch applied", "session", interactiveKey, "from", from, "to", modelOf(agent), "effort", p.effort)
	return nil
}
