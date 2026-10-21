package codex

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// A public answer to an inserted message must arrive while the original turn
// is still running, without requiring another tool call or a final result.
func TestAppServerSteerPublishesReplyBeforeNextTool(t *testing.T) {
	a, log := fakeAppServerAgent(t, "steer-public")
	as, err := a.StartSession(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.Send("start the long task", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := as.Send("please acknowledge this insertion", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-as.Events():
		if event.Type != core.EventText || !strings.Contains(event.Content, "inserted message") {
			t.Fatalf("inserted public reply = %+v, want visible text before turn completion", event)
		}
	case <-time.After(time.Second):
		t.Fatal("inserted public reply remained buffered until another tool or turn completion")
	}
	if err := as.Send("finish now", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	event, text := inputReadTerminal(t, as)
	if event.Type != core.EventResult || text != "steered" {
		t.Fatalf("event=%+v text=%q", event, text)
	}
	data, _ := os.ReadFile(log)
	if strings.Count(string(data), "turn/start\n") != 1 || strings.Count(string(data), "turn/steer\n") != 2 {
		t.Fatalf("insertion must preserve the original turn: %s", data)
	}
}

func TestAppServerPublicReplyPhaseCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name, phase string
		strict      bool
		immediate   bool
	}{
		{"commentary", "commentary", false, true},
		{"final", "final_answer", false, false},
		{"legacy", "", false, false},
		{"unknown", "future-phase", false, false},
		{"strict-voice", "commentary", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &appServerSession{events: make(chan core.Event, 8)}
			if tc.strict {
				s.strict = &appServerStrictTurn{}
			}
			s.handleItemCompleted(map[string]any{"type": "agentMessage", "phase": tc.phase, "text": "public reply"})
			if tc.immediate {
				select {
				case e := <-s.events:
					if e.Type != core.EventText || e.Content != "public reply" {
						t.Fatalf("event=%+v", e)
					}
				default:
					t.Fatal("public reply not emitted")
				}
			} else if len(s.events) != 0 {
				t.Fatal("legacy/final/strict boundary changed")
			}
			s.flushPendingAsText()
			want := 1
			if tc.immediate {
				want = 0
			}
			if len(s.events) != want {
				t.Fatalf("flush emitted %d events, want %d (no duplicate commentary)", len(s.events), want)
			}
		})
	}
	s := &appServerSession{events: make(chan core.Event, 1)}
	s.handleItemCompleted(map[string]any{"type": "reasoning", "summary": []any{"private reasoning"}})
	if e := <-s.events; e.Type != core.EventThinking {
		t.Fatalf("reasoning became public text: %+v", e)
	}
}

type publicReplyAgent struct {
	*Agent
	live core.AgentSession
}

func (a *publicReplyAgent) StartSession(context.Context, string) (core.AgentSession, error) {
	return a.live, nil
}

type publicReplyDelivery struct {
	kind, text string
	handle     any
}
type publicReplyPlatform struct {
	mu   sync.Mutex
	next int
	sent chan publicReplyDelivery
}

func (p *publicReplyPlatform) Name() string                    { return "test" }
func (p *publicReplyPlatform) Start(core.MessageHandler) error { return nil }
func (p *publicReplyPlatform) Stop() error                     { return nil }
func (p *publicReplyPlatform) Send(_ context.Context, _ any, text string) error {
	p.sent <- publicReplyDelivery{kind: "send", text: text}
	return nil
}
func (p *publicReplyPlatform) Reply(ctx context.Context, rc any, text string) error {
	return p.Send(ctx, rc, text)
}
func (p *publicReplyPlatform) SendPreviewStart(_ context.Context, _ any, text string) (any, error) {
	p.mu.Lock()
	p.next++
	id := p.next
	p.mu.Unlock()
	p.sent <- publicReplyDelivery{kind: "start", text: text, handle: id}
	return id, nil
}
func (p *publicReplyPlatform) UpdateMessage(_ context.Context, id any, text string) error {
	p.sent <- publicReplyDelivery{kind: "update", text: text, handle: id}
	return nil
}

// Real Engine.ReceiveMessage -> gate -> app-server turn/steer -> renderer.
// Only the external JSON-RPC process, gate HTTP and message transport are fake.
func TestAppServerInsertedReplyVisibleWhileOriginalTaskRuns(t *testing.T) {
	a, log := fakeAppServerAgent(t, "steer-engine")
	as, err := a.StartSession(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	p := &publicReplyPlatform{sent: make(chan publicReplyDelivery, 128)}
	e := core.NewEngine("test", &publicReplyAgent{Agent: a, live: as}, []core.Platform{p}, t.TempDir()+"/sessions.json", core.LangChinese)
	defer e.Stop()
	e.SetDisplayConfig(core.DisplayCfg{Mode: "compact", ThinkingMessages: false, ToolMessages: false})
	e.SetStreamPreviewCfg(core.StreamPreviewCfg{Enabled: true, IntervalMs: 1, MinDeltaChars: 1})
	gate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			fmt.Fprint(w, "{}")
			return
		}
		fmt.Fprint(w, `{"action":"reply"}`)
	}))
	defer gate.Close()
	e.SetGate(gate.URL+"/decide", 1000, "reply")
	e.SetGateBurstWindow(1)
	send := func(id, text string) {
		e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: id, UserID: "human", Content: text, Mentioned: true, ReplyCtx: id})
	}
	wait := func(text string) publicReplyDelivery {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case d := <-p.sent:
				if strings.Contains(d.text, text) {
					return d
				}
			case <-deadline:
				t.Fatalf("no visible %q", text)
			}
		}
	}
	send("first", "start work")
	first := wait("Starting the original task.")
	send("inserted", "please acknowledge this insertion")
	reply := wait("I received your inserted message")
	if reply.kind != "start" || reply.handle == first.handle {
		t.Fatalf("reply edited the old message: first=%+v inserted=%+v", first, reply)
	}
	// A further insertion still steers the SAME task, rather than starting a
	// second answer process or marking the original task complete early.
	send("finish", "finish now")
	wait("steered")
	data, _ := os.ReadFile(log)
	if strings.Count(string(data), "turn/start\n") != 1 || strings.Count(string(data), "turn/steer\n") != 2 {
		t.Fatalf("task restarted: %s", data)
	}
}
