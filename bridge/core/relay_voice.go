package core

// Private voice is an explicit variant of relay, not an error fallback from
// /input. Only the local 0600 socket admits it; device authorization stays in
// companion. Ordinary bot relay retains its existing visibility and behavior.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// VoiceRelayAgent explicitly supports a new isolated voice conversation and
// exact subsequent resume without fresh-session fallback.
// Returned sessions must emit successful EventResult only for a normally
// completed native turn, including the first Send (ACP: end_turn). Env is per-start,
// never a mutation of the engine agent's shared SessionEnvInjector state.
type VoiceRelayAgent interface {
	StartVoiceRelay(context.Context, string, []string) (AgentSession, error)
}

// This error is produced only before invoking Send. A crash or any failure
// after invoking Send remains ambiguous and must never reset identity.
type voiceNotSubmittedError struct{ error }

type voiceRelayResult struct {
	RequestID      string `json:"request_id"`
	RelayKey       string `json:"relay_key"`
	Status         string `json:"status"`
	Text           string `json:"text"`
	Error          string `json:"error"`
	AgentSessionID string `json:"agent_session_id"`
	// Only for requests with stream=true: complete public sentences so far,
	// and once completed, the public text after them. Cleared on failure.
	Sentences []string `json:"sentences,omitempty"`
	Rest      string   `json:"rest,omitempty"`
}
type voiceRelayEntry struct {
	Digest string           `json:"digest"`
	Result voiceRelayResult `json:"result"`
	cancel context.CancelFunc
}
type voiceRelayConversation struct {
	Agent string `json:"agent"`
	ID    string `json:"id"`
	// Started without an ID means execution may have happened but identity was
	// not recovered. Never silently create a replacement conversation.
	Started bool `json:"started"`
}
type voiceRelayStore struct {
	mu            sync.Mutex
	Entries       map[string]*voiceRelayEntry       `json:"entries"`
	Conversations map[string]voiceRelayConversation `json:"conversations"`
	busy          map[string]bool
	path          string
	fault         error
}

func (rm *RelayManager) initVoiceRelay(dataDir string) {
	v := &rm.voice
	v.Entries = make(map[string]*voiceRelayEntry)
	v.Conversations = make(map[string]voiceRelayConversation)
	v.busy = make(map[string]bool)
	if dataDir == "" {
		return
	}
	v.path = filepath.Join(dataDir, "voice_relay.json")
	data, err := os.ReadFile(v.path)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err == nil {
		err = json.Unmarshal(data, v)
	}
	if err != nil || v.Entries == nil || v.Conversations == nil {
		v.fault = fmt.Errorf("voice relay store unavailable")
		return
	}
	for _, entry := range v.Entries {
		if entry == nil {
			v.fault = fmt.Errorf("invalid voice relay receipt")
			return
		}
		if entry.Result.Status == "running" {
			entry.Result.Status = "failed"
			entry.Result.Error = "relay interrupted by restart; outcome unknown; do not resubmit"
			entry.Result.Text = ""
			entry.Result.Sentences, entry.Result.Rest = nil, ""
		}
	}
	v.saveLocked()
}

func (v *voiceRelayStore) saveLocked() error {
	if v.fault != nil {
		return v.fault
	}
	if v.path == "" {
		return nil
	}
	data, err := json.Marshal(v)
	if err == nil {
		err = AtomicWriteFile(v.path, data, 0600)
	}
	if err != nil {
		v.fault = fmt.Errorf("voice relay persistence failed")
	}
	return v.fault
}

func relayDigest(value any) string {
	data, _ := json.Marshal(value)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (rm *RelayManager) voiceTarget(req RelayRequest) (*Engine, string, error) {
	platform, chat, err := parseSessionKeyParts(req.SessionKey)
	if err != nil || req.From == "" || req.To == "" || !validInputID(req.Scope) || len(req.SessionKey) > 512 {
		return nil, "", fmt.Errorf("invalid voice relay identity")
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	binding := rm.bindings[chat]
	target := rm.engines[req.To]
	if binding == nil || binding.Platform != platform || binding.Bots[req.From] == "" || binding.Bots[req.To] == "" || target == nil || rm.engines[req.From] == nil {
		return nil, "", fmt.Errorf("source and target must be bound in the configured voice channel")
	}
	// Full source key preserves thread suffixes. Scope isolates devices; target
	// isolates roles. This cannot alias the ordinary coding or bot-relay key.
	key := relayDigest([]string{req.From, req.To, req.SessionKey, req.Scope})
	return target, key, nil
}

func (rm *RelayManager) submitVoice(req RelayRequest) (voiceRelayResult, int, error) {
	var zero voiceRelayResult
	if !validInputID(req.RequestID) || req.RequestID == "binding" || strings.TrimSpace(req.Message) == "" || len(req.Message) > maxInputBodyBytes {
		return zero, 400, fmt.Errorf("invalid voice relay request")
	}
	target, key, err := rm.voiceTarget(req)
	if err != nil {
		return zero, 422, err
	}
	v := &rm.voice
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.fault != nil {
		return zero, 503, v.fault
	}
	digest := relayDigest(req)
	if prior := v.Entries[req.RequestID]; prior != nil {
		if prior.Digest != digest {
			return zero, 409, fmt.Errorf("request ID already used for different input")
		}
		return prior.Result, 200, nil
	}
	if len(v.Entries) >= maxInputRequests {
		return zero, 503, &voiceNotSubmittedError{fmt.Errorf("voice relay receipt capacity reached")}
	}
	if v.busy[key] {
		return zero, 409, fmt.Errorf("voice conversation busy; request not sent")
	}
	conversation := v.Conversations[key]
	if conversation.Started && conversation.ID == "" {
		return zero, 422, fmt.Errorf("prior conversation identity unknown; manual recovery required")
	}
	// Bound wait even when ordinary bot relay is configured without a timeout.
	rm.mu.RLock()
	timeout := rm.timeout
	rm.mu.RUnlock()
	if timeout <= 0 || timeout > 3*time.Minute {
		timeout = 3 * time.Minute
	}
	if !target.beginMessageWork() {
		return zero, 503, &voiceNotSubmittedError{fmt.Errorf("target is stopping; request not sent")}
	}
	ctx, cancel := context.WithTimeout(target.ctx, timeout)
	entry := &voiceRelayEntry{Digest: digest, Result: voiceRelayResult{RequestID: req.RequestID, RelayKey: key, Status: "running"}, cancel: cancel}
	v.Entries[req.RequestID] = entry
	v.busy[key] = true
	conversation.Started = true
	v.Conversations[key] = conversation
	if err := v.saveLocked(); err != nil {
		cancel()
		target.messageWorkers.Done()
		delete(v.busy, key)
		return zero, 503, &voiceNotSubmittedError{err}
	}
	go func() {
		defer target.messageWorkers.Done()
		rm.runVoice(ctx, target, req, key, conversation)
	}()
	return entry.Result, 202, nil
}

func (rm *RelayManager) runVoice(ctx context.Context, e *Engine, req RelayRequest, key string, prior voiceRelayConversation) {
	v := &rm.voice
	saveID := func(id, agent string) error {
		if id == "" || id == ContinueSession {
			return fmt.Errorf("voice relay did not identify its conversation")
		}
		v.mu.Lock()
		defer v.mu.Unlock()
		old := v.Conversations[key]
		if old.ID != "" && (old.ID != id || old.Agent != agent) {
			return fmt.Errorf("voice relay conversation changed")
		}
		if old.ID == id && v.Entries[req.RequestID].Result.AgentSessionID == id {
			return nil
		}
		v.Conversations[key] = voiceRelayConversation{Agent: agent, ID: id, Started: true}
		v.Entries[req.RequestID].Result.AgentSessionID = id
		return v.saveLocked()
	}
	var split *voiceSentenceSplitter
	var progress func(string, bool)
	if req.Stream {
		split = &voiceSentenceSplitter{}
		progress = func(delta string, boundary bool) {
			v.mu.Lock()
			defer v.mu.Unlock()
			entry := v.Entries[req.RequestID]
			// Cancelled or failed receipts never grow again.
			if entry == nil || entry.Result.Status != "running" {
				split.frozen = true
				return
			}
			var added []string
			if boundary {
				added = split.boundary()
			} else {
				added = split.feed(delta)
			}
			entry.Result.Sentences = append(entry.Result.Sentences, added...)
		}
	}
	text, closeErr, err := e.collectVoiceRelay(ctx, req, prior, saveID, progress)
	v.mu.Lock()
	defer v.mu.Unlock()
	entry := v.Entries[req.RequestID]
	if err == nil && split != nil && !strings.HasPrefix(text, strings.Join(entry.Result.Sentences, "")) {
		err = fmt.Errorf("final voice answer changed its published prefix")
	}
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	entry.cancel()
	entry.cancel = nil
	delete(v.busy, key)
	var notSent *voiceNotSubmittedError
	if errors.As(err, &notSent) && prior.ID == "" && v.Conversations[key].ID == "" {
		v.Conversations[key] = voiceRelayConversation{Agent: prior.Agent, ID: prior.ID}
	}
	// A new conversation whose session was never persisted cannot be resumed;
	// keeping its ID would fail every later strict resume on this channel.
	if closeErr != nil && prior.ID == "" && v.Conversations[key].ID != "" {
		slog.Warn("voice relay: new session not persisted; next turn starts a new session",
			"session_key", req.SessionKey, "session_id", v.Conversations[key].ID, "error", closeErr)
		v.Conversations[key] = voiceRelayConversation{Agent: prior.Agent, ID: prior.ID}
	}
	if entry.Result.Status != "running" {
		_ = v.saveLocked()
		return
	}
	if err != nil {
		entry.Result.Status = "failed"
		entry.Result.Error = "voice relay failed; no complete public answer; check conversation before retrying"
		entry.Result.Sentences = nil
	} else {
		entry.Result.Status = "completed"
		entry.Result.Text = text
		if split != nil && len(entry.Result.Sentences) > 0 {
			entry.Result.Rest = strings.TrimPrefix(text, strings.Join(entry.Result.Sentences, ""))
		}
	}
	if v.saveLocked() != nil {
		entry.Result.Status = "failed"
		entry.Result.Text = ""
		entry.Result.Error = "receipt persistence failed; outcome unknown"
		entry.Result.Sentences, entry.Result.Rest = nil, ""
	}
}

// collectVoiceRelay shares relay workspace resolution, but has a fail-closed
// result collector: no group visibility, partial success, tool output or
// automatic permission approval. An unknown prior ID is never cleared.
// progress (stream requests only) receives public text deltas, and a boundary
// when a tool call ends the current assistant message. closeErr reports a failure
// to persist the session; it never replaces the turn's own result.
func (e *Engine) collectVoiceRelay(ctx context.Context, req RelayRequest, prior voiceRelayConversation, saveID func(string, string) error, progress func(string, bool)) (answer string, closeErr error, err error) {
	submitted := false
	defer func() {
		if err != nil && !submitted {
			err = &voiceNotSubmittedError{err}
		}
	}()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var progressToken string
	defer func() {
		if progressToken == "" {
			return
		}
		outcome := "result"
		if errors.Is(err, context.Canceled) {
			outcome = "cancelled"
		} else if err != nil {
			outcome = "failed"
		}
		e.publicProgress.finish(progressToken, outcome)
	}()
	agent, _, _, err := e.relayContextForSourceSessionKey(req.From, req.SessionKey)
	if err != nil {
		return "", nil, err
	}
	if prior.ID != "" && prior.Agent != agent.Name() {
		return "", nil, fmt.Errorf("relay agent changed")
	}
	starter, ok := agent.(VoiceRelayAgent)
	if !ok {
		return "", nil, fmt.Errorf("backend does not support isolated voice relay")
	}
	stream := "0"
	if req.Stream {
		stream = "1"
	}
	session, err := starter.StartVoiceRelay(ctx, prior.ID, []string{
		"CC_PROJECT=" + e.name, "CC_SESSION_KEY=" + req.SessionKey, "CC_VOICE_STREAM=" + stream,
	})
	if err != nil {
		return "", nil, err
	}
	defer func() {
		// The answer may already have been spoken (stream mode), so a persist failure
		// must not turn a delivered turn into a failure; it only risks the next turn
		// not resuming this context.
		if closeErr = session.Close(); closeErr != nil && err == nil {
			slog.Warn("voice relay: persist session failed; answer kept, next turn may not resume this context",
				"session_key", req.SessionKey, "error", closeErr)
		}
	}()
	if prior.ID != "" && session.CurrentSessionID() != prior.ID {
		return "", nil, fmt.Errorf("relay resume identity mismatch")
	}
	if id := session.CurrentSessionID(); id != "" {
		if err := saveID(id, agent.Name()); err != nil {
			return "", nil, err
		}
	}
	deskKey := voiceDeskKey(req)
	// Taken before sending: a proposal is confirmed only by the very next message, and a failed
	// or cancelled turn drops it rather than carrying it forward.
	pending, confirmed := e.voiceDeskTake(deskKey, voiceUserText(req))
	var toSend *voicePending
	if confirmed {
		toSend = &pending
	}
	prompt := withSubagentPolicy(e.withVoiceDesk(""), "", true)
	// A spoken task opens its card on the voice channel the device is bound to;
	// that channel is already verified by voiceTarget.
	if token := e.voicePublicProgress(ctx, req.SessionKey); token != "" {
		progressToken = token
		prompt = e.voiceProgressInstructions(token, req.SessionKey) + prompt
	}
	prompt = "[Bothouse voice context]\n" + prompt + "\n[/Bothouse voice context]\n\n" + req.Message
	send := func() error { return session.Send(prompt, req.RequestID, nil, nil) }
	if strict, ok := session.(StrictResumeSession); ok && session.CurrentSessionID() != "" {
		id := session.CurrentSessionID()
		if err = strict.PrepareResumed(id); err == nil {
			// Preparation quiesces the prior reader. Discard stale events before send.
			for draining := true; draining; {
				select {
				case _, open := <-session.Events():
					if !open {
						return "", nil, fmt.Errorf("relay closed before send")
					}
				default:
					draining = false
				}
			}
			send = func() error { return strict.SendResumed(prompt, req.RequestID, nil, nil, id) }
		}
	}
	if err != nil {
		return "", nil, err
	}
	// ACP Send waits for the full prompt RPC, including permission responses.
	// Consume events concurrently or a long response/permission can deadlock.
	sent := make(chan error, 1)
	submitted = true // From here on, failure may follow tool execution.
	go func() { sent <- send() }()
	var text strings.Builder
	for {
		select {
		case <-ctx.Done():
			return "", nil, ctx.Err()
		case err := <-sent:
			if err != nil {
				return "", nil, err
			}
			sent = nil // Send success is not the successful terminal event.
		case event, open := <-session.Events():
			if !open {
				return "", nil, fmt.Errorf("relay closed without successful terminal event")
			}
			if ctx.Err() != nil {
				return "", nil, ctx.Err()
			}
			if event.SessionID != "" {
				if err := saveID(event.SessionID, agent.Name()); err != nil {
					return "", nil, err
				}
			}
			switch event.Type {
			case EventText:
				if text.Len()+len(event.Content) > maxInputBodyBytes {
					return "", nil, fmt.Errorf("relay answer too large")
				}
				text.WriteString(event.Content)
				if progress != nil && event.Content != "" {
					progress(event.Content, false)
				}
			case EventToolUse:
				if progress != nil {
					progress("", true)
				}
			case EventResult:
				if !event.Done {
					continue
				}
				answer := event.Content
				if answer == "" {
					answer = text.String()
				}
				if len(answer) > maxInputBodyBytes || strings.TrimSpace(answer) == "" {
					return "", nil, ErrNoPublicAnswer
				}
				if err := saveID(session.CurrentSessionID(), agent.Name()); err != nil {
					return "", nil, err
				}
				// Hand-offs run only after a successful terminal answer; never on partial or failed turns.
				return e.finishVoiceDesk(ctx, deskKey, answer, toSend), nil, nil
			case EventError:
				return "", nil, fmt.Errorf("relay backend failed")
			case EventPermissionRequest:
				_ = session.RespondPermission(event.RequestID, PermissionResult{Behavior: "deny"})
				return "", nil, fmt.Errorf("voice relay requires permission; continue in configured channel")
			}
		}
	}
}

func (s *APIServer) handleVoiceRelay(w http.ResponseWriter, r *http.Request) {
	if s.relay == nil {
		inputHTTPError(w, 503, fmt.Errorf("relay unavailable"))
		return
	}
	rm := s.relay
	id := strings.TrimPrefix(r.URL.Path, "/relay/voice/")
	if id == "binding" && r.Method == http.MethodGet {
		q := r.URL.Query()
		req := RelayRequest{From: q.Get("from"), To: q.Get("to"), SessionKey: q.Get("session_key"), Scope: q.Get("scope")}
		_, key, err := rm.voiceTarget(req)
		if err != nil {
			inputHTTPError(w, 422, err)
			return
		}
		rm.voice.mu.Lock()
		defer rm.voice.mu.Unlock()
		if rm.voice.fault != nil {
			inputHTTPError(w, 503, rm.voice.fault)
			return
		}
		c := rm.voice.Conversations[key]
		if c.Started && c.ID == "" {
			inputHTTPError(w, 422, fmt.Errorf("prior relay identity unknown"))
			return
		}
		apiJSON(w, 200, map[string]any{"relay_key": key, "from": req.From, "to": req.To, "session_key": req.SessionKey, "scope": req.Scope, "busy": rm.voice.busy[key]})
		return
	}
	cancel := strings.HasSuffix(id, "/cancel")
	if cancel {
		id = strings.TrimSuffix(id, "/cancel")
	}
	if (cancel && r.Method != http.MethodPost) || (!cancel && r.Method != http.MethodGet) {
		http.Error(w, "method not allowed", 405)
		return
	}
	rm.voice.mu.Lock()
	defer rm.voice.mu.Unlock()
	if rm.voice.fault != nil {
		inputHTTPError(w, 503, rm.voice.fault)
		return
	}
	entry := rm.voice.Entries[id]
	if entry == nil {
		inputHTTPError(w, 404, fmt.Errorf("unknown relay receipt; do not resubmit"))
		return
	}
	if cancel && entry.Result.Status == "running" {
		entry.cancel()
		entry.Result.Status = "failed"
		entry.Result.Text = ""
		entry.Result.Error = "voice relay cancelled; execution may already have occurred"
		entry.Result.Sentences, entry.Result.Rest = nil, ""
		if err := rm.voice.saveLocked(); err != nil {
			inputHTTPError(w, 503, err)
			return
		}
	}
	apiJSON(w, 200, entry.Result)
}

func (e *Engine) voicePublicProgress(ctx context.Context, sessionKey string) string {
	if e.publicProgress == nil {
		return ""
	}
	name, _, ok := strings.Cut(sessionKey, ":")
	if !ok {
		return ""
	}
	for _, p := range e.platforms {
		if p.Name() == name {
			return e.beginPublicProgress(p, sessionKey, func() bool { return ctx.Err() != nil }, true)
		}
	}
	return ""
}
