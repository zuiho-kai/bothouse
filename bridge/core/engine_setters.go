package core

import (
	"fmt"
	"log/slog"
	"maps"
	"sort"
	"strings"
	"time"
)

// DefaultWorkspaceIdleTimeout is the default time a workspace can be idle
// before the reaper reclaims it.
const DefaultWorkspaceIdleTimeout = 15 * time.Minute

// SetMultiWorkspace enables multi-workspace mode for the engine.
func (e *Engine) SetMultiWorkspace(baseDir, bindingStorePath string) {
	e.multiWorkspace = true
	e.baseDir = baseDir
	e.workspaceBindings = NewWorkspaceBindingManager(bindingStorePath)
	e.workspacePool = newWorkspacePool(DefaultWorkspaceIdleTimeout)
	e.initFlows = make(map[string]*workspaceInitFlow)
	go e.runIdleReaper()
}

// SetWorkspaceIdleTimeout overrides the workspace idle reaper timeout.
// Must be called after SetMultiWorkspace. A zero value disables reaping.
func (e *Engine) SetWorkspaceIdleTimeout(d time.Duration) {
	if e.workspacePool != nil {
		e.workspacePool.mu.Lock()
		e.workspacePool.idleTimeout = d
		e.workspacePool.mu.Unlock()
	}
}

// SetWorkspaceInitAllowLocalPaths controls whether workspace init accepts
// existing local directories as targets. When false, init remains git-URL only.
func (e *Engine) SetWorkspaceInitAllowLocalPaths(allow bool) {
	e.workspaceInitAllowLocalPaths = allow
}

func (e *Engine) runIdleReaper() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-ticker.C:
			e.reapIdleWorkspaces()
		}
	}
}

func (e *Engine) reapIdleWorkspaces() {
	if e.workspacePool == nil {
		return
	}

	reaped := e.workspacePool.ReapIdle()
	if len(reaped) == 0 {
		return
	}

	reapedSet := make(map[string]struct{}, len(reaped))
	for _, ws := range reaped {
		reapedSet[ws] = struct{}{}
	}

	type cleanupTarget struct {
		key   string
		state *interactiveState
	}

	var targets []cleanupTarget
	e.interactiveMu.Lock()
	for key, state := range e.interactiveStates {
		if _, ok := reapedSet[state.workspaceDir]; ok {
			targets = append(targets, cleanupTarget{key: key, state: state})
		}
	}
	e.interactiveMu.Unlock()

	for _, target := range targets {
		e.cleanupInteractiveState(target.key, target.state)
	}
	for _, ws := range reaped {
		slog.Info("workspace idle-reaped", "workspace", ws)
	}
}

// SetHooks configures the lifecycle event hook manager.
func (e *Engine) SetHooks(hm *HookManager) {
	e.hooks = hm
}

// SetShell configures the shell binary, flag, and shell profile used for exec.
func (e *Engine) SetShell(shell, flag, shellProfile string) {
	e.shell = shell
	e.shellFlag = flag
	e.shellProfile = shellProfile
}

func (e *Engine) SetSpeechConfig(cfg SpeechCfg) {
	e.speech = cfg
}

// SetTTSConfig configures the text-to-speech subsystem.
func (e *Engine) SetTTSConfig(cfg *TTSCfg) {
	e.tts = cfg
}

// SetTTSSaveFunc registers a callback that persists TTS mode changes.
func (e *Engine) SetTTSSaveFunc(fn func(mode string) error) {
	e.ttsSaveFunc = fn
}

// SetDisplayConfig overrides the default truncation settings.
func (e *Engine) SetDisplayConfig(cfg DisplayCfg) {
	e.display = cfg
}

// SetInstantReply configures the immediate confirmation reply.
func (e *Engine) SetInstantReply(cfg InstantReplyCfg) {
	e.instantReply = cfg
}

// SetReferenceConfig configures local reference normalization/rendering.
func (e *Engine) SetReferenceConfig(cfg ReferenceRenderCfg) {
	e.references = normalizeReferenceRenderCfg(cfg)
}

// estimateTokensWithPendingAssistant is like estimateTokens but includes an assistant
// message not yet written to history (used at EventResult before AddHistory).
func estimateTokensWithPendingAssistant(entries []HistoryEntry, pendingAssistant string) int {
	// Heuristic: ~1 token per 4 characters in mixed English/Chinese.
	count := 0
	for _, h := range entries {
		count += len([]rune(h.Content))
	}
	if pendingAssistant != "" {
		count += len([]rune(pendingAssistant))
	}
	if count == 0 {
		return 0
	}
	return (count + 3) / 4
}

// SetAutoCompressConfig configures automatic context compression.
func (e *Engine) SetAutoCompressConfig(enabled bool, maxTokens int, minGap time.Duration) {
	e.autoCompressEnabled = enabled
	e.autoCompressMaxTokens = maxTokens
	if minGap <= 0 {
		minGap = 30 * time.Minute
	}
	e.autoCompressMinGap = minGap
}

// SetResetOnIdle configures automatic session rotation after prolonged inactivity.
// A zero or negative duration disables the behavior.
func (e *Engine) SetResetOnIdle(d time.Duration) {
	if d <= 0 {
		e.resetOnIdle = 0
		return
	}
	e.resetOnIdle = d
}

// SetAgentSessionIdleTimeout 配置单轮正常结束后的 live agent 空闲关闭时间。
// 小于等于 0 表示禁用。
func (e *Engine) SetAgentSessionIdleTimeout(d time.Duration) {
	if d <= 0 {
		e.agentSessionIdleTimeoutNanos.Store(0)
		e.cancelAllAgentSessionIdleCloses()
		return
	}
	e.agentSessionIdleTimeoutNanos.Store(int64(d))
}

func (e *Engine) cancelAllAgentSessionIdleCloses() {
	e.interactiveMu.Lock()
	states := make([]*interactiveState, 0, len(e.interactiveStates))
	for _, state := range e.interactiveStates {
		states = append(states, state)
	}
	e.interactiveMu.Unlock()
	for _, state := range states {
		e.cancelAgentSessionIdleClose(state)
	}
}

// SetShowContextIndicator controls whether the reply footer's first line
// (model / reasoning effort / token counts / context %) is rendered.
// Subordinate to SetReplyFooterEnabled — when the footer is disabled overall,
// this flag has no effect.
func (e *Engine) SetShowContextIndicator(show bool) {
	e.showContextIndicator = show
}

// SetShowWorkdirIndicator controls whether the reply footer's second line
// (workspace directory) is rendered. Subordinate to SetReplyFooterEnabled.
func (e *Engine) SetShowWorkdirIndicator(show bool) {
	e.showWorkdirIndicator = show
}

// SetShowQuotaIndicator controls whether the status line carries the account
// quota. When false the quota is never queried; model and context stay.
func (e *Engine) SetShowQuotaIndicator(show bool) {
	e.hideQuotaIndicator.Store(!show)
}

// SetShowQuotaStatus controls the quota status texts (unavailable, no data,
// querying, query failed). false = without a measured quota the footer says
// nothing about quota. Default true.
func (e *Engine) SetShowQuotaStatus(show bool) {
	e.hideQuotaStatus.Store(!show)
}

// SetSubagentPolicyEnabled controls whether each agent turn is prefixed with
// the delegation policy (core/subagent.go). Default on.
func (e *Engine) SetSubagentPolicyEnabled(on bool) {
	e.skipSubagentPolicy.Store(!on)
}

// SetReplyFooterEnabled is the master toggle for the per-turn reply footer.
// When false, no footer (statusline-style or single-line) is emitted, and the
// per-line flags (SetShowContextIndicator / SetShowWorkdirIndicator) become
// no-ops.
func (e *Engine) SetReplyFooterEnabled(show bool) {
	e.replyFooterEnabled = show
}

// SetFilterExternalSessions controls whether /list, /switch, /delete, etc.
// hide sessions created by direct CLI usage in the same work_dir.
// Default false = show all sessions from the agent.
func (e *Engine) SetFilterExternalSessions(v bool) {
	e.filterExternalSessions = v
}

func (e *Engine) SetWebSetupFunc(fn func() (int, string, bool, error)) { e.webSetupFunc = fn }
func (e *Engine) SetWebStatusFunc(fn func() string)                    { e.webStatusFunc = fn }

func (e *Engine) SetSkipGit(skipGit bool) {
	e.skipGit = skipGit
}

// SetInjectSender controls whether sender identity (platform and user ID) is
// prepended to each message before forwarding it to the agent. When enabled,
// the agent receives a preamble line like:
//
//	[cc-connect sender_id=ou_abc123 platform=feishu]
//
// This allows the agent to identify who sent the message and adjust behavior
// accordingly (e.g. personal task views, role-based access control).
func (e *Engine) SetInjectSender(v bool) {
	e.injectSender = v
}

// SetAttachmentSendEnabled controls whether side-channel image/file delivery is allowed.
func (e *Engine) SetAttachmentSendEnabled(v bool) {
	e.attachmentSendEnabled = v
}

// SetObserveConfig enables terminal session observation.
// projectDir is the Claude Code project directory containing session JSONL files.
// sessionKey identifies the Slack channel to forward messages to.
func (e *Engine) SetObserveConfig(projectDir, sessionKey string) {
	e.observeEnabled = true
	e.observeProjectDir = projectDir
	e.observeSessionKey = sessionKey
}

func (e *Engine) SetLanguageSaveFunc(fn func(Language) error) {
	e.i18n.SetSaveFunc(fn)
}

// findObserverTarget returns the first platform that implements ObserverTarget,
// or nil if none do.
func (e *Engine) findObserverTarget() ObserverTarget {
	for _, p := range e.platforms {
		if ot, ok := p.(ObserverTarget); ok {
			return ot
		}
	}
	return nil
}

func (e *Engine) SetProviderSaveFunc(fn func(providerName string) error) {
	e.providerSaveFunc = fn
}

func (e *Engine) SetProviderAddSaveFunc(fn func(ProviderConfig) error) {
	e.providerAddSaveFunc = fn
}

func (e *Engine) SetProviderRemoveSaveFunc(fn func(string) error) {
	e.providerRemoveSaveFunc = fn
}

func (e *Engine) SetProviderModelSaveFunc(fn func(providerName, model string) error) {
	e.providerModelSaveFunc = fn
}

func (e *Engine) SetProviderRefsSaveFunc(fn func(refs []string) error) {
	e.providerRefsSaveFunc = fn
}

func (e *Engine) SetListGlobalProvidersFunc(fn func(agentType string) ([]ProviderConfig, error)) {
	e.listGlobalProvidersFunc = fn
}

// SetReasoningEffortSaveFunc persists the project agent's reasoning effort, so a
// restart does not fall back to the config default (2026-10-22 23:21 G哥 cutover).
func (e *Engine) SetReasoningEffortSaveFunc(fn func(effort string) error) {
	e.effortSaveFunc = fn
}

func (e *Engine) SetModelSaveFunc(fn func(model string) error) {
	e.modelSaveFunc = fn
}

// AddPlatform appends a platform to the engine after construction.
// The platform is started and wired during the next Engine.Start call,
// or if the engine is already running, it is started immediately.
func (e *Engine) AddPlatform(p Platform) {
	e.platforms = append(e.platforms, p)
}

// Platforms returns a copy of the engine's platform list.
func (e *Engine) Platforms() []Platform {
	return append([]Platform(nil), e.platforms...)
}

func (e *Engine) SetCronScheduler(cs *CronScheduler) {
	e.cronScheduler = cs
}

func (e *Engine) SetTimerScheduler(ts *TimerScheduler) {
	e.timerScheduler = ts
}

func (e *Engine) SetHeartbeatScheduler(hs *HeartbeatScheduler) {
	e.heartbeatScheduler = hs
}

func (e *Engine) SetCommandSaveAddFunc(fn func(name, description, prompt, exec, workDir string) error) {
	e.commandSaveAddFunc = fn
}

func (e *Engine) SetCommandSaveDelFunc(fn func(name string) error) {
	e.commandSaveDelFunc = fn
}

func (e *Engine) SetDisplaySaveFunc(fn func(mode *string, thinkingMessages *bool, thinkingMaxLen, toolMaxLen *int, toolMessages *bool) error) {
	e.displaySaveFunc = fn
}

// ConfigReloadResult describes what was updated by a config reload.
type ConfigReloadResult struct {
	DisplayUpdated   bool
	ProvidersUpdated int
	CommandsUpdated  int
	// RestartKeys lists platform options ("<platform>.<key>") that changed in config.toml
	// but only take effect after a restart.
	RestartKeys []string
}

// OptionsReloader is implemented by platforms that can take some options from a
// reloaded config.toml while running. ReloadOptions returns the changed keys that still
// need a restart.
type OptionsReloader interface {
	ReloadOptions(opts map[string]any) []string
}

// ReloadPlatformOptions hands each running platform its options from the reloaded config
// (keyed by platform type). It returns "<type>.<key>" for every change that needs a restart;
// a platform without OptionsReloader reports "<type>" when its options changed at all.
func (e *Engine) ReloadPlatformOptions(byType map[string]map[string]any, started map[string]map[string]any) []string {
	var restart []string
	for _, p := range e.platforms {
		opts, ok := byType[p.Name()]
		if !ok {
			continue
		}
		if r, ok := p.(OptionsReloader); ok {
			for _, k := range r.ReloadOptions(opts) {
				restart = append(restart, p.Name()+"."+k)
			}
		} else if started != nil && fmt.Sprint(started[p.Name()]) != fmt.Sprint(opts) {
			restart = append(restart, p.Name())
		}
	}
	return restart
}

func (e *Engine) SetConfigReloadFunc(fn func() (*ConfigReloadResult, error)) {
	e.configReloadFunc = fn
}

// GetAgent returns the engine's agent (for type assertions like ProviderSwitcher).
func (e *Engine) GetAgent() Agent {
	return e.agent
}

// GetSessions returns the Engine's session manager (for testing).
func (e *Engine) GetSessions() *SessionManager {
	return e.sessions
}

// AddCommand registers a custom slash command.
func (e *Engine) AddCommand(name, description, prompt, exec, workDir, source string) {
	e.commands.Add(name, description, prompt, exec, workDir, source)
}

// ClearCommands removes all commands from the given source.
func (e *Engine) ClearCommands(source string) {
	e.commands.ClearSource(source)
}

// AddAlias registers a command alias.
func (e *Engine) AddAlias(name, command string) {
	e.aliasMu.Lock()
	defer e.aliasMu.Unlock()
	e.aliases[name] = command
}

func (e *Engine) SetAliasSaveAddFunc(fn func(name, command string) error) {
	e.aliasSaveAddFunc = fn
}

func (e *Engine) SetAliasSaveDelFunc(fn func(name string) error) {
	e.aliasSaveDelFunc = fn
}

// ClearAliases removes all aliases (for config reload).
func (e *Engine) ClearAliases() {
	e.aliasMu.Lock()
	defer e.aliasMu.Unlock()
	e.aliases = make(map[string]string)
}

// resolveDisabledCmds resolves a list of command names (including "*" wildcard)
// to a set of canonical command IDs.
func resolveDisabledCmds(cmds []string) map[string]bool {
	m := make(map[string]bool, len(cmds))
	for _, c := range cmds {
		c = strings.ToLower(strings.TrimPrefix(c, "/"))
		if c == "*" {
			for _, bc := range builtinCommands {
				m[bc.id] = true
			}
			return m
		}
		if id := matchPrefix(c, builtinCommands); id != "" {
			m[id] = true
		} else {
			m[c] = true
		}
	}
	return m
}

// GetDisabledCommands returns the list of disabled command IDs for this project.
func (e *Engine) GetDisabledCommands() []string {
	e.userRolesMu.RLock()
	defer e.userRolesMu.RUnlock()
	out := make([]string, 0, len(e.disabledCmds))
	for k := range e.disabledCmds {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// SetDisabledCommands sets the list of command IDs that are disabled for this project.
func (e *Engine) SetDisabledCommands(cmds []string) {
	e.userRolesMu.Lock()
	defer e.userRolesMu.Unlock()
	e.disabledCmds = resolveDisabledCmds(cmds)
}

// SetUserRoles configures per-user role-based policies. Pass nil to disable.
func (e *Engine) SetUserRoles(urm *UserRoleManager) {
	e.userRolesMu.Lock()
	defer e.userRolesMu.Unlock()
	if e.userRoles != nil {
		e.userRoles.Stop()
	}
	e.userRoles = urm
}

// SetAdminFrom sets the admin allowlist for privileged commands.
// "*" means all users who pass allow_from are admins.
// Empty string means privileged commands are denied for everyone.
func (e *Engine) SetAdminFrom(adminFrom string) {
	e.userRolesMu.Lock()
	e.adminFrom = strings.TrimSpace(adminFrom)
	af := e.adminFrom
	shellDisabled := e.disabledCmds["shell"]
	e.userRolesMu.Unlock()
	if af == "" && !shellDisabled {
		slog.Warn("admin_from is not set — privileged commands (/shell, /show, /dir, /restart, /upgrade) are blocked. "+
			"Set admin_from (your user ID, see /whoami) at the [[projects]] level of config.toml — not under "+
			"[projects.platforms.options] — to enable them, or use disabled_commands to hide them.",
			"project", e.name)
	}
}

// privilegedCommands are commands that require admin_from authorization.
var privilegedCommands = map[string]bool{
	"shell":   true,
	"show":    true,
	"dir":     true,
	"restart": true,
	"upgrade": true,
	"web":     true,
	"diff":    true,
}

// isPrivilegedCommandInvocation extends the privilegedCommands map to
// also gate specific destructive subcommands. Currently:
//
//   - /commands addexec ...    — registers a custom shell-exec command
//   - /cron    addexec ...     — schedules a recurring shell-exec
//
// Both effectively create new admin-only commands at runtime; if a
// non-admin can call addexec, they can install arbitrary shell commands
// for any future user to trigger. Sibling subcommands (list, add, del,
// etc.) remain non-privileged.
//
// Returns true when the cmdID itself is in privilegedCommands, or when
// the (cmdID, args[0]) pair matches one of the explicitly-gated
// subcommands above.
func isPrivilegedCommandInvocation(cmdID string, args []string) bool {
	if privilegedCommands[cmdID] {
		return true
	}
	if len(args) == 0 {
		return false
	}
	sub := strings.ToLower(args[0])
	switch cmdID {
	case "commands":
		return matchSubCommand(sub, []string{
			"list", "add", "addexec", "del", "delete", "rm", "remove",
		}) == "addexec"
	case "cron":
		return matchSubCommand(sub, []string{
			"add", "addexec", "list", "del", "delete", "rm", "remove", "enable", "disable", "mute", "unmute", "setup",
		}) == "addexec"
	default:
		return false
	}
}

// isAdmin checks whether the given user ID is authorized for privileged commands.
// Unlike AllowList, empty adminFrom means deny-all (fail-closed).
func (e *Engine) isAdmin(userID string) bool {
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	if af == "" {
		return false
	}
	if af == "*" {
		return true
	}
	for _, id := range strings.Split(af, ",") {
		if strings.EqualFold(strings.TrimSpace(id), userID) {
			return true
		}
	}
	return false
}

// SetBannedWords replaces the banned words list.
func (e *Engine) SetBannedWords(words []string) {
	e.bannedMu.Lock()
	defer e.bannedMu.Unlock()
	lower := make([]string, len(words))
	for i, w := range words {
		lower[i] = strings.ToLower(w)
	}
	e.bannedWords = lower
}

// SetRateLimitCfg configures per-session message rate limiting.
// It stops the previous rate limiter's background goroutine before replacing it.
func (e *Engine) SetRateLimitCfg(cfg RateLimitCfg) {
	next := NewRateLimiter(cfg.MaxMessages, cfg.Window)
	if old := e.rateLimiter.Load(); old != nil {
		if old.maxMessages == next.maxMessages && old.windowMs == next.windowMs {
			next.Stop() // unchanged on a reload: keep the counts collected so far
			return
		}
		defer old.Stop()
	}
	e.rateLimiter.Store(next)
}

// SetOutgoingRateLimitCfg configures per-platform outgoing message throttling.
func (e *Engine) SetOutgoingRateLimitCfg(defaults OutgoingRateLimitCfg, overrides map[string]OutgoingRateLimitCfg) {
	if old := e.outgoingRL.Load(); old != nil && old.defaults == defaults && maps.Equal(old.overrides, overrides) {
		return // unchanged on a reload: keep the token buckets
	}
	e.outgoingRL.Store(NewOutgoingRateLimiter(defaults, overrides))
}

// checkRateLimit returns true if the message is allowed, false if rate-limited.
// It checks per-user role-based limits first, then falls back to the global limiter.
func (e *Engine) checkRateLimit(msg *Message) bool {
	e.userRolesMu.RLock()
	urm := e.userRoles
	e.userRolesMu.RUnlock()

	// Try role-specific rate limit first
	if urm != nil {
		// Use userID if available, else fall back to sessionKey for unidentified users.
		// NOTE: sessionKey fallback means anonymous users get separate buckets per
		// session, which is less strict than per-user limiting. Platforms should
		// provide UserID for effective rate limiting.
		rateKey := msg.UserID
		if rateKey == "" {
			rateKey = msg.SessionKey
			slog.Debug("rate limit: no UserID, falling back to sessionKey", "session_key", msg.SessionKey)
		}
		allowed, handled := urm.AllowRate(rateKey)
		if handled {
			return allowed
		}
		// Role has no rate_limit config — fall through to global, keyed by user
	}
	// Global rate limiter
	rl := e.rateLimiter.Load()
	if rl == nil {
		return true
	}
	// When users config active: key by userID (per-user); otherwise sessionKey (legacy)
	key := msg.SessionKey
	if urm != nil && msg.UserID != "" {
		key = msg.UserID
	}
	return rl.Allow(key)
}

// SetStreamPreviewCfg configures the streaming preview behavior.
func (e *Engine) SetStreamPreviewCfg(cfg StreamPreviewCfg) {
	e.streamPreview = cfg
}

// SetMaxTurnTime sets an absolute wall-clock limit on how long a single agent turn
// may run. Unlike SetEventIdleTimeout (which resets on every event), this timer is
// not reset by tool-call activity. When it fires, the session is terminated and the
// user is notified. A value of 0 disables the limit (default).
//
// This is the primary mitigation for #1091: long-running bash commands that generate
// periodic tool events keep the idle timer alive indefinitely; the turn timer caps them.
func (e *Engine) SetMaxTurnTime(d time.Duration) {
	e.maxTurnTime = d
}

// SetEventIdleTimeout sets the maximum time to wait between consecutive agent events.
// 0 disables the timeout entirely.
func (e *Engine) SetEventIdleTimeout(d time.Duration) {
	e.eventIdleTimeout = d
}

// SetMaxQueuedMessages sets the per-session message queue depth.
// Values <= 0 mean the default depth.
func (e *Engine) SetMaxQueuedMessages(n int) {
	if n <= 0 {
		n = defaultMaxQueuedMessages
	}
	e.maxQueuedMessages = n
}

func (e *Engine) SetRelayManager(rm *RelayManager) {
	e.relayManager = rm
}

func (e *Engine) RelayManager() *RelayManager {
	return e.relayManager
}

func (e *Engine) SetDirHistory(dh *DirHistory) {
	e.dirHistory = dh
}

func (e *Engine) SetBaseWorkDir(dir string) {
	e.baseWorkDir = dir
}

func (e *Engine) SetProjectStateStore(store *ProjectStateStore) {
	e.projectState = store
	if store != nil {
		e.pendingSwitch = maps.Clone(store.state.PendingModelSwitches)
	}
}

func (e *Engine) SetDataDir(dir string) {
	e.dataDir = dir
	if dir == "" {
		return
	}
	managedSkillMu.Lock()
	if state, err := readManagedSkillState(dir); err == nil {
		if err := refreshManagedSkillView(dir, e.name, state); err != nil {
			slog.Warn("refresh managed skill view", "project", e.name, "error", err)
		}
	}
	managedSkillMu.Unlock()
	dirs := e.skills.Dirs()
	e.skills.SetDirs(append(dirs, ManagedSkillViewDir(dir, e.name)))
}

// RemoveCommand removes a custom command by name. Returns false if not found.
func (e *Engine) RemoveCommand(name string) bool {
	return e.commands.Remove(name)
}

func (e *Engine) ProjectName() string {
	return e.name
}

// ListSkills returns all discovered skills for this engine's project.
func (e *Engine) ListSkills() []*Skill {
	return e.skills.ListAll()
}

// SkillDirs returns the configured skill directories for this engine.
func (e *Engine) SkillDirs() []string {
	return e.skills.Dirs()
}

// agentHookExtra (maomao fork) names the runtime ("agent": claudecode, codex, …) and its session
// ("agent_session_id", when known) on message.received / message.sent, so a hook can keep one record of
// every conversation whatever runtime runs it (sessionlog; user 2026-10-20 「万一别人不用了claude code，他这个
// 就有个能力缺口」). extra is kept (trigger_message_ids); nil is fine.
func (e *Engine) agentHookExtra(agentSessionID string, extra map[string]any) map[string]any {
	out := make(map[string]any, len(extra)+2)
	for k, v := range extra {
		out[k] = v
	}
	if e.agent != nil {
		out["agent"] = e.agent.Name()
	}
	if agentSessionID != "" {
		out["agent_session_id"] = agentSessionID
	}
	return out
}

// activeAgentSessionID is the agent session of sessionKey's active session without creating one ("" when there is
// none yet, e.g. a channel's first message, or in multi-workspace mode where sessions live per workspace).
func (e *Engine) activeAgentSessionID(sessionKey string) string {
	if e.sessions == nil {
		return ""
	}
	if s := e.sessions.FindByID(e.sessions.ActiveSessionID(sessionKey)); s != nil {
		return s.GetAgentSessionID()
	}
	return ""
}

// AgentTypeName returns the agent type name (e.g. "claudecode", "codex").
func (e *Engine) AgentTypeName() string {
	if e.agent != nil {
		return e.agent.Name()
	}
	return ""
}

// ActiveSessionKeys returns the session keys of all active interactive sessions.
func (e *Engine) ActiveSessionKeys() []string {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	var keys []string
	for key, state := range e.interactiveStates {
		if state.platform != nil {
			keys = append(keys, key)
		}
	}
	return keys
}
