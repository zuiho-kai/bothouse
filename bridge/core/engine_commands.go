package core

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────────────────────
// Command handling
// ──────────────────────────────────────────────────────────────

// builtinCommands maps canonical command names to their aliases/full names.
// The first entry is the canonical name used for prefix matching.
var builtinCommands = []struct {
	names []string
	id    string
}{
	{[]string{"new"}, "new"},
	{[]string{"list", "sessions"}, "list"},
	{[]string{"switch"}, "switch"},
	{[]string{"name", "rename"}, "name"},
	{[]string{"current"}, "current"},
	{[]string{"status"}, "status"},
	{[]string{"usage", "quota"}, "usage"},
	{[]string{"history"}, "history"},
	{[]string{"allow"}, "allow"},
	{[]string{"model"}, "model"},
	{[]string{"reasoning", "effort"}, "reasoning"},
	{[]string{"mode"}, "mode"},
	{[]string{"lang"}, "lang"},
	{[]string{"quiet"}, "quiet"},
	{[]string{"provider"}, "provider"},
	{[]string{"memory"}, "memory"},
	{[]string{"cron"}, "cron"},
	{[]string{"timer", "at", "remind"}, "timer"},
	{[]string{"heartbeat", "hb"}, "heartbeat"},
	{[]string{"compress", "compact"}, "compress"},
	{[]string{"stop"}, "stop"},
	{[]string{"cancel"}, "cancel"},
	{[]string{"help"}, "help"},
	{[]string{"version"}, "version"},
	{[]string{"commands", "command", "cmd"}, "commands"},
	{[]string{"skills", "skill"}, "skills"},
	{[]string{"config"}, "config"},
	{[]string{"doctor"}, "doctor"},
	{[]string{"upgrade", "update"}, "upgrade"},
	{[]string{"restart"}, "restart"},
	{[]string{"alias"}, "alias"},
	{[]string{"delete", "del", "rm"}, "delete"},
	{[]string{"bind"}, "bind"},
	{[]string{"search", "find"}, "search"},
	{[]string{"shell", "sh", "exec", "run"}, "shell"},
	{[]string{"show"}, "show"},
	{[]string{"dir", "cd", "chdir", "workdir"}, "dir"},
	{[]string{"tts"}, "tts"},
	{[]string{"workspace", "ws"}, "workspace"},
	{[]string{"whoami", "myid"}, "whoami"},
	{[]string{"web"}, "web"},
	{[]string{"diff"}, "diff"},
	{[]string{"ps", "btw"}, "ps"},
}

func (e *Engine) cmdPs(p Platform, msg *Message, args []string) {
	text := strings.TrimSpace(strings.Join(args, " "))
	if text == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPsEmpty))
		return
	}
	iKey := e.interactiveKeyForSessionKey(msg.SessionKey)
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()
	if !ok || state == nil || state.agentSession == nil || !state.agentSession.Alive() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPsNoSession))
		return
	}
	// /ps is only meaningful as a supplement to a turn already in flight.
	// When the session is idle, injecting via agentSession.Send bypasses the
	// session lock and races with concurrent normal messages on the CLI's
	// stdin, so reject instead.
	_, sessions := e.sessionContextForKey(msg.SessionKey)
	if session := sessions.GetOrCreateActive(msg.SessionKey); !session.Busy() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPsNoSession))
		return
	}
	// No team-mode rules: /ps adds to the running turn, which already had them (teamRulesOnce).
	if err := state.agentSession.Send(e.withSupplementInstructions(text, msg.UserID, msg.FromBot), "", nil, nil); err != nil {
		slog.Error("ps: send failed", "error", err)
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPsSendFailed))
		return
	}
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPsSent))
}

// matchPrefix finds a unique command matching the given prefix.
// Returns the command id or "" if no match / ambiguous.
func matchPrefix(prefix string, candidates []struct {
	names []string
	id    string
}) string {
	// Exact match first
	for _, c := range candidates {
		for _, n := range c.names {
			if prefix == n {
				return c.id
			}
		}
	}
	// Prefix match
	var matched string
	for _, c := range candidates {
		for _, n := range c.names {
			if strings.HasPrefix(n, prefix) {
				if matched != "" && matched != c.id {
					return "" // ambiguous
				}
				matched = c.id
				break
			}
		}
	}
	return matched
}

// matchSubCommand does prefix matching against a flat list of subcommand names.
func matchSubCommand(input string, candidates []string) string {
	for _, c := range candidates {
		if input == c {
			return c
		}
	}
	var matched string
	for _, c := range candidates {
		if strings.HasPrefix(c, input) {
			if matched != "" {
				return input // ambiguous → return raw input (will hit default)
			}
			matched = c
		}
	}
	if matched != "" {
		return matched
	}
	return input
}

// splitCommandArgs splits a command string into tokens, respecting single- and
// double-quoted groups so paths like "/workspace bind '/my path/foo'" work
// correctly (#1211). Quotes are stripped from the resulting tokens.
func splitCommandArgs(s string) []string {
	var tokens []string
	var cur strings.Builder
	inSingle := false
	inDouble := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\'' && !inDouble:
			inSingle = !inSingle
		case c == '"' && !inSingle:
			inDouble = !inDouble
		case (c == ' ' || c == '\t') && !inSingle && !inDouble:
			if cur.Len() > 0 {
				tokens = append(tokens, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteByte(c)
		}
	}
	if cur.Len() > 0 {
		tokens = append(tokens, cur.String())
	}
	return tokens
}

func (e *Engine) handleCommand(p Platform, msg *Message, raw string) bool {
	parts := splitCommandArgs(raw)
	cmd := strings.ToLower(strings.TrimPrefix(parts[0], "/"))
	args := parts[1:]

	cmdID := matchPrefix(cmd, builtinCommands)

	// Resolve effective disabled commands: role-based if available, else project-level
	e.userRolesMu.RLock()
	disabledCmds := e.disabledCmds
	urm := e.userRoles
	e.userRolesMu.RUnlock()
	if urm != nil {
		if role := urm.ResolveRole(msg.UserID); role != nil {
			disabledCmds = role.DisabledCmds
		}
	}

	if cmdID != "" && disabledCmds[cmdID] {
		slog.Info("audit: command_blocked",
			"user_id", msg.UserID, "platform", msg.Platform,
			"project", e.name, "command", cmdID, "reason", "disabled")
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+cmdID))
		return true
	}

	if cmdID != "" && isPrivilegedCommandInvocation(cmdID, args) && !e.isAdmin(msg.UserID) {
		slog.Info("audit: command_blocked",
			"user_id", msg.UserID, "platform", msg.Platform,
			"project", e.name, "command", cmdID, "reason", "unauthorized")
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "/"+cmdID))
		return true
	}

	if cmdID != "" {
		slog.Info("audit: command_executed",
			"user_id", msg.UserID, "platform", msg.Platform,
			"project", e.name, "command", cmdID)
	}

	switch cmdID {
	case "new":
		e.cmdNew(p, msg, args)
	case "list":
		e.cmdList(p, msg, args)
	case "switch":
		e.cmdSwitch(p, msg, args)
	case "name":
		e.cmdName(p, msg, args)
	case "current":
		e.cmdCurrent(p, msg)
	case "status":
		e.cmdStatus(p, msg)
	case "usage":
		e.cmdUsage(p, msg)
	case "history":
		e.cmdHistory(p, msg, args)
	case "allow":
		e.cmdAllow(p, msg, args)
	case "model":
		e.cmdModel(p, msg, args)
	case "reasoning":
		e.cmdReasoning(p, msg, args)
	case "mode":
		e.cmdMode(p, msg, args)
	case "lang":
		e.cmdLang(p, msg, args)
	case "quiet":
		e.cmdQuiet(p, msg, args)
	case "provider":
		e.cmdProvider(p, msg, args)
	case "memory":
		e.cmdMemory(p, msg, args)
	case "cron":
		e.cmdCron(p, msg, args)
	case "timer":
		e.cmdTimer(p, msg, args)
	case "heartbeat":
		e.cmdHeartbeat(p, msg, args)
	case "compress":
		e.cmdCompress(p, msg)
	case "stop":
		e.cmdStop(p, msg)
	case "cancel":
		e.cmdCancel(p, msg)
	case "help":
		e.cmdHelp(p, msg)
	case "start":
		e.cmdStart(p, msg)
	case "version":
		e.reply(p, msg.ReplyCtx, VersionInfo)
	case "commands":
		e.cmdCommands(p, msg, args)
	case "skills":
		e.cmdSkills(p, msg)
	case "config":
		e.cmdConfig(p, msg, args)
	case "doctor":
		e.cmdDoctor(p, msg)
	case "upgrade":
		e.cmdUpgrade(p, msg, args)
	case "restart":
		e.cmdRestart(p, msg)
	case "alias":
		e.cmdAlias(p, msg, args)
	case "delete":
		e.cmdDelete(p, msg, args)
	case "bind":
		e.cmdBind(p, msg, args)
	case "search":
		e.cmdSearch(p, msg, args)
	case "shell":
		e.cmdShell(p, msg, raw)
	case "diff":
		e.cmdDiff(p, msg, raw)
	case "show":
		e.cmdShow(p, msg, args)
	case "dir":
		e.cmdDir(p, msg, args)
	case "tts":
		e.cmdTTS(p, msg, args)
	case "workspace":
		if !e.multiWorkspace {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsNotEnabled))
			return true
		}
		e.handleWorkspaceCommand(p, msg, args)
		return true
	case "whoami":
		e.cmdWhoami(p, msg)
	case "web":
		e.cmdWeb(p, msg, args)
	case "ps":
		e.cmdPs(p, msg, args)
	default:
		if custom, ok := e.commands.Resolve(cmd); ok {
			if disabledCmds[strings.ToLower(custom.Name)] {
				slog.Info("audit: command_blocked",
					"user_id", msg.UserID, "platform", msg.Platform,
					"project", e.name, "command", custom.Name, "reason", "disabled")
				e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+custom.Name))
				return true
			}
			slog.Info("audit: command_executed",
				"user_id", msg.UserID, "platform", msg.Platform,
				"project", e.name, "command", custom.Name, "type", "custom")
			e.executeCustomCommand(p, msg, custom, args)
			return true
		}
		if skill := e.skills.Resolve(cmd); skill != nil {
			if disabledCmds[strings.ToLower(skill.Name)] {
				slog.Info("audit: command_blocked",
					"user_id", msg.UserID, "platform", msg.Platform,
					"project", e.name, "command", skill.Name, "reason", "disabled")
				e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+skill.Name))
				return true
			}
			slog.Info("audit: command_executed",
				"user_id", msg.UserID, "platform", msg.Platform,
				"project", e.name, "command", skill.Name, "type", "skill")
			e.executeSkill(p, msg, skill, args)
			return true
		}
		// #2041: one of the agent's own slash commands, in a message that calls this role. It
		// falls through like any other text the bridge does not own, marked so that it reaches
		// the agent as typed. Said to someone else or to no one it is chat, not a command here.
		if agent, _, _, err := e.commandContext(p, msg); err == nil && e.addresseeOf(p, msg) == AddrSelf {
			if nc, ok := agent.(NativeCommandAgent); ok {
				if name, readOnly := nc.NativeCommand(e.ctx, raw); name != "" {
					if disabledCmds[strings.ToLower(name)] {
						slog.Info("audit: command_blocked",
							"user_id", msg.UserID, "platform", msg.Platform,
							"project", e.name, "command", name, "reason", "disabled")
						e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+name))
						return true
					}
					if !readOnly && !e.isAdmin(msg.UserID) {
						slog.Info("audit: command_blocked",
							"user_id", msg.UserID, "platform", msg.Platform,
							"project", e.name, "command", name, "reason", "unauthorized")
						e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "/"+name))
						return true
					}
					slog.Info("audit: command_executed",
						"user_id", msg.UserID, "platform", msg.Platform,
						"project", e.name, "command", name, "type", "agent")
					msg.nativeCommand = true
					return false
				}
			}
		}
		// Not a cc-connect command — notify user, then fall through to agent.
		// In a QQ group it is usually meant for another bot: say nothing there.
		notice := fmt.Sprintf(e.i18n.T(MsgUnknownCommand), "/"+cmd)
		if !e.noticeKeptOut(p, msg.ReplyCtx, notice) {
			e.send(p, msg.ReplyCtx, notice)
		}
		return false
	}
	return true
}

func (e *Engine) handleWorkspaceCommand(p Platform, msg *Message, args []string) {
	channelID := effectiveChannelID(msg)
	channelKey := effectiveWorkspaceChannelKey(msg)
	projectKey := "project:" + e.name
	resolveChannelName := func() func() string {
		resolved := false
		channelName := ""
		return func() string {
			if resolved {
				return channelName
			}
			resolved = true
			if resolver, ok := p.(ChannelNameResolver); ok {
				channelName, _ = resolver.ResolveChannelName(channelID)
			}
			return channelName
		}
	}()
	replyWorkspaceInfo := func(b *WorkspaceBinding, bindingKey string) {
		if bindingKey == sharedWorkspaceBindingsKey {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInfoShared, b.Workspace, b.BoundAt.Format(time.RFC3339)))
			return
		}
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInfo, b.Workspace, b.BoundAt.Format(time.RFC3339)))
	}
	routeWorkspace := func(bindingKey string, pathParts []string, usageKey, successKey MsgKey) bool {
		routePath := strings.TrimSpace(strings.Join(pathParts, " "))
		if routePath == "" {
			e.reply(p, msg.ReplyCtx, e.i18n.T(usageKey))
			return false
		}
		if !filepath.IsAbs(routePath) {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsRouteAbsoluteRequired, routePath))
			return false
		}

		info, err := os.Stat(routePath)
		if err != nil {
			if os.IsNotExist(err) {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsRouteNotFound, routePath))
			} else {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
			}
			return false
		}
		if !info.IsDir() {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsRouteNotDirectory, routePath))
			return false
		}

		normalizedPath := normalizeWorkspacePath(routePath)
		e.workspaceBindings.Bind(bindingKey, channelKey, resolveChannelName(), normalizedPath)
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(successKey, normalizedPath))
		return true
	}
	bindWorkspace := func(bindingKey, wsName string, successKey MsgKey) bool {
		wsPath := filepath.Join(e.baseDir, wsName)

		// Check if workspace directory exists
		if _, err := os.Stat(wsPath); os.IsNotExist(err) {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsBindNotFound, wsName))
			return false
		}

		e.workspaceBindings.Bind(bindingKey, channelKey, resolveChannelName(), normalizeWorkspacePath(wsPath))
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(successKey, wsName))
		return true
	}
	initWorkspace := func(bindingKey, target string, successKey MsgKey) bool {
		// Support local directory paths (absolute or relative to baseDir).
		if e.workspaceInitAllowLocalPaths && looksLikeLocalDir(target) {
			dirPath, err := resolveLocalDirPath(target, e.baseDir)
			if err != nil {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInitDirNotFound, target))
				return false
			}
			info, statErr := os.Stat(dirPath)
			if statErr != nil || !info.IsDir() {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInitDirNotFound, target))
				return false
			}
			e.workspaceBindings.Bind(bindingKey, channelKey, resolveChannelName(), normalizeWorkspacePath(dirPath))
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsBindSuccess, dirPath))
			return true
		}
		if !e.workspaceInitAllowLocalPaths && looksLikeLocalDir(target) && !looksLikeGitURL(target) {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsInitLocalPathsDisabled))
			return false
		}

		if !looksLikeGitURL(target) {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsInitInvalidTarget))
			return false
		}

		repoName := extractRepoName(target)
		cloneTo := filepath.Join(e.baseDir, repoName)

		if _, err := os.Stat(cloneTo); err == nil {
			e.workspaceBindings.Bind(bindingKey, channelKey, resolveChannelName(), normalizeWorkspacePath(cloneTo))
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(successKey, cloneTo))
			return true
		}

		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsCloneProgress, target))

		if err := gitClone(target, cloneTo); err != nil {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsCloneFailed, err))
			return false
		}

		e.workspaceBindings.Bind(bindingKey, channelKey, resolveChannelName(), normalizeWorkspacePath(cloneTo))
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(successKey, cloneTo))
		return true
	}
	listBindings := func(bindingKey string, emptyKey, titleKey MsgKey) {
		bindings := e.workspaceBindings.ListByProject(bindingKey)
		if len(bindings) == 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(emptyKey))
			return
		}
		var sb strings.Builder
		sb.WriteString(e.i18n.T(titleKey) + "\n")
		for chID, b := range bindings {
			name := b.ChannelName
			if name == "" {
				name = chID
			}
			sb.WriteString(fmt.Sprintf("• #%s → `%s`\n", name, b.Workspace))
		}
		e.reply(p, msg.ReplyCtx, sb.String())
	}

	subCmd := ""
	if len(args) > 0 {
		subCmd = matchSubCommand(args[0], []string{"init", "bind", "route", "unbind", "list", "shared"})
	}

	switch subCmd {
	case "":
		b, bindingKey, usable := e.lookupEffectiveWorkspaceBinding(channelKey)
		if !usable {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsNoBinding))
		} else {
			replyWorkspaceInfo(b, bindingKey)
		}

	case "bind":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsBindUsage))
			return
		}
		bindWorkspace(projectKey, args[1], MsgWsBindSuccess)

	case "route":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsRouteUsage))
			return
		}
		routeWorkspace(projectKey, args[1:], MsgWsRouteUsage, MsgWsRouteSuccess)

	case "init":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsInitUsage))
			return
		}
		initWorkspace(projectKey, args[1], MsgWsCloneSuccess)

	case "shared":
		sharedSubCmd := ""
		if len(args) > 1 {
			sharedSubCmd = matchSubCommand(args[1], []string{"init", "bind", "route", "unbind", "list"})
		}
		switch sharedSubCmd {
		case "":
			b := e.workspaceBindings.Lookup(sharedWorkspaceBindingsKey, channelKey)
			if b == nil {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedNoBinding))
			} else {
				replyWorkspaceInfo(b, sharedWorkspaceBindingsKey)
			}
			return
		case "bind":
			if len(args) < 3 {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedUsage))
				return
			}
			bindWorkspace(sharedWorkspaceBindingsKey, args[2], MsgWsSharedBindSuccess)
			return
		case "route":
			if len(args) < 3 {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedUsage))
				return
			}
			routeWorkspace(sharedWorkspaceBindingsKey, args[2:], MsgWsSharedUsage, MsgWsSharedRouteSuccess)
			return
		case "init":
			if len(args) < 3 {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedUsage))
				return
			}
			initWorkspace(sharedWorkspaceBindingsKey, args[2], MsgWsSharedBindSuccess)
			return
		case "unbind":
			if e.workspaceBindings.Lookup(sharedWorkspaceBindingsKey, channelKey) == nil {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedNoBinding))
				return
			}
			e.workspaceBindings.Unbind(sharedWorkspaceBindingsKey, channelKey)
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedUnbindSuccess))
			return
		case "list":
			listBindings(sharedWorkspaceBindingsKey, MsgWsSharedListEmpty, MsgWsSharedListTitle)
			return
		default:
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedUsage))
			return
		}

	case "unbind":
		if e.workspaceBindings.Lookup(projectKey, channelKey) == nil {
			if e.workspaceBindings.Lookup(sharedWorkspaceBindingsKey, channelKey) != nil {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsSharedOnlyHint))
			} else {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsNoBinding))
			}
			return
		}
		e.workspaceBindings.Unbind(projectKey, channelKey)
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsUnbindSuccess))

	case "list":
		listBindings(projectKey, MsgWsListEmpty, MsgWsListTitle)

	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsUsage))
	}
}

func (e *Engine) cmdNew(p Platform, msg *Message, args []string) {
	_, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	name := ""
	if len(args) > 0 {
		name = strings.Join(args, " ")
	}
	e.startFreshSession(sessions, interactiveKey, msg.SessionKey, name, "用户发了 /new")
	if name != "" {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgNewSessionCreatedName), name))
	} else {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgNewSessionCreated))
	}
}

// startFreshSession is the state change behind /new: stop the live agent
// session, retire the old conversation and open a fresh one that inherits the
// old transcript's tail. Also used by `cc-connect session new --after-turn`.
func (e *Engine) startFreshSession(sessions *SessionManager, interactiveKey, sessionKey, name, handoffReason string) {
	slog.Info("cmdNew: cleaning up old session", "session_key", sessionKey)
	e.dropPendingReset(sessionKey) // this reset satisfies any queued one; it must not hit the next conversation
	// #699 design §4 row 12: a reset no longer frees a team workspace — the task's state does,
	// when its turn ends (releaseReturnedWorkspace).
	e.cleanupInteractiveState(interactiveKey)
	slog.Info("cmdNew: cleanup done, creating new session", "session_key", sessionKey)

	// Clear old session's agent session ID so it cannot be resumed
	old := sessions.GetOrCreateActive(sessionKey)
	oldAgentID := old.GetAgentSessionID()
	pendingFrom, pendingReason := old.TakeHandoffFrom() // /new twice before a turn
	old.SetAgentSessionID("", "")
	old.ClearHistory()
	sessions.Save()

	fresh := sessions.NewSession(sessionKey, name)
	// maomao fork: the fresh context inherits the old transcript's tail. The
	// channel backfill keeps its own window: a message marked seen may never
	// have reached the old context (dropped from the queue by this /new).
	if _, ok := e.agent.(SessionHandoffReader); ok {
		if oldAgentID != "" && oldAgentID != ContinueSession {
			fresh.SetHandoffFrom(oldAgentID, handoffReason)
		} else if pendingFrom != "" {
			fresh.SetHandoffFrom(pendingFrom, pendingReason)
		}
		sessions.Save()
	}
}

// applySessionFilter conditionally filters agent sessions based on the
// filter_external_sessions config. When disabled (default), all sessions are
// returned. When enabled, only sessions tracked by cc-connect are shown.
func (e *Engine) applySessionFilter(sessions []AgentSessionInfo, sm *SessionManager) []AgentSessionInfo {
	if !e.filterExternalSessions {
		return sessions
	}
	return filterOwnedSessions(sessions, sm.KnownAgentSessionIDs())
}

// filterOwnedSessions removes agent sessions that are not tracked by cc-connect's
// session manager. This prevents external CLI sessions in the same work_dir from
// appearing in /list, /switch, /delete, etc. If the session manager has no tracked
// agent sessions at all (e.g. first run), all sessions are returned unfiltered.
func filterOwnedSessions(sessions []AgentSessionInfo, known map[string]struct{}) []AgentSessionInfo {
	if len(known) == 0 {
		return sessions
	}
	filtered := make([]AgentSessionInfo, 0, len(sessions))
	for _, s := range sessions {
		if _, ok := known[s.ID]; ok {
			filtered = append(filtered, s)
		}
	}
	return filtered
}

const listPageSize = 20

// dirCardPageSize is the max directory history rows per card page (Feishu / other card UIs).
const dirCardPageSize = 20

func (e *Engine) cmdList(p Platform, msg *Message, args []string) {
	agent, sessions, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	if !supportsCards(p) {
		agentSessions, err := agent.ListSessions(e.ctx)
		if err != nil {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgListError), err))
			return
		}
		agentSessions = e.applySessionFilter(agentSessions, sessions)
		if len(agentSessions) == 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgListEmpty))
			return
		}

		total := len(agentSessions)
		totalPages := (total + listPageSize - 1) / listPageSize

		page := 1
		if len(args) > 0 {
			if n, err := strconv.Atoi(args[0]); err == nil && n > 0 {
				page = n
			}
		}
		if page > totalPages {
			page = totalPages
		}

		start := (page - 1) * listPageSize
		end := start + listPageSize
		if end > total {
			end = total
		}

		agentName := agent.Name()
		activeSession := sessions.GetOrCreateActive(msg.SessionKey)
		activeAgentID := activeSession.GetAgentSessionID()

		var sb strings.Builder
		if totalPages > 1 {
			sb.WriteString(fmt.Sprintf(e.i18n.T(MsgListTitlePaged), agentName, total, page, totalPages))
		} else {
			sb.WriteString(fmt.Sprintf(e.i18n.T(MsgListTitle), agentName, total))
		}
		for i := start; i < end; i++ {
			s := agentSessions[i]
			marker := "◻"
			if s.ID == activeAgentID {
				marker = "▶"
			}
			displayName := sessions.GetSessionName(s.ID)
			if displayName != "" {
				displayName = "📌 " + displayName
			} else {
				displayName = strings.ReplaceAll(s.Summary, "\n", " ")
				displayName = strings.Join(strings.Fields(displayName), " ")
				if displayName == "" {
					displayName = "(empty)"
				}
				if len([]rune(displayName)) > 40 {
					displayName = string([]rune(displayName)[:40]) + "…"
				}
			}
			sb.WriteString(fmt.Sprintf("%s **%d.** %s · **%d** msgs · %s\n",
				marker, i+1, displayName, s.MessageCount, s.ModifiedAt.Format("01-02 15:04")))
		}
		if totalPages > 1 {
			sb.WriteString(fmt.Sprintf(e.i18n.T(MsgListPageHint), page, totalPages))
		}
		sb.WriteString(e.i18n.T(MsgListSwitchHint))
		e.reply(p, msg.ReplyCtx, sb.String())
		return
	}

	page := 1
	if len(args) > 0 {
		if n, err := strconv.Atoi(args[0]); err == nil && n > 0 {
			page = n
		}
	}
	card, err := e.renderListCard(msg.SessionKey, page)
	if err != nil {
		e.reply(p, msg.ReplyCtx, err.Error())
		return
	}
	e.replyWithCard(p, msg.ReplyCtx, card)
}

func (e *Engine) cmdSwitch(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, "Usage: /switch <number | id_prefix | name>")
		return
	}
	query := strings.TrimSpace(strings.Join(args, " "))

	slog.Info("cmdSwitch: listing agent sessions", "session_key", msg.SessionKey)
	agent, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}
	agentSessions, err := agent.ListSessions(e.ctx)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	agentSessions = e.applySessionFilter(agentSessions, sessions)

	matched := e.matchSession(agentSessions, sessions, query)
	if matched == nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgSwitchNoMatch), query))
		return
	}

	slog.Info("cmdSwitch: cleaning up old session", "session_key", msg.SessionKey)
	e.cleanupInteractiveState(interactiveKey)
	slog.Info("cmdSwitch: cleanup done", "session_key", msg.SessionKey)

	// NOTE: Do NOT call session.ClearHistory() on the returned Session.
	// When switching back to a known agent_session_id, SwitchToAgentSession
	// returns the *existing* Session object whose History reflects the
	// original conversation; wiping it makes /history return empty after a
	// /switch round-trip. When SwitchToAgentSession creates a fresh Session
	// (no prior match), History is already nil, so preserving is a no-op.
	_ = sessions.SwitchToAgentSession(msg.SessionKey, matched.ID, agent.Name(), matched.Summary)

	shortID := matched.ID
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	displayName := sessions.GetSessionName(matched.ID)
	if displayName == "" {
		displayName = matched.Summary
	}
	e.reply(p, msg.ReplyCtx,
		e.i18n.Tf(MsgSwitchSuccess, displayName, shortID, matched.MessageCount))
}

// matchSession resolves a user query to an agent session. Priority:
//  1. Numeric index (1-based, matching /list output)
//  2. Exact custom name match (case-insensitive)
//  3. Session ID prefix match
//  4. Custom name prefix match (case-insensitive)
//  5. Summary substring match (case-insensitive)
func (e *Engine) matchSession(sessions []AgentSessionInfo, manager *SessionManager, query string) *AgentSessionInfo {
	if len(sessions) == 0 {
		return nil
	}

	// 1. Numeric index
	if idx, err := strconv.Atoi(query); err == nil && idx >= 1 && idx <= len(sessions) {
		return &sessions[idx-1]
	}

	queryLower := strings.ToLower(query)

	// 2. Exact custom name match
	for i := range sessions {
		name := manager.GetSessionName(sessions[i].ID)
		if name != "" && strings.ToLower(name) == queryLower {
			return &sessions[i]
		}
	}

	// 3. Session ID prefix match
	for i := range sessions {
		if strings.HasPrefix(sessions[i].ID, query) {
			return &sessions[i]
		}
	}

	// 4. Custom name prefix match
	for i := range sessions {
		name := manager.GetSessionName(sessions[i].ID)
		if name != "" && strings.HasPrefix(strings.ToLower(name), queryLower) {
			return &sessions[i]
		}
	}

	// 5. Summary substring match
	for i := range sessions {
		if sessions[i].Summary != "" && strings.Contains(strings.ToLower(sessions[i].Summary), queryLower) {
			return &sessions[i]
		}
	}

	return nil
}

// Refresh the pointer on every turn, including warm CLI sessions and queued input.
func (e *Engine) withSharedMemoryHint(prompt string, agent Agent, msg *Message, workspaceDir string) string {
	dir := workspaceDir
	if dir == "" {
		dir = e.commandWorkDir(agent, msg)
	}
	if hint := e.experienceHint(); hint != "" {
		prompt += "\n\n" + hint
	}
	if hint := sharedMemoryHint(dir, msg.SessionKey); hint != "" {
		return prompt + "\n\n" + hint
	}
	return prompt
}

func (e *Engine) commandWorkDir(agent Agent, msg *Message) string {
	if switcher, ok := agent.(WorkDirSwitcher); ok {
		if wd := strings.TrimSpace(switcher.GetWorkDir()); wd != "" {
			return normalizeWorkspacePath(wd)
		}
	}
	if e.multiWorkspace {
		channelKey := effectiveWorkspaceChannelKey(msg)
		if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); usable {
			return normalizeWorkspacePath(b.Workspace)
		}
	}
	if wd, ok := agent.(interface{ GetWorkDir() string }); ok {
		if dir := strings.TrimSpace(wd.GetWorkDir()); dir != "" {
			return normalizeWorkspacePath(dir)
		}
	}
	if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
		if dir := strings.TrimSpace(wd.GetWorkDir()); dir != "" {
			return normalizeWorkspacePath(dir)
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		return normalizeWorkspacePath(cwd)
	}
	return ""
}

func (e *Engine) cmdShow(p Platform, msg *Message, args []string) {
	rawRef := strings.TrimSpace(strings.Join(args, " "))
	if rawRef == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgShowUsage))
		return
	}

	agent, _, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}
	workDir := e.commandWorkDir(agent, msg)
	req, err := buildReferenceViewRequest(rawRef, workDir)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgShowParseError, rawRef))
		return
	}
	content, err := renderReferenceView(req)
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "path does not exist"):
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgShowNotFound, rawRef))
		case strings.Contains(err.Error(), "directory reference cannot carry a location"):
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgShowDirWithLocation, rawRef))
		default:
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgShowReadFailed, err))
		}
		return
	}
	e.reply(p, msg.ReplyCtx, content)
}
