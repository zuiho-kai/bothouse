package core

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
)

func (e *Engine) cmdModel(p Platform, msg *Message, args []string) {
	agent, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	switcher, ok := agent.(ModelSwitcher)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgModelNotSupported))
		return
	}

	if len(args) == 0 {
		if !supportsCards(p) {
			fetchCtx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
			defer cancel()
			models := switcher.AvailableModels(fetchCtx)

			var sb strings.Builder
			current := e.currentSessionModel(msg.SessionKey, agent)
			if current == "" {
				sb.WriteString(e.i18n.T(MsgModelDefault))
			} else {
				sb.WriteString(e.i18n.Tf(MsgModelCurrent, current))
				sb.WriteString("\n")
			}
			sb.WriteString("\n")
			sb.WriteString(e.i18n.T(MsgModelListTitle))
			var buttons [][]ButtonOption
			var row []ButtonOption
			for i, m := range models {
				marker := "  "
				if m.Name == current {
					marker = "> "
				}
				var line string
				if m.Alias != "" {
					line = fmt.Sprintf("%s%d. %s - %s\n", marker, i+1, m.Alias, m.Name)
				} else {
					desc := m.Desc
					if desc != "" {
						desc = " — " + desc
					}
					line = fmt.Sprintf("%s%d. %s%s\n", marker, i+1, m.Name, desc)
				}
				sb.WriteString(line)

				label := m.Name
				if m.Alias != "" {
					label = m.Alias
				}
				if m.Name == current {
					label = "▶ " + label
				}
				row = append(row, ButtonOption{Text: label, Data: fmt.Sprintf("cmd:/model switch %d", i+1)})
				if len(row) >= 3 {
					buttons = append(buttons, row)
					row = nil
				}
			}
			if len(row) > 0 {
				buttons = append(buttons, row)
			}
			sb.WriteString("\n")
			sb.WriteString(e.i18n.T(MsgModelUsage))
			e.replyWithButtons(p, msg.ReplyCtx, sb.String(), buttons)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderModelCard(msg.SessionKey))
		return
	}

	targetInput, ok := parseModelSwitchArgs(args)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgModelUsage))
		return
	}

	target := strings.TrimSpace(targetInput)
	if modelSwitchNeedsLookup(target) {
		fetchCtx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
		defer cancel()
		models := switcher.AvailableModels(fetchCtx)
		target = resolveModelSwitchTarget(target, models)
	}

	target, err = e.selectSessionModel(msg.SessionKey, target)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgModelChangeFailed, err))
		return
	}
	e.cleanupInteractiveState(interactiveKey)
	// The switch is applied and the old session is gone, so the cooldown that was
	// waiting on the old model can release its messages (review P1).
	e.capacityRecover("channel model switch")

	// Keep the existing agent session ID so the next StartSession uses
	// --resume <id> --model <new>, which lets the CLI agent restore context
	// natively without replaying history (no extra token cost).
	sessions.Save()

	e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgModelChanged, target))
}

// resolveModelAlias resolves a user-supplied string to a model name.
// It first checks for an exact alias match, then falls back to the original value
// (which may be a direct model name).
func resolveModelAlias(models []ModelOption, input string) string {
	for _, m := range models {
		if m.Alias != "" && strings.EqualFold(m.Alias, input) {
			return m.Name
		}
	}
	return input
}

func resolveModelSwitchTarget(input string, models []ModelOption) string {
	input = strings.TrimSpace(input)
	if idx, err := strconv.Atoi(input); err == nil && idx >= 1 && idx <= len(models) {
		return models[idx-1].Name
	}
	if resolved := resolveModelAlias(models, input); resolved != input {
		return resolved
	}
	for _, m := range models {
		if strings.EqualFold(m.Name, input) {
			return m.Name
		}
	}
	return input
}

func modelSwitchNeedsLookup(input string) bool {
	input = strings.TrimSpace(input)
	if input == "" {
		return false
	}
	if _, err := strconv.Atoi(input); err == nil {
		return true
	}
	return !strings.Contains(input, "/")
}

func parseModelSwitchArgs(args []string) (string, bool) {
	if len(args) == 0 {
		return "", false
	}
	if len(args) == 1 {
		if strings.EqualFold(strings.TrimSpace(args[0]), "switch") {
			return "", false
		}
		return args[0], true
	}
	if strings.EqualFold(strings.TrimSpace(args[0]), "switch") && len(args) >= 2 {
		return strings.TrimSpace(args[1]), true
	}
	return "", false
}

// switchModel applies a runtime model selection to the global engine agent and
// persists the change so reloads keep the selected default.
func (e *Engine) switchModel(target string) (string, error) {
	return e.switchModelOnAgent(e.agent, target, true)
}

// switchModelOnAgent applies a runtime model selection to the provided agent.
// When persistConfig is true, config-backed model/provider changes are saved so
// reloads keep the new default. Workspace-scoped runtime switches pass false.
func (e *Engine) switchModelOnAgent(agent Agent, target string, persistConfig bool) (res string, err error) {
	switcher, ok := agent.(ModelSwitcher)
	if !ok {
		return target, nil
	}

	providerSwitcher, ok := agent.(ProviderSwitcher)
	if !ok {
		if persistConfig && e.modelSaveFunc != nil {
			if err := e.modelSaveFunc(target); err != nil {
				return "", fmt.Errorf("save model: %w", err)
			}
		}
		switcher.SetModel(target)
		return target, nil
	}
	active := providerSwitcher.GetActiveProvider()
	if active == nil {
		if persistConfig && e.modelSaveFunc != nil {
			if err := e.modelSaveFunc(target); err != nil {
				return "", fmt.Errorf("save model: %w", err)
			}
		}
		switcher.SetModel(target)
		return target, nil
	}

	providers := providerSwitcher.ListProviders()
	updated, found := SetProviderModel(providers, active.Name, target)
	if !found {
		switcher.SetModel(target)
		return target, nil
	}
	if !persistConfig {
		switcher.SetModel(target)
		return target, nil
	}
	if persistConfig && e.providerModelSaveFunc != nil {
		if err := e.providerModelSaveFunc(active.Name, target); err != nil {
			return "", fmt.Errorf("save provider model %q: %w", active.Name, err)
		}
	}
	providerSwitcher.SetProviders(updated)
	switcher.SetModel(target)
	providerSwitcher.SetActiveProvider(active.Name)
	return target, nil
}

func (e *Engine) cmdReasoning(p Platform, msg *Message, args []string) {
	agent, sessions, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	switcher, ok := agent.(ReasoningEffortSwitcher)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgReasoningNotSupported))
		return
	}

	if len(args) == 0 {
		if !supportsCards(p) {
			efforts := switcher.AvailableReasoningEfforts()

			var sb strings.Builder
			current := e.sessionEffortFor(msg.SessionKey, agent)
			if current == "" {
				sb.WriteString(e.i18n.T(MsgReasoningDefault))
			} else {
				sb.WriteString(e.i18n.Tf(MsgReasoningCurrent, current))
				sb.WriteString("\n")
			}
			sb.WriteString("\n")
			sb.WriteString(e.i18n.T(MsgReasoningListTitle))
			var buttons [][]ButtonOption
			var row []ButtonOption
			for i, effort := range efforts {
				marker := "  "
				if effort == current {
					marker = "> "
				}
				sb.WriteString(fmt.Sprintf("%s%d. %s\n", marker, i+1, effort))

				label := effort
				if effort == current {
					label = "▶ " + label
				}
				row = append(row, ButtonOption{Text: label, Data: fmt.Sprintf("cmd:/reasoning %d", i+1)})
				if len(row) >= 3 {
					buttons = append(buttons, row)
					row = nil
				}
			}
			if len(row) > 0 {
				buttons = append(buttons, row)
			}
			sb.WriteString("\n")
			sb.WriteString(e.i18n.T(MsgReasoningUsage))
			e.replyWithButtons(p, msg.ReplyCtx, sb.String(), buttons)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderReasoningCard(msg.SessionKey))
		return
	}

	efforts := switcher.AvailableReasoningEfforts()
	target := strings.ToLower(strings.TrimSpace(args[0]))
	if idx, err := strconv.Atoi(target); err == nil && idx >= 1 && idx <= len(efforts) {
		target = efforts[idx-1]
	}

	valid := false
	for _, effort := range efforts {
		if effort == target {
			valid = true
			break
		}
	}
	if !valid {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgReasoningUsage))
		return
	}

	if err := e.saveSessionSelection(msg.SessionKey, "", target); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	e.cleanupInteractiveState(e.interactiveKeyForSessionKey(msg.SessionKey))
	sessions.Save()

	e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgReasoningChanged, target))
}

func (e *Engine) cmdMode(p Platform, msg *Message, args []string) {
	agent, _, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	switcher, ok := agent.(ModeSwitcher)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgModeNotSupported))
		return
	}

	if len(args) == 0 {
		if !supportsCards(p) {
			current := switcher.GetMode()
			modes := switcher.PermissionModes()
			var sb strings.Builder
			zhLike := e.i18n.IsZhLike()
			for _, m := range modes {
				suffix := ""
				if m.Key == current {
					if zhLike {
						suffix = "（当前）"
					} else {
						suffix = " (current)"
					}
				}
				if zhLike {
					sb.WriteString(fmt.Sprintf("**%s**%s — %s\n", m.NameZh, suffix, m.DescZh))
				} else {
					sb.WriteString(fmt.Sprintf("**%s**%s — %s\n", m.Name, suffix, m.Desc))
				}
			}
			sb.WriteString(e.modeUsageText(modes))

			var buttons [][]ButtonOption
			var row []ButtonOption
			for _, m := range modes {
				label := m.Name
				if zhLike {
					label = m.NameZh
				}
				row = append(row, ButtonOption{Text: label, Data: "cmd:/mode " + m.Key})
				if len(row) >= 2 {
					buttons = append(buttons, row)
					row = nil
				}
			}
			if len(row) > 0 {
				buttons = append(buttons, row)
			}
			e.replyWithButtons(p, msg.ReplyCtx, sb.String(), buttons)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderModeCard())
		return
	}

	target := strings.ToLower(args[0])
	switcher.SetMode(target)
	newMode := switcher.GetMode()
	appliedLive := e.applyLiveModeChange(msg.SessionKey, newMode)

	if !appliedLive {
		e.cleanupInteractiveState(e.interactiveKeyForSessionKey(msg.SessionKey))
	}

	modes := switcher.PermissionModes()
	displayName := newMode
	zhLike := e.i18n.IsZhLike()
	for _, m := range modes {
		if m.Key == newMode {
			if zhLike {
				displayName = m.NameZh
			} else {
				displayName = m.Name
			}
			break
		}
	}
	reply := fmt.Sprintf(e.i18n.T(MsgModeChanged), displayName)
	if appliedLive {
		reply += "\n\n(Current session updated immediately.)"
	}
	e.reply(p, msg.ReplyCtx, reply)
}

func (e *Engine) modeUsageText(modes []PermissionModeInfo) string {
	keys := make([]string, 0, len(modes))
	for _, mode := range modes {
		keys = append(keys, "`"+mode.Key+"`")
	}
	return e.i18n.Tf(MsgModeUsage, strings.Join(keys, " / "))
}

func (e *Engine) applyLiveModeChange(sessionKey, mode string) bool {
	iKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()
	if !ok || state == nil {
		return false
	}
	state.mu.Lock()
	state.approveAll = isYoloModeStr(mode)
	state.mu.Unlock()
	if state.agentSession == nil || !state.agentSession.Alive() {
		return false
	}
	switcher, ok := state.agentSession.(LiveModeSwitcher)
	if !ok {
		return false
	}
	return switcher.SetLiveMode(mode)
}

func (e *Engine) cmdQuiet(p Platform, msg *Message, args []string) {
	// /quiet [full|compact|quiet]
	// Without argument: cycle full → quiet → compact → full.
	// With argument: set mode directly.
	var newMode string
	if len(args) > 0 {
		switch strings.ToLower(args[0]) {
		case "full", "compact", "quiet":
			newMode = strings.ToLower(args[0])
		default:
			e.reply(p, msg.ReplyCtx, "Usage: /quiet [full|compact|quiet]")
			return
		}
	} else {
		switch e.display.Mode {
		case "full", "":
			newMode = "quiet"
		case "quiet":
			newMode = "compact"
		default: // "compact" or unknown
			newMode = "full"
		}
	}

	e.display.Mode = newMode
	switch newMode {
	case "compact", "quiet":
		e.display.ThinkingMessages = false
		e.display.ToolMessages = false
	default:
		e.display.ThinkingMessages = true
		e.display.ToolMessages = true
	}

	if e.displaySaveFunc != nil {
		tm := e.display.ThinkingMessages
		tool := e.display.ToolMessages
		if err := e.displaySaveFunc(&newMode, &tm, nil, nil, &tool); err != nil {
			slog.Error("failed to persist display config after /quiet", "error", err)
		}
	}

	switch newMode {
	case "quiet":
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgQuietOn))
	case "compact":
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDisplayModeCompact))
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgQuietOff))
	}
}

func (e *Engine) cmdTTS(p Platform, msg *Message, args []string) {
	if e.tts == nil || !e.tts.Enabled || e.tts.TTS == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTTSNotEnabled))
		return
	}
	if len(args) == 0 {
		providerStr := e.tts.Provider
		if providerStr == "" {
			providerStr = "unknown"
		}
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTTSStatus), e.tts.GetTTSMode(), providerStr))
		return
	}
	switch args[0] {
	case "always", "voice_only":
		mode := args[0]
		e.tts.SetTTSMode(mode)
		if e.ttsSaveFunc != nil {
			if err := e.ttsSaveFunc(mode); err != nil {
				slog.Warn("tts: failed to persist mode", "error", err)
			}
		}
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTTSSwitched), mode))
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTTSUsage))
	}
}
