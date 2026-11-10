package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// User 2026-11-09「同一个人连发几条合并成一次回」: one person's ordinary idle messages are held until
// that person falls quiet (gate_sender_silence). These tests cover the burst key, the window and
// the hard cap; the gate's own verdict is recorded like gateRecorder does.

func silenceGate(t *testing.T, action string) (*httptest.Server, func() []gateRequest) {
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
		_ = json.NewEncoder(w).Encode(gateResponse{Action: action})
	}))
	t.Cleanup(srv.Close)
	return srv, func() []gateRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]gateRequest(nil), reqs...)
	}
}

func personMsg(session, id, text string) *Message {
	return &Message{SessionKey: session, Platform: "test", UserID: id, UserName: id, MessageID: "m-" + text, Content: text, ReplyCtx: "ctx-" + id}
}

// Three lines in a row from one person are one burst, under a per-sender key, and the merged
// message carries all three as parts.
func TestApplyGateSenderSilence_MergesSameSenderBurst(t *testing.T) {
	srv, _ := silenceGate(t, "reply")
	e := newTestEngine()
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateSenderSilence(true, 60_000, 600_000) // long windows: this test releases the burst itself
	p := &leadPlatform{}
	s := &Session{}

	for _, text := range []string{"第一行", "第二行", "第三行"} {
		if !e.applyGate(p, personMsg("test:room", "u1", text), s, "k") {
			t.Fatalf("%q was not held for the silent wait", text)
		}
	}
	g := e.gate
	g.mu.Lock()
	if len(g.held) != 1 {
		g.mu.Unlock()
		t.Fatalf("held = %d bursts, want 1 (three lines from one person)", len(g.held))
	}
	key := "k\x00test-u1"
	h := g.held[key]
	if h == nil {
		g.mu.Unlock()
		t.Fatalf("burst not under the sender key: %v", g.held)
	}
	g.mu.Unlock()

	merged := releaseHeld(t, e, key)
	if got := strings.TrimSpace(merged.Content); got != "第一行\n第二行\n第三行" {
		t.Fatalf("merged content = %q", got)
	}
	if len(merged.gateParts) != 3 {
		t.Fatalf("parts = %+v, want three", merged.gateParts)
	}
}

// Two people talking in one session never share a burst: the silent wait keys on the sender.
func TestApplyGateSenderSilence_KeepsSendersApart(t *testing.T) {
	srv, _ := silenceGate(t, "reply")
	e := newTestEngine()
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateSenderSilence(true, 60_000, 600_000)
	p := &leadPlatform{}
	s := &Session{}

	e.applyGate(p, personMsg("test:room", "u1", "甲一"), s, "k")
	e.applyGate(p, personMsg("test:room", "u2", "乙一"), s, "k")
	e.applyGate(p, personMsg("test:room", "u1", "甲二"), s, "k")

	g := e.gate
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.held) != 2 {
		t.Fatalf("held = %d bursts, want one per sender", len(g.held))
	}
	if got := strings.TrimSpace(g.held["k\x00test-u1"].msg.Content); got != "甲一\n甲二" {
		t.Fatalf("u1 burst = %q", got)
	}
	if got := strings.TrimSpace(g.held["k\x00test-u2"].msg.Content); got != "乙一" {
		t.Fatalf("u2 burst = %q", got)
	}
}

// Only plain messages wait for silence: an @ of this bot, a message @-ing a teammate, a command,
// an attachment, a DM and a teammate bot keep the old burst window and the old session key.
func TestGateSenderSilence_OnlyPlainMessages(t *testing.T) {
	e := newTestEngine()
	defer e.Stop()
	e.SetGate("http://localhost/decide", 1000, "reply")
	e.SetGateSenderSilence(true, 1500, 6000)
	g := e.gate

	plain := personMsg("test:room", "u1", "随便说说")
	if !g.silenceApplies(plain, false) {
		t.Fatal("a plain idle message should wait for silence")
	}
	if g.silenceApplies(plain, true) {
		t.Fatal("a busy session keeps the short burst")
	}
	for name, msg := range map[string]*Message{
		"mentioned":      {SessionKey: "test:room", Platform: "test", UserID: "u1", Content: "@bot 看这个", Mentioned: true},
		"addressedOther": {SessionKey: "test:room", Platform: "test", UserID: "u1", Content: "@别的bot 看这个", AddressedOther: true},
		"command":        personMsg("test:room", "u1", "/new"),
		"image":          {SessionKey: "test:room", Platform: "test", UserID: "u1", Images: []ImageAttachment{{}}},
		"file":           {SessionKey: "test:room", Platform: "test", UserID: "u1", Files: []FileAttachment{{}}},
		"dm":             {SessionKey: "test:dm", Platform: "test", UserID: "u1", Content: "在吗", Direct: true},
		"private room":   {SessionKey: "test:p", Platform: "test", UserID: "u1", Content: "在吗", PrivateRoom: true},
		"from bot":       {SessionKey: "test:room", Platform: "test", UserID: "b1", Content: "我算完了", FromBot: true},
		"no person":      {SessionKey: "test:room", Platform: "test", Content: "无主的消息"},
		"empty":          {SessionKey: "test:room", Platform: "test", UserID: "u1", Content: "   "},
	} {
		if g.silenceApplies(msg, false) {
			t.Errorf("%s should keep its old timing", name)
		}
		if got := g.holdKey("k", msg, false); got != "k" {
			t.Errorf("%s hold key = %q, want the session key", name, got)
		}
	}
	if got := g.holdKey("k", plain, false); got != "k\x00test-u1" {
		t.Fatalf("plain hold key = %q", got)
	}

	// A project without the switch keeps the old behaviour for the same message.
	e.SetGateSenderSilence(false, 0, 0)
	if g.silenceApplies(plain, false) || g.holdKey("k", plain, false) != "k" {
		t.Fatal("silence off must keep the per-session burst")
	}
}

// The hard cap is measured from the burst's first message: a person who keeps typing still gets a
// turn (石英: at most 6s). The chosen windows here follow the defaults, only compressed for a test.
func TestGateSenderSilence_HoldForClampsAtMax(t *testing.T) {
	g := &gateState{silence: true, silenceFor: 1500 * time.Millisecond, silenceMax: 6 * time.Second}
	h := &heldMsg{msg: &Message{Content: "hi"}, silence: true, firstAt: time.Now()}
	if got := g.holdFor(h, h.firstAt); got != 1500*time.Millisecond {
		t.Fatalf("first wait = %v, want the silent window", got)
	}
	if got := g.holdFor(h, h.firstAt.Add(5900*time.Millisecond)); got != 100*time.Millisecond {
		t.Fatalf("wait near the cap = %v, want what is left of it", got)
	}
	if got := g.holdFor(h, h.firstAt.Add(7*time.Second)); got != 0 {
		t.Fatalf("wait past the cap = %v, want 0", got)
	}
	// Without the switch the burst keeps its own window: holdFor is only asked for silent batches.
	e := newTestEngine()
	defer e.Stop()
	e.SetGate("http://localhost/decide", 1000, "reply")
	if got := e.gate.holdWindow(&Message{Content: "hi"}); got != burstWindow {
		t.Fatalf("plain burst = %v, want %v", got, burstWindow)
	}
}

// Continuous typing must still start a turn at the cap: the timer is reset by every follow-up,
// but never beyond first message + silenceMax.
func TestCUJ_SenderSilence_CapStartsTurnWhileTyping(t *testing.T) {
	srv, reqs := silenceGate(t, "reply")
	env := newCUJEnv(t)
	env.engine.SetGate(srv.URL, 2000, "reply")
	env.engine.SetGateSenderSilence(true, 150, 250) // compressed default 1.5s / 6s; test timing only

	start := time.Now()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 40; i++ {
			select {
			case <-stop:
				return
			default:
			}
			env.userSends("user", fmt.Sprintf("第 %d 行", i))
			time.Sleep(40 * time.Millisecond)
		}
	}()
	defer func() {
		close(stop)
		<-done
	}()

	deadline := time.Now().Add(2 * time.Second)
	for len(reqs()) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("no turn started while the sender kept typing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Typing went on for ~1.6s; the cap is 250ms, so the turn must have started long before it stopped.
	if elapsed := time.Since(start); elapsed > 250*time.Millisecond+300*time.Millisecond {
		t.Fatalf("turn started after %v, want at the %v cap", elapsed, 250*time.Millisecond)
	}
	if got := reqs()[0].Content; !strings.HasPrefix(got, "第 0 行") {
		t.Fatalf("first request = %q", got)
	}
}

// The end-to-end shape the user described: three lines in a row become one turn, not three.
func TestCUJ_SenderSilence_ThreeLinesOneTurn(t *testing.T) {
	srv, reqs := silenceGate(t, "reply")
	env := newCUJEnv(t)
	env.engine.SetGate(srv.URL, 2000, "reply")
	// A 30ms ordinary burst: without the silent wait each line, sent 60ms apart, would be its
	// own turn — this is what makes the three-line test fail when the feature is removed.
	env.engine.SetGateBurstWindow(30)
	env.engine.SetGateSenderSilence(true, 120, 1200)

	for _, line := range []string{"第一行", "第二行", "第三行"} {
		env.userSends("user", line)
		time.Sleep(60 * time.Millisecond)
	}
	env.waitFor("one answer to the three lines", 2*time.Second, func() bool { return env.sentContains("ok") })

	got := reqs()
	if len(got) != 1 {
		t.Fatalf("gate requests = %d, want one turn: %+v", len(got), got)
	}
	if want := "第一行\n第二行\n第三行"; got[0].Content != want {
		t.Fatalf("merged request = %q, want %q", got[0].Content, want)
	}
	if len(env.plat.getSent()) != 1 {
		t.Fatalf("replies = %q, want one", env.plat.getSent())
	}
}

// A message that does call this bot does not wait out the silence, but it must not overtake the
// silent burst the same person already has in flight: it joins that burst and ends the wait.
func TestApplyGateSenderSilence_MentionJoinsItsOwnBurst(t *testing.T) {
	srv, _ := silenceGate(t, "reply")
	e := newTestEngine()
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateSenderSilence(true, 60_000, 600_000)
	e.SetGateBurstWindow(60_000)
	p := &leadPlatform{}
	s := &Session{}

	e.applyGate(p, personMsg("test:room", "u1", "先说一句"), s, "k")
	mention := personMsg("test:room", "u1", "@bot 你看这个")
	mention.Mentioned = true
	if !e.applyGate(p, mention, s, "k") {
		t.Fatal("the @ should join the sender's burst, not start a turn")
	}
	g := e.gate
	g.mu.Lock()
	h := g.held["k\x00test-u1"]
	if h == nil {
		g.mu.Unlock()
		t.Fatalf("held keys = %v", g.held)
	}
	silence := h.silence
	g.mu.Unlock()
	if silence {
		t.Fatal("a burst that now @-s this bot must not keep waiting for silence")
	}
	merged := releaseHeld(t, e, "k\x00test-u1")
	if !merged.Mentioned || !strings.Contains(merged.Content, "@bot 你看这个") {
		t.Fatalf("merged = %+v", merged)
	}
}

// A second person's message still opens its own burst while the first one is held.
func TestApplyGateSenderSilence_OtherSenderStartsFreshBurst(t *testing.T) {
	srv, _ := silenceGate(t, "reply")
	e := newTestEngine()
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateSenderSilence(true, 60_000, 600_000)
	p := &leadPlatform{}
	s := &Session{}

	e.applyGate(p, personMsg("test:room", "u1", "甲"), s, "k")
	e.applyGate(p, personMsg("test:room", "u2", "乙"), s, "k")
	g := e.gate
	g.mu.Lock()
	_, u1 := g.held["k\x00test-u1"]
	_, u2 := g.held["k\x00test-u2"]
	g.mu.Unlock()
	if !u1 || !u2 {
		t.Fatalf("bursts held: u1=%v u2=%v", u1, u2)
	}
}

// A burst that is not waiting for silence (an @ of this bot, or the switch off for this message) is
// already collecting: a plain message joins that session burst instead of opening a separate
// sender batch that would be answered before it.
func TestApplyGateSenderSilence_JoinsSessionBurstInFlight(t *testing.T) {
	srv, _ := silenceGate(t, "reply")
	e := newTestEngine()
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateSenderSilence(true, 60_000, 600_000)
	e.SetGateBurstWindow(60_000)
	p := &leadPlatform{}
	s := &Session{}

	mention := personMsg("test:room", "u1", "@bot 先看这个")
	mention.Mentioned = true
	e.applyGate(p, mention, s, "k") // no silent wait: held under the session key
	if !e.applyGate(p, personMsg("test:room", "u1", "补充一句"), s, "k") {
		t.Fatal("the plain message should join the burst already collecting")
	}
	g := e.gate
	g.mu.Lock()
	keys := len(g.held)
	h := g.held["k"]
	g.mu.Unlock()
	if keys != 1 || h == nil {
		t.Fatalf("held bursts = %d (want the session burst only)", keys)
	}
	if got := strings.TrimSpace(h.msg.Content); got != "@bot 先看这个\n补充一句" {
		t.Fatalf("merged = %q", got)
	}
}
