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
	e.SetAdminFrom("*, 100000000000000001,100000000000000002")
	api := &APIServer{engines: map[string]*Engine{"p": e}}

	rec := postSend(t, api, SendRequest{Project: "p", DM: true, Message: "悄悄话"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(p.openedFor) != 1 || p.openedFor[0] != "100000000000000001" {
		t.Fatalf("OpenDM called for %v, want the first admin_from ID", p.openedFor)
	}
	if len(p.reconstructed) != 1 || p.reconstructed[0] != "discord:dm-chan:100000000000000001" {
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

// A message in the owner's private chat is always for this bot: the gate is not asked, so it
// can never be filed as overheard context.
func TestGateSkipsOwnerDirectMessage(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(gateResponse{Action: "context"})
	}))
	defer srv.Close()
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "context")
	e.SetAdminFrom("u1")
	msg := &Message{SessionKey: "discord:dm-chan:u1", UserID: "u1", Content: "在吗", Direct: true}
	if e.applyGate(nil, msg, &Session{}, "k") {
		t.Fatal("a direct message must go on to a normal turn")
	}
	if calls.Load() != 0 {
		t.Fatalf("gate called %d times for a direct message", calls.Load())
	}
	if !msg.Mentioned {
		t.Fatal("an owner DM must be treated as addressed to this bot")
	}
	e.gate.mu.Lock()
	defer e.gate.mu.Unlock()
	if len(e.gate.held) != 0 || len(e.gate.buf["k"]) != 0 || len(e.gate.gbuf["k"]) != 0 {
		t.Fatal("a direct message must not be held or buffered")
	}
}

// A DM from anyone who is not named in admin_from (including when admin_from is "*") goes
// through the gate like any other message.
func TestGateChecksNonOwnerDirectMessage(t *testing.T) {
	for _, adminFrom := range []string{"u1", "*", ""} {
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			_ = json.NewEncoder(w).Encode(gateResponse{Action: "context"})
		}))
		e := newTestEngine()
		e.SetGate(srv.URL, 2000, "context")
		e.SetAdminFrom(adminFrom)
		msg := &Message{SessionKey: "discord:dm-chan:u2", UserID: "u2", Content: "在吗", Direct: true}
		// Mark it as handed back by the burst timer so the gate is asked right away.
		e.gate.mu.Lock()
		e.gate.released[msg] = true
		e.gate.mu.Unlock()
		if !e.applyGate(nil, msg, &Session{}, "k") {
			t.Errorf("admin_from=%q: a non-owner DM judged as context must not start a turn", adminFrom)
		}
		if calls.Load() != 1 {
			t.Errorf("admin_from=%q: gate called %d times for a non-owner DM, want 1", adminFrom, calls.Load())
		}
		if msg.Mentioned {
			t.Errorf("admin_from=%q: a non-owner DM must not be marked addressed", adminFrom)
		}
		srv.Close()
	}
}
