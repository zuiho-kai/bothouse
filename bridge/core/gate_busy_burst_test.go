package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// User 2026-10-23「我都艾特你了，他还在判断」: the lead was busy, the user sent "@橘 这个你怎么看" plus an
// image; Discord split them in two, the busy lead judged them one by one and the image alone — no
// text, no @ — was inserted into its turn ("↪ 已插入"). Busy bots now collect the burst like idle ones,
// so the image goes with its text and follows the text's verdict.

// splitGate answers like the gate did on 2026-10-23: an @ of someone else → context, an empty
// text with an attachment → insert, anything else → reply.
func splitGate(t *testing.T) (*httptest.Server, func() []gateRequest) {
	t.Helper()
	var mu sync.Mutex
	var reqs []gateRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var req gateRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		reqs = append(reqs, req)
		mu.Unlock()
		act := "reply"
		switch {
		case req.Mentioned:
		case strings.Contains(req.Content, "<@"):
			act = "context"
		case strings.TrimSpace(req.Content) == "" && (req.HasImages || req.HasFiles):
			act = "insert"
		}
		_ = json.NewEncoder(w).Encode(gateResponse{Action: act})
	}))
	t.Cleanup(srv.Close)
	return srv, func() []gateRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]gateRequest(nil), reqs...)
	}
}

// releaseHeld ends the burst held for key as its timer would, and returns the merged message.
func releaseHeld(t *testing.T, e *Engine, key string) *Message {
	t.Helper()
	g := e.gate
	g.mu.Lock()
	defer g.mu.Unlock()
	h := g.held[key]
	if h == nil {
		t.Fatal("burst not held")
	}
	h.timer.Stop()
	delete(g.held, key)
	g.released[h.msg] = true
	return h.msg
}

func busyLead(t *testing.T, gateURL string) (*Engine, *midTurnSession, *stubPlatformEngine, *Session) {
	t.Helper()
	e, a, p := newMidTurnEngine(t)
	e.SetGate(gateURL, 2000, "reply")
	e.SetGateBurstWindow(60_000) // the test releases the burst itself
	a.can.Store(true)
	running := &midTurnSession{imgCaptureSession: newImgCaptureSession()}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive("discord:c1")
	s.TryLock() // busy
	return e, running, p, s
}

func TestApplyGate_BusyBurstImageFollowsItsText(t *testing.T) {
	srv, reqs := splitGate(t)
	e, running, p, s := busyLead(t, srv.URL)

	text := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "201", UserName: "zuiho", Content: "<@9> 这个你怎么看"}
	img := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "202", UserName: "zuiho", Images: []ImageAttachment{{MimeType: "image/png", Data: []byte("PNG")}}}
	if !e.applyGate(p, text, s, "k") || !e.applyGate(p, img, s, "k") {
		t.Fatal("busy messages must be held for their burst")
	}
	if got := reqs(); len(got) != 0 {
		t.Fatalf("gate asked before the burst ended: %+v", got)
	}
	merged := releaseHeld(t, e, "k")
	if !e.applyGate(p, merged, s, "k") {
		t.Fatal("a burst @-ing someone else started a turn")
	}

	got := reqs()
	if len(got) != 1 || got[0].Content != "<@9> 这个你怎么看" || !got[0].HasImages || !got[0].Busy {
		t.Fatalf("gate requests = %+v, want one busy request with the text and the image", got)
	}
	running.mu.Lock()
	mid := len(running.mid)
	running.mu.Unlock()
	if _, prompts := running.sent(); mid != 0 || len(prompts) != 0 {
		t.Fatalf("lead's turn got input: mid=%d sent=%q", mid, prompts)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("lead posted %q, want silence", sent)
	}
}

// The same split @-ing the busy bot itself: one injection carrying both the text and the image.
func TestApplyGate_BusyBurstMentionedInjectsOnce(t *testing.T) {
	srv, reqs := splitGate(t)
	e, running, p, s := busyLead(t, srv.URL)

	text := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "201", UserName: "zuiho", Content: "这个你怎么看", Mentioned: true}
	img := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "202", UserName: "zuiho", Images: []ImageAttachment{{MimeType: "image/png", Data: []byte("PNG")}}}
	e.applyGate(p, text, s, "k")
	e.applyGate(p, img, s, "k")
	merged := releaseHeld(t, e, "k")
	if !e.applyGate(p, merged, s, "k") {
		t.Fatal("busy mentioned burst should be injected")
	}
	if got := reqs(); len(got) != 1 || !got[0].Mentioned || !got[0].HasImages {
		t.Fatalf("gate requests = %+v", got)
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 1 || !strings.Contains(running.mid[0], "这个你怎么看") {
		t.Fatalf("injections = %q, want one with the text", running.mid)
	}
}
