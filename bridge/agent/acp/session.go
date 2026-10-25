package acp

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// toolInputCacheMaxEntries caps toolInputByID growth; beyond this we evict
// roughly half the map (iteration order is arbitrary) to bound memory.
const toolInputCacheMaxEntries = 1000

type acpSession struct {
	core.SubTaskTracker
	subTaskRuns    subTaskRuns
	modelInfo      acpModelInfo // what the server advertised for model / effort selection (models.go)
	workDir        string
	events         chan core.Event
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	alive          atomic.Bool
	closeOnce      sync.Once
	closeErr       error // published by closeOnce
	closeSupported bool  // immutable after a successful session binding

	cmd *exec.Cmd
	tr  *transport

	acpSessMu sync.RWMutex
	acpSessID string

	outputMu        sync.Mutex
	outputFilter    privateOutput
	outputMessageID string
	outputTurn      privateOutputTurn

	sendMu         sync.Mutex
	promptInFlight atomic.Bool // a session/prompt RPC is outstanding (sendLocked)
	steerSupported atomic.Bool // handshake advertised steerMetaKey (session_steer.go)
	imagePrompts   atomic.Bool // handshake advertised promptCapabilities.image
	inputMu        sync.Mutex
	inputGuard     bool // suppress replay and notifications outside a strict prompt
	inputActive    bool
	inputErr       error
	requireEndTurn bool // set before publishing a voice session; immutable thereafter
	strictResume   bool // immutable: cold start must never fall back to session/new

	permMu   sync.Mutex
	permByID map[string]permState

	toolInputMu   sync.Mutex
	toolInputByID map[string]string // toolCallId -> summarized tool input
	toolNameByID  map[string]string // toolCallId -> tool_call title/kind, for updates that omit the title

	// modesMu guards availableModes and currentMode. Both fields are
	// populated on handshake (session/new or session/load response) and
	// updated whenever SetLiveMode succeeds or the server announces a
	// mode change via session/update.
	modesMu        sync.RWMutex
	availableModes []acpModeInfo
	currentMode    string

	callbacks sessionCallbacks // may be nil (tests, integration harness)
}

type permState struct {
	RPCID   json.RawMessage
	Options []permissionOption
}

// acpSessionConfig bundles the inputs newACPSession needs. It's a
// struct rather than a long positional argument list because we keep
// adding optional knobs (initialMode, callbacks) and would otherwise
// break every call site each time.
type acpSessionConfig struct {
	command         string
	args            []string
	extraEnv        []string
	workDir         string
	resumeSessionID string
	strictResume    bool
	authMethod      string
	initialMode     string           // if non-empty, applied via session/set_mode after session/new
	initialModel    string           // if non-empty, applied after session/new (set_model or the "model" config option)
	initialEffort   string           // if non-empty, applied via the "reasoning_effort" config option
	callbacks       sessionCallbacks // may be nil
}

func newACPSession(ctx context.Context, cfg acpSessionConfig) (*acpSession, error) {
	absWorkDir, err := filepath.Abs(cfg.workDir)
	if err != nil {
		absWorkDir = cfg.workDir
	}

	sessionCtx, cancel := context.WithCancel(ctx)
	s := &acpSession{
		workDir:       absWorkDir,
		events:        make(chan core.Event, 128),
		ctx:           sessionCtx,
		cancel:        cancel,
		permByID:      make(map[string]permState),
		toolInputByID: make(map[string]string),
		toolNameByID:  make(map[string]string),
		acpSessID:     cfg.resumeSessionID,
		callbacks:     cfg.callbacks,
		strictResume:  cfg.strictResume,
		inputGuard:    cfg.strictResume,
	}
	s.alive.Store(true)

	cmd := exec.CommandContext(sessionCtx, cfg.command, cfg.args...)
	cmd.Dir = absWorkDir
	cmd.Env = core.MergeEnv(os.Environ(), cfg.extraEnv)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("acp: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("acp: stdout pipe: %w", err)
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = io.MultiWriter(&stderrBuf, os.Stderr)

	s.cmd = cmd
	s.tr = newTransport(stdout, stdin, s.onNotification, s.onServerRequest)

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("acp: start %s: %w", cfg.command, err)
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer s.CloseSubTasks()
		s.tr.readLoop(sessionCtx)
		waitErr := cmd.Wait()
		if waitErr != nil {
			msg := stderrBuf.String()
			if msg != "" {
				slog.Error("acp: process exited", "error", waitErr, "stderr", msg)
				s.emit(core.Event{Type: core.EventError, Error: fmt.Errorf("%s", strings.TrimSpace(msg))})
			} else {
				slog.Debug("acp: process exited", "error", waitErr)
			}
		}
		s.alive.Store(false)
	}()

	if err := s.handshake(cfg.resumeSessionID, cfg.authMethod); err != nil {
		_ = s.Close()
		return nil, err
	}

	// Apply the agent-level mode preference now that we have a session
	// id. If set_mode fails (e.g. modeId unknown to this backend) we
	// log and carry on with whatever mode the server defaulted to —
	// the alternative would be to reject the session entirely, which
	// is worse UX for a non-critical control.
	if strings.TrimSpace(cfg.initialMode) != "" {
		if ok := s.SetLiveMode(cfg.initialMode); !ok {
			slog.Warn("acp: initial mode could not be applied",
				"mode", cfg.initialMode,
				"session_id", s.currentACPSessionID(),
			)
		}
	}

	// Model / effort: some ACP backends (Cursor) default to a model the account may not have
	// access to, and /model, /reasoning or the chat shortcut set new ones for the next session.
	s.applyModel(cfg.initialModel)
	s.applyEffort(cfg.initialEffort)

	return s, nil
}

// handshake runs initialize → optional authenticate → session/load or
// session/new, and caches any modes the server advertises so
// SetLiveMode / PermissionModes can answer correctly.
func (s *acpSession) handshake(resumeSessionID string, authMethod string) error {
	initParams := map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs": map[string]any{
				"readTextFile":  false,
				"writeTextFile": false,
			},
			"terminal": false,
		},
		"clientInfo": map[string]any{
			"name":    "bothouse",
			"version": "1.0.0",
		},
	}
	res, err := s.tr.call(s.ctx, "initialize", initParams)
	if err != nil {
		return fmt.Errorf("acp: initialize: %w", err)
	}

	var initOut acpInitializeResult
	if err := json.Unmarshal(res, &initOut); err != nil {
		return fmt.Errorf("acp: parse initialize result: %w", err)
	}
	listSupported := len(initOut.AgentCapabilities.SessionCapabilities.List) > 0
	closeCapability := bytes.TrimSpace(initOut.AgentCapabilities.SessionCapabilities.Close)
	closeSupported := len(closeCapability) > 0 && closeCapability[0] == '{'
	slog.Debug("acp: initialized",
		"protocol", initOut.ProtocolVersion,
		"load_session", initOut.AgentCapabilities.LoadSession,
		"list_sessions", listSupported,
	)
	if s.callbacks != nil {
		s.callbacks.reportListSupported(listSupported)
	}
	s.imagePrompts.Store(initOut.AgentCapabilities.PromptCapabilities.Image)
	steer := initOut.AgentCapabilities.Meta[steerMetaKey] == true
	s.steerSupported.Store(steer)
	if r, ok := s.callbacks.(steerReporter); ok {
		r.reportSteerSupported(steer)
	}

	if strings.TrimSpace(authMethod) != "" {
		if _, err := s.tr.call(s.ctx, "authenticate", map[string]any{
			"methodId": authMethod,
		}); err != nil {
			return fmt.Errorf("acp: authenticate (%s): %w", authMethod, err)
		}
		slog.Debug("acp: authenticated", "method_id", authMethod)
	}

	wantResume := resumeSessionID != "" && resumeSessionID != core.ContinueSession
	resumeCapability := bytes.TrimSpace(initOut.AgentCapabilities.SessionCapabilities.Resume)
	resumeSupported := len(resumeCapability) > 0 && resumeCapability[0] == '{'
	resumeMethod := "session/load"
	if resumeSupported {
		resumeMethod = "session/resume"
	}
	if s.strictResume && (!wantResume || !(initOut.AgentCapabilities.LoadSession || resumeSupported)) {
		return fmt.Errorf("acp: strict resume requires a concrete session and loadSession or resume support")
	}
	if wantResume && (initOut.AgentCapabilities.LoadSession || resumeSupported) {
		loadParams := map[string]any{
			"sessionId":  resumeSessionID,
			"cwd":        s.workDir,
			"mcpServers": []any{},
		}
		loadRes, err := s.tr.call(s.ctx, resumeMethod, loadParams)
		if err != nil {
			if s.strictResume || resumeSupported {
				return fmt.Errorf("acp: %s: %w", resumeMethod, err)
			}
			slog.Warn("acp: session/load failed, starting new session", "error", err)
		} else {
			var lr struct {
				SessionID     string            `json:"sessionId"`
				Modes         *acpModesBlock    `json:"modes"`
				Models        *acpModelsBlock   `json:"models"`
				ConfigOptions []acpConfigOption `json:"configOptions"`
			}
			parseErr := json.Unmarshal(loadRes, &lr)
			if s.strictResume || resumeSupported {
				// ACP v1 LoadSessionResponse has no required sessionId: a successful
				// object response acknowledges the requested ID. Reject a conflicting
				// vendor extension, malformed result, or null; never create a session.
				if parseErr != nil || len(bytes.TrimSpace(loadRes)) == 0 || bytes.TrimSpace(loadRes)[0] != '{' {
					return fmt.Errorf("acp: invalid %s response", resumeMethod)
				}
				if lr.SessionID != "" && lr.SessionID != resumeSessionID {
					return fmt.Errorf("acp: loaded session does not match original binding")
				}
				lr.SessionID = resumeSessionID
			}
			if parseErr == nil && lr.SessionID != "" {
				s.setACPSessionID(lr.SessionID)
				s.absorbModes(lr.Modes)
				s.absorbModelInfo(lr.Models, lr.ConfigOptions)
				s.closeSupported = closeSupported
				return nil
			}
		}
	}

	newParams := map[string]any{
		"cwd":        s.workDir,
		"mcpServers": []any{},
	}
	newRes, err := s.tr.call(s.ctx, "session/new", newParams)
	if err != nil {
		return fmt.Errorf("acp: session/new: %w", err)
	}
	var sn struct {
		SessionID     string            `json:"sessionId"`
		Modes         *acpModesBlock    `json:"modes"`
		Models        *acpModelsBlock   `json:"models"`
		ConfigOptions []acpConfigOption `json:"configOptions"`
	}
	if err := json.Unmarshal(newRes, &sn); err != nil {
		return fmt.Errorf("acp: parse session/new: %w", err)
	}
	if sn.SessionID == "" {
		return fmt.Errorf("acp: session/new: empty sessionId")
	}
	s.setACPSessionID(sn.SessionID)
	s.absorbModes(sn.Modes)
	s.absorbModelInfo(sn.Models, sn.ConfigOptions)
	s.closeSupported = closeSupported
	return nil
}

// absorbModes copies a modes block into the session's cache and fans
// it out to the parent agent callbacks (if any). Both the session and
// the agent need the information: the session uses it to validate
// SetLiveMode inputs; the agent uses it to render `/mode` menus in IM.
func (s *acpSession) absorbModes(block *acpModesBlock) {
	if block == nil || len(block.AvailableModes) == 0 {
		return
	}
	s.modesMu.Lock()
	s.availableModes = append(s.availableModes[:0], block.AvailableModes...)
	if block.CurrentModeID != "" {
		s.currentMode = block.CurrentModeID
	}
	s.modesMu.Unlock()
	if s.callbacks != nil {
		s.callbacks.reportModes(*block)
	}
}

func (s *acpSession) setACPSessionID(id string) {
	s.acpSessMu.Lock()
	s.acpSessID = id
	s.acpSessMu.Unlock()
}

func (s *acpSession) currentACPSessionID() string {
	s.acpSessMu.RLock()
	defer s.acpSessMu.RUnlock()
	return s.acpSessID
}

// CurrentMode returns the ACP modeId most recently applied or reported
// for this session. Empty when the server never sent a modes block.
func (s *acpSession) CurrentMode() string {
	s.modesMu.RLock()
	defer s.modesMu.RUnlock()
	return s.currentMode
}

// SetLiveMode applies a permission mode change to the running session
// via `session/set_mode`. Returns true on success, false if the mode
// is unknown / the call errors / the session is closed.
//
// This is the implementation of core.LiveModeSwitcher for ACP
// sessions; the engine invokes it when the user runs `/mode <x>`,
// `/plan`, `/bypass`, etc. while a session is active.
//
// Client-side validation is important because at least one ACP server
// (devin acp in 2026.4.9) silently accepts unknown modeIds without
// any error, so a server-only check would let typos go undetected.
func (s *acpSession) SetLiveMode(mode string) bool {
	if !s.alive.Load() {
		return false
	}
	sid := s.currentACPSessionID()
	if sid == "" {
		return false
	}
	modeID := s.matchAvailableMode(mode)
	if modeID == "" {
		slog.Debug("acp: SetLiveMode rejected unknown mode",
			"mode", mode,
			"session_id", sid,
		)
		return false
	}
	if _, err := s.tr.call(s.ctx, "session/set_mode", map[string]any{
		"sessionId": sid,
		"modeId":    modeID,
	}); err != nil {
		slog.Warn("acp: session/set_mode failed",
			"mode", modeID,
			"session_id", sid,
			"error", err,
		)
		return false
	}
	s.modesMu.Lock()
	s.currentMode = modeID
	s.modesMu.Unlock()
	if s.callbacks != nil {
		// Re-publish current modeId so Agent.GetMode stays in sync.
		s.modesMu.RLock()
		available := append([]acpModeInfo(nil), s.availableModes...)
		s.modesMu.RUnlock()
		s.callbacks.reportModes(acpModesBlock{
			CurrentModeID:  modeID,
			AvailableModes: available,
		})
	}
	slog.Info("acp: live mode applied", "mode", modeID, "session_id", sid)
	return true
}

// matchAvailableMode resolves a user-typed mode string to a known ACP
// modeId from the cached availableModes list. Matching is case-
// insensitive on both id and display name to accommodate IM input.
// Returns "" if nothing matches or if modes are unknown (first session
// hasn't handshaked yet).
func (s *acpSession) matchAvailableMode(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	lower := strings.ToLower(input)
	s.modesMu.RLock()
	defer s.modesMu.RUnlock()
	for _, m := range s.availableModes {
		if strings.ToLower(m.ID) == lower || strings.ToLower(m.Name) == lower {
			return m.ID
		}
	}
	return ""
}

func (s *acpSession) onNotification(method string, params json.RawMessage) {
	if method != "session/update" {
		slog.Debug("acp: notification", "method", method)
		return
	}
	if s.handleSubTaskUpdate(params) {
		return
	}
	if !s.acceptInputUpdate(params) {
		return
	}
	s.cacheToolCallInput(params)
	s.maybeAbsorbCurrentModeUpdate(params)
	sid := s.currentACPSessionID()
	var header struct {
		Update struct{ SessionUpdate, MessageID string }
	}
	if json.Unmarshal(params, &header) != nil {
		return
	}
	slog.Debug("acp: session/update", "session_id", sid, "kind", header.Update.SessionUpdate, "bytes", len(params))
	// The RPC reader serializes notifications. The mutex also protects prompt
	// completion/error resets; foreground and unsolicited output use this seam.
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	for _, ev := range mapSessionUpdate(sid, params) {
		if ev.Type == core.EventToolResult {
			// mapToolCallUpdate falls back to the toolCallId when the update carries no title.
			ev.ToolName = s.toolNameFor(ev.ToolName)
		}
		if ev.Type == core.EventToolUse && s.outputMessageID == "" {
			s.outputFilter = privateOutput{}
		}
		if ev.Type == core.EventText {
			id := header.Update.MessageID
			if id != "" && id != s.outputMessageID {
				s.outputFilter = privateOutput{}
				s.outputMessageID = id
			}
			ev.Content = s.outputFilter.feed(ev.Content)
			s.outputTurn.public = s.outputTurn.public || strings.TrimSpace(ev.Content) != ""
			if ev.Content == "" {
				continue
			}
		}
		s.emit(ev)
	}
}

// maybeAbsorbCurrentModeUpdate watches session/update notifications
// for `current_mode_update` (server-driven mode switch, e.g. when the
// user toggles modes via the Windsurf/IDE UI while cc-connect is
// connected). Keeping currentMode in sync here means the IM `/mode`
// indicator reflects the true server state rather than the last
// client-initiated value.
func (s *acpSession) maybeAbsorbCurrentModeUpdate(params json.RawMessage) {
	var wrap struct {
		Update json.RawMessage `json:"update"`
	}
	if json.Unmarshal(params, &wrap) != nil || len(wrap.Update) == 0 {
		return
	}
	var head struct {
		Kind          string `json:"sessionUpdate"`
		CurrentModeID string `json:"currentModeId"`
	}
	if json.Unmarshal(wrap.Update, &head) != nil {
		return
	}
	if head.Kind != "current_mode_update" || head.CurrentModeID == "" {
		return
	}
	s.modesMu.Lock()
	s.currentMode = head.CurrentModeID
	available := append([]acpModeInfo(nil), s.availableModes...)
	s.modesMu.Unlock()
	if s.callbacks != nil {
		s.callbacks.reportModes(acpModesBlock{
			CurrentModeID:  head.CurrentModeID,
			AvailableModes: available,
		})
	}
}

// cacheToolCallInput extracts and caches rawInput from tool_call and tool_call_update
// session updates so that handlePermissionRequest can look it up by toolCallId.
// OpenCode ACP bug (#7370): rawInput is empty in tool_call and request_permission,
// but populated in tool_call_update. We cache from both sources.
func (s *acpSession) evictToolInputCacheIfNeededLocked() {
	target := toolInputCacheMaxEntries / 2
	for _, m := range []map[string]string{s.toolInputByID, s.toolNameByID} {
		if len(m) < toolInputCacheMaxEntries {
			continue
		}
		for k := range m {
			if len(m) <= target {
				break
			}
			delete(m, k)
		}
	}
}

// toolNameFor returns the name a tool_call announced for this toolCallId, or label unchanged.
func (s *acpSession) toolNameFor(label string) string {
	s.toolInputMu.Lock()
	defer s.toolInputMu.Unlock()
	if name := s.toolNameByID[label]; name != "" {
		return name
	}
	return label
}

func (s *acpSession) cacheToolCallInput(params json.RawMessage) {
	var wrap struct {
		Update json.RawMessage `json:"update"`
	}
	if json.Unmarshal(params, &wrap) != nil || len(wrap.Update) == 0 {
		return
	}
	var head struct {
		SessionUpdate string `json:"sessionUpdate"`
	}
	if json.Unmarshal(wrap.Update, &head) != nil {
		return
	}
	switch head.SessionUpdate {
	case "tool_call":
		var tc struct {
			ToolCallID string          `json:"toolCallId"`
			Title      string          `json:"title"`
			Kind       string          `json:"kind"`
			RawInput   json.RawMessage `json:"rawInput"`
		}
		if json.Unmarshal(wrap.Update, &tc) != nil || tc.ToolCallID == "" {
			return
		}
		if name := cmp.Or(tc.Title, tc.Kind); name != "" && s.toolNameByID != nil {
			s.toolInputMu.Lock()
			s.evictToolInputCacheIfNeededLocked()
			s.toolNameByID[tc.ToolCallID] = name
			s.toolInputMu.Unlock()
		}
		if len(tc.RawInput) == 0 {
			return
		}
		s.toolInputMu.Lock()
		s.evictToolInputCacheIfNeededLocked()
		input := summarizeACPToolInput(tc.Kind, tc.RawInput)
		s.toolInputByID[tc.ToolCallID] = input
		s.toolInputMu.Unlock()
		slog.Info("acp: cached tool_call input", "toolCallId", tc.ToolCallID, "kind", tc.Kind, "input", input)
	case "tool_call_update":
		var tc struct {
			ToolCallID string          `json:"toolCallId"`
			RawInput   json.RawMessage `json:"rawInput"`
		}
		if json.Unmarshal(wrap.Update, &tc) != nil || tc.ToolCallID == "" || len(tc.RawInput) == 0 {
			return
		}
		input := summarizeACPToolInput("", tc.RawInput)
		if input == "" {
			return
		}
		s.toolInputMu.Lock()
		s.evictToolInputCacheIfNeededLocked()
		s.toolInputByID[tc.ToolCallID] = input
		s.toolInputMu.Unlock()
		slog.Info("acp: cached tool_call_update input", "toolCallId", tc.ToolCallID, "input", input)
	}
}

func (s *acpSession) onServerRequest(method string, id json.RawMessage, params json.RawMessage) {
	if !s.acceptInputUpdate(params) {
		_ = s.tr.respondError(id, -32602, "request outside the original active session")
		return
	}
	switch method {
	case "session/request_permission":
		s.handlePermissionRequest(id, params)
	case "cursor/ask_question", "cursor/create_plan", "cursor/update_todos", "cursor/task", "cursor/generate_image":
		// Cursor CLI extensions — acknowledge so tool flows do not block; IM UX is limited for these.
		slog.Debug("acp: cursor extension request (no-op ack)", "method", method)
		_ = s.tr.respondSuccess(id, map[string]any{})
	default:
		if strings.HasPrefix(method, "cursor/") {
			slog.Debug("acp: unknown cursor extension, ack empty", "method", method)
			_ = s.tr.respondSuccess(id, map[string]any{})
			return
		}
		slog.Info("acp: unhandled server request", "method", method)
		_ = s.tr.respondError(id, -32601, "method not implemented")
	}
}

func (s *acpSession) handlePermissionRequest(id json.RawMessage, params json.RawMessage) {
	var p struct {
		SessionID string `json:"sessionId"`
		ToolCall  struct {
			ToolCallID string          `json:"toolCallId"`
			Title      string          `json:"title"`
			Kind       string          `json:"kind"`
			RawInput   json.RawMessage `json:"rawInput"`
		} `json:"toolCall"`
		Options []permissionOption `json:"options"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		_ = s.tr.respondError(id, -32602, "invalid params")
		return
	}
	slog.Debug("acp: permission request raw params", "params", string(params))
	reqKey := jsonIDKey(id)
	toolName := p.ToolCall.Title
	if toolName == "" {
		toolName = p.ToolCall.Kind
	}
	if toolName == "" {
		toolName = "permission"
	}

	s.permMu.Lock()
	s.permByID[reqKey] = permState{RPCID: id, Options: p.Options}
	s.permMu.Unlock()

	rawTool := map[string]any{}
	_ = json.Unmarshal(params, &rawTool)

	// OpenCode ACP bug (#7370): rawInput in request_permission is always {},
	// but tool_call_update (which arrives right after) has the real input.
	// Emit in a goroutine so we don't block the read loop, and wait briefly
	// for tool_call_update to populate the cache.
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for i := 0; i < 10; i++ {
			s.toolInputMu.Lock()
			toolInput := s.toolInputByID[p.ToolCall.ToolCallID]
			s.toolInputMu.Unlock()
			if toolInput != "" {
				break
			}
			select {
			case <-s.ctx.Done():
				return
			case <-time.After(50 * time.Millisecond):
			}
		}
		s.toolInputMu.Lock()
		toolInput := s.toolInputByID[p.ToolCall.ToolCallID]
		s.toolInputMu.Unlock()
		if toolInput == "" {
			toolInput = summarizeACPToolInput(p.ToolCall.Kind, p.ToolCall.RawInput)
		}
		if toolInput == "" {
			toolInput = p.ToolCall.Title
		}
		if toolInput == "" {
			toolInput = p.ToolCall.ToolCallID
		}

		slog.Info("acp: permission request", "request_id", reqKey, "tool", toolName, "input", toolInput)
		s.emit(core.Event{
			Type:         core.EventPermissionRequest,
			RequestID:    reqKey,
			ToolName:     toolName,
			ToolInput:    toolInput,
			ToolInputRaw: rawTool,
			SessionID:    s.currentACPSessionID(),
		})
	}()
}

func (s *acpSession) emit(ev core.Event) {
	if ev.SessionID == "" {
		ev.SessionID = s.currentACPSessionID()
	}
	select {
	case s.events <- ev:
	case <-s.ctx.Done():
	}
}

func (s *acpSession) Send(prompt string, messageID string, images []core.ImageAttachment, files []core.FileAttachment) error {
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if !s.alive.Load() {
		return fmt.Errorf("acp: session closed")
	}
	s.inputMu.Lock()
	s.inputGuard, s.inputActive, s.inputErr = false, false, nil
	s.inputMu.Unlock()
	return s.sendLocked(prompt, messageID, images, files, false)
}

func (s *acpSession) sendLocked(prompt string, messageID string, images []core.ImageAttachment, files []core.FileAttachment, strict bool) error {
	s.resetPrivateOutput()

	sid := s.currentACPSessionID()
	if sid == "" {
		return fmt.Errorf("acp: no agent session id")
	}

	params := map[string]any{
		"sessionId": sid,
		"prompt":    s.promptBlocks(prompt, messageID, images, files, true),
	}

	slog.Debug("acp: sending session/prompt", "session_id", sid, "prompt_len", len(prompt))
	var completed sync.Once
	var output privateOutputTurn
	complete := func() {
		completed.Do(func() {
			if strict {
				s.finishInputUpdates()
			}
			output = s.resetPrivateOutput()
		})
	}
	if strict {
		s.inputMu.Lock()
		s.inputActive = true
		s.inputMu.Unlock()
	}
	s.promptInFlight.Store(true)
	res, err := s.tr.callCompleted(s.ctx, "session/prompt", params, complete)
	s.promptInFlight.Store(false)
	complete() // write failure/cancellation may not invoke the reader callback
	var result struct {
		StopReason string `json:"stopReason"`
	}
	validResult := json.Unmarshal(res, &result) == nil
	if strict {
		s.finishInputUpdates()
		s.inputMu.Lock()
		if err == nil {
			err = s.inputErr
		}
		s.inputMu.Unlock()
	}
	if (strict || s.requireEndTurn) && err == nil && (!validResult || result.StopReason != "end_turn") {
		err = fmt.Errorf("acp: prompt did not complete successfully (%s)", result.StopReason)
	}
	if err != nil {
		s.emit(core.Event{Type: core.EventError, Error: err})
		return fmt.Errorf("acp: session/prompt: %w", err)
	}
	slog.Debug("acp: session/prompt response", "session_id", sid, "response_len", len(res))
	if !validResult || result.StopReason != "end_turn" {
		// The RPC returned but the turn did not succeed. Never invent an empty
		// successful reply or echo an untrusted vendor stopReason.
		s.emit(core.Event{Type: core.EventError, SessionID: sid, Error: fmt.Errorf("acp: prompt did not complete successfully")})
		return nil
	}
	if !output.public {
		// The RPC completed; only the reply failed. Report one terminal event,
		// not a competing Send error. Tools may have run: never replay this turn.
		s.emit(core.Event{Type: core.EventError, SessionID: sid, Error: core.ErrNoPublicAnswer})
		return nil
	}

	// Text was streamed via session/update; engine aggregates EventText.
	s.emit(core.Event{
		Type:      core.EventResult,
		SessionID: sid,
		Done:      true,
	})
	return nil
}

// promptBlocks builds session/prompt content: the text (with saved file references, after the
// model-control instructions when modelSkill) and, when the agent advertised
// promptCapabilities.image, one image block per supported image. Other images are saved to disk
// and referenced by path in the text.
func (s *acpSession) promptBlocks(prompt string, messageID string, images []core.ImageAttachment, files []core.FileAttachment, modelSkill bool) []any {
	filePaths := core.SaveFilesToDisk(s.workDir, messageID, files)
	prompt = core.AppendFileRefs(prompt, filePaths)
	var imageBlocks []any
	if len(images) > 0 {
		var rest []core.ImageAttachment
		if s.imagePrompts.Load() {
			imageBlocks, rest = acpImageBlocks(images)
		} else {
			rest = images
		}
		if len(rest) > 0 {
			prompt = s.appendImageRefs(prompt, rest)
		} else if strings.TrimSpace(prompt) == "" {
			prompt = "User sent image(s)."
		}
	}
	if modelSkill {
		prompt = core.PrependModelSwitchInstructions(prompt)
	}
	blocks := []any{map[string]any{"type": "text", "text": prompt}}
	return append(blocks, imageBlocks...)
}

// acpImageMimeTypes are the raster types the ACP image block accepts in practice (DSH rejects others).
var acpImageMimeTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// acpImageBlocks returns inline ACP image blocks for images of a supported type, and the rest.
func acpImageBlocks(images []core.ImageAttachment) (blocks []any, rest []core.ImageAttachment) {
	for _, img := range images {
		mt := strings.ToLower(strings.TrimSpace(img.MimeType))
		if mt == "" || !acpImageMimeTypes[mt] {
			mt = http.DetectContentType(img.Data)
		}
		if len(img.Data) == 0 || !acpImageMimeTypes[mt] {
			rest = append(rest, img)
			continue
		}
		blocks = append(blocks, map[string]any{"type": "image", "mimeType": mt, "data": base64.StdEncoding.EncodeToString(img.Data)})
	}
	return blocks, rest
}

func (s *acpSession) appendImageRefs(prompt string, images []core.ImageAttachment) string {
	attachDir := filepath.Join(s.workDir, ".cc-connect", "attachments")
	if err := os.MkdirAll(attachDir, 0o755); err != nil {
		slog.Warn("acp: mkdir attachments failed", "error", err)
		return prompt
	}
	var paths []string
	for i, img := range images {
		ext := ".bin"
		switch img.MimeType {
		case "image/jpeg":
			ext = ".jpg"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		case "image/png", "":
			ext = ".png"
		}
		fname := fmt.Sprintf("img_%d_%d%s", time.Now().UnixMilli(), i, ext)
		fpath := filepath.Join(attachDir, fname)
		if err := os.WriteFile(fpath, img.Data, 0o644); err != nil {
			slog.Error("acp: save image failed", "error", err)
			continue
		}
		paths = append(paths, fpath)
	}
	if len(paths) == 0 {
		return prompt
	}
	if prompt == "" {
		prompt = "User sent image(s)."
	}
	return prompt + "\n\n(Image files saved locally: " + strings.Join(paths, ", ") + ")"
}

func (s *acpSession) RespondPermission(requestID string, result core.PermissionResult) error {
	if !s.alive.Load() {
		return fmt.Errorf("acp: session closed")
	}

	s.permMu.Lock()
	st, ok := s.permByID[requestID]
	if ok {
		delete(s.permByID, requestID)
	}
	s.permMu.Unlock()
	if !ok {
		return fmt.Errorf("acp: unknown permission request %q", requestID)
	}

	allow := strings.EqualFold(result.Behavior, "allow")
	optID := pickPermissionOptionID(allow, st.Options)
	if allow && optID == "" {
		slog.Warn("acp: allow requested but agent sent no options", "request_id", requestID)
		return s.tr.respondError(st.RPCID, -32603, "no permission options from agent")
	}
	res := buildPermissionResult(allow, optID)

	slog.Debug("acp: permission response", "request_id", requestID, "allow", allow, "option_id", optID)
	return s.tr.respondSuccess(st.RPCID, res)
}

func (s *acpSession) Events() <-chan core.Event {
	return s.events
}

func (s *acpSession) CurrentSessionID() string {
	return s.currentACPSessionID()
}

// CancelTurn sends an ACP session/cancel notification to abort the current
// turn while keeping the session alive. The agent should cancel the active
// LLM request and persist state, then wait for the next user message on the
// same connection. This is used by /stop instead of Close().
func (s *acpSession) CancelTurn() error {
	sid := s.currentACPSessionID()
	if sid == "" {
		return fmt.Errorf("acp: no active session to cancel")
	}
	if s.tr == nil {
		return fmt.Errorf("acp: transport not available")
	}
	slog.Debug("acp: cancelling current turn", "session_id", sid)
	return s.tr.sendNotification("session/cancel", map[string]any{
		"sessionId": sid,
	})
}

func (s *acpSession) Alive() bool {
	return s.alive.Load()
}

func (s *acpSession) Close() error {
	s.CloseSubTasks()
	s.closeOnce.Do(func() {
		s.alive.Store(false)
		// The prompt response can precede durable storage. Let capable servers
		// drain and flush the session before CommandContext kills the process.
		if sid := s.currentACPSessionID(); s.closeSupported && sid != "" && s.ctx.Err() == nil {
			ctx, cancel := context.WithTimeout(s.ctx, 2*time.Second)
			_, err := s.tr.call(ctx, "session/close", map[string]any{"sessionId": sid})
			cancel()
			if err != nil {
				s.closeErr = fmt.Errorf("acp: close session before process teardown: %w", err)
				slog.Warn("acp: session close failed; persistence unconfirmed", "error", s.closeErr)
			}
		}
		s.cancel()
		if s.cmd != nil && s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
		done := make(chan struct{})
		go func() {
			s.wg.Wait()
			// RPC cancellation wakes Send, which still publishes its error.
			// Wait for that producer as well as the reader/permission workers.
			s.sendMu.Lock()
			close(s.events)
			s.sendMu.Unlock()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			slog.Warn("acp: close timed out waiting for session workers")
		}
	})
	return s.closeErr
}

// summarizeACPToolInput extracts a human-readable summary from ACP tool rawInput.
func summarizeACPToolInput(kind string, raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return string(raw)
	}
	if len(m) == 0 {
		return ""
	}
	switch strings.ToLower(kind) {
	case "bash", "shell", "terminal", "execute":
		if cmd, ok := m["command"].(string); ok {
			if desc, ok := m["description"].(string); ok && desc != "" {
				return "# " + desc + "\n" + cmd
			}
			return cmd
		}
	case "read", "write", "edit":
		if fp, ok := m["file_path"].(string); ok {
			return fp
		}
		if fp, ok := m["path"].(string); ok {
			return fp
		}
	}
	// Fallback: try extracting command with description before formatting JSON.
	if cmd, ok := m["command"].(string); ok {
		if desc, ok := m["description"].(string); ok && desc != "" {
			return "# " + desc + "\n" + cmd
		}
		return cmd
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return string(b)
}
