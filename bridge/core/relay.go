package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// relayTimeout bounds how long a dispatch waits for the target's answer.
// 来源：主人 2026-10-23 给的实测分布——大部分任务几分钟，一部分十几分钟，
// 少数要跑个把小时。20 分钟覆盖前两类，少数长任务靠 ErrRelayNoReplyYet 的
// 「仍在处理」语义处理，而不是把默认值抬到一小时，否则卡死的派工毫无反馈。
const relayTimeout = 20 * time.Minute

// ErrRelayNoReplyYet marks a dispatch whose target was reached but had not
// answered when the wait expired. The target may still be working, so this is
// not a failure: callers must not treat it as one, must not retry the same
// assignment, and should read the answer from the target's task thread.
var ErrRelayNoReplyYet = errors.New("relay: no reply yet")

// Relay response statuses reported to the dispatch caller.
const (
	RelayStatusDone    = "done"
	RelayStatusWaiting = "waiting"
)

const (
	RelayVisibilityFull    = "full"
	RelayVisibilitySummary = "summary"
	RelayVisibilityNone    = "none"
)

// RelayBinding represents a bot-to-bot relay binding in a group chat.
type RelayBinding struct {
	Platform string            `json:"platform"`
	ChatID   string            `json:"chat_id"`
	Bots     map[string]string `json:"bots"` // project name → bot display name
}

// RelayManager coordinates bot-to-bot message relay across engines.
type RelayManager struct {
	quotaMu    sync.Mutex // one quota takeover changes shared task/workspace ownership at a time
	mu         sync.RWMutex
	engines    map[string]*Engine       // project name → engine (runtime only)
	bindings   map[string]*RelayBinding // chatID → binding
	storePath  string                   // empty = no persistence
	timeout    time.Duration
	visibility string
	voice      voiceRelayStore
	// team bindings from the wizard and configured team_status_dir (relay_team_bind.go)
	dataDir    string
	denied     map[string]map[string]bool // chatID → project (or "*") removed by /bind -x or /bind remove
	deniedPath string
	teamMu     sync.Mutex
	team       relayTeamCache
}

func NewRelayManager(dataDir string) *RelayManager {
	rm := &RelayManager{
		engines:    make(map[string]*Engine),
		bindings:   make(map[string]*RelayBinding),
		denied:     make(map[string]map[string]bool),
		timeout:    relayTimeout,
		visibility: RelayVisibilityFull,
		dataDir:    dataDir,
	}
	if dataDir != "" {
		rm.storePath = filepath.Join(dataDir, "relay_bindings.json")
		rm.deniedPath = filepath.Join(dataDir, "relay_team_denied.json")
		rm.load()
		rm.loadDenied()
	}
	rm.initVoiceRelay(dataDir)
	return rm
}

func (rm *RelayManager) RegisterEngine(name string, e *Engine) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.engines[name] = e
}

// SetTimeout overrides the relay response timeout. Set to 0 to disable it.
func (rm *RelayManager) SetTimeout(d time.Duration) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if d < 0 {
		d = 0
	}
	rm.timeout = d
}

// SetVisibility controls whether relay request/response visibility messages are
// echoed into the source group chat. The relay transport still returns the
// target response to the caller regardless of this setting.
func (rm *RelayManager) SetVisibility(mode string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.visibility = normalizeRelayVisibility(mode)
}

// Bind establishes a relay binding between bots in a group chat.
// If a binding already exists, it will be replaced.
func (rm *RelayManager) Bind(platform, chatID string, bots map[string]string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.bindings[chatID] = &RelayBinding{
		Platform: platform,
		ChatID:   chatID,
		Bots:     bots,
	}
	for proj := range bots {
		rm.allowLocked(chatID, proj)
	}
	slog.Info("relay: binding created", "chat_id", chatID, "bots", bots)
	rm.saveLocked()
}

// AddToBind adds a project to an existing binding, or creates a new one.
func (rm *RelayManager) AddToBind(platform, chatID, projectName string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	binding := rm.bindings[chatID]
	if binding == nil {
		binding = &RelayBinding{
			Platform: platform,
			ChatID:   chatID,
			Bots:     make(map[string]string),
		}
		rm.bindings[chatID] = binding
	}

	binding.Bots[projectName] = projectName
	rm.allowLocked(chatID, projectName)
	slog.Info("relay: project added to binding", "chat_id", chatID, "project", projectName, "bots", binding.Bots)
	rm.saveLocked()
}

// RemoveFromBind removes a project from an existing binding. A member of an explicit
// team (wizard or shared team_status_dir) is also vetoed in this chat, so the team does
// not bind it back (relay_team_bind.go).
// Returns true if the project was removed, false if not found.
func (rm *RelayManager) RemoveFromBind(chatID, projectName string) bool {
	team := rm.inAnyTeam(projectName)
	rm.mu.Lock()
	defer rm.mu.Unlock()

	vetoed := false
	if team && !rm.denied[chatID][projectName] {
		rm.denyLocked(chatID, projectName)
		vetoed = true
	}
	binding := rm.bindings[chatID]
	if binding == nil {
		return vetoed
	}

	if _, exists := binding.Bots[projectName]; exists {
		delete(binding.Bots, projectName)
		slog.Info("relay: project removed from binding", "chat_id", chatID, "project", projectName, "remaining", binding.Bots)

		if len(binding.Bots) == 0 {
			delete(rm.bindings, chatID)
			slog.Info("relay: binding removed (no bots left)", "chat_id", chatID)
		}
		rm.saveLocked()
		return true
	}
	return vetoed
}

// GetBinding returns the binding for a chat, or nil if none.
func (rm *RelayManager) GetBinding(chatID string) *RelayBinding {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.bindings[chatID]
}

// Unbind removes the relay binding for a chat.
func (rm *RelayManager) Unbind(chatID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.bindings, chatID)
	// The team does not bind the chat back either (relay_team_bind.go).
	rm.denied[chatID] = map[string]bool{relayDeniedAll: true}
	rm.saveDeniedLocked()
	slog.Info("relay: binding removed", "chat_id", chatID)
	rm.saveLocked()
}

// HasEngine checks if a project engine is registered.
func (rm *RelayManager) HasEngine(name string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	_, ok := rm.engines[name]
	return ok
}

// ListEngineNames returns all registered engine names.
func (rm *RelayManager) ListEngineNames() []string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	names := make([]string, 0, len(rm.engines))
	for n := range rm.engines {
		names = append(names, n)
	}
	return names
}

// ListBoundBots returns the other bots bound in the same chat as the given project.
func (rm *RelayManager) ListBoundBots(chatID, selfProject string) map[string]string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	b := rm.bindings[chatID]
	if b == nil {
		return nil
	}
	others := make(map[string]string)
	for proj, name := range b.Bots {
		if proj != selfProject {
			others[proj] = name
		}
	}
	return others
}

// RelayRequest is the payload for a relay send.
type RelayRequest struct {
	TaskID     string `json:"task_id,omitempty"`
	Mode       string `json:"mode,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	Scope      string `json:"scope,omitempty"`
	From       string `json:"from"`        // source project name
	To         string `json:"to"`          // target project name
	SessionKey string `json:"session_key"` // source session key (contains platform + chatID)
	// Workspace is the explicit execution channel for a task relay: a workspace
	// of the same chat channel as the source workspace. Empty keeps the
	// target in the source session.
	Workspace string `json:"workspace,omitempty"`
	Message   string `json:"message"`
	// UserText (voice mode) is the speaker's own words without the entry prompt in Message.
	UserText string `json:"user_text,omitempty"`
	// Stream enables early public speech for this private voice request.
	Stream bool `json:"stream,omitempty"`
}

// RelayResponse is the result of a relay send.
type RelayResponse struct {
	Response string `json:"response"`
	// Status is "done" when the target answered, "waiting" when it was reached
	// but the wait expired first. A caller that records "failed" for "waiting"
	// reports a healthy long task as broken.
	Status string `json:"status,omitempty"`
	// Partial is true when Status is "waiting" and Response still holds the
	// text the target had already produced before the wait expired.
	Partial bool `json:"partial,omitempty"`
}

// Send delivers a message from one bot to another and returns the response.
func (rm *RelayManager) Send(ctx context.Context, req RelayRequest) (*RelayResponse, error) {
	if (req.TaskID == "") != (req.RequestID == "") {
		return nil, fmt.Errorf("relay: task_id and request_id must be provided together")
	}
	if req.Workspace != "" && req.TaskID == "" {
		return nil, fmt.Errorf("relay: workspace requires a task dispatch (task_id and request_id)")
	}
	platform, chatID, err := parseSessionKeyParts(req.SessionKey)
	if err != nil {
		return nil, fmt.Errorf("relay: invalid session key: %w", err)
	}

	rm.mu.RLock()
	binding := rm.effectiveBindingForLocked(platform, chatID, req.From)
	// teamFilled: a configured team added members to this chat's binding. Then the
	// sender must be in the binding too, or bots outside the team (external projects,
	// members of another platform's team) could relay to team members without /bind. A
	// chat bound only by a manual /bind keeps its old rule (relay_team_bind.go).
	teamFilled := binding != nil && binding != rm.bindings[chatID]
	targetEngine := rm.engines[req.To]
	sourceEngine := rm.engines[req.From]
	visibility := rm.visibility
	rm.mu.RUnlock()

	// An unbound bot: the command and the channel both say which /bind to send (#587).
	notBound := func(project, detail string) error {
		sourceEngine.noticeNotBound(req.SessionKey, project)
		return fmt.Errorf("relay: %w", &notBoundError{project: project, detail: detail})
	}
	// An unknown target name is a typo, not a missing /bind: no channel notice.
	if targetEngine == nil {
		return nil, fmt.Errorf("relay: target engine %q not found (is the project running?)", req.To)
	}
	if binding == nil {
		return nil, notBound(req.To, "")
	}
	if _, ok := binding.Bots[req.From]; teamFilled && !ok {
		return nil, notBound(req.From, "")
	}
	if req.TaskID != "" && (binding.Platform != platform || sourceEngine == nil || binding.Bots[req.From] == "") {
		return nil, notBound(req.From, "")
	}
	if _, ok := binding.Bots[req.To]; !ok {
		var bound []string
		for proj := range binding.Bots {
			if proj != req.From {
				bound = append(bound, proj)
			}
		}
		sort.Strings(bound)
		detail := "本频道没有已绑定的其他机器人"
		if len(bound) > 0 {
			detail = "已绑定：" + strings.Join(bound, ", ") + "，名字要写准"
		}
		return nil, notBound(req.To, detail)
	}
	if wait := targetEngine.capacityWait(); wait > 0 {
		return nil, fmt.Errorf("relay: target engine %q is cooling down for %s", req.To, wait.Round(time.Second))
	}
	sourceEngine.clearNotBound(req.SessionKey, req.To)

	fromName := req.From
	if binding.Bots[req.From] != "" {
		fromName = binding.Bots[req.From]
	}
	toName := req.To
	if binding.Bots[req.To] != "" {
		toName = binding.Bots[req.To]
	}
	if req.TaskID != "" {
		return rm.sendTask(ctx, req, sourceEngine, targetEngine, toName)
	}

	// Post the forwarded message to the group chat for visibility.  The
	// default target is "<platform>:<chatID>:relay"; platforms that
	// understand thread / topic semantics can override this by
	// implementing core.RelayGroupVisibilityTarget on their Platform impl.
	groupSessionKey := rm.resolveGroupVisibilityKey(platform, chatID, req.SessionKey, sourceEngine)
	if sourceEngine != nil && visibility != RelayVisibilityNone {
		label := relayVisibilityRequestLabel(visibility, fromName, toName, req.Message)
		rm.sendToGroup(ctx, sourceEngine, platform, groupSessionKey, label)
	}

	// Execute relay: inject message into target engine and collect response
	relayCtx, cancel := rm.relayContext(ctx)
	defer cancel()

	response, err := targetEngine.HandleRelay(relayCtx, req.From, req.SessionKey, req.Message)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(relayCtx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("%w within %s; the target was reached and may still be working, so this is not a failure and the same assignment must not be resent: read its answer from the target's task thread or card", ErrRelayNoReplyYet, rm.configuredTimeout())
		}
		return nil, fmt.Errorf("relay: %w", err)
	}

	// Post the response to the group chat for visibility.
	if targetEngine != nil && visibility != RelayVisibilityNone {
		label := relayVisibilityResponseLabel(visibility, toName, response)
		rm.sendToGroup(ctx, targetEngine, platform, groupSessionKey, label)
	}

	resp := &RelayResponse{Response: response, Status: RelayStatusDone}
	if relayCtx.Err() != nil {
		// HandleRelay hands back what the target had produced when the wait
		// expired. That answer is useful but the turn is not finished, and
		// calling it "done" is what made a healthy long task look broken.
		resp.Status = RelayStatusWaiting
		resp.Partial = true
	}
	return resp, nil
}

// sendToGroup sends a message to the group chat for visibility.
func (rm *RelayManager) sendToGroup(ctx context.Context, e *Engine, platform, sessionKey, content string) {
	for _, p := range e.platforms {
		if p.Name() != platform {
			continue
		}
		rc, ok := p.(ReplyContextReconstructor)
		if !ok {
			continue
		}
		rctx, err := rc.ReconstructReplyCtx(sessionKey)
		if err != nil {
			slog.Debug("relay: failed to reconstruct reply ctx", "error", err)
			continue
		}
		if err := p.Send(ctx, rctx, content); err != nil {
			slog.Debug("relay: failed to send group message", "error", err)
		}
		return
	}
}

func truncateRelay(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "…"
}

func normalizeRelayVisibility(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case RelayVisibilityNone:
		return RelayVisibilityNone
	case RelayVisibilitySummary:
		return RelayVisibilitySummary
	case "", RelayVisibilityFull:
		return RelayVisibilityFull
	default:
		slog.Warn("relay: unknown visibility mode, falling back to full", "mode", mode,
			"valid_values", []string{RelayVisibilityNone, RelayVisibilitySummary, RelayVisibilityFull})
		return RelayVisibilityFull
	}
}

func relayVisibilityRequestLabel(mode, fromName, toName, message string) string {
	if normalizeRelayVisibility(mode) == RelayVisibilitySummary {
		return fmt.Sprintf("[%s → %s] relay request sent", fromName, toName)
	}
	return fmt.Sprintf("[%s → %s] %s", fromName, toName, message)
}

func relayVisibilityResponseLabel(mode, toName, response string) string {
	if normalizeRelayVisibility(mode) == RelayVisibilitySummary {
		return fmt.Sprintf("[%s] relay response ready (%d chars)", toName, len([]rune(response)))
	}
	return fmt.Sprintf("[%s] %s", toName, truncateRelay(response, 2000))
}

// configuredTimeout reports the wait actually in force, for messages that must
// name it.
func (rm *RelayManager) configuredTimeout() time.Duration {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.timeout
}

func (rm *RelayManager) relayContext(ctx context.Context) (context.Context, context.CancelFunc) {
	rm.mu.RLock()
	timeout := rm.timeout
	rm.mu.RUnlock()
	if timeout <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func parseSessionKeyParts(sessionKey string) (platform, chatID string, err error) {
	// Format: "platform:chatID:userID"
	// Relay session format: "relay:sourceProject:chatID"
	parts := strings.SplitN(sessionKey, ":", 3)
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid session key format: %q", sessionKey)
	}
	if parts[0] == "relay" && len(parts) == 3 {
		// For relay sessions, chatID is the third part: "relay:sourceProject:chatID"
		return parts[0], parts[2], nil
	}
	return parts[0], parts[1], nil
}

// resolveGroupVisibilityKey computes the session key used for relay
// visibility echoes.  It defaults to "<platform>:<chatID>:relay" and
// gives the caller's platform a chance to override via the optional
// core.RelayGroupVisibilityTarget interface.
//
// Looking the platform up via sourceEngine.platforms (not targetEngine)
// matches the existing sendToGroup() resolution path — the visibility
// echo is dispatched as the source bot, so the source engine's
// platform impl is authoritative for the key format.
func (rm *RelayManager) resolveGroupVisibilityKey(platform, chatID, callerSessionKey string, sourceEngine *Engine) string {
	defaultKey := platform + ":" + chatID + ":relay"
	if sourceEngine == nil {
		return defaultKey
	}
	for _, p := range sourceEngine.platforms {
		if p.Name() != platform {
			continue
		}
		d, ok := p.(RelayGroupVisibilityTarget)
		if !ok {
			return defaultKey
		}
		if k, ok := d.RelayGroupVisibilityKey(callerSessionKey); ok && k != "" {
			return k
		}
		return defaultKey
	}
	return defaultKey
}

// ── Persistence ─────────────────────────────────────────────

// saveLocked persists bindings to disk. Caller must hold rm.mu (read or write).
func (rm *RelayManager) saveLocked() {
	if rm.storePath == "" {
		return
	}
	data, err := json.MarshalIndent(rm.bindings, "", "  ")
	if err != nil {
		slog.Error("relay: failed to marshal bindings", "error", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(rm.storePath), 0o755); err != nil {
		slog.Error("relay: failed to create dir", "error", err)
		return
	}
	if err := AtomicWriteFile(rm.storePath, data, 0o644); err != nil {
		slog.Error("relay: failed to write bindings", "path", rm.storePath, "error", err)
	}
}

func (rm *RelayManager) load() {
	if rm.storePath == "" {
		return
	}
	data, err := os.ReadFile(rm.storePath)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Error("relay: failed to read bindings", "path", rm.storePath, "error", err)
		}
		return
	}
	var bindings map[string]*RelayBinding
	if err := json.Unmarshal(data, &bindings); err != nil {
		slog.Error("relay: failed to unmarshal bindings", "path", rm.storePath, "error", err)
		return
	}
	if bindings != nil {
		rm.bindings = bindings
		slog.Info("relay: loaded bindings", "count", len(bindings))
	}
}

// truncateRelayMore is truncateRelay with a way back to the rest: when s is cut,
// the full text is saved under dataDir and the cut ends with its length and path,
// so the reader can open the whole thing instead of guessing what was dropped.
func truncateRelayMore(dataDir, kind, s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	cut := string(runes[:maxLen]) + "…"
	path := saveTruncatedFull(dataDir, kind, s)
	if path == "" {
		return cut + fmt.Sprintf("\n（已截断：原文 %d 字，这里只有前 %d 字）", len(runes), maxLen)
	}
	return cut + fmt.Sprintf("\n（已截断：原文 %d 字，这里只有前 %d 字；全文：%s ，要细节用 Read 读它）", len(runes), maxLen, path)
}

// saveTruncatedFull writes s to <dataDir>/truncated/<time>-<kind>-<hash>.txt and
// returns the path ("" when there is nowhere to write). Same text, same file.
func saveTruncatedFull(dataDir, kind, s string) string {
	if dataDir == "" {
		return ""
	}
	dir := filepath.Join(dataDir, "truncated")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		slog.Warn("relay: save truncated text failed", "error", err)
		return ""
	}
	kind = strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return r
		}
		return '_'
	}, kind)
	sum := sha256.Sum256([]byte(s))
	name := fmt.Sprintf("%s-%s-%x.txt", time.Now().Format("20060102"), kind, sum[:6])
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil {
		return path
	}
	if err := os.WriteFile(path, []byte(s), 0o600); err != nil {
		slog.Warn("relay: save truncated text failed", "error", err)
		return ""
	}
	return path
}
