package acp

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: model and reasoning-effort switching for ACP agents.
//
// ACP servers advertise these differently, so the session records what it saw and picks the
// matching call:
//   - Cursor (`agent acp`): a "models" block → session/set_model; effort is part of the model id.
//   - Grok (`grok agent stdio`): "models" → session/set_model, plus a "reasoning_effort" config
//     option → session/set_config_option.
//   - dsh (DeepSeek): only a "model" config option (values like ["provider","model"]) →
//     session/set_config_option.

type acpModelsBlock struct {
	CurrentModelID  string `json:"currentModelId"`
	AvailableModels []struct {
		ModelID     string `json:"modelId"`
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"availableModels"`
}

type acpConfigChoice struct {
	Value       string            `json:"value"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Group       string            `json:"group"`
	Options     []acpConfigChoice `json:"options"` // grouped selects nest their choices
}

type acpConfigOption struct {
	ID           string            `json:"id"`
	Category     string            `json:"category"`
	CurrentValue json.RawMessage   `json:"currentValue"`
	Options      []acpConfigChoice `json:"options"`
}

// acpModelInfo is what one session/new (or session/load) told us.
type acpModelInfo struct {
	viaSetModel  bool // models block present → session/set_model
	viaConfig    bool // "model" config option present → session/set_config_option
	effortConfig string
	models       []core.ModelOption
	efforts      []string
	currentModel string
	currentEff   string
}

type modelInfoReporter interface {
	reportModelInfo(info acpModelInfo)
}

func flattenChoices(in []acpConfigChoice, group string) []acpConfigChoice {
	var out []acpConfigChoice
	for _, c := range in {
		if len(c.Options) > 0 {
			g := c.Name
			if g == "" {
				g = c.Group
			}
			out = append(out, flattenChoices(c.Options, g)...)
			continue
		}
		if c.Value == "" {
			continue
		}
		if c.Group == "" {
			c.Group = group
		}
		out = append(out, c)
	}
	return out
}

func rawString(r json.RawMessage) string {
	var s string
	if json.Unmarshal(r, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(r))
}

func parseModelInfo(models *acpModelsBlock, opts []acpConfigOption) acpModelInfo {
	var info acpModelInfo
	if models != nil && len(models.AvailableModels) > 0 {
		info.viaSetModel = true
		info.currentModel = models.CurrentModelID
		for _, m := range models.AvailableModels {
			info.models = append(info.models, core.ModelOption{Name: m.ModelID, Alias: m.Name, Desc: m.Description})
		}
	}
	for _, o := range opts {
		switch {
		case o.ID == "model" || o.Category == "model":
			if info.viaSetModel {
				continue // prefer set_model when both are advertised
			}
			info.viaConfig = true
			info.currentModel = rawString(o.CurrentValue)
			for _, c := range flattenChoices(o.Options, "") {
				label := strings.TrimSpace(c.Group + " " + c.Name)
				info.models = append(info.models, core.ModelOption{Name: c.Value, Alias: label, Desc: c.Description})
			}
		case o.ID == "reasoning_effort" || o.Category == "thought_level":
			info.effortConfig = o.ID
			info.currentEff = rawString(o.CurrentValue)
			for _, c := range flattenChoices(o.Options, "") {
				info.efforts = append(info.efforts, c.Value)
			}
		}
	}
	return info
}

// absorbModelInfo keeps what the server advertised and hands it to the parent agent.
func (s *acpSession) absorbModelInfo(models *acpModelsBlock, opts []acpConfigOption) {
	info := parseModelInfo(models, opts)
	s.modelInfo = info
	if r, ok := s.callbacks.(modelInfoReporter); ok {
		r.reportModelInfo(info)
	}
}

// applyModel selects model on the live session with whichever call this server supports.
func (s *acpSession) applyModel(model string) {
	model = strings.TrimSpace(model)
	if model == "" {
		return
	}
	sid := s.currentACPSessionID()
	var err error
	var res json.RawMessage
	switch {
	case s.modelInfo.viaSetModel:
		res, err = s.tr.call(s.ctx, "session/set_model", map[string]any{"sessionId": sid, "modelId": model})
	case s.modelInfo.viaConfig:
		res, err = s.tr.call(s.ctx, "session/set_config_option", map[string]any{"sessionId": sid, "configId": "model", "value": model})
	default:
		slog.Warn("acp: model configured but this agent advertises no way to select one", "model", model)
		return
	}
	if err != nil {
		slog.Warn("acp: model could not be applied", "model", model, "session_id", sid, "error", err)
		return
	}
	slog.Info("acp: model applied", "model", model, "session_id", sid, "reported", reportedValue(res, "model"))
}

// reportedValue pulls the server's current value for configID out of a set_config_option reply.
func reportedValue(res json.RawMessage, configID string) string {
	var r struct {
		ConfigOptions []acpConfigOption `json:"configOptions"`
	}
	if json.Unmarshal(res, &r) != nil {
		return ""
	}
	for _, o := range r.ConfigOptions {
		if o.ID == configID {
			return rawString(o.CurrentValue)
		}
	}
	return ""
}

// applyEffort sets reasoning effort when the server exposes it as a config option.
func (s *acpSession) applyEffort(effort string) {
	effort = strings.TrimSpace(effort)
	if effort == "" {
		return
	}
	if s.modelInfo.effortConfig == "" {
		slog.Warn("acp: reasoning effort configured but this agent has no such option", "effort", effort)
		return
	}
	sid := s.currentACPSessionID()
	res, err := s.tr.call(s.ctx, "session/set_config_option", map[string]any{
		"sessionId": sid, "configId": s.modelInfo.effortConfig, "value": effort,
	})
	if err != nil {
		slog.Warn("acp: reasoning effort could not be applied", "effort", effort, "session_id", sid, "error", err)
		return
	}
	slog.Info("acp: reasoning effort applied", "effort", effort, "session_id", sid, "reported", reportedValue(res, s.modelInfo.effortConfig))
}

// --- Agent side: core.ModelSwitcher and core.ReasoningEffortSwitcher ---

func (a *Agent) reportModelInfo(info acpModelInfo) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(info.models) > 0 {
		a.modelOptions = info.models
	}
	a.effortOptions = info.efforts
	if a.model == "" {
		a.advertisedModel = info.currentModel
	}
	if a.effort == "" {
		a.advertisedEffort = info.currentEff
	}
}

// SetModel takes effect on the next session (the engine restarts the agent process after a switch).
func (a *Agent) SetModel(model string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.model = strings.TrimSpace(model)
	slog.Info("acp: model changed", "model", a.model)
}

func (a *Agent) GetModel() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.model != "" {
		return a.model
	}
	return a.advertisedModel
}

// AvailableModels returns what the server advertised in the last session handshake. Right after
// start-up nothing has been seen yet, so it starts a throwaway session to ask (a few seconds;
// Cursor takes ~10s because it authenticates first).
func (a *Agent) AvailableModels(ctx context.Context) []core.ModelOption {
	a.mu.RLock()
	cached := append([]core.ModelOption(nil), a.modelOptions...)
	a.mu.RUnlock()
	if len(cached) > 0 {
		return cached
	}
	s, err := a.StartSession(ctx, "")
	if err != nil {
		slog.Warn("acp: could not probe available models", "error", err)
		return nil
	}
	_ = s.Close()
	a.mu.RLock()
	defer a.mu.RUnlock()
	return append([]core.ModelOption(nil), a.modelOptions...)
}

func (a *Agent) SetReasoningEffort(effort string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.effort = strings.TrimSpace(effort)
	slog.Info("acp: reasoning effort changed", "effort", a.effort)
}

func (a *Agent) GetReasoningEffort() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.effort != "" {
		return a.effort
	}
	return a.advertisedEffort
}

// AvailableReasoningEfforts is empty for servers that don't expose effort (e.g. Cursor, where
// effort is baked into the model id).
func (a *Agent) AvailableReasoningEfforts() []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return append([]string(nil), a.effortOptions...)
}

var (
	_ core.ModelSwitcher           = (*Agent)(nil)
	_ core.ReasoningEffortSwitcher = (*Agent)(nil)
)
