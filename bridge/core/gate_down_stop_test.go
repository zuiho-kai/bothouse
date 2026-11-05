package core

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A gate that is configured but cannot judge (no model: 503, or unreachable) must not turn a
// person's "暂停" into a plain mid-turn remark: the built-in stop words apply, as with no gate.
// The stop word may come as a reply to a long message (the quote is not the person's words).
func TestGateDown_StopWordStillCancels(t *testing.T) {
	quote := "[replying to 鲸鱼娘: " + strings.Repeat("我做不了这件，要等上游。", 60) + "]\n暂停"
	for _, tc := range []struct {
		name string
		url  func(t *testing.T) string
	}{
		{"no model 503", func(t *testing.T) string {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusServiceUnavailable)
			}))
			t.Cleanup(srv.Close)
			return srv.URL
		}},
		{"unreachable", func(t *testing.T) string {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
			u := srv.URL
			srv.Close()
			return u
		}},
	} {
		for _, content := range []string{"暂停", quote} {
			t.Run(tc.name, func(t *testing.T) {
				e, running, p, s := newLocalGateEngine(t)
				e.SetGate(tc.url(t), 500, "context")
				msg := localMsg(content)
				msg.Mentioned = true
				e.gate.released[msg] = true
				if !e.applyGate(p, msg, s, "k") {
					t.Fatal("the stop word must be fully handled")
				}
				running.mu.Lock()
				mid := len(running.mid)
				running.mu.Unlock()
				if mid != 0 {
					t.Fatalf("the stop word was inserted into the running turn (%d)", mid)
				}
				e.interactiveMu.Lock()
				_, alive := e.interactiveStates["k"]
				e.interactiveMu.Unlock()
				if alive {
					t.Fatal("the running turn was not stopped")
				}
				var notice bool
				for _, s := range p.getSent() {
					notice = notice || strings.Contains(s, e.i18n.T(MsgLocalGateStopped))
				}
				if !notice {
					t.Fatalf("no stop notice: %q", p.getSent())
				}
			})
		}
	}
}

// When the gate is down, other messages keep the old fallback (inserted into the running turn).
func TestGateDown_OtherMessageStillInserted(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)
	e, running, p, s := newLocalGateEngine(t)
	e.SetGate(srv.URL, 500, "context")
	msg := localMsg("另外帮我看下X")
	msg.Mentioned = true
	e.gate.released[msg] = true
	e.applyGate(p, msg, s, "k")
	running.mu.Lock()
	mid := len(running.mid)
	running.mu.Unlock()
	e.interactiveMu.Lock()
	_, alive := e.interactiveStates["k"]
	e.interactiveMu.Unlock()
	if !alive || mid != 1 {
		t.Fatalf("alive=%v mid=%d, want the turn kept and the message inserted", alive, mid)
	}
}
