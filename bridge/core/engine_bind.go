package core

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// cmdBind handles /bind — establishes a relay binding between bots in a group chat.
//
// Usage:
//
//	/bind <project>           — bind current bot with another project in this group
//	/bind remove              — remove all bindings for this group
//	/bind -<project>          — remove specific project from binding
//	/bind                     — show current binding status
//
// The <project> argument is the project name from config.toml [[projects]].
// Multiple projects can be bound together for relay.
func (e *Engine) cmdBind(p Platform, msg *Message, args []string) {
	if e.relayManager == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelayNotAvailable))
		return
	}

	_, chatID, err := parseSessionKeyParts(msg.SessionKey)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelayNotAvailable))
		return
	}

	if len(args) == 0 {
		e.cmdBindStatus(p, msg.ReplyCtx, p.Name(), chatID)
		return
	}

	otherProject := args[0]

	// Handle removal commands
	if otherProject == "remove" || otherProject == "rm" || otherProject == "unbind" || otherProject == "del" || otherProject == "clear" {
		e.relayManager.Unbind(chatID)
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelayUnbound))
		return
	}

	if otherProject == "setup" {
		e.cmdBindSetup(p, msg)
		return
	}

	if otherProject == "help" || otherProject == "-h" || otherProject == "--help" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelayUsage))
		return
	}

	// Handle removal with - prefix: /bind -project
	if strings.HasPrefix(otherProject, "-") {
		projectToRemove := strings.TrimPrefix(otherProject, "-")
		if e.relayManager.RemoveFromBind(chatID, projectToRemove) {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelayBindRemoved), projectToRemove))
		} else {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelayBindNotFound), projectToRemove))
		}
		return
	}

	if otherProject == e.name {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelayBindSelf))
		return
	}

	// Validate the target project exists
	if !e.relayManager.HasEngine(otherProject) {
		available := e.relayManager.ListEngineNames()
		var others []string
		for _, n := range available {
			if n != e.name {
				others = append(others, n)
			}
		}
		if len(others) == 0 {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelayNoTarget), otherProject))
		} else {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelayNotFound), otherProject, strings.Join(others, ", ")))
		}
		return
	}

	// Add current project and target project to binding
	e.relayManager.AddToBind(p.Name(), chatID, e.name)
	e.relayManager.AddToBind(p.Name(), chatID, otherProject)

	// Get all bound projects for status message
	// Same view as a bare /bind: manual binding plus this project's team (relay_team_bind.go).
	binding := e.relayManager.EffectiveBindingFor(p.Name(), chatID, e.name)
	var boundProjects []string
	if binding != nil {
		for proj := range binding.Bots {
			boundProjects = append(boundProjects, proj)
		}
	}
	sort.Strings(boundProjects)

	reply := fmt.Sprintf(e.i18n.T(MsgRelayBindSuccess), strings.Join(boundProjects, " ↔ "), otherProject, otherProject)

	if _, ok := e.agent.(SystemPromptSupporter); !ok {
		if mp, ok := e.agent.(MemoryFileProvider); ok {
			reply += fmt.Sprintf(e.i18n.T(MsgRelaySetupHint), filepath.Base(mp.ProjectMemoryFile()))
		}
	}

	e.reply(p, msg.ReplyCtx, reply)
}

func (e *Engine) cmdBindStatus(p Platform, replyCtx any, platform, chatID string) {
	binding := e.relayManager.EffectiveBindingFor(platform, chatID, e.name)
	if binding == nil {
		e.reply(p, replyCtx, e.i18n.T(MsgRelayNoBinding))
		return
	}
	var parts []string
	for proj := range binding.Bots {
		parts = append(parts, proj)
	}
	e.reply(p, replyCtx, fmt.Sprintf(e.i18n.T(MsgRelayBound), strings.Join(parts, " ↔ ")))
}

const ccConnectInstructionMarker = "<!-- bothouse-instructions -->"

type setupResult int

const (
	setupOK       setupResult = iota // instructions written successfully
	setupExists                      // instructions already present
	setupNative                      // agent supports system prompt natively
	setupNoMemory                    // agent has no memory file support
	setupError                       // write error
)

// setupMemoryFile appends AgentSystemPrompt() to the agent's project memory
// file. It returns the result, the filename (for messages), and any error.
func (e *Engine) setupMemoryFile() (setupResult, string, error) {
	if _, ok := e.agent.(SystemPromptSupporter); ok {
		return setupNative, "", nil
	}

	mp, ok := e.agent.(MemoryFileProvider)
	if !ok {
		return setupNoMemory, "", nil
	}

	filePath := mp.ProjectMemoryFile()
	if filePath == "" {
		return setupNoMemory, "", nil
	}

	baseName := filepath.Base(filePath)

	existing, _ := os.ReadFile(filePath)
	existingText := string(existing)
	block := "\n" + ccConnectInstructionMarker + "\n" + AgentSystemPrompt() + "\n"
	if idx := strings.Index(existingText, ccConnectInstructionMarker); idx >= 0 {
		if strings.Contains(existingText[idx:], AgentSystemPrompt()) {
			return setupExists, baseName, nil
		}
		updated := strings.TrimRight(existingText[:idx], "\n") + block
		if err := os.WriteFile(filePath, []byte(updated), 0o644); err != nil {
			return setupError, baseName, err
		}
		return setupOK, baseName, nil
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return setupError, baseName, err
	}

	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return setupError, baseName, err
	}
	defer f.Close()

	if _, err := f.WriteString(block); err != nil {
		return setupError, baseName, err
	}

	return setupOK, baseName, nil
}

func (e *Engine) cmdBindSetup(p Platform, msg *Message) {
	result, baseName, err := e.setupMemoryFile()
	switch result {
	case setupNative:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgSetupNative))
	case setupNoMemory:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelaySetupNoMemory))
	case setupExists:
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelaySetupExists), baseName))
	case setupError:
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
	case setupOK:
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelaySetupOK), baseName))
	}
}

// chatIdentityBlock names the shared chat itself. Without it a group turn only carries
// people and message text, so the model tends to infer the room from the topic under discussion
// (2026-11-26: a fork question in "Superintelligent 交流群" was answered as "这边是 bothouse 群").
// The line is turn context, not sender injection, so it is present even where sender injection is off.
func chatIdentityBlock(msg *Message) string {
	if !msg.GroupChat {
		return ""
	}
	chatID := msg.ChannelKey
	if chatID == "" {
		chatID = extractChannelID(msg.SessionKey)
	}
	name := strings.TrimSpace(msg.ChatName)
	if name == "" || name == chatID {
		return fmt.Sprintf("[Chat identity: type=group platform=%s chat_id=%s; the group display name is unavailable, but this chat is not named after the project or repository]", msg.Platform, chatID)
	}
	safeName := strings.NewReplacer(`"`, `'`, "\n", " ", "\r", "").Replace(name)
	return fmt.Sprintf("[Chat identity: type=group platform=%s chat_name=\"%s\" chat_id=%s; refer to this chat by this name, not by the project or repository name]", msg.Platform, safeName, chatID)
}

// senderText prefixes a multi-party message's own words with the sender's display name.
// GroupChat and UserName are structured platform fields, so the label does not depend on
// AmbientChat: the first message after start/reconnect, and a quote-only message, keep
// their author too. DMs, bot payloads and commands stay raw so routing and command parsing
// are unchanged.
func senderText(msg *Message, text string) string {
	// GroupChat is the structured signal; AmbientChat is kept as a compatibility fallback
	// for a platform that has not set GroupChat yet (it can only exist in a group anyway).
	if (!msg.GroupChat && msg.AmbientChat == "") || msg.FromBot || msg.Direct || text == "" || msg.UserName == "" ||
		strings.HasPrefix(text, "/") || strings.HasPrefix(text, "!") {
		return text
	}
	return strings.NewReplacer("\n", " ", "\r", "").Replace(msg.UserName) + "：" + text
}

// voiceNoteMark tells the model the words under it came from speech
// recognition, not from the person typing.
//
// Why it exists: handleVoiceMessage posts the transcript back to the channel as
// "🎙 [语音] …" and then re-dispatches the message with only Content replaced,
// so the prompt the model sees is bare text. #215 (2026-11-06 09:08-09:09) is
// what that costs: the model read 「1235」 as typing, answered 「听不到，收到的一直是文字」,
// and the person had to send the voice message twice. The mark goes after the
// sender header (buildSenderPrompt) so that header stays the first line.
const voiceNoteMark = "（这条是语音消息，下面是语音转成的文字，是说话人说的，不是打字发的）"

// withVoiceNote marks message text that came from speech recognition. It is
// applied to the text before buildSenderPrompt so the sender header stays the
// first line of the prompt. It wraps one part, never a mixed batch: a merged
// queue batch marks each voice part where it sits, and the gate marks a
// transcript before the buffered/backfilled history is put above it. Callers
// pass fromVoice && !voiceMarked, so a part that already carries the mark is
// not marked again on a re-dispatch (queued turn, mid-turn injection, capacity
// retry); a plain FromVoice message without that flag is marked by whichever
// prompt build runs first.
func withVoiceNote(content string, fromVoice bool) string {
	if !fromVoice {
		return content
	}
	return voiceNoteMark + "\n" + content
}

// buildSenderPrompt prepends a sender identity header to content when
// injectSender is enabled and userID is non-empty. When userName is available
// it is included as sender_name so the agent can identify who sent the message
// by display name (useful in shared channel sessions with multiple users).
func (e *Engine) buildSenderPrompt(content, userID, userName, platform, sessionKey, channelKey string) string {
	if !e.injectSender || userID == "" {
		return content
	}
	chatID := channelKey
	if chatID == "" {
		chatID = extractChannelID(sessionKey)
	}
	// The owner (admin_from, from the wizard's bot-owner lookup) is marked so the agent knows
	// who its owner is without searching its notes; "*" names no one in particular.
	owner := ""
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	if af != "*" && e.isAdmin(userID) {
		owner = " sender_is_owner=true"
	}
	if userName != "" {
		safeName := strings.NewReplacer(`"`, `'`, "\n", " ", "\r", "").Replace(userName)
		return fmt.Sprintf("[bothouse sender_id=%s sender_name=\"%s\"%s platform=%s chat_id=%s]\n%s", userID, safeName, owner, platform, chatID, content)
	}
	return fmt.Sprintf("[bothouse sender_id=%s%s platform=%s chat_id=%s]\n%s", userID, owner, platform, chatID, content)
}

func extractChannelID(sessionKey string) string {
	// Format: "platform:channelID:userID" or "platform:channelID"
	// Some platforms encode a short type tag as an extra segment, e.g.
	// "platform:t:channelID:userID" or "platform:t:channelID" (shared session)
	// where t is a single-char tag. When parts[1] is a single char and at
	// least one more segment follows, treat parts[2] as the real channel ID.
	parts := strings.SplitN(sessionKey, ":", 4)
	if len(parts) >= 3 && len(parts[1]) == 1 {
		return parts[2]
	}
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}

func extractUserID(sessionKey string) string {
	// Format: "platform:channelID:userID" or "platform:type:channelID:userID"
	// When parts[1] is a single-char type tag, the user ID is in parts[3]
	// (4-segment form). The 3-segment form with a type tag (shared session,
	// e.g. "dingtalk:g:cid") has no per-user ID, so return "".
	parts := strings.SplitN(sessionKey, ":", 5)
	if len(parts) >= 3 && len(parts[1]) == 1 {
		if len(parts) >= 4 {
			return parts[3]
		}
		return ""
	}
	if len(parts) >= 3 {
		return parts[2]
	}
	return ""
}

func extractPlatformName(sessionKey string) string {
	if i := strings.IndexByte(sessionKey, ':'); i >= 0 {
		return sessionKey[:i]
	}
	return sessionKey
}

func workspaceChannelKey(platformName, channelID string) string {
	if channelID == "" {
		return ""
	}
	if platformName == "" {
		return channelID
	}
	return platformName + ":" + channelID
}

func extractWorkspaceChannelKey(sessionKey string) string {
	return workspaceChannelKey(extractPlatformName(sessionKey), extractChannelID(sessionKey))
}

// effectiveChannelID returns the channel identifier from a Message.
// It prefers the platform-provided ChannelKey (e.g. "chatID:threadID" for forum topics)
// and falls back to parsing the session key.
func effectiveChannelID(msg *Message) string {
	if msg.ChannelKey != "" {
		return msg.ChannelKey
	}
	return extractChannelID(msg.SessionKey)
}

// effectiveWorkspaceChannelKey returns the workspace binding key from a Message.
func effectiveWorkspaceChannelKey(msg *Message) string {
	if msg.ChannelKey != "" {
		return workspaceChannelKey(msg.Platform, msg.ChannelKey)
	}
	return extractWorkspaceChannelKey(msg.SessionKey)
}

// migrateLegacyWorkspaceBindings moves bindings from a platform-provided
// legacy channel scope to the current scope before workspace resolution. The
// platform owns both opaque identifiers; core only adds the platform prefix.
func (e *Engine) migrateLegacyWorkspaceBindings(msg *Message) {
	if e.workspaceBindings == nil || msg == nil || msg.ChannelKey == "" || msg.LegacyChannelKey == "" {
		return
	}
	oldChannelKey := workspaceChannelKey(msg.Platform, msg.LegacyChannelKey)
	newChannelKey := workspaceChannelKey(msg.Platform, msg.ChannelKey)
	if oldChannelKey == "" || newChannelKey == "" || oldChannelKey == newChannelKey {
		return
	}

	for _, projectKey := range []string{"project:" + e.name, sharedWorkspaceBindingsKey} {
		if e.workspaceBindings.MigrateChannelKey(projectKey, oldChannelKey, newChannelKey) {
			slog.Info("workspace binding migrated",
				"project", projectKey,
				"old_channel_key", oldChannelKey,
				"new_channel_key", newChannelKey)
		}
	}
}

// commandContext resolves the appropriate agent, session manager, and interactive key
// for a command. In multi-workspace mode, it routes to the bound workspace if present.
func (e *Engine) commandContext(p Platform, msg *Message) (Agent, *SessionManager, string, error) {
	agent, sessions, interactiveKey, _, err := e.commandContextWithWorkspace(p, msg)
	return agent, sessions, interactiveKey, err
}

// commandContextWithWorkspace is like commandContext but additionally returns
// the resolved workspace path for callers that need to forward it to
// processInteractiveMessageWith (idle reaper bookkeeping, reply footer, etc).
func (e *Engine) commandContextWithWorkspace(p Platform, msg *Message) (Agent, *SessionManager, string, string, error) {
	if !e.multiWorkspace {
		return e.agent, e.sessions, msg.SessionKey, "", nil
	}
	channelID := effectiveChannelID(msg)
	channelKey := effectiveWorkspaceChannelKey(msg)
	if channelKey == "" || channelID == "" {
		return e.agent, e.sessions, msg.SessionKey, "", nil
	}
	workspace, _, err := e.resolveWorkspace(p, channelID)
	if err != nil {
		return nil, nil, "", "", err
	}
	if workspace == "" {
		return e.agent, e.sessions, msg.SessionKey, "", nil
	}
	agent, sessions, interactiveKey, effectiveDir, err := e.workspaceContext(workspace, msg.SessionKey)
	if err != nil {
		return nil, nil, "", "", err
	}
	return agent, sessions, interactiveKey, effectiveDir, nil
}

// sessionContextForKey resolves the agent and session manager for a sessionKey.
// It uses existing workspace bindings and falls back to global context if unresolved.
func (e *Engine) sessionContextForKey(sessionKey string) (Agent, *SessionManager) {
	if workspace := e.sendWorkDirForSession(sessionKey); workspace != "" {
		if wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(workspace); err == nil {
			return wsAgent, wsSessions
		}
	}
	if !e.multiWorkspace || e.workspaceBindings == nil {
		return e.agent, e.sessions
	}
	if channelKey := extractWorkspaceChannelKey(sessionKey); channelKey != "" {
		if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); usable {
			if wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(normalizeWorkspacePath(b.Workspace)); err == nil {
				return wsAgent, wsSessions
			}
		}
	}
	// Live-state fallback: when channel-derived binding misses (Discord
	// thread_isolation case where binding is keyed by parent channel but
	// sessionKey is the thread ID), recover the workspace from any live
	// interactive state keyed as "<workspace>:<sessionKey>". Without this,
	// callers would route to the global agent while interactiveKeyForSessionKey
	// returns the workspace-prefixed key, allowing concurrent unlocked sends
	// to the same agent session.
	if workspace := e.workspaceFromLiveState(sessionKey); workspace != "" {
		if wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(workspace); err == nil {
			return wsAgent, wsSessions
		}
	}
	return e.agent, e.sessions
}

func (e *Engine) bindSendWorkDir(sessionKey, workDir string) {
	if sessionKey == "" || workDir == "" {
		return
	}
	keys := []string{sessionKey}
	if participantKey := directParticipantKeyForSession(sessionKey); participantKey != "" {
		keys = append(keys, participantKey)
	}
	e.sendWorkDirMu.Lock()
	defer e.sendWorkDirMu.Unlock()
	if e.sendWorkDirs == nil {
		e.sendWorkDirs = make(map[string]string)
	}
	for _, key := range keys {
		if key != "" {
			e.sendWorkDirs[key] = workDir
		}
	}
}

func (e *Engine) sendWorkDirForSession(sessionKey string) string {
	if sessionKey == "" {
		return ""
	}
	participantKey := directParticipantKeyForSession(sessionKey)
	e.sendWorkDirMu.RLock()
	defer e.sendWorkDirMu.RUnlock()
	if workDir := e.sendWorkDirs[sessionKey]; workDir != "" {
		return workDir
	}
	if participantKey != "" {
		return e.sendWorkDirs[participantKey]
	}
	return ""
}

func directParticipantKeyForSession(sessionKey string) string {
	platformName := extractPlatformName(sessionKey)
	if platformName == "" {
		return ""
	}
	parts := strings.SplitN(sessionKey, ":", 5)
	if len(parts) < 4 || parts[1] != "d" || strings.TrimSpace(parts[3]) == "" {
		return ""
	}
	return platformName + ":direct-user:" + strings.TrimSpace(parts[3])
}

// workspaceFromLiveState extracts the workspace path embedded in a live
// interactive state key for sessionKey, or "" if no live state references
// this sessionKey. Used as a recovery path when channel-binding-derived
// workspace resolution misses.
func (e *Engine) workspaceFromLiveState(sessionKey string) string {
	if sessionKey == "" {
		return ""
	}
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	suffix := ":" + sessionKey
	for k := range e.interactiveStates {
		if strings.HasSuffix(k, suffix) {
			return strings.TrimSuffix(k, suffix)
		}
	}
	return ""
}

// interactiveKeyForSessionKey returns the interactive state key for a sessionKey.
// In multi-workspace mode, it prefixes with the bound workspace path when available.
func (e *Engine) interactiveKeyForSessionKey(sessionKey string) string {
	if workspace := e.sendWorkDirForSession(sessionKey); workspace != "" {
		return workspace + ":" + sessionKey
	}
	// Single-workspace fast path: no scan, no binding lookup, no lock.
	if !e.multiWorkspace || e.workspaceBindings == nil {
		return sessionKey
	}
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	return e.interactiveKeyForSessionKeyLocked(sessionKey)
}

// interactiveKeyForSessionKeyLocked is the lock-free variant of
// interactiveKeyForSessionKey. It assumes the caller already holds
// e.interactiveMu (e.g. SendToSessionWithAttachments which scans
// interactiveStates under the lock and then needs to resolve the
// canonical key for a session).
//
// Resolution precedence:
//
//  1. Exact match — if state already exists under raw sessionKey, prefer it
//     so a single-workspace placeholder isn't shadowed by a workspace-
//     prefixed state created later.
//  2. Channel-binding-derived — if the channel resolves to a workspace,
//     return "<workspace>:<sessionKey>". This is deterministic even when
//     multiple workspace-prefixed states for the same sessionKey coexist
//     (e.g. a channel rebound to a new workspace while the old workspace's
//     state hasn't been cleaned up yet) — the *current* binding wins, and
//     any stale workspace state becomes unreachable through this lookup,
//     which is exactly what we want.
//  3. Live-state suffix scan — only fires when channel-binding lookup
//     fails. This is the recovery path for Discord thread_isolation: the
//     binding is keyed by the parent channel, but sessionKey is the thread
//     ID, so step 2 misses. The state map was keyed correctly at processing
//     time, so we recover the workspace prefix from there.
func (e *Engine) interactiveKeyForSessionKeyLocked(sessionKey string) string {
	if workspace := e.sendWorkDirForSession(sessionKey); workspace != "" {
		return workspace + ":" + sessionKey
	}
	if !e.multiWorkspace || e.workspaceBindings == nil {
		return sessionKey
	}
	if _, ok := e.interactiveStates[sessionKey]; ok {
		return sessionKey
	}
	if channelKey := extractWorkspaceChannelKey(sessionKey); channelKey != "" {
		if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); usable {
			return normalizeWorkspacePath(b.Workspace) + ":" + sessionKey
		}
	}
	if found := findInteractiveKeyInStatesLocked(e.interactiveStates, sessionKey); found != "" {
		return found
	}
	return sessionKey
}

// findInteractiveKeyForSession scans the live interactiveStates map for an
// interactive key that matches sessionKey, either as the key itself or as
// the trailing "<workspace>:<sessionKey>" segment. Returns "" when no live
// state references this sessionKey. Acquires e.interactiveMu internally;
// callers that already hold the lock must use findInteractiveKeyInStatesLocked.
//
// The scan is bounded by the number of in-flight interactive sessions
// (typically <10), so the linear cost is negligible compared to even one
// binding lookup. Avoiding a parallel sessionKey→interactiveKey map keeps
// the engine's state surface single-source-of-truth.
func (e *Engine) findInteractiveKeyForSession(sessionKey string) string {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	return findInteractiveKeyInStatesLocked(e.interactiveStates, sessionKey)
}

// findInteractiveKeyInStatesLocked is the lock-free body of the scan; it
// assumes the caller holds e.interactiveMu.
//
// Precedence is exact match first, then suffix scan. The exact path matters
// because Go map iteration order is randomized: if both `sessionKey` and
// `<workspace>:<sessionKey>` are live (e.g. a raw placeholder created before
// multi-workspace was enabled coexisting with a workspace-prefixed turn),
// a pure scan could non-deterministically return either, sending /stop or
// pending-permission handling at the wrong state.
func findInteractiveKeyInStatesLocked(states map[string]*interactiveState, sessionKey string) string {
	if sessionKey == "" {
		return ""
	}
	if _, ok := states[sessionKey]; ok {
		return sessionKey
	}
	suffix := ":" + sessionKey
	for k := range states {
		if strings.HasSuffix(k, suffix) {
			return k
		}
	}
	return ""
}

// lookupEffectiveWorkspaceBinding returns the effective binding for a channel
// plus whether the bound workspace is currently usable.
func (e *Engine) lookupEffectiveWorkspaceBinding(channelKey string) (*WorkspaceBinding, string, bool) {
	if !e.multiWorkspace || e.workspaceBindings == nil || channelKey == "" {
		return nil, "", false
	}

	projectKey := "project:" + e.name
	b, bindingKey := e.workspaceBindings.LookupEffective(projectKey, channelKey)
	if b == nil {
		return nil, "", false
	}

	// When run_as_user isolation is active, the workspace lives in the target
	// user's space (typically under their HOME, set to mode 0700 by `sudo -i`).
	// The supervisor process runs as a different user, so os.Stat here would
	// hit EACCES on the target user's private path and we'd wrongly conclude
	// the directory is "missing" — then Unbind() it, permanently dropping a
	// perfectly valid binding. The agent that actually uses the workspace runs
	// as the target user and can access it fine, so skip the supervisor-side
	// existence check entirely under isolation and trust the binding.
	if e.runAsUser() != "" {
		return b, bindingKey, true
	}

	if _, err := os.Stat(b.Workspace); err != nil {
		// Only a genuine "does not exist" justifies dropping the binding. A
		// permission error (or any other transient stat failure) must NOT
		// unbind: the directory may well exist but be inaccessible to the
		// supervisor. Treating those as "missing" silently loses user bindings.
		if !os.IsNotExist(err) {
			slog.Warn("bound workspace stat failed; keeping binding (not treating as missing)",
				"workspace", b.Workspace, "channel_key", channelKey, "binding_scope", bindingKey, "err", err)
			return b, bindingKey, true
		}
		slog.Warn("bound workspace directory missing",
			"workspace", b.Workspace, "channel_key", channelKey, "binding_scope", bindingKey)
		if bindingKey != sharedWorkspaceBindingsKey {
			e.workspaceBindings.Unbind(bindingKey, channelKey)
		}
		return b, bindingKey, false
	}

	return b, bindingKey, true
}

// runAsUser returns the configured run_as_user for the engine's agent, or ""
// if OS-level user isolation is not active. Mirrors the capability probe used
// when copying isolation settings to per-workspace agents (getOrCreateWorkspaceAgent).
func (e *Engine) runAsUser() string {
	if ma, ok := e.agent.(interface{ GetRunAsUser() string }); ok {
		return ma.GetRunAsUser()
	}
	return ""
}

// resolveWorkspace resolves a channel to a workspace directory.
// Returns (workspacePath, channelName, error).
// If workspacePath is empty, the init flow should be triggered.
func (e *Engine) resolveWorkspace(p Platform, channelID string) (string, string, error) {
	channelKey := workspaceChannelKey(p.Name(), channelID)

	// Step 1: Check existing binding
	if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); b != nil {
		if !usable {
			return "", b.ChannelName, nil
		}
		return normalizeWorkspacePath(b.Workspace), b.ChannelName, nil
	}

	// Step 2: Resolve channel name for convention match
	channelName := ""
	if resolver, ok := p.(ChannelNameResolver); ok {
		name, err := resolver.ResolveChannelName(channelID)
		if err != nil {
			slog.Warn("failed to resolve channel name", "channel", channelID, "err", err)
		} else if name == filepath.Base(name) && name != "." && name != ".." {
			// Only a plain directory name becomes a path under base_dir. A Feishu group can be
			// called "../x" or "a/b" (Discord and Slack channel names cannot): no convention match.
			channelName = name
		}
	}

	if channelName == "" {
		return "", "", nil
	}

	// Step 3: Convention match — check if base_dir/<channel-name> exists
	candidate := filepath.Join(e.baseDir, channelName)
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		// Auto-bind
		projectKey := "project:" + e.name
		normalized := normalizeWorkspacePath(candidate)
		e.workspaceBindings.Bind(projectKey, channelKey, channelName, normalized)
		slog.Info("workspace auto-bound by convention",
			"channel", channelName, "workspace", normalized)
		return normalized, channelName, nil
	}

	return "", channelName, nil
}

// handleWorkspaceInitFlow manages the conversational workspace setup.
// Returns true if the message was consumed by the init flow.
func (e *Engine) handleWorkspaceInitFlow(p Platform, msg *Message, channelName string) bool {
	channelKey := effectiveWorkspaceChannelKey(msg)

	e.initFlowsMu.Lock()
	flow, exists := e.initFlows[channelKey]
	e.initFlowsMu.Unlock()

	content := strings.TrimSpace(msg.Content)
	looksLikeAllowedLocalDir := e.workspaceInitAllowLocalPaths && looksLikeLocalDir(content)

	if !exists {
		if strings.HasPrefix(content, "/") && !looksLikeAllowedLocalDir {
			return false
		}
		if e.skipGit {
			cloneTo := filepath.Join(e.baseDir, channelName)
			flow = &workspaceInitFlow{
				state:       "awaiting_confirm",
				channelName: channelName,
				cloneTo:     cloneTo,
			}
			e.initFlowsMu.Lock()
			e.initFlows[channelKey] = flow
			e.initFlowsMu.Unlock()
			e.reply(p, msg.ReplyCtx, fmt.Sprintf("I'll mkdir `%s` and bind it to this channel. OK? (yes/no)", channelName))
			return true
		}
		flow = &workspaceInitFlow{
			state:       "awaiting_url",
			channelName: channelName,
		}
		e.initFlowsMu.Lock()
		e.initFlows[channelKey] = flow
		e.initFlowsMu.Unlock()
		// If the first message is already a path or URL, process it now;
		// otherwise show the hint and wait for the next message.
		if !looksLikeAllowedLocalDir && !looksLikeGitURL(content) {
			hintKey := MsgWsNotFoundHintGitOnly
			if e.workspaceInitAllowLocalPaths {
				hintKey = MsgWsNotFoundHint
			}
			e.reply(p, msg.ReplyCtx, e.i18n.T(hintKey))
			return true
		}
	}

	// Slash commands always take priority over the init flow — let them
	// pass through to handleCommand. Clean up the stale flow since the
	// user is issuing explicit commands instead of following the clone guide.
	if exists && strings.HasPrefix(content, "/") && !looksLikeAllowedLocalDir {
		e.initFlowsMu.Lock()
		delete(e.initFlows, channelKey)
		e.initFlowsMu.Unlock()
		return false
	}

	switch flow.state {
	case "awaiting_url":
		// Accept local directory paths: bind directly without cloning.
		if looksLikeAllowedLocalDir {
			dirPath, resolveErr := resolveLocalDirPath(content, e.baseDir)
			if resolveErr != nil {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInitDirNotFound, content))
				return true
			}
			info, err := os.Stat(dirPath)
			if err != nil || !info.IsDir() {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsInitDirNotFound, content))
				return true
			}
			projectKey := "project:" + e.name
			e.workspaceBindings.Bind(projectKey, channelKey, flow.channelName, normalizeWorkspacePath(dirPath))
			e.initFlowsMu.Lock()
			delete(e.initFlows, channelKey)
			e.initFlowsMu.Unlock()
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsBindSuccess, dirPath))
			return true
		}
		if !e.workspaceInitAllowLocalPaths && looksLikeLocalDir(content) && !looksLikeGitURL(content) {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsInitLocalPathsDisabled))
			return true
		}

		if !looksLikeGitURL(content) {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgWsInitInvalidTarget))
			return true
		}
		repoName := extractRepoName(content)
		cloneTo := filepath.Join(e.baseDir, repoName)

		e.initFlowsMu.Lock()
		flow.repoURL = content
		flow.cloneTo = cloneTo
		flow.state = "awaiting_confirm"
		e.initFlowsMu.Unlock()

		e.reply(p, msg.ReplyCtx, fmt.Sprintf(
			"I'll clone `%s` to `%s` and bind it to this channel. OK? (yes/no)", content, cloneTo))
		return true

	case "awaiting_confirm":
		lower := strings.ToLower(content)
		if lower != "yes" && lower != "y" {
			e.initFlowsMu.Lock()
			delete(e.initFlows, channelKey)
			e.initFlowsMu.Unlock()
			e.reply(p, msg.ReplyCtx, "Cancelled. Send a repo URL anytime to try again.")
			return true
		}

		var err error
		var message string
		if e.skipGit {
			err = os.MkdirAll(flow.cloneTo, 0o755)
			message = fmt.Sprintf("mkdir failed: %v", err)
		} else {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf("Cloning `%s` to `%s`...", flow.repoURL, flow.cloneTo))
			err = gitClone(flow.repoURL, flow.cloneTo)
			message = fmt.Sprintf("Clone failed: %v\nSend a repo URL to try again.", err)
		}
		if err != nil {
			e.initFlowsMu.Lock()
			delete(e.initFlows, channelKey)
			e.initFlowsMu.Unlock()
			e.reply(p, msg.ReplyCtx, message)
			return true
		}

		projectKey := "project:" + e.name
		e.workspaceBindings.Bind(projectKey, channelKey, flow.channelName, normalizeWorkspacePath(flow.cloneTo))

		e.initFlowsMu.Lock()
		delete(e.initFlows, channelKey)
		e.initFlowsMu.Unlock()

		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsCloneSuccess, flow.cloneTo))
		return true
	}

	return false
}

func looksLikeGitURL(s string) bool {
	return strings.HasPrefix(s, "https://") ||
		strings.HasPrefix(s, "http://") ||
		strings.HasPrefix(s, "git@") ||
		strings.HasPrefix(s, "ssh://")
}

// resolveLocalDirPath resolves a user-provided directory path to an absolute
// path, expanding ~/... and joining relative paths with baseDir. It rejects
// paths that escape baseDir via ../ traversal.
func resolveLocalDirPath(target, baseDir string) (string, error) {
	dirPath := target
	if dirPath == "~" || strings.HasPrefix(dirPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot resolve home directory: %w", err)
		}
		dirPath = filepath.Join(home, dirPath[2:])
	} else if !filepath.IsAbs(dirPath) {
		dirPath = filepath.Join(baseDir, dirPath)
	}
	cleaned := filepath.Clean(dirPath)
	resolved, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		resolved = cleaned
	}
	if baseDir != "" && !filepath.IsAbs(target) && !strings.HasPrefix(target, "~") {
		cleanBase := filepath.Clean(baseDir)
		if evalBase, err := filepath.EvalSymlinks(cleanBase); err == nil {
			cleanBase = evalBase
		}
		if !strings.HasPrefix(resolved, cleanBase+string(filepath.Separator)) && resolved != cleanBase {
			return "", fmt.Errorf("path escapes workspace base directory")
		}
	}
	return resolved, nil
}

// looksLikeLocalDir returns true if the string looks like a local directory
// path (absolute path, home-relative, dot-relative, or a bare name that
// doesn't look like a URL). Slash commands like /dir are not local dirs.
func looksLikeLocalDir(s string) bool {
	if s == "" {
		return false
	}
	if strings.Contains(s, "://") || strings.Contains(s, "@") {
		return false
	}
	if strings.HasPrefix(s, "~/") || s == "~" || strings.HasPrefix(s, "./") || strings.HasPrefix(s, "../") {
		return true
	}
	// A single /word could be a slash command or an absolute path like /root.
	// Check against known commands; if it matches, it's not a local dir.
	if strings.HasPrefix(s, "/") {
		name := strings.ToLower(strings.SplitN(s[1:], " ", 2)[0])
		for _, c := range builtinCommands {
			for _, n := range c.names {
				if name == n {
					return false
				}
			}
		}
	}
	return true
}

func extractRepoName(url string) string {
	url = strings.TrimSuffix(url, ".git")
	// Handle git@host:org/repo format
	if idx := strings.LastIndex(url, ":"); idx != -1 && strings.HasPrefix(url, "git@") {
		remainder := url[idx+1:]
		parts := strings.Split(remainder, "/")
		if len(parts) > 0 {
			return parts[len(parts)-1]
		}
	}
	// Handle https://host/org/repo format
	parts := strings.Split(url, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return "workspace"
}

func gitClone(repoURL, dest string) error {
	cmd := exec.Command("git", "clone", repoURL, dest)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}
