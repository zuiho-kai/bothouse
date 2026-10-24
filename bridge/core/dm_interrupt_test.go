package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The owner's private chat must be interruptible like a group @-mention: while a turn is running
// the message goes through the gate, so "abort" cancels the turn and the message starts the next
// one, and anything else is inserted into the running turn.

// runOwnerDMTurn starts a long first turn in the owner's DM and waits until it is running.
func runOwnerDMTurn(t *testing.T, e *Engine, p *leadPlatform, sess *abortTurnSession, key string) time.Time {
	t.Helper()
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "u1", UserName: "用户",
		Content: "跑一个很长的任务", Direct: true, ReplyCtx: leadCtx{id: "1"}})
	deadline := time.Now().Add(5 * time.Second)
	for {
		sess.mu.Lock()
		n := len(sess.prompts)
		sess.mu.Unlock()
		if n == 1 && e.sessions.GetOrCreateActive(key).Busy() {
			return deadline
		}
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// ① Busy owner DM judged "abort" by the gate: the running turn is cancelled and this message
// starts a new turn instead of queueing.
func TestOwnerDMBusyGateAbortStartsNewTurn(t *testing.T) {
	var calls atomic.Int32
	var lastReq atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		calls.Add(1)
		var req gateRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		lastReq.Store(req)
		if strings.Contains(req.Content, "改做") {
			_, _ = w.Write([]byte(`{"action":"abort"}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	sess := &abortTurnSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &abortTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "context")
	e.SetAdminFrom("u1")

	key := "test:dm-u1"
	deadline := runOwnerDMTurn(t, e, p, sess, key)
	if n := calls.Load(); n != 0 {
		t.Fatalf("an idle owner DM must skip the gate, got %d calls", n)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "u1", UserName: "用户",
		Content: "别做这个，改做 X", Direct: true, ReplyCtx: leadCtx{id: "2"}})

	for {
		sess.mu.Lock()
		cancels, prompts := sess.cancels, append([]string(nil), sess.prompts...)
		sess.mu.Unlock()
		if len(prompts) >= 2 {
			if cancels != 1 {
				t.Fatalf("CancelTurn called %d times, want 1", cancels)
			}
			if !strings.Contains(prompts[1], "改做 X") {
				t.Fatalf("second turn prompt = %q, want the abort message", prompts[1])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("busy owner DM never interrupted the turn; cancels=%d prompts=%q sent=%+v", cancels, prompts, p.sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if req, _ := lastReq.Load().(gateRequest); !req.Busy || !req.Mentioned {
		t.Fatalf("gate request = %+v, want busy and mentioned", req)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	var notice bool
	for _, s := range p.sent {
		notice = notice || strings.Contains(s.content, "已打断当前这一轮")
	}
	if !notice {
		t.Fatalf("no interrupt notice: %+v", p.sent)
	}
}

// ② Busy owner DM that is not an abort is inserted into the running turn. A gate answer that
// would drop it ("silent" / "context") is overridden: the owner's DM is always addressed.
func TestOwnerDMBusyGateInserts(t *testing.T) {
	for _, action := range []string{"reply", "insert", "silent", "context"} {
		t.Run(action, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_ = json.NewEncoder(w).Encode(gateResponse{Action: action})
			}))
			defer srv.Close()
			e, running, p, s := newLocalGateEngine(t)
			e.SetGate(srv.URL, 2000, "context")
			e.gate.inject = true
			e.SetAdminFrom("u1")
			msg := localMsg("顺便看下这个")
			msg.UserID, msg.Direct = "u1", true
			e.gate.mu.Lock()
			e.gate.released[msg] = true // skip the burst window
			e.gate.mu.Unlock()
			if !e.applyGate(p, msg, s, "k") {
				t.Fatal("a busy owner DM must be handled (inserted)")
			}
			if calls.Load() != 1 {
				t.Fatalf("gate called %d times, want 1", calls.Load())
			}
			running.mu.Lock()
			mid := append([]string(nil), running.mid...)
			running.mu.Unlock()
			if len(mid) != 1 || !strings.Contains(mid[0], "顺便看下这个") {
				t.Fatalf("SendMidTurn got %q, want the message", mid)
			}
			if sent := p.getSent(); len(sent) != 1 || sent[0] != "↪ 已插入" {
				t.Fatalf("replies = %q, want the insert notice", sent)
			}
			e.gate.mu.Lock()
			defer e.gate.mu.Unlock()
			if len(e.gate.buf["k"]) != 0 || len(e.gate.gbuf["k"]) != 0 || len(e.gate.released) != 0 {
				t.Fatal("an owner DM must not be buffered")
			}
		})
	}
}

// ③ An owner DM that was held while busy and handed back after the turn ended skips the gate
// like any idle owner DM, and leaves nothing behind in the gate state.
func TestOwnerDMReleasedWhenIdleSkipsGate(t *testing.T) {
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
	e.gate.mu.Lock()
	e.gate.released[msg] = true
	e.gate.mu.Unlock()
	if e.applyGate(nil, msg, &Session{}, "k") {
		t.Fatal("an idle owner DM must go on to a normal turn")
	}
	if calls.Load() != 0 {
		t.Fatalf("gate called %d times for an idle owner DM", calls.Load())
	}
	e.gate.mu.Lock()
	defer e.gate.mu.Unlock()
	if len(e.gate.released) != 0 || len(e.gate.held) != 0 {
		t.Fatal("gate state left behind")
	}
}

// ④ No gate service: a busy owner DM's stop word cancels the running turn (local gate).
func TestOwnerDMBusyNoGateStopWordCancels(t *testing.T) {
	sess := &abortTurnSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &abortTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGateLocal(true)
	e.SetAdminFrom("u1")

	key := "test:dm-u1-local"
	deadline := runOwnerDMTurn(t, e, p, sess, key)
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "u1", UserName: "用户",
		Content: "停一下", Direct: true, ReplyCtx: leadCtx{id: "2"}})
	for e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("the running turn was not released after the stop word")
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	sess.mu.Lock()
	cancels := sess.cancels
	sess.mu.Unlock()
	if cancels != 1 {
		t.Fatalf("CancelTurn called %d times, want 1", cancels)
	}
}
