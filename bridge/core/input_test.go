package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type inputTestPlatform struct {
	stubPlatformEngine
	typing atomic.Int32
	cards  atomic.Int32
}

func (p *inputTestPlatform) ReconstructReplyCtx(key string) (any, error) { return key, nil }
func (p *inputTestPlatform) StartTyping(context.Context, any) func() {
	p.typing.Add(1)
	return func() {}
}
func (p *inputTestPlatform) SendCard(ctx context.Context, rc any, c *Card) error {
	p.cards.Add(1)
	return p.Send(ctx, rc, c.RenderText())
}
func (p *inputTestPlatform) ReplyCard(ctx context.Context, rc any, c *Card) error {
	return p.SendCard(ctx, rc, c)
}

func (p *inputTestPlatform) CreateStreamingCard(context.Context, any) (StreamingCard, error) {
	p.cards.Add(1)
	return nil, errors.New("test streaming card unavailable")
}
func (p *inputTestPlatform) AddDoneReaction(any) { p.typing.Add(1) }

type inputTestTTS struct{ calls atomic.Int32 }

func (s *inputTestTTS) Synthesize(context.Context, string, TTSSynthesisOpts) ([]byte, string, error) {
	s.calls.Add(1)
	return nil, "", errors.New("unexpected TTS")
}

type inputTestSession struct {
	stubAgentSession
	events        chan Event
	prompts       chan string
	strict        atomic.Int32
	normal        atomic.Int32
	closed        atomic.Bool
	id            string
	sendErr       error
	prepareEvents []Event
}

func (s *inputTestSession) Events() <-chan Event     { return s.events }
func (s *inputTestSession) CurrentSessionID() string { return s.id }
func (s *inputTestSession) PrepareResumed(id string) error {
	for _, ev := range s.prepareEvents {
		s.events <- ev
	}
	if id != s.id {
		return errors.New("wrong resume ID")
	}
	return nil
}
func (s *inputTestSession) Alive() bool  { return !s.closed.Load() }
func (s *inputTestSession) Close() error { s.closed.Store(true); return nil }
func (s *inputTestSession) Send(p, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.normal.Add(1)
	s.prompts <- p
	return s.sendErr
}
func (s *inputTestSession) SendResumed(p, _ string, _ []ImageAttachment, _ []FileAttachment, id string) error {
	if id != s.id {
		return errors.New("wrong resume ID")
	}
	s.strict.Add(1)
	s.prompts <- p
	return s.sendErr
}

type inputTestAgent struct {
	stubAgent
	session      *inputTestSession
	starts       atomic.Int32
	normalStarts atomic.Int32
	err          error
	unsupported  bool
	requested    chan string
	listed       []AgentSessionInfo
}

func (a *inputTestAgent) CompressCommand() string    { return "/compact" }
func (a *inputTestAgent) SupportsStrictResume() bool { return !a.unsupported }
func (a *inputTestAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) {
	return a.listed, nil
}
func (a *inputTestAgent) StartSessionStrict(_ context.Context, id string) (AgentSession, error) {
	a.starts.Add(1)
	a.requested <- id
	if a.err != nil {
		return nil, a.err
	}
	return a.session, nil
}
func (a *inputTestAgent) StartSession(context.Context, string) (AgentSession, error) {
	a.normalStarts.Add(1)
	return a.session, nil
}

const inputTestKey = "discord:voice-channel"

func inputFixture(t *testing.T) (*APIServer, *Engine, *inputTestAgent, *inputTestPlatform, *Session) {
	t.Helper()
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "original-thread"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("gge", ag, []Platform{p}, "", LangEnglish)
	session := e.sessions.GetOrCreateActive(inputTestKey)
	session.SetAgentSessionID(as.id, ag.Name())
	api := &APIServer{engines: map[string]*Engine{"gge": e}}
	t.Cleanup(func() { e.cancel(); inputWait(t, func() bool { return !session.Busy() }); _ = e.Stop() })
	return api, e, ag, p, session
}
func inputWait(t *testing.T, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition timed out")
}
func inputPost(s *APIServer, r any) (int, InputResult) {
	b, _ := json.Marshal(r)
	w := httptest.NewRecorder()
	s.handleInput(w, httptest.NewRequest("POST", "/input", strings.NewReader(string(b))))
	var result InputResult
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	return w.Code, result
}
func inputReq(id, text string) InputRequest {
	return InputRequest{RequestID: id, Project: "gge", SessionKey: inputTestKey, Text: text}
}
func inputGet(s *APIServer, id string) (int, InputResult) {
	w := httptest.NewRecorder()
	s.handleInputLookup(w, httptest.NewRequest("GET", "/input/"+id, nil))
	var r InputResult
	_ = json.Unmarshal(w.Body.Bytes(), &r)
	return w.Code, r
}
func inputResult(t *testing.T, s *APIServer, id string, status string) InputResult {
	t.Helper()
	var r InputResult
	inputWait(t, func() bool { _, r = inputGet(s, id); return r.Status != "running" && r.Status != "" })
	if r.Status != status {
		t.Fatalf("result=%+v, want %s", r, status)
	}
	return r
}
func inputPrompt(t *testing.T, a *inputTestAgent) string {
	t.Helper()
	select {
	case p := <-a.session.prompts:
		return p
	case <-time.After(3 * time.Second):
		t.Fatal("no prompt")
		return ""
	}
}
func inputDone(a *inputTestAgent, text string) {
	a.session.events <- Event{Type: EventResult, Done: true, Content: text, SessionID: a.session.id}
}

// Build the wire request from the public lookup response so this regression
// also exercises the JSON contract, including on servers without the fields.
func inputBoundRequest(t *testing.T, api *APIServer, id string) map[string]any {
	t.Helper()
	code, binding := inputGet(api, "bindings?project=gge&session_key="+inputTestKey)
	if code != http.StatusOK || binding.SessionID == "" || binding.AgentSessionID == "" {
		t.Fatalf("binding lookup: %d %+v", code, binding)
	}
	return map[string]any{
		"request_id": id, "project": "gge", "session_key": inputTestKey, "text": "voice words",
		"expected_session_id": binding.SessionID, "expected_agent_session_id": binding.AgentSessionID,
	}
}

func TestLocalInputRejectsBindingChangedAfterLookup(t *testing.T) {
	for _, change := range []string{"session", "agent-session"} {
		t.Run(change, func(t *testing.T) {
			api, e, a, p, s := inputFixture(t)
			req := inputBoundRequest(t, api, "binding-retry")
			if change == "session" {
				s = e.sessions.NewSession(inputTestKey, "replacement")
			} else {
				a.session.id = "replacement-thread"
			}
			s.SetAgentSessionID(a.session.id, a.Name())
			if code, result := inputPost(api, req); code != http.StatusConflict {
				t.Fatalf("stale binding: got %d %+v, want 409", code, result)
			}
			if code, _ := inputGet(api, "binding-retry"); code != http.StatusNotFound {
				t.Fatalf("rejected request ID was reserved: %d", code)
			}
			if a.starts.Load() != 0 || a.normalStarts.Load() != 0 || a.session.strict.Load() != 0 || len(a.session.prompts) != 0 || len(p.getSent()) != 0 {
				t.Fatal("stale binding started or sent a turn")
			}
			// Refreshing the binding must allow the very same request ID to run.
			req = inputBoundRequest(t, api, "binding-retry")
			if code, result := inputPost(api, req); code != http.StatusAccepted {
				t.Fatalf("refreshed binding: %d %+v", code, result)
			}
			inputPrompt(t, a)
			inputDone(a, "fresh answer")
			result := inputResult(t, api, "binding-retry", "completed")
			inputWait(t, func() bool { return !s.Busy() })
			if result.SessionID != s.ID || result.AgentSessionID != a.session.id {
				t.Fatalf("wrong result binding: %+v", result)
			}
		})
	}
}

func TestLocalInputExpectedBindingAndLegacyAreIdempotent(t *testing.T) {
	for _, mode := range []string{"expected-binding", "legacy"} {
		t.Run(mode, func(t *testing.T) {
			api, e, a, _, s := inputFixture(t)
			req := inputBoundRequest(t, api, "idempotent")
			if mode == "legacy" {
				delete(req, "expected_session_id")
				delete(req, "expected_agent_session_id")
			}
			var wg sync.WaitGroup
			codes := make(chan int, 8)
			for i := 0; i < cap(codes); i++ {
				wg.Add(1)
				go func() { defer wg.Done(); code, _ := inputPost(api, req); codes <- code }()
			}
			wg.Wait()
			close(codes)
			accepted := 0
			for code := range codes {
				if code == http.StatusAccepted {
					accepted++
				} else if code != http.StatusOK {
					t.Fatalf("identical retry: got %d, want 200", code)
				}
			}
			if accepted != 1 {
				t.Fatalf("accepted %d identical requests, want 1", accepted)
			}
			inputPrompt(t, a)
			inputDone(a, "bound answer")
			result := inputResult(t, api, "idempotent", "completed")
			inputWait(t, func() bool { return !s.Busy() })
			if result.Text != "bound answer" || result.SessionID != s.ID || result.AgentSessionID != a.session.id {
				t.Fatalf("wrong result: %+v", result)
			}
			// A completed retry returns its original result even after a switch.
			next := e.sessions.NewSession(inputTestKey, "next conversation")
			next.SetAgentSessionID("next-thread", a.Name())
			if code, retry := inputPost(api, req); code != http.StatusOK || retry != result {
				t.Fatalf("completed retry: %d %+v, want %+v", code, retry, result)
			}
			if code, retry := inputPost(api, inputBoundRequest(t, api, "idempotent")); code != http.StatusConflict {
				t.Fatalf("changed binding reused request ID: %d %+v", code, retry)
			}
			if a.session.strict.Load() != 1 || a.normalStarts.Load() != 0 {
				t.Fatal("retry executed another prompt")
			}
		})
	}
}

func TestLocalInputExpectedBindingRequiresCompletePair(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"session-only", func(r map[string]any) { delete(r, "expected_agent_session_id") }},
		{"agent-only", func(r map[string]any) { delete(r, "expected_session_id") }},
		{"empty-session", func(r map[string]any) { r["expected_session_id"] = "" }},
		{"empty-agent", func(r map[string]any) { r["expected_agent_session_id"] = "" }},
		{"null-session", func(r map[string]any) { r["expected_session_id"] = nil }},
		{"null-agent", func(r map[string]any) { r["expected_agent_session_id"] = nil }},
		{"empty-pair", func(r map[string]any) { r["expected_session_id"], r["expected_agent_session_id"] = "", "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, _, a, _, s := inputFixture(t)
			req := inputBoundRequest(t, api, "pair-retry")
			tc.change(req)
			if code, result := inputPost(api, req); code != http.StatusBadRequest {
				t.Fatalf("invalid pair: %d %+v, want 400", code, result)
			}
			if code, _ := inputGet(api, "pair-retry"); code != http.StatusNotFound {
				t.Fatalf("invalid request ID was reserved: %d", code)
			}
			if a.starts.Load() != 0 || len(a.session.prompts) != 0 {
				t.Fatal("invalid pair started a turn")
			}
			if code, result := inputPost(api, inputBoundRequest(t, api, "pair-retry")); code != http.StatusAccepted {
				t.Fatalf("corrected pair: %d %+v", code, result)
			}
			inputPrompt(t, a)
			inputDone(a, "corrected answer")
			inputResult(t, api, "pair-retry", "completed")
			inputWait(t, func() bool { return !s.Busy() })
		})
	}
}

func TestLocalInputSameSessionLocalOnlyAndDiscord(t *testing.T) {
	api, e, a, p, s := inputFixture(t)
	e.instantReply = InstantReplyCfg{Enabled: true, Content: "starting"}
	e.autoCompressEnabled = true
	e.autoCompressMaxTokens = 1
	tts := &inputTestTTS{}
	e.tts = &TTSCfg{Enabled: true, TTS: tts, ttsMode: "always"}
	for i := 0; i < 2; i++ {
		id := fmt.Sprint("voice", i)
		if code, _ := inputPost(api, inputReq(id, "voice words")); code != 202 {
			t.Fatal(code)
		}
		inputPrompt(t, a)
		if err := e.SendToSession(inputTestKey, "voice side send"); err == nil {
			t.Fatal("voice side send must be rejected")
		}
		if _, err := e.resolveSendTarget(inputTestKey, true); err == nil {
			t.Fatal("voice attachment/workdir send must be rejected")
		}
		a.session.events <- Event{Type: EventThinking, Content: "private thought"}
		a.session.events <- Event{Type: EventToolUse, ToolName: "read", ToolInput: "private tool"}
		a.session.events <- Event{Type: EventToolResult, ToolName: "read", Content: "private result"}
		inputDone(a, "voice answer")
		r := inputResult(t, api, id, "completed")
		inputWait(t, func() bool { return !s.Busy() })
		if r.Text != "voice answer" || r.SessionID != s.ID || r.AgentSessionID != "original-thread" {
			t.Fatalf("%+v", r)
		}
		if len(p.getSent()) != 0 || p.typing.Load() != 0 || p.cards.Load() != 0 {
			t.Fatalf("voice leaked to platform: %v", p.getSent())
		}
	}
	if tts.calls.Load() != 0 {
		t.Fatal("voice invoked TTS")
	}
	e.autoCompressEnabled = false
	e.tts = nil
	if a.starts.Load() != 1 || a.normalStarts.Load() != 0 || a.session.strict.Load() != 2 {
		t.Fatal("did not reuse strict session")
	}
	if got := <-a.requested; got != "original-thread" {
		t.Fatal(got)
	}
	history := s.GetHistory(0)
	if len(history) != 4 {
		t.Fatalf("missing voice memory: %v", history)
	}
	e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: "discord", Content: "Discord followup", ReplyCtx: inputTestKey, UserID: "user"})
	inputPrompt(t, a)
	inputDone(a, "Discord answer")
	inputWait(t, func() bool { return !s.Busy() })
	if !strings.Contains(strings.Join(p.getSent(), "\n"), "Discord answer") || a.session.normal.Load() != 1 {
		t.Fatalf("Discord was muted: %v", p.getSent())
	}
	e.interactiveMu.Lock()
	st := e.interactiveStates[inputTestKey]
	e.interactiveMu.Unlock()
	st.mu.Lock()
	original := st.platform == p
	st.mu.Unlock()
	if !original {
		t.Fatal("original capabilities lost")
	}
}

func TestLocalInputEmptyAnswerFails(t *testing.T) {
	api, _, a, p, s := inputFixture(t)
	if code, _ := inputPost(api, inputReq("empty", "hello")); code != 202 {
		t.Fatal(code)
	}
	inputPrompt(t, a)
	inputDone(a, "   ")
	r := inputResult(t, api, "empty", "failed")
	inputWait(t, func() bool { return !s.Busy() })
	if r.Text != "" || len(p.getSent()) != 0 {
		t.Fatalf("empty answer leaked: %+v", r)
	}
}

func TestLocalInputConcurrentBusyIdempotentAndIsolation(t *testing.T) {
	api, e, a, p, s := inputFixture(t)
	r := inputReq("first", "voice")
	var wg sync.WaitGroup
	codes := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); code, _ := inputPost(api, r); codes <- code }()
	}
	wg.Wait()
	close(codes)
	accepted := 0
	for code := range codes {
		if code == 202 {
			accepted++
		} else if code != 200 {
			t.Fatal(code)
		}
	}
	if accepted != 1 {
		t.Fatal(accepted)
	}
	inputPrompt(t, a)
	if code, _ := inputPost(api, inputReq("second", "another")); code != 409 {
		t.Fatal(code)
	}
	if code, _ := inputPost(api, inputReq("first", "different")); code != 409 {
		t.Fatal(code)
	}
	// Queue a platform turn directly to isolate the output/response boundary from gate policy.
	e.interactiveMu.Lock()
	st := e.interactiveStates[inputTestKey]
	e.interactiveMu.Unlock()
	st.mu.Lock()
	st.pendingMessages = append(st.pendingMessages, queuedMessage{platform: p, replyCtx: inputTestKey, content: "queued Discord", msgSessionKey: inputTestKey, msgPlatform: "discord"})
	st.mu.Unlock()
	inputDone(a, "local answer")
	inputPrompt(t, a)
	got := inputResult(t, api, "first", "completed")
	if got.Text != "local answer" {
		t.Fatal(got)
	}
	if len(p.getSent()) != 0 {
		t.Fatalf("local output leaked: %v", p.getSent())
	}
	inputDone(a, "queued answer")
	inputWait(t, func() bool { return !s.Busy() })
	_, after := inputGet(api, "first")
	if after != got {
		t.Fatalf("queued turn changed result: %+v", after)
	}
	if !strings.Contains(strings.Join(p.getSent(), "\n"), "queued answer") {
		t.Fatalf("queue muted: %v", p.getSent())
	}
	if code, retry := inputPost(api, r); code != 200 || retry != got {
		t.Fatalf("retry %d %+v", code, retry)
	}
	if a.session.strict.Load() != 1 || a.session.normal.Load() != 1 {
		t.Fatal("duplicate execution")
	}
}

func TestLocalInputFailedTurnReleasesSideSendGuardBeforeQueuedDiscord(t *testing.T) {
	for _, kind := range []string{"error", "empty"} {
		t.Run(kind, func(t *testing.T) {
			api, e, a, p, s := inputFixture(t)
			if code, _ := inputPost(api, inputReq("failed-voice", "voice")); code != 202 {
				t.Fatal(code)
			}
			inputPrompt(t, a)
			e.interactiveMu.Lock()
			st := e.interactiveStates[inputTestKey]
			e.interactiveMu.Unlock()
			st.mu.Lock()
			st.pendingMessages = append(st.pendingMessages, queuedMessage{platform: p, replyCtx: inputTestKey, content: "queued Discord", msgSessionKey: inputTestKey, msgPlatform: "discord"})
			st.mu.Unlock()
			if kind == "error" {
				a.session.events <- Event{Type: EventError, Error: errors.New("voice failed")}
			} else {
				inputDone(a, "  ")
			}
			inputPrompt(t, a)
			inputResult(t, api, "failed-voice", "failed")
			if err := e.SendToSession(inputTestKey, "queued side send"); err != nil {
				t.Errorf("ordinary queued turn inherited voice guard: %v", err)
			}
			if _, err := e.resolveSendTarget(inputTestKey, true); err != nil {
				t.Errorf("ordinary attachment inherited voice guard: %v", err)
			}
			inputDone(a, "queued answer")
			inputWait(t, func() bool { return !s.Busy() })
		})
	}
}

func TestLocalInputRejectsMissingAndUnsupported(t *testing.T) {
	for _, tc := range []struct {
		name  string
		code  int
		setup func(*Engine, *inputTestAgent, *Session)
		key   string
	}{
		{"missing", 404, nil, "discord:missing"},
		{"empty", 409, func(_ *Engine, _ *inputTestAgent, s *Session) { s.SetAgentSessionID("", "stub") }, ""},
		{"continue", 409, func(_ *Engine, _ *inputTestAgent, s *Session) {
			s.mu.Lock()
			s.AgentSessionID = ContinueSession
			s.mu.Unlock()
		}, ""},
		{"backend", 422, func(_ *Engine, a *inputTestAgent, _ *Session) { a.unsupported = true }, ""},
		{"wrong backend", 409, func(_ *Engine, _ *inputTestAgent, s *Session) { s.SetAgentSessionID("original-thread", "other") }, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, e, a, _, s := inputFixture(t)
			if tc.setup != nil {
				tc.setup(e, a, s)
			}
			r := inputReq("reject", "hello")
			if tc.key != "" {
				r.SessionKey = tc.key
			}
			if code, _ := inputPost(api, r); code != tc.code {
				t.Fatal(code)
			}
			if a.starts.Load() != 0 || e.sessions.ActiveSessionID("discord:missing") != "" {
				t.Fatal("created binding")
			}
		})
	}
}
func TestLocalInputResumeFailureNeverFallsBack(t *testing.T) {
	for _, wrongID := range []bool{false, true} {
		t.Run(fmt.Sprint(wrongID), func(t *testing.T) {
			api, _, a, p, s := inputFixture(t)
			if wrongID {
				a.session.id = "replacement"
			} else {
				a.err = errors.New("resume missing")
			}
			code, _ := inputPost(api, inputReq("fail", "hello"))
			if code != 202 {
				t.Fatal(code)
			}
			r := inputResult(t, api, "fail", "failed")
			inputWait(t, func() bool { return !s.Busy() })
			if r.Error == "" || a.normalStarts.Load() != 0 || s.GetAgentSessionID() != "original-thread" || len(p.getSent()) != 0 {
				t.Fatalf("not fail closed: %+v", r)
			}
		})
	}
}
func TestLocalInputPartialFailureAndSilent(t *testing.T) {
	for _, kind := range []string{"error", "closed", "wrong-event", "send-error", "nonterminal", "silent"} {
		t.Run(kind, func(t *testing.T) {
			api, _, a, p, s := inputFixture(t)
			if kind == "send-error" {
				a.session.sendErr = errors.New("send failed")
			}
			inputPost(api, inputReq("r", "voice"))
			inputPrompt(t, a)
			switch kind {
			case "error":
				a.session.events <- Event{Type: EventText, Content: "partial"}
				a.session.events <- Event{Type: EventError, Content: "answer after tool failure", Error: errors.New("failed after partial")}
			case "closed":
				a.session.events <- Event{Type: EventText, Content: "partial"}
				close(a.session.events)
			case "wrong-event":
				a.session.events <- Event{Type: EventText, Content: "wrong", SessionID: "different"}
			case "send-error":
			case "nonterminal":
				a.session.events <- Event{Type: EventResult, Content: "interim", Done: false}
				time.Sleep(10 * time.Millisecond)
				_, r := inputGet(api, "r")
				if r.Status != "running" {
					t.Fatal(r)
				}
				inputDone(a, "final")
			case "silent":
				inputDone(a, "NO_REPLY")
			}
			want := "failed"
			if kind == "nonterminal" {
				want = "completed"
			}
			if kind == "silent" {
				want = "silent"
			}
			r := inputResult(t, api, "r", want)
			inputWait(t, func() bool { return !s.Busy() })
			if want == "failed" && (r.Error == "" || r.Text != "") {
				t.Fatalf("partial marked success: %+v", r)
			}
			if len(p.getSent()) != 0 {
				t.Fatalf("leaked: %v", p.getSent())
			}
			if s.GetAgentSessionID() != "original-thread" {
				t.Fatal("binding changed")
			}
		})
	}
}
func TestLocalInputValidationAndCapacity(t *testing.T) {
	api, _, a, _, s := inputFixture(t)
	for _, body := range []string{"{}", "null", "{\"request_id\":\"x\",\"project\":\"gge\",\"session_key\":\"discord:voice-channel\",\"text\":\"hi\",\"mode_override\":\"yolo\"}"} {
		w := httptest.NewRecorder()
		api.handleInput(w, httptest.NewRequest("POST", "/input", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	for _, text := range []string{"/new", "  /cancel", "!stop", " "} {
		if code, _ := inputPost(api, inputReq("bad", text)); code != 400 {
			t.Fatal(code)
		}
	}
	inputPost(api, inputReq("running", "voice"))
	inputPrompt(t, a)
	api.inputs.mu.Lock()
	for i := 1; i < maxInputRequests; i++ {
		id := fmt.Sprint("old", i)
		api.inputs.entries[id] = &inputEntry{result: InputResult{RequestID: id, Status: "completed"}}
	}
	api.inputs.mu.Unlock()
	if code, _ := inputPost(api, inputReq("overflow", "hello")); code != 503 {
		t.Fatal(code)
	}
	if code, r := inputPost(api, inputReq("running", "voice")); code != 200 || r.Status != "running" {
		t.Fatalf("running evicted: %d %+v", code, r)
	}
	if code, _ := inputGet(api, "old1"); code != 200 {
		t.Fatal("completed evicted")
	}
	inputDone(a, "ok")
	inputResult(t, api, "running", "completed")
	inputWait(t, func() bool { return !s.Busy() })
	w := httptest.NewRecorder()
	api.handleInputLookup(w, httptest.NewRequest(http.MethodGet, "/input/bindings?project=gge&session_key="+inputTestKey, nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "original-thread") {
		t.Fatal(w.Body.String())
	}
}

func TestLocalInputPermissionRetainsOriginalCapabilities(t *testing.T) {
	api, e, a, p, s := inputFixture(t)
	inputPost(api, inputReq("approval", "private voice question"))
	inputPrompt(t, a)
	a.session.events <- Event{Type: EventText, Content: "private voice draft"}
	a.session.events <- Event{Type: EventPermissionRequest, RequestID: "approve1", ToolName: "Read", ToolInput: "requested file"}
	inputWait(t, func() bool { return p.cards.Load() == 1 })
	if sent := strings.Join(p.getSent(), "\n"); strings.Contains(sent, "private voice") || !strings.Contains(sent, "Read") {
		t.Fatalf("approval leaked conversation or lost card: %s", sent)
	}
	_, r := inputGet(api, "approval")
	if r.Status != "running" {
		t.Fatal(r)
	}
	if !e.handlePendingPermission(p, &Message{SessionKey: inputTestKey, ReplyCtx: inputTestKey, UserID: "user", Content: "allow"}, "allow", inputTestKey) {
		t.Fatal("approval not routed")
	}
	// Permission acknowledgements belong to the original approval UX, not the answer.
	inputDone(a, "approved answer")
	inputResult(t, api, "approval", "completed")
	inputWait(t, func() bool { return !s.Busy() })
	if strings.Contains(strings.Join(p.getSent(), "\n"), "approved answer") {
		t.Fatal("answer leaked after permission")
	}
}

func TestLocalInputDifferentConcurrentRequestsOneAccepted(t *testing.T) {
	api, _, a, _, s := inputFixture(t)
	var wg sync.WaitGroup
	type outcome struct {
		code int
		id   string
	}
	out := make(chan outcome, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprint("concurrent", i)
			code, _ := inputPost(api, inputReq(id, "hello"))
			out <- outcome{code, id}
		}(i)
	}
	wg.Wait()
	close(out)
	id := ""
	for r := range out {
		if r.code == 202 {
			if id != "" {
				t.Fatal("two turns accepted")
			}
			id = r.id
		} else if r.code != 409 {
			t.Fatal(r)
		}
	}
	if id == "" {
		t.Fatal("none accepted")
	}
	inputPrompt(t, a)
	inputDone(a, "answer")
	inputResult(t, api, id, "completed")
	inputWait(t, func() bool { return !s.Busy() })
	if a.session.strict.Load() != 1 {
		t.Fatal("busy input injected")
	}
}

func TestLocalInputDrainsPreviousTurnAfterPrepare(t *testing.T) {
	api, _, a, p, s := inputFixture(t)
	a.session.prepareEvents = []Event{{Type: EventResult, Done: true, Content: "previous answer", SessionID: "original-thread"}, {Type: EventError, Error: errors.New("previous process exit")}}
	inputPost(api, inputReq("fresh", "voice"))
	inputPrompt(t, a)
	inputDone(a, "this answer")
	r := inputResult(t, api, "fresh", "completed")
	inputWait(t, func() bool { return !s.Busy() })
	if r.Text != "this answer" || len(p.getSent()) != 0 {
		t.Fatalf("previous turn leaked: %+v %v", r, p.getSent())
	}
}
