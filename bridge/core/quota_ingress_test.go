package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

type quotaJourneyAgent struct {
	stubAgent
	mu    sync.Mutex
	model string
	sent  chan string
}

func (a *quotaJourneyAgent) GetModel() string  { a.mu.Lock(); defer a.mu.Unlock(); return a.model }
func (a *quotaJourneyAgent) SetModel(m string) { a.mu.Lock(); a.model = m; a.mu.Unlock() }
func (a *quotaJourneyAgent) AvailableModels(context.Context) []ModelOption {
	return []ModelOption{{Name: "A"}, {Name: "B"}, {Name: "A2"}}
}
func (a *quotaJourneyAgent) QuotaScope(model string) (string, string) {
	if model == "A2" {
		model = "A"
	}
	return "journey-account", model
}
func (a *quotaJourneyAgent) StartSession(context.Context, string) (AgentSession, error) {
	return &quotaJourneySession{inputTestSession: &inputTestSession{events: make(chan Event, 8), prompts: make(chan string, 8), id: "quota-journey"}, model: a.GetModel(), sent: a.sent}, nil
}

type quotaJourneySession struct {
	*inputTestSession
	model string
	sent  chan string
}

func (s *quotaJourneySession) GetModel() string { return s.model }
func (s *quotaJourneySession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.sent <- s.model
	if s.model == "A" {
		s.events <- Event{Type: EventError, Metadata: WithQuotaExhausted(nil, time.Now().Add(time.Hour).Format(time.RFC3339))}
	} else {
		s.events <- Event{Type: EventResult, Content: "answer from " + s.model, Done: true}
	}
	return nil
}

func TestQuotaPendingSwitchIngress(t *testing.T) {
	for _, entry := range []string{"message", "relay", "timer", "cron"} {
		t.Run(entry, func(t *testing.T) {
			a := &quotaJourneyAgent{model: "A", sent: make(chan string, 8)}
			p := &inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
			e := NewEngine("quota-ingress", a, []Platform{p}, "", LangEnglish)
			e.dataDir = t.TempDir()
			e.SetReplyFooterEnabled(false)
			e.markPlatformReady(p)
			t.Cleanup(func() { e.cancel(); e.Stop() })
			key := "discord:quota-ingress"
			send := func(id string) {
				e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "discord", MessageID: id, UserID: "human", Content: id, Mentioned: true, ReplyCtx: key})
			}
			send("first")
			select {
			case model := <-a.sent:
				if model != "A" {
					t.Fatal(model)
				}
			case <-time.After(time.Second):
				t.Fatal("first turn missing")
			}
			inputWait(t, func() bool { return !e.sessions.GetOrCreateActive(key).Busy() && !e.quotaCooling().IsZero() })
			p.clearSent()
			if r := e.QueueModelSwitch(context.Background(), key, "B", "", false); !r.OK {
				t.Fatal(r.Message)
			}
			switch entry {
			case "message":
				send("second")
			case "relay":
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				if _, err := e.HandleRelay(ctx, "source", key, "second"); err != nil {
					t.Fatal(err)
				}
			case "timer":
				if err := e.ExecuteTimerJob(&TimerJob{ID: "quota-timer", SessionKey: key, Prompt: "second"}); err != nil {
					t.Fatal(err)
				}
			case "cron":
				if err := e.ExecuteCronJob(&CronJob{ID: "quota-cron", SessionKey: key, Prompt: "second"}); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case model := <-a.sent:
				if model != "B" {
					t.Fatalf("queued B ran old model %s", model)
				}
			case <-time.After(time.Second):
				t.Fatalf("queued B blocked at %s: %s", entry, strings.Join(p.getSent(), "\n"))
			}
			inputWait(t, func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
			a.SetModel("A2")
			if e.quotaCooling().IsZero() {
				t.Fatal("same shared pool bypassed A cooldown")
			}
		})
	}
}
