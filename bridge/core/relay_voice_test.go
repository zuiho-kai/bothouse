package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type voiceAgentFake struct {
	controllableAgent
	mu        sync.Mutex
	starts    []string
	env       []string
	sessions  chan *inputTestSession
	fail      bool
	blocking  bool
	unknownID bool
}

func (a *voiceAgentFake) StartVoiceRelay(ctx context.Context, id string, env []string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.starts = append(a.starts, id)
	a.env = append([]string{}, env...)
	if a.fail {
		return nil, errors.New("resume failed")
	}
	if id == "" {
		id = "native-" + validTestSuffix(len(a.starts))
	}
	if a.unknownID {
		id = ""
	}
	s := &inputTestSession{id: id, events: make(chan Event, 16), prompts: make(chan string, 1)}
	a.sessions <- s
	if a.blocking {
		return &blockingVoiceSession{inputTestSession: s, ctx: ctx}, nil
	}
	return s, nil
}

type blockingVoiceSession struct {
	*inputTestSession
	ctx context.Context
}

func (s *blockingVoiceSession) SendResumed(_ string, _ string, _ []ImageAttachment, _ []FileAttachment, id string) error {
	for i := 0; i < 200; i++ {
		select {
		case s.events <- Event{Type: EventText, Content: "a", SessionID: id}:
		case <-s.ctx.Done():
			return s.ctx.Err()
		}
	}
	s.events <- Event{Type: EventResult, SessionID: id, Done: true}
	return nil
}

func TestVoiceRelay_BlockingSendConsumesEventsConcurrently(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, "")
	a.blocking = true
	rm.SetTimeout(time.Second)
	if _, _, err := rm.submitVoice(voiceReq("long")); err != nil {
		t.Fatal(err)
	}
	r := voiceWait(t, rm, "long")
	if r.Status != "completed" || r.Text != strings.Repeat("a", 200) {
		t.Fatalf("blocking sender lost answer: %+v", r)
	}
}
func validTestSuffix(n int) string { return string(rune('a' + n)) }

func voiceFixture(t *testing.T, dir string) (*RelayManager, *APIServer, *voiceAgentFake, *relayVisibilityPlatform) {
	t.Helper()
	a := &voiceAgentFake{sessions: make(chan *inputTestSession, 16)}
	p := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("target", a, []Platform{p}, "", LangEnglish)
	rm := NewRelayManager(dir)
	rm.RegisterEngine("target", e)
	src := NewEngine("source", &stubAgent{}, []Platform{p}, "", LangEnglish)
	rm.RegisterEngine("source", src)
	// Stop drains in-flight voice receipts, so nothing writes into dir after the test's TempDir cleanup.
	t.Cleanup(func() { _ = e.Stop(); _ = src.Stop() })
	rm.Bind("test", "voice", map[string]string{"source": "source", "target": "target"})
	return rm, &APIServer{relay: rm}, a, p
}
func voiceReq(id string) RelayRequest {
	return RelayRequest{Mode: "voice", RequestID: id, Scope: "desk", From: "source", To: "target", SessionKey: "test:voice:thread-a", Message: "hello"}
}
func voiceWait(t *testing.T, rm *RelayManager, id string) voiceRelayResult {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		rm.voice.mu.Lock()
		r := rm.voice.Entries[id].Result
		rm.voice.mu.Unlock()
		if r.Status != "running" {
			return r
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("relay did not terminate")
	return voiceRelayResult{}
}
func voiceHTTP(api *APIServer, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	api.handleVoiceRelay(w, httptest.NewRequest(method, path, strings.NewReader("{}")))
	return w
}

func TestVoiceRelay_PublicFinalPrivateAndExactlyOnce(t *testing.T) {
	rm, api, a, p := voiceFixture(t, t.TempDir())
	req := voiceReq("one")
	first, code, err := rm.submitVoice(req)
	if err != nil || code != 202 {
		t.Fatalf("%d %v", code, err)
	}
	s := <-a.sessions
	<-s.prompts
	if duplicate, c, e := rm.submitVoice(req); e != nil || c != 200 || duplicate.RequestID != first.RequestID {
		t.Fatalf("duplicate: %v %d", e, c)
	}
	req.Message = "changed"
	if _, code, _ := rm.submitVoice(req); code != 409 {
		t.Fatal("different request accepted")
	}
	s.events <- Event{Type: EventThinking, Content: "PRIVATE_FIXTURE"}
	s.events <- Event{Type: EventToolResult, Content: "TOOL_FIXTURE"}
	s.events <- Event{Type: EventText, Content: "public answer"}
	s.events <- Event{Type: EventResult, Done: true}
	result := voiceWait(t, rm, "one")
	if result.Status != "completed" || result.Text != "public answer" {
		t.Fatalf("%+v", result)
	}
	if len(p.getSent()) != 0 {
		t.Fatal("voice echoed to channel")
	}
	if w := voiceHTTP(api, "GET", "/relay/voice/one"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	restored := NewRelayManager(filepath.Dir(rm.voice.path))
	if restored.voice.Entries["one"].Result.Text != "public answer" {
		t.Fatal("receipt lost on restart")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.starts) != 1 || !strings.Contains(strings.Join(a.env, ";"), "CC_SESSION_KEY=test:voice:thread-a") {
		t.Fatal("start/env mismatch")
	}
}

func TestVoiceRelay_IsolationAndBusy(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, "")
	req := voiceReq("a")
	rm.submitVoice(req)
	s1 := <-a.sessions
	<-s1.prompts
	same := voiceReq("b")
	if _, code, _ := rm.submitVoice(same); code != 409 {
		t.Fatal("same conversation concurrent")
	}
	other := voiceReq("c")
	other.SessionKey = "test:voice:thread-b"
	rm.submitVoice(other)
	s2 := <-a.sessions
	<-s2.prompts
	third := voiceReq("d")
	third.Scope = "second-device"
	rm.submitVoice(third)
	s3 := <-a.sessions
	<-s3.prompts
	for _, s := range []*inputTestSession{s1, s2, s3} {
		s.events <- Event{Type: EventResult, Content: "ok", Done: true}
	}
	r1, r2, r3 := voiceWait(t, rm, "a"), voiceWait(t, rm, "c"), voiceWait(t, rm, "d")
	if r1.RelayKey == r2.RelayKey || r1.RelayKey == r3.RelayKey {
		t.Fatal("scope aliased")
	}
	next := voiceReq("e")
	rm.submitVoice(next)
	s4 := <-a.sessions
	<-s4.prompts
	if s4.id != s1.id {
		t.Fatal("conversation not resumed")
	}
	s4.events <- Event{Type: EventResult, Content: "next", Done: true}
	voiceWait(t, rm, "e")
}

func TestVoiceRelay_FailuresNeverSpeakPartial(t *testing.T) {
	for _, kind := range []string{"timeout", "closed", "error", "empty", "permission", "wrong-id", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			rm, api, a, _ := voiceFixture(t, "")
			rm.SetTimeout(30 * time.Millisecond)
			rm.submitVoice(voiceReq("fail"))
			s := <-a.sessions
			<-s.prompts
			if kind != "empty" {
				s.events <- Event{Type: EventText, Content: "partial"}
			}
			switch kind {
			case "closed":
				close(s.events)
			case "error":
				s.events <- Event{Type: EventError, Error: errors.New("bad")}
			case "empty":
				s.events <- Event{Type: EventResult, Done: true}
			case "permission":
				s.events <- Event{Type: EventPermissionRequest, RequestID: "permission"}
			case "wrong-id":
				s.events <- Event{Type: EventResult, Content: "wrong", SessionID: "other", Done: true}
			case "cancel":
				if w := voiceHTTP(api, "POST", "/relay/voice/fail/cancel"); w.Code != 200 {
					t.Fatal(w.Code)
				}
			}
			result := voiceWait(t, rm, "fail")
			if result.Status != "failed" || result.Text != "" {
				t.Fatalf("%+v", result)
			}
		})
	}
}

func TestVoiceRelay_NoResumeFallbackAndDurableUnknown(t *testing.T) {
	dir := t.TempDir()
	rm, _, a, _ := voiceFixture(t, dir)
	rm.submitVoice(voiceReq("first"))
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventResult, Content: "ok", Done: true}
	voiceWait(t, rm, "first")
	a.mu.Lock()
	a.fail = true
	a.mu.Unlock()
	rm.submitVoice(voiceReq("second"))
	result := voiceWait(t, rm, "second")
	if result.Status != "failed" {
		t.Fatal(result)
	}
	a.mu.Lock()
	if len(a.starts) != 2 || a.starts[1] != s.id {
		t.Fatal("fresh fallback")
	}
	a.mu.Unlock()
	// Simulate a crash snapshot after reservation but before a result.
	rm.voice.mu.Lock()
	rm.voice.Entries["second"].Result.Status = "running"
	rm.voice.saveLocked()
	rm.voice.mu.Unlock()
	restored, _, b, _ := voiceFixture(t, dir)
	r, _, err := restored.submitVoice(voiceReq("second"))
	if err != nil || r.Status != "failed" {
		t.Fatalf("%+v %v", r, err)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.starts) != 0 {
		t.Fatal("replayed after restart")
	}
}

func TestVoiceRelay_AdmissionFailsClosed(t *testing.T) {
	for _, kind := range []string{"source", "target", "platform", "scope", "capacity", "store", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			rm, _, a, _ := voiceFixture(t, "")
			req := voiceReq("id")
			switch kind {
			case "source":
				req.From = "missing"
			case "target":
				req.To = "missing"
			case "platform":
				req.SessionKey = "different:voice"
			case "scope":
				req.Scope = "../bad"
			case "capacity":
				for i := 0; i < maxInputRequests; i++ {
					rm.voice.Entries[string(rune(i))] = &voiceRelayEntry{}
				}
			case "store":
				rm.voice.path = filepath.Join(t.TempDir(), "missing", "store.json")
			case "unknown":
				_, key, _ := rm.voiceTarget(req)
				rm.voice.Conversations[key] = voiceRelayConversation{Started: true}
			}
			if _, _, err := rm.submitVoice(req); err == nil {
				t.Fatal("unsafe admission")
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if len(a.starts) != 0 {
				t.Fatal("started rejected request")
			}
		})
	}
}

func TestVoiceRelay_HTTPAndCorruptStore(t *testing.T) {
	rm, api, _, _ := voiceFixture(t, "")
	if w := voiceHTTP(api, "GET", "/relay/voice/missing"); w.Code != 404 {
		t.Fatal(w.Code)
	}
	req := voiceReq("id")
	req.Mode = "invalid"
	data, _ := json.Marshal(req)
	w := httptest.NewRecorder()
	api.handleRelaySend(w, httptest.NewRequest("POST", "/relay/send", strings.NewReader(string(data))))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	path := filepath.Join(t.TempDir(), "voice_relay.json")
	os.WriteFile(path, []byte("broken"), 0600)
	rm.initVoiceRelay(filepath.Dir(path))
	if _, _, err := rm.submitVoice(voiceReq("new")); err == nil {
		t.Fatal("corrupt store admitted work")
	}
}

func TestVoiceRelay_HTTPAdmissionPollResumeCancel(t *testing.T) {
	rm, api, a, p := voiceFixture(t, t.TempDir())
	binding := voiceHTTP(api, "GET", "/relay/voice/binding?from=source&to=target&session_key=test:voice:thread-a&scope=desk")
	if binding.Code != 200 {
		t.Fatal(binding.Body.String())
	}
	post := func(req RelayRequest) *httptest.ResponseRecorder {
		b, _ := json.Marshal(req)
		w := httptest.NewRecorder()
		api.handleRelaySend(w, httptest.NewRequest("POST", "/relay/send", strings.NewReader(string(b))))
		return w
	}
	req := voiceReq("http-one")
	if w := post(req); w.Code != 202 {
		t.Fatal(w.Body.String())
	}
	s := <-a.sessions
	<-s.prompts
	if s.strict.Load() != 1 || s.normal.Load() != 0 {
		t.Fatal("first voice turn bypassed strict completion")
	}
	if w := post(req); w.Code != 200 {
		t.Fatal("duplicate", w.Body.String())
	}
	s.events <- Event{Type: EventResult, Done: true, Content: "complete"}
	voiceWait(t, rm, req.RequestID)
	w := voiceHTTP(api, "GET", "/relay/voice/http-one")
	var r voiceRelayResult
	if json.Unmarshal(w.Body.Bytes(), &r) != nil || r.Text != "complete" {
		t.Fatal(w.Body.String())
	}
	req.RequestID = "http-two"
	if w := post(req); w.Code != 202 {
		t.Fatal(w.Body.String())
	}
	second := <-a.sessions
	<-second.prompts
	if second.strict.Load() != 1 || second.normal.Load() != 0 {
		t.Fatal("resumed voice turn bypassed strict completion")
	}
	if second.id != s.id {
		t.Fatal("second request lost original voice context")
	}
	if w := voiceHTTP(api, "POST", "/relay/voice/http-two/cancel"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if len(p.getSent()) != 0 {
		t.Fatal("voice appeared in chat")
	}
	req.RequestID = "binding"
	if w := post(req); w.Code != 400 {
		t.Fatal("reserved receipt ID accepted")
	}
}

func TestVoiceRelay_ShutdownDrainsReceiptBeforeReturning(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	req := voiceReq("shutdown")
	if _, _, err := rm.submitVoice(req); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	<-s.prompts
	if err := rm.engines["target"].Stop(); err != nil {
		t.Fatal(err)
	}
	r := voiceWait(t, rm, req.RequestID)
	if r.Status != "failed" || !s.closed.Load() {
		t.Fatal("shutdown did not finish voice request")
	}
	req.RequestID = "after-stop"
	if _, code, _ := rm.submitVoice(req); code != 503 {
		t.Fatal("stopping engine accepted input")
	}
}

func TestVoiceRelay_StartupFailureDoesNotPoisonNewConversation(t *testing.T) {
	dir := t.TempDir()
	rm, _, a, _ := voiceFixture(t, dir)
	a.fail = true
	req := voiceReq("startup-failure")
	if _, _, err := rm.submitVoice(req); err != nil {
		t.Fatal(err)
	}
	failed := voiceWait(t, rm, req.RequestID)
	if failed.Status != "failed" || failed.Text != "" {
		t.Fatal(failed)
	}
	// The failed request stays deduplicated, even after restart. Only a new
	// user request can try again; no prompt was submitted by the failed start.
	restored, _, b, _ := voiceFixture(t, dir)
	duplicate, code, err := restored.submitVoice(req)
	if err != nil || code != 200 || duplicate.Status != "failed" {
		t.Fatalf("%+v %d %v", duplicate, code, err)
	}
	if len(b.starts) != 0 {
		t.Fatal("failed request replayed")
	}
	if _, _, err := restored.submitVoice(voiceReq("fresh-request")); err != nil {
		t.Fatal(err)
	}
	s := <-b.sessions
	<-s.prompts
	s.events <- Event{Type: EventResult, Content: "complete answer", Done: true}
	if r := voiceWait(t, restored, "fresh-request"); r.Status != "completed" {
		t.Fatal(r)
	}
}

func TestVoiceRelay_Admission503ProvesNonSubmissionOnlyWhenKnown(t *testing.T) {
	for _, kind := range []string{"capacity", "stopping", "write", "corrupt"} {
		t.Run(kind, func(t *testing.T) {
			rm, api, a, _ := voiceFixture(t, "")
			switch kind {
			case "capacity":
				for i := 0; i < maxInputRequests; i++ {
					rm.voice.Entries[string(rune(i))] = &voiceRelayEntry{}
				}
			case "stopping":
				rm.engines["target"].Stop()
			case "write":
				rm.voice.path = filepath.Join(t.TempDir(), "missing", "store.json")
			case "corrupt":
				rm.voice.fault = errors.New("unreadable store; prior execution unknown")
			}
			data, _ := json.Marshal(voiceReq("admission"))
			w := httptest.NewRecorder()
			api.handleRelaySend(w, httptest.NewRequest("POST", "/relay/send", strings.NewReader(string(data))))
			if w.Code != 503 {
				t.Fatal(w.Code, w.Body.String())
			}
			var result map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if (result["submission"] == "not_sent") != (kind != "corrupt") {
				t.Fatal(result)
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if len(a.starts) != 0 {
				t.Fatal("admission failure started agent")
			}
		})
	}
}

func TestVoiceRelay_PostSendUnknownIdentityRemainsLocked(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	a.unknownID = true
	if _, _, err := rm.submitVoice(voiceReq("ambiguous")); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventError, Error: errors.New("disconnected after send")}
	if r := voiceWait(t, rm, "ambiguous"); r.Status != "failed" || r.Text != "" {
		t.Fatal(r)
	}
	if _, code, err := rm.submitVoice(voiceReq("next")); code != 422 || err == nil {
		t.Fatalf("%d %v", code, err)
	}
	restored, _, _, _ := voiceFixture(t, filepath.Dir(rm.voice.path))
	if _, code, err := restored.submitVoice(voiceReq("after-restart")); code != 422 || err == nil {
		t.Fatalf("%d %v", code, err)
	}
}
