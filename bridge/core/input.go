package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// StrictResumeAgent opts into the local input API. Implementations must refuse
// fresh sessions, unsupported transports and any implicit resume fallback.
type StrictResumeAgent interface {
	SupportsStrictResume() bool
	StartSessionStrict(context.Context, string) (AgentSession, error)
}

// StrictResumeSession validates the binding before sending and before emitting
// a successful terminal event. The normal Send path is unchanged.
type StrictResumeSession interface {
	// Quiesce the preceding reader before core drains stale events. No new
	// prompt may be sent here; this establishes the response isolation boundary.
	PrepareResumed(expectedID string) error
	SendResumed(prompt, messageID string, images []ImageAttachment, files []FileAttachment, expectedID string) error
}

type InputRequest struct {
	Stream                 bool    `json:"stream,omitempty"`
	RequestID              string  `json:"request_id"`
	Project                string  `json:"project"`
	SessionKey             string  `json:"session_key"`
	Text                   string  `json:"text"`
	ExpectedSessionID      *string `json:"expected_session_id,omitempty"`
	ExpectedAgentSessionID *string `json:"expected_agent_session_id,omitempty"`
}

// Compare optional IDs by value: each HTTP retry decodes fresh pointers.
func (r InputRequest) sameInput(other InputRequest) bool {
	return r.Stream == other.Stream && r.RequestID == other.RequestID && r.Project == other.Project &&
		r.SessionKey == other.SessionKey && r.Text == other.Text &&
		sameInputID(r.ExpectedSessionID, other.ExpectedSessionID) &&
		sameInputID(r.ExpectedAgentSessionID, other.ExpectedAgentSessionID)
}

func sameInputID(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

type InputResult struct {
	SpeechText     string `json:"speech_text,omitempty"`
	RequestID      string `json:"request_id"`
	Status         string `json:"status"`
	Text           string `json:"text"`
	Error          string `json:"error"`
	SessionID      string `json:"session_id"`
	AgentSessionID string `json:"agent_session_id"`
}

type inputEntry struct {
	request InputRequest
	result  InputResult
}

// Entries are process-local and never evicted, including terminal entries.
// At capacity new IDs are rejected; existing IDs remain readable/idempotent.
const maxInputRequests = 1024
const maxInputBodyBytes = 64 << 10

type inputStore struct {
	mu      sync.Mutex
	entries map[string]*inputEntry
}

type inputTurnResult struct {
	text   string
	silent bool
	err    error
}

type inputTurn struct {
	expectedID   string
	once         sync.Once
	complete     func(inputTurnResult)
	appendSpeech func(string)
}

func (t *inputTurn) finish(r inputTurnResult) {
	if t != nil {
		t.once.Do(func() { t.complete(r) })
	}
}

func inputHTTPError(w http.ResponseWriter, code int, err error) {
	apiJSON(w, code, map[string]string{"error": err.Error()})
}

func validInputID(id string) bool {
	if len(id) == 0 || len(id) > 128 || id == "bindings" {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func (s *APIServer) inputEngine(project string) *Engine {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.engines[project]
}

// inputBinding only reads the existing project store. Workspace creation and
// active-session creation are deliberately unavailable through this endpoint.
func (e *Engine) inputBinding(key string) (*Session, Platform, any, int, error) {
	if e.multiWorkspace || e.sendWorkDirForSession(key) != "" {
		return nil, nil, nil, 422, fmt.Errorf("workspace routing is not supported by local input")
	}
	strict, ok := e.agent.(StrictResumeAgent)
	if !ok || !strict.SupportsStrictResume() {
		return nil, nil, nil, 422, fmt.Errorf("backend does not support strict local input")
	}
	name, _, ok := strings.Cut(key, ":")
	if !ok {
		return nil, nil, nil, 400, fmt.Errorf("invalid session_key")
	}
	var platform Platform
	for _, p := range e.platforms {
		if p.Name() == name {
			platform = p
			break
		}
	}
	rc, ok := platform.(ReplyContextReconstructor)
	if !ok {
		return nil, nil, nil, 422, fmt.Errorf("original platform cannot reconstruct replies")
	}
	session := e.sessions.FindByID(e.sessions.ActiveSessionID(key))
	if session == nil {
		return nil, nil, nil, 404, fmt.Errorf("existing active binding required")
	}
	session.mu.Lock()
	agentType := session.AgentType
	session.mu.Unlock()
	if agentType != "" && agentType != e.agent.Name() {
		return nil, nil, nil, 409, fmt.Errorf("binding belongs to a different backend")
	}
	id := session.GetAgentSessionID()
	if id == "" || id == ContinueSession {
		return nil, nil, nil, 409, fmt.Errorf("concrete agent session binding required")
	}
	reply, err := rc.ReconstructReplyCtx(key)
	if err != nil {
		return nil, nil, nil, 400, err
	}
	return session, platform, reply, 0, nil
}

func (s *APIServer) handleInput(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/input" {
		inputHTTPError(w, 404, fmt.Errorf("not found"))
		return
	}
	if r.Method != http.MethodPost {
		inputHTTPError(w, 405, fmt.Errorf("POST only"))
		return
	}
	var req InputRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxInputBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		inputHTTPError(w, 400, fmt.Errorf("invalid input JSON: %w", err))
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		inputHTTPError(w, 400, fmt.Errorf("exactly one JSON object required"))
		return
	}
	text := strings.TrimSpace(req.Text)
	if !validInputID(req.RequestID) || req.Project == "" || req.SessionKey == "" || text == "" {
		inputHTTPError(w, 400, fmt.Errorf("request_id, project, session_key and nonempty text required"))
		return
	}
	if (req.ExpectedSessionID == nil) != (req.ExpectedAgentSessionID == nil) ||
		(req.ExpectedSessionID != nil && (*req.ExpectedSessionID == "" || *req.ExpectedAgentSessionID == "")) {
		inputHTTPError(w, 400, fmt.Errorf("expected_session_id and expected_agent_session_id must be supplied together and nonempty"))
		return
	}
	if strings.HasPrefix(text, "/") || strings.HasPrefix(text, "!") {
		inputHTTPError(w, 400, fmt.Errorf("control commands are not accepted by local input"))
		return
	}
	s.inputs.mu.Lock()
	defer s.inputs.mu.Unlock()
	if old := s.inputs.entries[req.RequestID]; old != nil {
		if !old.request.sameInput(req) {
			inputHTTPError(w, 409, fmt.Errorf("request_id already used with different input"))
			return
		}
		apiJSON(w, 200, old.result)
		return
	}
	if len(s.inputs.entries) >= maxInputRequests {
		inputHTTPError(w, 503, fmt.Errorf("input request capacity reached"))
		return
	}
	e := s.inputEngine(req.Project)
	if e == nil {
		inputHTTPError(w, 404, fmt.Errorf("project not found"))
		return
	}
	if e.ctx.Err() != nil {
		inputHTTPError(w, 503, fmt.Errorf("engine stopped"))
		return
	}
	session, p, reply, code, err := e.inputBinding(req.SessionKey)
	if err != nil {
		inputHTTPError(w, code, err)
		return
	}
	// Take the same lock as Discord/timer turns. There is no queued input and
	// a busy rejection does not reserve the ID, so callers may explicitly retry.
	if !session.TryLock() {
		inputHTTPError(w, 409, fmt.Errorf("session busy"))
		return
	}
	if e.sessions.ActiveSessionID(req.SessionKey) != session.ID {
		session.Unlock()
		inputHTTPError(w, 409, fmt.Errorf("active binding changed"))
		return
	}
	agentSessionID := session.GetAgentSessionID()
	if req.ExpectedSessionID != nil && (session.ID != *req.ExpectedSessionID || agentSessionID != *req.ExpectedAgentSessionID) {
		session.UnlockWithoutUpdate()
		inputHTTPError(w, 409, fmt.Errorf("session binding does not match expected IDs"))
		return
	}
	entry := &inputEntry{request: req, result: InputResult{RequestID: req.RequestID, Status: "running", SessionID: session.ID, AgentSessionID: agentSessionID}}
	if s.inputs.entries == nil {
		s.inputs.entries = make(map[string]*inputEntry)
	}
	s.inputs.entries[req.RequestID] = entry
	turn := &inputTurn{expectedID: entry.result.AgentSessionID}
	if req.Stream {
		turn.appendSpeech = func(text string) {
			s.inputs.mu.Lock()
			defer s.inputs.mu.Unlock()
			// Bound retained output, never evict/replay it. The consumer falls
			// back to the terminal answer if no supported source emits deltas.
			if entry.result.Status == "running" && len(entry.result.SpeechText)+len(text) <= 16384 {
				entry.result.SpeechText += text
			}
		}
	}
	turn.complete = func(result inputTurnResult) {
		s.inputs.mu.Lock()
		defer s.inputs.mu.Unlock()
		entry.result.Status = "completed"
		entry.result.Text = result.text
		if result.err != nil {
			entry.result.Status = "failed"
			entry.result.Error = result.err.Error()
		} else if result.silent {
			entry.result.Status = "silent"
			entry.result.Text = ""
		}
	}
	msg := &Message{SessionKey: req.SessionKey, Platform: p.Name(), UserID: "local-input", UserName: "local-input", Content: text, ReplyCtx: reply, inputTurn: turn}
	if !e.startInteractiveMessage(p, msg, session, e.agent, e.sessions, req.SessionKey, "", req.SessionKey) {
		delete(s.inputs.entries, req.RequestID)
		inputHTTPError(w, 503, fmt.Errorf("engine stopped"))
		return
	}
	apiJSON(w, http.StatusAccepted, entry.result)
}

func (s *APIServer) handleInputLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		inputHTTPError(w, 405, fmt.Errorf("GET only"))
		return
	}
	if r.URL.Path == "/input/bindings" {
		project, key := r.URL.Query().Get("project"), r.URL.Query().Get("session_key")
		if project == "" || key == "" {
			inputHTTPError(w, 400, fmt.Errorf("project and session_key required"))
			return
		}
		e := s.inputEngine(project)
		if e == nil {
			inputHTTPError(w, 404, fmt.Errorf("project not found"))
			return
		}
		session, _, _, code, err := e.inputBinding(key)
		if err != nil {
			inputHTTPError(w, code, err)
			return
		}
		apiJSON(w, 200, map[string]any{"project": project, "session_key": key, "session_id": session.ID, "agent_session_id": session.GetAgentSessionID(), "busy": session.Busy()})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/input/")
	s.inputs.mu.Lock()
	defer s.inputs.mu.Unlock()
	entry := s.inputs.entries[id]
	if entry == nil {
		inputHTTPError(w, 404, fmt.Errorf("request not found (request IDs are process-local)"))
		return
	}
	apiJSON(w, 200, entry.result)
}

// localInputOutput is only a presentation sink. Never store it in interactiveState
// or pass it to startup/history/permissions: those need the original capabilities.
// Omitting preview/card capabilities prevents alternate presentation sends.
type localInputOutput struct{ name string }

func (p localInputOutput) Name() string                           { return p.name }
func (localInputOutput) Start(MessageHandler) error               { return nil }
func (localInputOutput) Stop() error                              { return nil }
func (localInputOutput) Send(context.Context, any, string) error  { return nil }
func (localInputOutput) Reply(context.Context, any, string) error { return nil }
func inputOutputPlatform(p Platform, turn *inputTurn) Platform {
	if turn != nil {
		return localInputOutput{name: p.Name()}
	}
	return p
}
