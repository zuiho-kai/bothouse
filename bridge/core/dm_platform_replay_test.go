package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type dmReplaySession struct{ abortTurnSession }

func (s *dmReplaySession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	if strings.Contains(prompt, "改做X") {
		go func() { s.events <- Event{Type: EventResult, Content: "已改做X", Done: true} }()
	}
	return nil
}

type dmReplayAgent struct {
	abortTurnAgent
	s *dmReplaySession
}

func (a *dmReplayAgent) StartSession(context.Context, string) (AgentSession, error) { return a.s, nil }

type dmReplayPlatform struct {
	leadPlatform
	name string
}

func (p *dmReplayPlatform) Name() string { return p.name }
func TestDMPlatformReplay(t *testing.T) {
	for _, platform := range []string{"discord", "telegram", "feishu", "slack"} {
		t.Run(platform, func(t *testing.T) {
			b, err := os.ReadFile(filepath.Join("testdata", "dm-replay", platform+".json"))
			if err != nil {
				t.Fatal(err)
			}
			var fixtures []Message
			if err = json.Unmarshal(b, &fixtures); err != nil {
				t.Fatal(err)
			}
			for _, mode := range []string{"gateway", "local"} {
				t.Run(mode, func(t *testing.T) {
					sess := &dmReplaySession{abortTurnSession: abortTurnSession{events: make(chan Event, 16)}}
					p := &dmReplayPlatform{name: platform}
					e := NewEngine("replay", &dmReplayAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangChinese)
					defer e.Stop()
					e.SetAdminFrom(fixtures[0].UserID)
					e.SetGateLocal(true)
					var requests []gateRequest
					var reqMu sync.Mutex
					if mode == "gateway" {
						srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if strings.HasSuffix(r.URL.Path, "/context") {
								w.Write([]byte(`{}`))
								return
							}
							var req gateRequest
							json.NewDecoder(r.Body).Decode(&req)
							reqMu.Lock()
							requests = append(requests, req)
							reqMu.Unlock()
							json.NewEncoder(w).Encode(gateResponse{Action: "abort"})
						}))
						defer srv.Close()
						e.SetGate(srv.URL+"/decide", 1000, "context")
						e.SetGateBurstWindow(1)
					}
					send := func(i int) { m := fixtures[i]; m.ReplyCtx = leadCtx{id: m.MessageID}; e.ReceiveMessage(p, &m) }
					wait := func(f func() bool) bool {
						deadline := time.Now().Add(3 * time.Second)
						for time.Now().Before(deadline) {
							if f() {
								return true
							}
							time.Sleep(10 * time.Millisecond)
						}
						return false
					}
					send(0)
					if !wait(func() bool {
						sess.mu.Lock()
						defer sess.mu.Unlock()
						return len(sess.prompts) == 1 && e.sessions.GetOrCreateActive(fixtures[0].SessionKey).Busy()
					}) {
						t.Fatal("long task did not start")
					}
					send(1)
					stopped := wait(func() bool { sess.mu.Lock(); defer sess.mu.Unlock(); return sess.cancels >= 1 })
					if !stopped {
						t.Errorf("exact stop word 停 did not cancel the long task")
					}
					if mode == "gateway" && !wait(func() bool { sess.mu.Lock(); defer sess.mu.Unlock(); return len(sess.prompts) >= 2 }) {
						t.Error("stop message not received by next turn")
					}
					if mode == "local" {
						if !wait(func() bool { return !e.sessions.GetOrCreateActive(fixtures[0].SessionKey).Busy() }) {
							t.Fatal("stop did not release session")
						}
						sess.mu.Lock()
						n := len(sess.prompts)
						sess.mu.Unlock()
						if n != 1 {
							t.Fatalf("stop started a turn: prompts=%d", n)
						}
						m := fixtures[0]
						m.MessageID = "restart"
						m.ReplyCtx = leadCtx{id: "restart"}
						e.ReceiveMessage(p, &m)
						if !wait(func() bool {
							sess.mu.Lock()
							defer sess.mu.Unlock()
							return len(sess.prompts) == 2 && e.sessions.GetOrCreateActive(m.SessionKey).Busy()
						}) {
							t.Fatal("second long task did not start")
						}
					}
					send(2)
					wantCancels := 2
					if !wait(func() bool {
						sess.mu.Lock()
						defer sess.mu.Unlock()
						return sess.cancels >= wantCancels && len(sess.prompts) >= 3 && strings.Contains(sess.prompts[2], "改做X")
					}) {
						t.Errorf("redirect did not interrupt and reach next turn")
					}
					sess.mu.Lock()
					cancels, prompts := sess.cancels, append([]string(nil), sess.prompts...)
					sess.mu.Unlock()
					p.mu.Lock()
					sent := append([]leadSend(nil), p.sent...)
					p.mu.Unlock()
					t.Logf("platform=%s mode=%s cancels=%d prompt_count=%d replies=%+v", platform, mode, cancels, len(prompts), sent)
					if !wait(func() bool {
						p.mu.Lock()
						defer p.mu.Unlock()
						for _, m := range p.sent {
							if m.ctx.final && strings.Contains(m.content, "已改做X") {
								return true
							}
						}
						return false
					}) {
						t.Error("new task final answer not delivered")
					}
					if mode == "gateway" {
						reqMu.Lock()
						defer reqMu.Unlock()
						for _, req := range requests {
							if !req.Busy || !req.Mentioned {
								t.Errorf("busy owner DM not marked busy/addressed: %+v", req)
							}
						}
					}
				})
			}
		})
	}
}
