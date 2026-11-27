package core

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────────────────────
// Card navigation (in-place card updates)
// ──────────────────────────────────────────────────────────────

// handleCardNav is called by platforms that support in-place card updates.
// It routes nav: and act: prefixed actions to the appropriate render function.
func (e *Engine) handleCardNav(action string, sessionKey string) *Card {
	var prefix, body string
	if i := strings.Index(action, ":"); i >= 0 {
		prefix = action[:i]
		body = action[i+1:]
	} else {
		return nil
	}

	cmd, args := body, ""
	if i := strings.IndexByte(body, ' '); i >= 0 {
		cmd = body[:i]
		args = strings.TrimSpace(body[i+1:])
	}

	if prefix == "act" && cmd == "/model" {
		return e.handleModelCardAction(args, sessionKey)
	}

	if prefix == "act" {
		e.executeCardAction(cmd, args, sessionKey)
	}

	switch cmd {
	case "/help":
		return e.renderHelpGroupCard(args)
	case "/model":
		return e.renderModelCard(sessionKey)
	case "/reasoning":
		return e.renderReasoningCard(sessionKey)
	case "/mode":
		return e.renderModeCard()
	case "/lang":
		return e.renderLangCard()
	case "/status":
		return e.renderStatusCard(sessionKey, extractUserID(sessionKey))
	case "/list":
		page := 1
		if args != "" {
			if n, err := strconv.Atoi(args); err == nil && n > 0 {
				page = n
			}
		}
		return e.renderListCardSafe(sessionKey, page)
	case "/dir":
		page := 1
		if args != "" {
			if n, err := strconv.Atoi(args); err == nil && n > 0 {
				page = n
			}
		}
		return e.renderDirCardSafe(sessionKey, page)
	case "/current":
		return e.renderCurrentCard(sessionKey)
	case "/history":
		return e.renderHistoryCard(sessionKey)
	case "/provider":
		return e.renderProviderCard()
	case "/provider/add", "/provider/add-other", "/provider/add-cancel":
		return e.renderProviderAddCard(sessionKey)
	case "/cron":
		return e.renderCronCard(sessionKey, extractUserID(sessionKey))
	case "/timer":
		return e.renderTimerCard(sessionKey, extractUserID(sessionKey))
	case "/heartbeat":
		return e.renderHeartbeatCard()
	case "/commands":
		return e.renderCommandsCard()
	case "/alias":
		return e.renderAliasCard()
	case "/config":
		return e.renderConfigCard()
	case "/skills":
		return e.renderSkillsCard()
	case "/doctor":
		return e.renderDoctorCard()
	case "/whoami":
		return e.renderWhoamiCard(&Message{
			SessionKey: sessionKey,
			UserID:     extractUserID(sessionKey),
			Platform:   extractPlatformName(sessionKey),
		})
	case "/version":
		return e.renderVersionCard()
	case "/new":
		return e.renderCurrentCard(sessionKey)
	case "/switch":
		return e.renderListCardSafe(sessionKey, 1)
	case "/delete-mode":
		if strings.HasPrefix(args, "cancel") {
			return e.renderListCardSafe(sessionKey, 1)
		}
		return e.renderDeleteModeCard(sessionKey)
	case "/stop":
		return e.renderStatusCard(sessionKey, extractUserID(sessionKey))
	case "/upgrade":
		return e.renderUpgradeCard()
	}
	return nil
}

func (e *Engine) handleModelCardAction(args, sessionKey string) *Card {
	agent, sessions := e.sessionContextForKey(sessionKey)
	switcher, ok := agent.(ModelSwitcher)
	if !ok {
		return e.simpleCard(e.i18n.T(MsgCardTitleModel), "indigo", e.i18n.T(MsgModelNotSupported))
	}

	target, ok := parseModelSwitchArgs(strings.Fields(args))
	if !ok {
		return e.renderModelCard(sessionKey)
	}
	target = strings.TrimSpace(target)
	if modelSwitchNeedsLookup(target) {
		fetchCtx, cancel := context.WithTimeout(e.ctx, 3*time.Second)
		models := switcher.AvailableModels(fetchCtx)
		target = resolveModelSwitchTarget(target, models)
		cancel()
	}

	resolved, err := e.selectSessionModel(sessionKey, target)
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	if err == nil {
		e.cleanupInteractiveState(interactiveKey)
		sessions.Save()
	}

	return e.renderModelSwitchResultCard(resolved, err)
}

// executeCardAction performs the side-effect for act: prefixed actions
// (e.g. switching model/mode/lang) before the card is re-rendered.
func (e *Engine) executeCardAction(cmd, args, sessionKey string) {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)

	switch cmd {
	case "/model":
		if args == "" {
			return
		}
		agent, sessions := e.sessionContextForKey(sessionKey)
		switcher, ok := agent.(ModelSwitcher)
		if !ok {
			return
		}
		fetchCtx, cancel := context.WithTimeout(e.ctx, 3*time.Second)
		target, ok := parseModelSwitchArgs(strings.Fields(args))
		if !ok {
			cancel()
			return
		}
		target = strings.TrimSpace(target)
		if modelSwitchNeedsLookup(target) {
			models := switcher.AvailableModels(fetchCtx)
			target = resolveModelSwitchTarget(target, models)
		}
		cancel()
		e.cleanupInteractiveState(interactiveKey)
		e.interactiveMu.Lock()
		state := e.interactiveStates[interactiveKey]
		if state == nil {
			state = &interactiveState{}
			e.interactiveStates[interactiveKey] = state
		}
		e.interactiveMu.Unlock()
		state.mu.Lock()
		state.modelSwitch = &modelSwitchState{phase: "switching", target: target}
		state.mu.Unlock()
		go e.performModelSwitchAsync(sessionKey, state, agent, sessions, target)

	case "/reasoning":
		if args == "" {
			return
		}
		agent, sessions := e.sessionContextForKey(sessionKey)
		switcher, ok := agent.(ReasoningEffortSwitcher)
		if !ok {
			return
		}
		efforts := switcher.AvailableReasoningEfforts()
		target := strings.ToLower(strings.TrimSpace(args))
		if idx, err := strconv.Atoi(target); err == nil && idx >= 1 && idx <= len(efforts) {
			target = efforts[idx-1]
		}
		for _, effort := range efforts {
			if effort == target {
				if err := e.saveSessionSelection(sessionKey, "", target); err != nil {
					slog.Error("reasoning selection failed", "session", sessionKey, "error", err)
					return
				}
				e.cleanupInteractiveState(interactiveKey)
				sessions.Save()
				return
			}
		}

	case "/mode":
		if args == "" {
			return
		}
		switcher, ok := e.agent.(ModeSwitcher)
		if !ok {
			return
		}
		newMode := strings.ToLower(args)
		switcher.SetMode(newMode)
		if e.applyLiveModeChange(sessionKey, switcher.GetMode()) {
			e.cleanupInteractiveState(interactiveKey)
			return
		}
		e.cleanupInteractiveState(interactiveKey)
		// Mode change requires a new session to take effect
		s := e.sessions.GetOrCreateActive(sessionKey)
		s.SetAgentSessionID("", "")
		s.ClearHistory()
		e.sessions.Save()

	case "/lang":
		if args == "" {
			return
		}
		target := strings.ToLower(strings.TrimSpace(args))
		var lang Language
		switch target {
		case "en", "english":
			lang = LangEnglish
		case "zh", "cn", "chinese":
			lang = LangChinese
		case "zh-tw", "zh_tw", "zhtw":
			lang = LangTraditionalChinese
		case "ja", "jp", "japanese":
			lang = LangJapanese
		case "es", "spanish":
			lang = LangSpanish
		case "auto":
			lang = LangAuto
		default:
			return
		}
		e.i18n.SetLang(lang)

	case "/provider":
		if args == "" {
			return
		}
		switcher, ok := e.agent.(ProviderSwitcher)
		if !ok {
			return
		}
		provName := args
		if provName == "clear" {
			provName = ""
		}
		if switcher.SetActiveProvider(provName) {
			e.cleanupInteractiveState(interactiveKey)
			s := e.sessions.GetOrCreateActive(sessionKey)
			s.SetAgentSessionID("", "")
			s.ClearHistory()
			e.sessions.Save()
			if e.providerSaveFunc != nil {
				_ = e.providerSaveFunc(provName)
			}
		}

	case "/provider/add":
		if args == "" {
			return
		}
		agentType := e.agent.Name()
		presets, err := FetchProviderPresets()
		if err != nil || presets == nil {
			return
		}
		for _, preset := range presets.Providers {
			if preset.Name != args {
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
			e.setPendingProviderAdd(sessionKey, pa)
			return
		}

	case "/provider/add-other":
		e.setPendingProviderAdd(sessionKey, &pendingProviderAddState{
			phase: "other",
		})

	case "/provider/add-cancel":
		e.setPendingProviderAdd(sessionKey, nil)

	case "/provider/link":
		e.executeProviderLink(sessionKey, args)

	case "/new":
		_, sessions := e.sessionContextForKey(sessionKey)
		e.cleanupInteractiveState(interactiveKey)
		sessions.NewSession(sessionKey, "")

	case "/delete-mode":
		e.executeDeleteModeAction(sessionKey, args)

	case "/switch":
		if args == "" {
			return
		}
		agent, sessions := e.sessionContextForKey(sessionKey)
		agentSessions, err := agent.ListSessions(e.ctx)
		if err != nil || len(agentSessions) == 0 {
			return
		}
		agentSessions = e.applySessionFilter(agentSessions, sessions)
		matched := e.matchSession(agentSessions, sessions, args)
		if matched == nil {
			return
		}
		e.cleanupInteractiveState(interactiveKey)
		session := sessions.SwitchToAgentSession(sessionKey, matched.ID, agent.Name(), matched.Summary)
		session.ClearHistory()

	case "/dir":
		fields := strings.Fields(args)
		if len(fields) == 0 {
			return
		}
		agent, sessions := e.sessionContextForKey(sessionKey)
		ik := e.interactiveKeyForSessionKey(sessionKey)
		var applyArgs []string
		switch fields[0] {
		case "select":
			if len(fields) < 2 {
				return
			}
			applyArgs = []string{fields[1]}
		case "reset":
			applyArgs = []string{"reset"}
		case "prev":
			applyArgs = []string{"-"}
		default:
			return
		}
		errMsg, _ := e.dirApply(agent, sessions, ik, sessionKey, applyArgs)
		if errMsg != "" {
			slog.Debug("dir card action failed", "message", errMsg)
		}

	case "/stop":
		e.stopInteractiveSession(interactiveKey, nil, nil)

	case "/heartbeat":
		if e.heartbeatScheduler == nil {
			return
		}
		switch args {
		case "pause", "stop":
			e.heartbeatScheduler.Pause(e.name)
		case "resume", "start":
			e.heartbeatScheduler.Resume(e.name)
		case "run", "trigger":
			e.heartbeatScheduler.TriggerNow(e.name)
		}

	case "/cron":
		if e.cronScheduler == nil || args == "" {
			return
		}
		subArgs := strings.Fields(args)
		if len(subArgs) < 2 {
			return
		}
		sub, id := subArgs[0], subArgs[1]
		switch sub {
		case "enable":
			if err := e.cronScheduler.EnableJob(id); err != nil {
				slog.Error("cron: enable job failed", "id", id, "error", err)
			}
		case "disable":
			if err := e.cronScheduler.DisableJob(id); err != nil {
				slog.Error("cron: disable job failed", "id", id, "error", err)
			}
		case "delete":
			e.cronScheduler.RemoveJob(id)
		case "mute":
			e.cronScheduler.Store().SetMute(id, true)
		case "unmute":
			e.cronScheduler.Store().SetMute(id, false)
		}

	case "/timer":
		if e.timerScheduler == nil || args == "" {
			return
		}
		subArgs := strings.Fields(args)
		if len(subArgs) < 2 {
			return
		}
		sub, id := subArgs[0], subArgs[1]
		switch sub {
		case "delete":
			e.timerScheduler.RemoveJob(id)
		case "mute":
			e.timerScheduler.SetMute(id, true)
		case "unmute":
			e.timerScheduler.SetMute(id, false)
		}
	}
}

func (e *Engine) getOrCreateDeleteModeState(sessionKey string, p Platform, replyCtx any) *deleteModeState {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[interactiveKey]
	if !ok || state == nil {
		state = &interactiveState{platform: p, replyCtx: replyCtx, eventsNeedResync: true}
		e.interactiveStates[interactiveKey] = state
	} else {
		state.platform = p
		state.replyCtx = replyCtx
	}
	e.interactiveMu.Unlock()

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.deleteMode == nil {
		state.deleteMode = &deleteModeState{}
	}
	dm := state.deleteMode
	dm.page = 1
	dm.phase = "select"
	dm.hint = ""
	dm.result = ""
	dm.selectedIDs = make(map[string]struct{})
	return dm
}

func (e *Engine) getDeleteModeState(sessionKey string) *deleteModeState {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return nil
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.deleteMode == nil {
		return nil
	}
	cp := &deleteModeState{
		page:        state.deleteMode.page,
		selectedIDs: make(map[string]struct{}, len(state.deleteMode.selectedIDs)),
		phase:       state.deleteMode.phase,
		hint:        state.deleteMode.hint,
		result:      state.deleteMode.result,
	}
	for id := range state.deleteMode.selectedIDs {
		cp.selectedIDs[id] = struct{}{}
	}
	return cp
}

func (e *Engine) getModelSwitchState(sessionKey string) *modelSwitchState {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return nil
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.modelSwitch == nil {
		return nil
	}
	cp := *state.modelSwitch
	return &cp
}

func (e *Engine) renderDeleteModeCard(sessionKey string) *Card {
	agent, sessions := e.sessionContextForKey(sessionKey)
	agentSessions, err := agent.ListSessions(e.ctx)
	if err != nil {
		return e.simpleCard(e.i18n.T(MsgDeleteModeTitle), "red", err.Error())
	}
	agentSessions = e.applySessionFilter(agentSessions, sessions)
	dm := e.getDeleteModeState(sessionKey)
	if dm == nil {
		return e.simpleCard(e.i18n.T(MsgDeleteModeTitle), "red", e.i18n.T(MsgDeleteUsage))
	}
	switch dm.phase {
	case "confirm":
		return e.renderDeleteModeConfirmCard(sessions, dm, agentSessions)
	case "result":
		return e.renderDeleteModeResultCard(dm)
	case "deleting":
		return e.renderDeleteModeDeletingCard(dm)
	default:
		return e.renderDeleteModeSelectCard(sessionKey, sessions, dm, agentSessions)
	}
}

func (e *Engine) renderDeleteModeSelectCard(sessionKey string, sessions *SessionManager, dm *deleteModeState, agentSessions []AgentSessionInfo) *Card {
	if len(agentSessions) == 0 {
		return e.simpleCard(e.i18n.T(MsgDeleteModeTitle), "red", e.i18n.T(MsgListEmpty))
	}
	total := len(agentSessions)
	totalPages := (total + listPageSize - 1) / listPageSize
	page := dm.page
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}
	start := (page - 1) * listPageSize
	end := start + listPageSize
	if end > total {
		end = total
	}

	cb := NewCard().Title(e.i18n.T(MsgDeleteModeTitle), "carmine")
	activeAgentID := sessions.GetOrCreateActive(sessionKey).GetAgentSessionID()
	selectedCount := 0
	for i := start; i < end; i++ {
		s := agentSessions[i]
		isActive := activeAgentID == s.ID
		isSelected := false
		if !isActive {
			_, isSelected = dm.selectedIDs[s.ID]
		}
		marker := "◻"
		if isActive {
			marker = "▶"
		} else if isSelected {
			marker = "☑"
			selectedCount++
		}
		btnText := e.i18n.T(MsgDeleteModeSelect)
		btnType := "default"
		action := fmt.Sprintf("act:/delete-mode toggle %s", s.ID)
		if isActive {
			btnText = e.i18n.T(MsgCardTitleCurrentSession)
			btnType = "primary"
			action = fmt.Sprintf("act:/delete-mode noop %s", s.ID)
		} else if isSelected {
			btnText = e.i18n.T(MsgDeleteModeSelected)
			btnType = "primary"
		}
		cb.ListItemBtn(
			e.i18n.Tf(MsgListItem, marker, i+1, e.deleteSessionDisplayName(sessions, &s), s.MessageCount, s.ModifiedAt.Format("01-02 15:04")),
			btnText,
			btnType,
			action,
		)
	}
	cb.TaggedNote("delete-mode-selected-count", e.i18n.Tf(MsgDeleteModeSelectedCount, selectedCount))
	if dm.hint != "" {
		cb.Note(dm.hint)
	}
	cb.Buttons(
		DangerBtn(e.i18n.T(MsgDeleteModeDeleteSelected), "act:/delete-mode confirm"),
		DefaultBtn(e.i18n.T(MsgDeleteModeCancel), "act:/delete-mode cancel"),
	)

	var navBtns []CardButton
	if page > 1 {
		navBtns = append(navBtns, DefaultBtn(e.i18n.T(MsgCardPrev), fmt.Sprintf("act:/delete-mode page %d", page-1)))
	}
	if page < totalPages {
		navBtns = append(navBtns, DefaultBtn(e.i18n.T(MsgCardNext), fmt.Sprintf("act:/delete-mode page %d", page+1)))
	}
	if len(navBtns) > 0 {
		cb.Buttons(navBtns...)
	}
	return cb.Build()
}

func (e *Engine) renderDeleteModeConfirmCard(sessions *SessionManager, dm *deleteModeState, agentSessions []AgentSessionInfo) *Card {
	selectedNames := e.deleteModeSelectionNames(sessions, dm, agentSessions)
	body := strings.Join(selectedNames, "\n")
	if body == "" {
		body = e.i18n.T(MsgDeleteModeEmptySelection)
	}
	return NewCard().
		Title(e.i18n.T(MsgDeleteModeConfirmTitle), "carmine").
		Markdown(body).
		Buttons(
			DangerBtn(e.i18n.T(MsgDeleteModeConfirmButton), "act:/delete-mode submit"),
			DefaultBtn(e.i18n.T(MsgDeleteModeBackButton), "act:/delete-mode back"),
		).
		Build()
}

func (e *Engine) renderDeleteModeResultCard(dm *deleteModeState) *Card {
	return NewCard().
		Title(e.i18n.T(MsgDeleteModeResultTitle), "turquoise").
		Markdown(dm.result).
		Buttons(DefaultBtn(e.i18n.T(MsgCardBack), "nav:/list 1")).
		Build()
}

func (e *Engine) renderDeleteModeDeletingCard(dm *deleteModeState) *Card {
	return NewCard().
		Title(e.i18n.T(MsgDeleteModeDeletingTitle), "orange").
		Markdown(dm.hint).
		Build()
}

// performDeleteModeAsync runs the actual session deletions in a background
// goroutine so that the card callback can return immediately with a "deleting"
// indicator. Once all deletions finish it updates the interactive state and
// pushes a result card to the originating platform.
func (e *Engine) performDeleteModeAsync(sessionKey string, selectedIDs map[string]struct{}) {
	lines := e.submitDeleteModeSelection(sessionKey, selectedIDs)
	result := strings.Join(lines, "\n")

	// Update the interactive state to "result" phase.
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state != nil {
		state.mu.Lock()
		if state.deleteMode != nil {
			state.deleteMode.result = result
			state.deleteMode.hint = ""
			state.deleteMode.phase = "result"
		}
		state.mu.Unlock()
	}

	// Push the result card to the platform proactively.
	e.pushDeleteModeResultCard(sessionKey)
}

// pushDeleteModeResultCard resolves the platform from the session key and
// refreshes the "deleting" card in-place with the final result. Falls back to
// sending a new card if the platform does not support in-place card refresh.
func (e *Engine) pushDeleteModeResultCard(sessionKey string) {
	dm := e.getDeleteModeState(sessionKey)
	if dm == nil {
		return
	}
	card := e.renderDeleteModeResultCard(dm)

	platformName := extractPlatformName(sessionKey)
	var targetPlatform Platform
	for _, p := range e.platforms {
		if p.Name() == platformName {
			targetPlatform = p
			break
		}
	}
	if targetPlatform == nil {
		slog.Warn("delete mode: platform not found for result card", "sessionKey", sessionKey)
		return
	}

	// Prefer in-place card refresh (updates the "deleting" card to show results).
	if refresher, ok := targetPlatform.(CardRefresher); ok {
		if err := refresher.RefreshCard(e.ctx, sessionKey, card); err != nil {
			slog.Warn("delete mode: refresh card failed, falling back to new message", "error", err)
		} else {
			return
		}
	}

	// Fallback: send a new card message.
	rc, ok := targetPlatform.(ReplyContextReconstructor)
	if !ok {
		slog.Warn("delete mode: platform does not support proactive messaging", "platform", platformName)
		return
	}
	rctx, err := rc.ReconstructReplyCtx(sessionKey)
	if err != nil {
		slog.Error("delete mode: reconstruct reply ctx failed", "error", err)
		return
	}
	e.sendWithCard(targetPlatform, rctx, card)
}

func (e *Engine) performModelSwitchAsync(sessionKey string, state *interactiveState, agent Agent, sessions *SessionManager, target string) {
	resolved, err := e.selectSessionModel(sessionKey, target)
	if err == nil {
		sessions.Save()
	}

	resultCard := e.renderModelSwitchResultCard(resolved, err)
	if state != nil {
		state.mu.Lock()
		if state.modelSwitch != nil {
			state.modelSwitch.phase = "result"
			state.modelSwitch.target = resolved
			if err != nil {
				state.modelSwitch.result = e.i18n.Tf(MsgModelCardSwitchFailed, err)
			} else {
				state.modelSwitch.result = e.i18n.Tf(MsgModelCardSwitched, resolved)
			}
		}
		state.mu.Unlock()
	}
	e.pushModelSwitchResultCard(sessionKey, resultCard)
	e.cleanupInteractiveState(e.interactiveKeyForSessionKey(sessionKey), state)
}

func (e *Engine) pushModelSwitchResultCard(sessionKey string, card *Card) {
	platformName := extractPlatformName(sessionKey)
	var targetPlatform Platform
	for _, p := range e.platforms {
		if p.Name() == platformName {
			targetPlatform = p
			break
		}
	}
	if targetPlatform == nil {
		slog.Warn("model switch: platform not found for result card", "sessionKey", sessionKey)
		return
	}

	if refresher, ok := targetPlatform.(CardRefresher); ok {
		if err := refresher.RefreshCard(e.ctx, sessionKey, card); err != nil {
			slog.Warn("model switch: refresh card failed, falling back to new message", "error", err)
		} else {
			return
		}
	}

	rc, ok := targetPlatform.(ReplyContextReconstructor)
	if !ok {
		slog.Warn("model switch: platform does not support proactive messaging", "platform", platformName)
		return
	}
	rctx, err := rc.ReconstructReplyCtx(sessionKey)
	if err != nil {
		slog.Error("model switch: reconstruct reply ctx failed", "error", err)
		return
	}
	e.sendWithCard(targetPlatform, rctx, card)
}

func (e *Engine) deleteModeSelectionNames(sessions *SessionManager, dm *deleteModeState, agentSessions []AgentSessionInfo) []string {
	names := make([]string, 0, len(dm.selectedIDs))
	for i := range agentSessions {
		if _, ok := dm.selectedIDs[agentSessions[i].ID]; ok {
			names = append(names, "- "+e.deleteSessionDisplayName(sessions, &agentSessions[i]))
		}
	}
	return names
}

func (e *Engine) executeDeleteModeAction(sessionKey, args string) {
	interactiveKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return
	}

	fields := strings.Fields(args)
	if len(fields) == 0 {
		return
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.deleteMode == nil {
		return
	}

	dm := state.deleteMode
	switch fields[0] {
	case "toggle":
		if len(fields) < 2 {
			return
		}
		id := fields[1]
		if _, ok := dm.selectedIDs[id]; ok {
			delete(dm.selectedIDs, id)
		} else {
			dm.selectedIDs[id] = struct{}{}
		}
		dm.phase = "select"
		dm.hint = ""
	case "page":
		if len(fields) < 2 {
			return
		}
		if n, err := strconv.Atoi(fields[1]); err == nil && n > 0 {
			dm.page = n
		}
		dm.phase = "select"
	case "confirm":
		if len(dm.selectedIDs) == 0 {
			dm.phase = "select"
			dm.hint = e.i18n.T(MsgDeleteModeEmptySelection)
			return
		}
		dm.phase = "confirm"
		dm.hint = ""
	case "back":
		dm.phase = "select"
	case "submit":
		// Capture selected IDs and switch to "deleting" phase immediately
		// so the card callback can return a loading card without blocking.
		ids := make(map[string]struct{}, len(dm.selectedIDs))
		for id := range dm.selectedIDs {
			ids[id] = struct{}{}
		}
		dm.selectedIDs = make(map[string]struct{})
		dm.phase = "deleting"
		dm.hint = e.i18n.Tf(MsgDeleteModeDeletingBody, len(ids))
		go e.performDeleteModeAsync(sessionKey, ids)
	case "form-submit":
		dm.selectedIDs = parseDeleteModeSelectedIDs(fields[1:])
		if len(dm.selectedIDs) == 0 {
			dm.phase = "select"
			dm.hint = e.i18n.T(MsgDeleteModeEmptySelection)
			return
		}
		dm.phase = "confirm"
		dm.hint = ""
	case "cancel":
		state.deleteMode = nil
	}
}

func parseDeleteModeSelectedIDs(args []string) map[string]struct{} {
	ids := make(map[string]struct{})
	for _, arg := range args {
		for _, id := range strings.Split(arg, ",") {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			ids[id] = struct{}{}
		}
	}
	return ids
}

func (e *Engine) submitDeleteModeSelection(sessionKey string, selectedIDs map[string]struct{}) []string {
	agent, sessions := e.sessionContextForKey(sessionKey)
	deleter, ok := agent.(SessionDeleter)
	if !ok {
		return []string{e.i18n.T(MsgDeleteNotSupported)}
	}
	agentSessions, err := agent.ListSessions(e.ctx)
	if err != nil {
		return []string{e.i18n.Tf(MsgError, err)}
	}
	agentSessions = e.applySessionFilter(agentSessions, sessions)
	seen := make(map[string]struct{}, len(agentSessions))
	lines := make([]string, 0, len(selectedIDs))
	for i := range agentSessions {
		seen[agentSessions[i].ID] = struct{}{}
		if _, ok := selectedIDs[agentSessions[i].ID]; !ok {
			continue
		}
		if line := e.deleteSingleSessionReply(&Message{SessionKey: sessionKey}, deleter, &agentSessions[i]); line != "" {
			lines = append(lines, line)
		}
	}
	missingIDs := make([]string, 0)
	for id := range selectedIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		missingIDs = append(missingIDs, id)
	}
	sort.Strings(missingIDs)
	for _, id := range missingIDs {
		lines = append(lines, fmt.Sprintf(e.i18n.T(MsgDeleteModeMissingSession), id))
	}
	if len(lines) == 0 {
		lines = append(lines, e.i18n.T(MsgDeleteModeEmptySelection))
	}
	return lines
}
