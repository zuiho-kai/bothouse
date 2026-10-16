package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGateBurstWindow_DefaultAndAttachmentsUnchanged(t *testing.T) {
	e := NewEngine("test", &stubAgent{}, nil, "", LangEnglish)
	defer e.Stop()
	e.SetGate("http://localhost/decide", 1000, "reply")
	text := &Message{Content: "hello"}
	if got := e.gate.burstDelay(text); got != 1500*time.Millisecond {
		t.Fatalf("default text delay = %v", got)
	}
	e.SetGateBurstWindow(300)
	if got := e.gate.burstDelay(text); got != 300*time.Millisecond {
		t.Fatalf("configured text delay = %v", got)
	}
	for _, msg := range []*Message{
		{Content: "caption", Images: []ImageAttachment{{}}},
		{Content: "caption", Files: []FileAttachment{{}}},
	} {
		if got := e.gate.burstDelay(msg); got != 1500*time.Millisecond {
			t.Fatalf("attachment burst delay = %v", got)
		}
	}
	for _, value := range []int{0, -1} {
		e.SetGateBurstWindow(value)
		if got := e.gate.burstDelay(text); got != 1500*time.Millisecond {
			t.Fatalf("default delay for %d = %v", value, got)
		}
	}
}

func TestCUJ_A9_GateFastBurstPreservesFollowUps(t *testing.T) {
	requests := make(chan gateRequest, 3)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/context" {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var req gateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requests <- req
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	env := newCUJEnv(t)
	defer env.engine.Stop()
	env.engine.SetGate(srv.URL+"/decide", 1000, "reply")
	env.engine.SetGateBurstWindow(200)
	env.userSends("user", "first line")
	env.userSends("user", "second line")
	env.waitFor("one answer to the merged burst", time.Second, func() bool {
		return env.sentContains("ok")
	})
	if req := <-requests; req.Content != "first line\nsecond line" {
		t.Fatalf("merged request = %q", req.Content)
	}
	env.waitFor("first turn idle", time.Second, func() bool {
		return !env.activeSession("test:user").Busy()
	})
	before := len(env.plat.getSent())
	env.userSends("user", "third line")
	env.waitFor("answer to the follow-up", time.Second, func() bool {
		return len(env.plat.getSent()) > before && env.lastSent() == "ok"
	})
	if req := <-requests; req.Content != "third line" {
		t.Fatalf("follow-up request = %q", req.Content)
	}
	if len(requests) != 0 {
		t.Fatal("burst generated an extra turn")
	}
}

// The real receive path must not impose the default 1.5s delay on a project
// that explicitly requests a shorter text burst window.
func TestGateConfiguredBurstWindow_RepliesWithoutDefaultDelay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	env := newCUJEnv(t)
	defer env.engine.Stop()
	env.engine.SetGate(srv.URL, 1000, "reply")
	env.engine.SetGateBurstWindow(50)
	defer func() {
		g := env.engine.gate
		g.mu.Lock()
		defer g.mu.Unlock()
		for _, h := range g.held {
			h.timer.Stop()
		}
	}()
	env.userSends("user", "hello")
	env.waitFor("configured fast reply", 900*time.Millisecond, func() bool {
		return env.sentContains("ok")
	})
}
