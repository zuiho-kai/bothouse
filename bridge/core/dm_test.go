package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type stubDMPlatform struct {
	stubPlatformEngine
	openedFor     []string
	reconstructed []string
}

func (p *stubDMPlatform) OpenDM(userID string) (string, error) {
	p.openedFor = append(p.openedFor, userID)
	return "discord:dm-chan:" + userID, nil
}

func (p *stubDMPlatform) ReconstructReplyCtx(sessionKey string) (any, error) {
	p.reconstructed = append(p.reconstructed, sessionKey)
	return "dm-ctx", nil
}

func postSend(t *testing.T, api *APIServer, req SendRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	api.handleSend(rec, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body)))
	return rec
}

// `cc-connect send --dm` opens the private chat with the owner in admin_from and sends there,
// ignoring any session key the caller had.
func TestHandleSend_DMOpensPrivateChatWithOwner(t *testing.T) {
	p := &stubDMPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom("*, 727153614614822942,469124614711410688")
	api := &APIServer{engines: map[string]*Engine{"p": e}}

	rec := postSend(t, api, SendRequest{Project: "p", DM: true, Message: "悄悄话"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(p.openedFor) != 1 || p.openedFor[0] != "727153614614822942" {
		t.Fatalf("OpenDM called for %v, want the first admin_from ID", p.openedFor)
	}
	if len(p.reconstructed) != 1 || p.reconstructed[0] != "discord:dm-chan:727153614614822942" {
		t.Fatalf("sent to %v, want the DM session", p.reconstructed)
	}
	if got := p.getSent(); len(got) != 1 || got[0] != "悄悄话" {
		t.Fatalf("sent = %v", got)
	}
}

func TestHandleSend_DMNeedsOwner(t *testing.T) {
	p := &stubDMPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom("*")
	api := &APIServer{engines: map[string]*Engine{"p": e}}
	if rec := postSend(t, api, SendRequest{Project: "p", DM: true, Message: "hi"}); rec.Code == http.StatusOK {
		t.Fatal("--dm with no owner ID in admin_from must fail")
	}
	if len(p.getSent()) != 0 {
		t.Fatal("nothing may be sent")
	}
}

func TestHandleSend_DMUnsupportedPlatform(t *testing.T) {
	p := &stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom("u1")
	api := &APIServer{engines: map[string]*Engine{"p": e}}
	if rec := postSend(t, api, SendRequest{Project: "p", DM: true, Message: "hi"}); rec.Code == http.StatusOK {
		t.Fatal("--dm on a platform without private chats must fail")
	}
}

// A message in a private chat is always for this bot: the gate is not asked, so it can never
// be filed as overheard context.
func TestGateSkipsDirectMessage(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(gateResponse{Action: "context"})
	}))
	defer srv.Close()
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "context")
	msg := &Message{SessionKey: "discord:dm-chan:u1", Content: "在吗", Mentioned: true, Direct: true}
	if e.applyGate(nil, msg, &Session{}, "k") {
		t.Fatal("a direct message must go on to a normal turn")
	}
	if calls.Load() != 0 {
		t.Fatalf("gate called %d times for a direct message", calls.Load())
	}
	e.gate.mu.Lock()
	defer e.gate.mu.Unlock()
	if len(e.gate.held) != 0 || len(e.gate.buf["k"]) != 0 || len(e.gate.gbuf["k"]) != 0 {
		t.Fatal("a direct message must not be held or buffered")
	}
}
