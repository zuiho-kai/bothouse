package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

func (e *Engine) cmdAllow(p Platform, msg *Message, args []string) {
	agent, _, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	if len(args) == 0 {
		if auth, ok := agent.(ToolAuthorizer); ok {
			tools := auth.GetAllowedTools()
			if len(tools) == 0 {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgNoToolsAllowed))
			} else {
				e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCurrentTools), strings.Join(tools, ", ")))
			}
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgToolAuthNotSupported))
		}
		return
	}

	toolName := strings.TrimSpace(args[0])
	if auth, ok := agent.(ToolAuthorizer); ok {
		if err := auth.AddAllowedTools(toolName); err != nil {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgToolAllowFailed), err))
			return
		}
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgToolAllowedNew), toolName))
	} else {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgToolAuthNotSupported))
	}
}

func (e *Engine) cmdProvider(p Platform, msg *Message, args []string) {
	agent, sessions, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	switcher, ok := agent.(ProviderSwitcher)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderNotSupported))
		return
	}

	if len(args) == 0 {
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderProviderCard())
			return
		}

		current := switcher.GetActiveProvider()
		providers := switcher.ListProviders()
		if current == nil && len(providers) == 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderNone))
			return
		}

		var sb strings.Builder
		if current != nil {
			sb.WriteString(fmt.Sprintf(e.i18n.T(MsgProviderCurrent), current.Name))
			sb.WriteString("\n\n")
		}
		sb.WriteString(e.i18n.T(MsgProviderListTitle))
		for _, prov := range providers {
			marker := "  "
			if current != nil && prov.Name == current.Name {
				marker = "▶ "
			}
			detail := prov.Name
			if prov.BaseURL != "" {
				detail += " (" + prov.BaseURL + ")"
			}
			if prov.Model != "" {
				detail += " [" + prov.Model + "]"
			}
			sb.WriteString(fmt.Sprintf("%s%s\n", marker, detail))
		}
		sb.WriteString("\n" + e.i18n.T(MsgProviderSwitchHint))
		e.reply(p, msg.ReplyCtx, sb.String())
		return
	}

	sub := matchSubCommand(strings.ToLower(args[0]), []string{
		"list", "add", "remove", "switch", "current", "clear", "reset", "none",
	})
	switch sub {
	case "list":
		providers := switcher.ListProviders()
		if len(providers) == 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderListEmpty))
			return
		}
		current := switcher.GetActiveProvider()
		var sb strings.Builder
		sb.WriteString(e.i18n.T(MsgProviderListTitle))
		for _, prov := range providers {
			marker := "  "
			if current != nil && prov.Name == current.Name {
				marker = "▶ "
			}
			detail := prov.Name
			if prov.BaseURL != "" {
				detail += " (" + prov.BaseURL + ")"
			}
			if prov.Model != "" {
				detail += " [" + prov.Model + "]"
			}
			sb.WriteString(fmt.Sprintf("%s%s\n", marker, detail))
		}
		sb.WriteString("\n" + e.i18n.T(MsgProviderSwitchHint))
		e.reply(p, msg.ReplyCtx, sb.String())

	case "add":
		e.cmdProviderAdd(p, msg, switcher, args[1:])

	case "remove", "rm", "delete":
		e.cmdProviderRemove(p, msg, switcher, args[1:])

	case "switch":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, "Usage: /provider switch <name>")
			return
		}
		e.switchProvider(p, msg, sessions, switcher, args[1])

	case "current":
		current := switcher.GetActiveProvider()
		if current == nil {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderNone))
			return
		}
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderCurrent), current.Name))

	case "clear", "reset", "none":
		switcher.SetActiveProvider("")
		e.cleanupInteractiveState(e.interactiveKeyForSessionKey(msg.SessionKey))
		{
			s := sessions.GetOrCreateActive(msg.SessionKey)
			s.SetAgentSessionID("", "")
			s.ClearHistory()
			s.SetActiveProvider("")
			sessions.Save()
		}
		// Only persist to global config when operating on the global agent;
		// in workspace mode the provider state lives on the per-workspace agent.
		if sessions == e.sessions && e.providerSaveFunc != nil {
			if err := e.providerSaveFunc(""); err != nil {
				slog.Error("failed to save provider", "error", err)
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderCleared))

	default:
		e.switchProvider(p, msg, sessions, switcher, args[0])
	}
}

func (e *Engine) cmdProviderAdd(p Platform, msg *Message, switcher ProviderSwitcher, args []string) {
	if len(args) == 0 {
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderProviderAddCard(msg.SessionKey))
			return
		}
		if _, ok := p.(InlineButtonSender); ok {
			if btns := e.providerAddPresetButtons(); len(btns) > 0 {
				e.replyWithButtons(p, msg.ReplyCtx,
					e.i18n.T(MsgProviderAddPickHint), btns)
				return
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderAddUsage))
		return
	}

	// "/provider add <preset_name>" (1 arg) — check if it matches a preset
	if len(args) == 1 {
		if e.tryProviderAddPreset(p, msg, switcher, args[0]) {
			return
		}
	}

	var prov ProviderConfig

	// Join args back; detect JSON (starts with '{') vs positional
	raw := strings.Join(args, " ")
	raw = strings.TrimSpace(raw)

	if strings.HasPrefix(raw, "{") {
		// JSON format: /provider add {"name":"relay","api_key":"sk-xxx",...}
		var jp struct {
			Name    string            `json:"name"`
			APIKey  string            `json:"api_key"`
			BaseURL string            `json:"base_url"`
			Model   string            `json:"model"`
			Env     map[string]string `json:"env"`
		}
		if err := json.Unmarshal([]byte(raw), &jp); err != nil {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAddFailed), "invalid JSON: "+err.Error()))
			return
		}
		if jp.Name == "" {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAddFailed), "\"name\" is required"))
			return
		}
		prov = ProviderConfig{Name: jp.Name, APIKey: jp.APIKey, BaseURL: jp.BaseURL, Model: jp.Model, Env: jp.Env}
	} else {
		// Positional: /provider add <name> <api_key> [base_url] [model]
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderAddUsage))
			return
		}
		prov.Name = args[0]
		prov.APIKey = args[1]
		if len(args) > 2 {
			prov.BaseURL = args[2]
		}
		if len(args) > 3 {
			prov.Model = args[3]
		}
	}

	// Check for duplicates
	for _, existing := range switcher.ListProviders() {
		if existing.Name == prov.Name {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAddFailed), fmt.Sprintf("provider %q already exists", prov.Name)))
			return
		}
	}

	// Add to runtime
	updated := append(switcher.ListProviders(), prov)
	switcher.SetProviders(updated)

	// Persist to config
	if e.providerAddSaveFunc != nil {
		if err := e.providerAddSaveFunc(prov); err != nil {
			slog.Error("failed to persist provider", "error", err)
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAdded), prov.Name, prov.Name))
}

func (e *Engine) cmdProviderRemove(p Platform, msg *Message, switcher ProviderSwitcher, args []string) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, "Usage: /provider remove <name>")
		return
	}
	name := args[0]

	providers := switcher.ListProviders()
	found := false
	var remaining []ProviderConfig
	for _, prov := range providers {
		if prov.Name == name {
			found = true
		} else {
			remaining = append(remaining, prov)
		}
	}

	if !found {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderNotFound), name))
		return
	}

	// If removing the active provider, clear it
	active := switcher.GetActiveProvider()
	switcher.SetProviders(remaining)
	if active != nil && active.Name == name {
		// No active provider after removal
		slog.Info("removed active provider, clearing selection", "name", name)
	}

	// Persist
	if e.providerRemoveSaveFunc != nil {
		if err := e.providerRemoveSaveFunc(name); err != nil {
			slog.Error("failed to persist provider removal", "error", err)
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderRemoved), name))
}

// resetAllSessions resets the agent session ID and clears history for all
// active sessions. Used when the provider changes via the management API
// (where there is no single session key context).
func (e *Engine) resetAllSessions() {
	for _, s := range e.sessions.AllSessions() {
		s.SetAgentSessionID("", "")
		s.ClearHistory()
	}
	e.sessions.Save()
}

func (e *Engine) switchProvider(p Platform, msg *Message, sessions *SessionManager, switcher ProviderSwitcher, name string) {
	if !switcher.SetActiveProvider(name) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderNotFound), name))
		return
	}
	e.cleanupInteractiveState(e.interactiveKeyForSessionKey(msg.SessionKey))

	s := sessions.GetOrCreateActive(msg.SessionKey)
	s.SetAgentSessionID("", "")
	s.ClearHistory()
	// Persist the provider choice so that a subsequent --resume after a
	// cc-connect process restart can re-bind the agent's activeIdx; without
	// this the agent reverts to its default provider while the saved
	// agent_session_id keeps the conversation going, producing "model X
	// does not exist" errors against the wrong base_url. See cc-connect
	// internal task t-20260614-qp7xnl.
	s.SetActiveProvider(name)
	sessions.Save()

	// Only persist to global config when operating on the global agent;
	// in workspace mode the provider state lives on the per-workspace agent.
	if sessions == e.sessions && e.providerSaveFunc != nil {
		if err := e.providerSaveFunc(name); err != nil {
			slog.Error("failed to save provider", "error", err)
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderSwitched), name))
}

// handlePendingProviderAdd checks for a pending provider add state (from the
// card-driven add flow) and completes the add if the user sends the required input.
func (e *Engine) handlePendingProviderAdd(p Platform, msg *Message, content string, interactiveKey string) bool {
	if strings.HasPrefix(content, "/") {
		return false
	}
	if interactiveKey == "" {
		interactiveKey = e.interactiveKeyForSessionKey(msg.SessionKey)
	}
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return false
	}
	state.mu.Lock()
	pa := state.pendingProviderAdd
	if pa == nil {
		state.mu.Unlock()
		return false
	}
	paCopy := *pa
	state.pendingProviderAdd = nil
	state.mu.Unlock()

	switcher, ok := e.agent.(ProviderSwitcher)
	if !ok {
		return false
	}

	var prov ProviderConfig
	switch paCopy.phase {
	case "preset":
		apiKey := strings.TrimSpace(content)
		if apiKey == "" {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderAddUsage))
			return true
		}
		prov = ProviderConfig{
			Name:             paCopy.name,
			APIKey:           apiKey,
			BaseURL:          paCopy.baseURL,
			Model:            paCopy.model,
			CodexWireAPI:     paCopy.codexWireAPI,
			CodexHTTPHeaders: paCopy.codexHTTPHeaders,
		}
	case "other":
		fields := strings.Fields(content)
		if len(fields) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgProviderAddUsage))
			return true
		}
		prov.Name = fields[0]
		prov.APIKey = fields[1]
		if len(fields) > 2 {
			prov.BaseURL = fields[2]
		}
		if len(fields) > 3 {
			prov.Model = fields[3]
		}
	default:
		return false
	}

	for _, existing := range switcher.ListProviders() {
		if existing.Name == prov.Name {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAddFailed), fmt.Sprintf("provider %q already exists", prov.Name)))
			return true
		}
	}

	updated := append(switcher.ListProviders(), prov)
	switcher.SetProviders(updated)
	if e.providerAddSaveFunc != nil {
		if err := e.providerAddSaveFunc(prov); err != nil {
			slog.Error("failed to persist provider", "error", err)
		}
	}
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgProviderAdded), prov.Name, prov.Name))
	return true
}

// setPendingProviderAdd stores a pending provider add state for the card-driven flow.
func (e *Engine) setPendingProviderAdd(sessionKey string, pa *pendingProviderAddState) {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[interactiveKey]
	if !ok {
		state = &interactiveState{}
		e.interactiveStates[interactiveKey] = state
	}
	e.interactiveMu.Unlock()
	state.mu.Lock()
	state.pendingProviderAdd = pa
	state.mu.Unlock()
}

// getPendingProviderAdd retrieves pending provider add state without removing it.
func (e *Engine) getPendingProviderAdd(sessionKey string) *pendingProviderAddState {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return nil
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.pendingProviderAdd == nil {
		return nil
	}
	cp := *state.pendingProviderAdd
	return &cp
}

// providerAddPresetButtons builds inline keyboard rows for platforms
// that support InlineButtonSender but not full cards.
func (e *Engine) providerAddPresetButtons() [][]ButtonOption {
	agentType := e.agent.Name()
	presets, err := FetchProviderPresets()
	if err != nil || presets == nil || len(presets.Providers) == 0 {
		return nil
	}
	var rows [][]ButtonOption
	var row []ButtonOption
	for _, preset := range presets.Providers {
		if !preset.SupportsAgent(agentType) {
			continue
		}
		row = append(row, ButtonOption{
			Text: preset.DisplayName,
			Data: "cmd:/provider add " + preset.Name,
		})
		if len(row) == 2 {
			rows = append(rows, row)
			row = nil
		}
	}
	if len(row) > 0 {
		rows = append(rows, row)
	}
	return rows
}

// tryProviderAddPreset handles "/provider add <name>" with a single arg that
// matches a preset name — sets up the pending API key flow.
func (e *Engine) tryProviderAddPreset(p Platform, msg *Message, switcher ProviderSwitcher, presetName string) bool {
	agentType := e.agent.Name()
	presets, err := FetchProviderPresets()
	if err != nil || presets == nil {
		return false
	}
	for _, preset := range presets.Providers {
		if preset.Name != presetName {
			continue
		}
		ac := preset.AgentConfig(agentType)
		if ac == nil {
			continue
		}
		pa := &pendingProviderAddState{
			phase:     "preset",
			name:      preset.Name,
			baseURL:   ac.BaseURL,
			model:     ac.Model,
			inviteURL: preset.InviteURL,
		}
		if ac.CodexConfig != nil {
			pa.codexWireAPI = ac.CodexConfig.WireAPI
			pa.codexHTTPHeaders = ac.CodexConfig.HTTPHeaders
		}
		e.setPendingProviderAdd(msg.SessionKey, pa)
		displayName := preset.DisplayName
		if displayName == "" {
			displayName = preset.Name
		}
		prompt := fmt.Sprintf(e.i18n.T(MsgProviderAddApiKeyPrompt), displayName)
		if preset.InviteURL != "" {
			prompt += "\n\n" + fmt.Sprintf(e.i18n.T(MsgProviderAddInviteHint), preset.InviteURL)
		}
		e.reply(p, msg.ReplyCtx, prompt)
		return true
	}
	return false
}
