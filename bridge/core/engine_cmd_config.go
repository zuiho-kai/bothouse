package core

import (
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
)

// ── /config command ──────────────────────────────────────────

// configItem describes a configurable runtime parameter.
type configItem struct {
	key     string
	desc    string // en description
	descZh  string // zh description
	getFunc func() string
	setFunc func(string) error
}

func (ci configItem) description(isZh bool) string {
	if isZh && ci.descZh != "" {
		return ci.descZh
	}
	return ci.desc
}

func (e *Engine) configItems() []configItem {
	return []configItem{
		{
			key:    "mode",
			desc:   "Display mode: full, compact, quiet",
			descZh: "显示模式: full, compact, quiet",
			getFunc: func() string {
				if e.display.Mode == "" {
					return "full"
				}
				return e.display.Mode
			},
			setFunc: func(v string) error {
				switch v {
				case "full":
					e.display.Mode = "full"
					e.display.ThinkingMessages = true
					e.display.ToolMessages = true
				case "compact", "quiet":
					e.display.Mode = v
					e.display.ThinkingMessages = false
					e.display.ToolMessages = false
				default:
					return fmt.Errorf("must be full, compact, or quiet")
				}
				if e.displaySaveFunc != nil {
					tm := e.display.ThinkingMessages
					tool := e.display.ToolMessages
					return e.displaySaveFunc(&v, &tm, nil, nil, &tool)
				}
				return nil
			},
		},
		{
			key:    "thinking_messages",
			desc:   "Whether thinking messages are shown (true/false)",
			descZh: "是否显示思考消息 (true/false)",
			getFunc: func() string {
				return fmt.Sprintf("%t", e.display.ThinkingMessages)
			},
			setFunc: func(v string) error {
				b, err := strconv.ParseBool(v)
				if err != nil {
					return fmt.Errorf("invalid boolean: %s", v)
				}
				e.display.ThinkingMessages = b
				if e.displaySaveFunc != nil {
					return e.displaySaveFunc(nil, &b, nil, nil, nil)
				}
				return nil
			},
		},
		{
			key:    "thinking_max_len",
			desc:   "Max chars for thinking messages (0=no truncation)",
			descZh: "思考消息最大长度 (0=不截断)",
			getFunc: func() string {
				return fmt.Sprintf("%d", e.display.ThinkingMaxLen)
			},
			setFunc: func(v string) error {
				n, err := strconv.Atoi(v)
				if err != nil {
					return fmt.Errorf("invalid integer: %s", v)
				}
				if n < 0 {
					return fmt.Errorf("value must be >= 0")
				}
				e.display.ThinkingMaxLen = n
				if e.displaySaveFunc != nil {
					return e.displaySaveFunc(nil, nil, &n, nil, nil)
				}
				return nil
			},
		},
		{
			key:    "tool_messages",
			desc:   "Whether tool progress messages are shown (true/false)",
			descZh: "是否显示工具进度消息 (true/false)",
			getFunc: func() string {
				return fmt.Sprintf("%t", e.display.ToolMessages)
			},
			setFunc: func(v string) error {
				b, err := strconv.ParseBool(v)
				if err != nil {
					return fmt.Errorf("invalid boolean: %s", v)
				}
				e.display.ToolMessages = b
				if e.displaySaveFunc != nil {
					return e.displaySaveFunc(nil, nil, nil, nil, &b)
				}
				return nil
			},
		},
		{
			key:    "tool_max_len",
			desc:   "Max chars for tool use messages (0=no truncation)",
			descZh: "工具消息最大长度 (0=不截断)",
			getFunc: func() string {
				return fmt.Sprintf("%d", e.display.ToolMaxLen)
			},
			setFunc: func(v string) error {
				n, err := strconv.Atoi(v)
				if err != nil {
					return fmt.Errorf("invalid integer: %s", v)
				}
				if n < 0 {
					return fmt.Errorf("value must be >= 0")
				}
				e.display.ToolMaxLen = n
				if e.displaySaveFunc != nil {
					return e.displaySaveFunc(nil, nil, nil, &n, nil)
				}
				return nil
			},
		},
	}
}

func (e *Engine) cmdConfig(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		if !supportsCards(p) {
			items := e.configItems()
			isZh := e.i18n.IsZhLike()
			var sb strings.Builder
			sb.WriteString(e.i18n.T(MsgConfigTitle))
			for _, item := range items {
				sb.WriteString(fmt.Sprintf("`%s` = `%s`\n  %s\n\n", item.key, item.getFunc(), item.description(isZh)))
			}
			sb.WriteString(e.i18n.T(MsgConfigHint))
			e.reply(p, msg.ReplyCtx, sb.String())
			return
		}

		e.replyWithCard(p, msg.ReplyCtx, e.renderConfigCard())
		return
	}

	items := e.configItems()
	isZh := e.i18n.IsZhLike()
	sub := matchSubCommand(strings.ToLower(args[0]), []string{"get", "set", "reload"})

	switch sub {
	case "reload":
		e.cmdConfigReload(p, msg)
		return
	case "get":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgConfigGetUsage))
			return
		}
		key := strings.ToLower(args[1])
		for _, item := range items {
			if item.key == key {
				e.reply(p, msg.ReplyCtx, fmt.Sprintf("`%s` = `%s`\n  %s", key, item.getFunc(), item.description(isZh)))
				return
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgConfigKeyNotFound, key))

	case "set":
		if len(args) < 3 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgConfigSetUsage))
			return
		}
		key := strings.ToLower(args[1])
		value := args[2]
		for _, item := range items {
			if item.key == key {
				if err := item.setFunc(value); err != nil {
					e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
					return
				}
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgConfigUpdated, key, item.getFunc()))
				return
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgConfigKeyNotFound, key))

	default:
		key := strings.ToLower(sub)
		for _, item := range items {
			if item.key == key {
				if len(args) >= 2 {
					if err := item.setFunc(args[1]); err != nil {
						e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
						return
					}
					e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgConfigUpdated, key, item.getFunc()))
				} else {
					e.reply(p, msg.ReplyCtx, fmt.Sprintf("`%s` = `%s`\n  %s", key, item.getFunc(), item.description(isZh)))
				}
				return
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgConfigKeyNotFound, key))
	}
}

// ── /whoami command ─────────────────────────────────────────

func (e *Engine) cmdWhoami(p Platform, msg *Message) {
	if supportsCards(p) {
		e.replyWithCard(p, msg.ReplyCtx, e.renderWhoamiCard(msg))
		return
	}
	e.reply(p, msg.ReplyCtx, e.formatWhoamiText(msg))
}

func (e *Engine) formatWhoamiText(msg *Message) string {
	var sb strings.Builder
	sb.WriteString(e.i18n.T(MsgWhoamiTitle))
	sb.WriteString("\n")

	if msg.UserID != "" {
		sb.WriteString(fmt.Sprintf("User ID: `%s`\n", msg.UserID))
	} else {
		sb.WriteString("User ID: (unknown)\n")
	}
	if msg.UserName != "" {
		sb.WriteString(fmt.Sprintf("Name: %s\n", msg.UserName))
	}
	if msg.Platform != "" {
		sb.WriteString(fmt.Sprintf("Platform: %s\n", msg.Platform))
	}

	chatID := effectiveChannelID(msg)
	if chatID != "" {
		sb.WriteString(fmt.Sprintf("Chat ID: `%s`\n", chatID))
	}
	sb.WriteString(fmt.Sprintf("Session Key: `%s`\n", msg.SessionKey))

	sb.WriteString("\n")
	sb.WriteString(e.i18n.T(MsgWhoamiUsage))
	return sb.String()
}

func (e *Engine) renderWhoamiCard(msg *Message) *Card {
	userID := msg.UserID
	if userID == "" {
		userID = "(unknown)"
	}

	var body strings.Builder
	body.WriteString(fmt.Sprintf("**User ID:**  `%s`\n", userID))
	if msg.UserName != "" {
		body.WriteString(fmt.Sprintf("**%s:**  %s\n", e.i18n.T(MsgWhoamiName), msg.UserName))
	}
	if msg.Platform != "" {
		body.WriteString(fmt.Sprintf("**%s:**  %s\n", e.i18n.T(MsgWhoamiPlatform), msg.Platform))
	}
	chatID := effectiveChannelID(msg)
	if chatID != "" {
		body.WriteString(fmt.Sprintf("**Chat ID:**  `%s`\n", chatID))
	}
	body.WriteString(fmt.Sprintf("**Session Key:**  `%s`\n", msg.SessionKey))

	return NewCard().
		Title(e.i18n.T(MsgWhoamiCardTitle), "blue").
		Markdown(body.String()).
		Divider().
		Note(e.i18n.T(MsgWhoamiUsage)).
		Buttons(e.cardBackButton()).
		Build()
}

// ── /doctor command ─────────────────────────────────────────

func (e *Engine) cmdDoctor(p Platform, msg *Message) {
	results := RunDoctorChecks(e.ctx, e.agent, e.platforms)
	report := FormatDoctorResults(results, e.i18n)
	e.reply(p, msg.ReplyCtx, report)
}

func (e *Engine) cmdUpgrade(p Platform, msg *Message, args []string) {
	subCmd := ""
	if len(args) > 0 {
		subCmd = matchSubCommand(args[0], []string{"confirm", "check"})
	}

	if subCmd == "confirm" {
		e.cmdUpgradeConfirm(p, msg)
		return
	}

	// Default: check for updates
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgUpgradeChecking))

	cur := CurrentVersion
	if cur == "" || cur == "dev" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgUpgradeDevBuild))
		return
	}

	useGitee := e.i18n.IsZhLike()
	release, err := CheckForUpdate(cur, useGitee)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	if release == nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgUpgradeUpToDate), cur))
		return
	}

	body := release.Body
	if len([]rune(body)) > 300 {
		body = string([]rune(body)[:300]) + "…"
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgUpgradeAvailable), cur, release.TagName, body))
}

func (e *Engine) cmdUpgradeConfirm(p Platform, msg *Message) {
	cur := CurrentVersion
	if isDevVersion(cur) {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgUpgradeDevBuild))
		return
	}
	if err := UpdateRefusal(); err != nil {
		e.reply(p, msg.ReplyCtx, err.Error())
		return
	}

	useGitee := e.i18n.IsZhLike()
	release, err := updateCheckFn(cur, useGitee)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	if release == nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgUpgradeUpToDate), cur))
		return
	}
	if !updateMu.TryLock() {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, "update already in progress"))
		return
	}
	defer updateMu.Unlock()

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgUpgradeDownloading), release.TagName))

	if err := selfUpdateFn(release.TagName, useGitee); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	// Same self-check as the web update; a rollback is reported back to this chat.
	req := RestartRequest{SessionKey: msg.SessionKey, Platform: p.Name()}
	if err := armUpdateGuard(activeMgmt.Load(), release.TagName, &req); err != nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf("新版 %s 没能启动自检，已退回 %s：%v", release.TagName, cur, err))
		return
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgUpgradeSuccess), release.TagName))

	// Auto-restart to apply the update
	requestRestart(req)
}

func (e *Engine) cmdConfigReload(p Platform, msg *Message) {
	if e.configReloadFunc == nil {
		e.reply(p, msg.ReplyCtx, "❌ Config reload not available")
		return
	}
	result, err := e.configReloadFunc()
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgConfigReloaded),
		result.DisplayUpdated, result.ProvidersUpdated, result.CommandsUpdated))
}

func (e *Engine) cmdRestart(p Platform, msg *Message) {
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRestarting))
	select {
	case RestartCh <- RestartRequest{
		SessionKey: msg.SessionKey,
		Platform:   p.Name(),
	}:
	default:
	}
}

func (e *Engine) cmdAlias(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		if !supportsCards(p) {
			e.cmdAliasList(p, msg)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderAliasCard())
		return
	}

	sub := matchSubCommand(strings.ToLower(args[0]), []string{"list", "add", "del", "delete", "remove"})
	switch sub {
	case "list":
		e.cmdAliasList(p, msg)
	case "add":
		e.cmdAliasAdd(p, msg, args[1:])
	case "del", "delete", "remove":
		e.cmdAliasDel(p, msg, args[1:])
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgAliasUsage))
	}
}

func (e *Engine) cmdAliasList(p Platform, msg *Message) {
	e.aliasMu.RLock()
	defer e.aliasMu.RUnlock()

	if len(e.aliases) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgAliasEmpty))
		return
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(e.i18n.T(MsgAliasListHeader), len(e.aliases)))
	sb.WriteString("\n")

	names := make([]string, 0, len(e.aliases))
	for n := range e.aliases {
		names = append(names, n)
	}
	sort.Strings(names)

	for _, n := range names {
		sb.WriteString(fmt.Sprintf("  %s → %s\n", n, e.aliases[n]))
	}
	e.reply(p, msg.ReplyCtx, strings.TrimRight(sb.String(), "\n"))
}

func (e *Engine) cmdAliasAdd(p Platform, msg *Message, args []string) {
	if len(args) < 2 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgAliasUsage))
		return
	}
	name := args[0]
	command := strings.Join(args[1:], " ")
	if !strings.HasPrefix(command, "/") {
		command = "/" + command
	}

	e.aliasMu.Lock()
	e.aliases[name] = command
	e.aliasMu.Unlock()

	if e.aliasSaveAddFunc != nil {
		if err := e.aliasSaveAddFunc(name, command); err != nil {
			slog.Error("alias: save failed", "error", err)
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAliasAdded), name, command))
}

func (e *Engine) cmdAliasDel(p Platform, msg *Message, args []string) {
	if len(args) < 1 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgAliasUsage))
		return
	}
	name := args[0]

	e.aliasMu.Lock()
	_, exists := e.aliases[name]
	if exists {
		delete(e.aliases, name)
	}
	e.aliasMu.Unlock()

	if !exists {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAliasNotFound), name))
		return
	}

	if e.aliasSaveDelFunc != nil {
		if err := e.aliasSaveDelFunc(name); err != nil {
			slog.Error("alias: save failed", "error", err)
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAliasDeleted), name))
}

func (e *Engine) cmdDelete(p Platform, msg *Message, args []string) {
	agent, sessions, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}
	deleter, ok := agent.(SessionDeleter)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDeleteNotSupported))
		return
	}

	if len(args) == 0 {
		if supportsCards(p) {
			_ = e.getOrCreateDeleteModeState(msg.SessionKey, p, msg.ReplyCtx)
			e.replyWithCard(p, msg.ReplyCtx, e.renderDeleteModeCard(msg.SessionKey))
			return
		}
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDeleteUsage))
		return
	}
	if len(args) > 1 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDeleteUsage))
		return
	}

	agentSessions, err := agent.ListSessions(e.ctx)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	agentSessions = e.applySessionFilter(agentSessions, sessions)

	prefix := strings.TrimSpace(args[0])
	if isExplicitDeleteBatchArg(prefix) {
		indices, err := parseDeleteBatchIndices(prefix, len(agentSessions))
		if err != nil {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDeleteUsage))
			return
		}
		e.cmdDeleteBatch(p, msg, deleter, agentSessions, indices)
		return
	}
	var matched *AgentSessionInfo

	if idx, err := strconv.Atoi(prefix); err == nil && idx >= 1 && idx <= len(agentSessions) {
		matched = &agentSessions[idx-1]
	} else {
		for i := range agentSessions {
			if strings.HasPrefix(agentSessions[i].ID, prefix) {
				matched = &agentSessions[i]
				break
			}
		}
	}

	if matched == nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgSwitchNoMatch), prefix))
		return
	}

	e.deleteSingleSession(p, msg, deleter, matched)
}

func isExplicitDeleteBatchArg(arg string) bool {
	if strings.Contains(arg, ",") {
		return true
	}
	if !strings.Contains(arg, "-") {
		return false
	}
	for _, r := range arg {
		if (r < '0' || r > '9') && r != '-' {
			return false
		}
	}
	return true
}

func parseDeleteBatchIndices(spec string, max int) ([]int, error) {
	parts := strings.Split(spec, ",")
	if len(parts) == 0 {
		return nil, fmt.Errorf("empty batch spec")
	}
	seen := make(map[int]struct{}, len(parts))
	indices := make([]int, 0, len(parts))

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, fmt.Errorf("empty batch item")
		}

		if strings.Contains(part, "-") {
			bounds := strings.Split(part, "-")
			if len(bounds) != 2 || bounds[0] == "" || bounds[1] == "" {
				return nil, fmt.Errorf("invalid range %q", part)
			}
			start, err := strconv.Atoi(bounds[0])
			if err != nil {
				return nil, err
			}
			end, err := strconv.Atoi(bounds[1])
			if err != nil {
				return nil, err
			}
			if start < 1 || end < 1 || start > end || end > max {
				return nil, fmt.Errorf("range %q out of bounds", part)
			}
			for idx := start; idx <= end; idx++ {
				if _, ok := seen[idx]; ok {
					continue
				}
				seen[idx] = struct{}{}
				indices = append(indices, idx)
			}
			continue
		}

		idx, err := strconv.Atoi(part)
		if err != nil {
			return nil, err
		}
		if idx < 1 || idx > max {
			return nil, fmt.Errorf("index %d out of bounds", idx)
		}
		if _, ok := seen[idx]; ok {
			continue
		}
		seen[idx] = struct{}{}
		indices = append(indices, idx)
	}

	return indices, nil
}

func (e *Engine) cmdDeleteBatch(p Platform, msg *Message, deleter SessionDeleter, sessions []AgentSessionInfo, indices []int) {
	lines := make([]string, 0, len(indices))
	for _, idx := range indices {
		matched := &sessions[idx-1]
		if line := e.deleteSingleSessionReply(msg, deleter, matched); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDeleteUsage))
		return
	}
	e.reply(p, msg.ReplyCtx, strings.Join(lines, "\n"))
}

func (e *Engine) deleteSingleSession(p Platform, msg *Message, deleter SessionDeleter, matched *AgentSessionInfo) {
	e.reply(p, msg.ReplyCtx, e.deleteSingleSessionReply(msg, deleter, matched))
}

func (e *Engine) deleteSingleSessionReply(msg *Message, deleter SessionDeleter, matched *AgentSessionInfo) string {
	if matched == nil {
		return ""
	}

	// Prevent deleting the currently active session
	_, sessions := e.sessionContextForKey(msg.SessionKey)
	activeSession := sessions.GetOrCreateActive(msg.SessionKey)
	if activeSession.GetAgentSessionID() == matched.ID {
		return e.i18n.T(MsgDeleteActiveDenied)
	}

	displayName := e.deleteSessionDisplayName(sessions, matched)

	if err := deleter.DeleteSession(e.ctx, matched.ID); err != nil {
		return e.i18n.Tf(MsgFailedToDeleteSession, displayName, err)
	}

	// Keep local session snapshot aligned with agent-side deletion.
	sessions.DeleteByAgentSessionID(matched.ID)
	sessions.SetSessionName(matched.ID, "")
	return fmt.Sprintf(e.i18n.T(MsgDeleteSuccess), displayName)
}

func (e *Engine) deleteSessionDisplayName(sessions *SessionManager, matched *AgentSessionInfo) string {
	displayName := sessions.GetSessionName(matched.ID)
	if displayName == "" {
		displayName = matched.Summary
	}
	if displayName == "" {
		shortID := matched.ID
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		displayName = shortID
	}
	return displayName
}

func (e *Engine) cmdWeb(p Platform, msg *Message, args []string) {
	subCmd := ""
	if len(args) > 0 {
		subCmd = matchSubCommand(strings.ToLower(args[0]),
			[]string{"setup", "status"})
	}

	switch subCmd {
	case "setup":
		e.cmdWebSetup(p, msg)
	default:
		e.cmdWebStatus(p, msg)
	}
}

func (e *Engine) cmdWebSetup(p Platform, msg *Message) {
	if !WebAssetsAvailable() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNotSupported))
		return
	}
	if e.webSetupFunc == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNotSupported))
		return
	}

	port, token, needRestart, err := e.webSetupFunc()
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	url := fmt.Sprintf("http://localhost:%d", port)
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgWebSetupSuccess), url, token))
	if needRestart {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNeedRestart))
	}
}

func (e *Engine) cmdWebStatus(p Platform, msg *Message) {
	if !WebAssetsAvailable() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNotSupported))
		return
	}
	if e.webStatusFunc == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNotSupported))
		return
	}

	url := e.webStatusFunc()
	if url == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWebNotEnabled))
		return
	}
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgWebStatus), url))
}
