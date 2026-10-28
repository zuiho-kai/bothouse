package core

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDisplayModelName(t *testing.T) {
	for in, want := range map[string]string{
		`["codegoai-deepseek","deepseek-v4.1-flash"]`: "codegoai-deepseek/deepseek-v4.1-flash",
		"claude-opus": "claude-opus",
		" [not json ": "[not json",
		`["", "m"]`:   "m",
	} {
		if got := displayModelName(in); got != want {
			t.Errorf("displayModelName(%q) = %q, want %q", in, got, want)
		}
	}
}

type quotaModelAgent struct{ *controllableAgent }

func (a *quotaModelAgent) GetModel() string { return `["prov","model-x"]` }

func TestQuotaAndErrorMessageAttribution(t *testing.T) {
	e := NewEngine("whale", &quotaModelAgent{}, nil, "", LangChinese)
	if got, want := e.quotaExhaustedMessage("10pm (Asia/Tokyo)", nil, nil), "⚠️ whale (prov/model-x) 额度已用完，10pm (Asia/Tokyo) 恢复"; got != want {
		t.Fatalf("quota message = %q, want %q", got, want)
	}
	if got, want := e.quotaExhaustedMessage("", nil, nil), "⚠️ whale (prov/model-x) 额度已用完"; got != want {
		t.Fatalf("quota message without reset = %q, want %q", got, want)
	}
	got := e.agentErrorMessage("boom")
	if !strings.HasPrefix(got, "[whale] ") || !strings.Contains(got, "boom") {
		t.Fatalf("error message = %q", got)
	}
}

// A turn the adapter marked as quota-exhausted ends normally with one
// attributed notice, whether it ends in a result (Claude Code) or an error
// (Codex); the CLI's raw text is never relayed.
func TestCUJ_QuotaExhaustedTurnEndsOnceWithAttributedNotice(t *testing.T) {
	for _, tc := range []struct {
		name string
		ev   Event
	}{
		{"result", Event{Type: EventResult, Content: "You've hit your session limit · resets 10pm (Asia/Tokyo)", SessionID: "quota-thread", Done: true,
			Metadata: WithQuotaExhausted(nil, "10pm (Asia/Tokyo)")}},
		{"error", Event{Type: EventError, Error: errors.New("You've hit your usage limit. Try again at 10pm (Asia/Tokyo)."),
			Metadata: WithQuotaExhausted(nil, "10pm (Asia/Tokyo)")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			as := &errorQuotaSession{inputTestSession: &inputTestSession{
				events: make(chan Event, 16), prompts: make(chan string, 16), id: "quota-thread",
			}}
			a := &errorQuotaAgent{&controllableAgent{nextSession: as}}
			p := &stubPlatformEngine{n: "discord"}
			e := NewEngine("whale", a, []Platform{p}, "", LangChinese)
			e.SetReplyFooterEnabled(false)
			s := e.sessions.GetOrCreateActive(inputTestKey)
			t.Cleanup(func() { e.cancel(); inputWait(t, func() bool { return !s.Busy() }); _ = e.Stop() })
			send := func(id string) {
				e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: id, Mentioned: true, ReplyCtx: "local"})
			}
			send("first")
			inputPrompt(t, &inputTestAgent{session: as.inputTestSession})
			as.events <- tc.ev
			inputWait(t, func() bool { return !s.Busy() })
			out := strings.Join(p.getSent(), "\n")
			want := "whale (gemini-4-argon-medium) 额度已用完，10pm (Asia/Tokyo) 恢复"
			if strings.Count(out, want) != 1 || strings.Contains(out, "hit your") || strings.Contains(out, "❌") {
				t.Fatalf("sent = %q, want one %q and no raw CLI text", out, want)
			}
			// The turn is closed, but the provider stays cooling until its reset.
			p.clearSent()
			send("second")
			inputWait(t, func() bool { return !s.Busy() && len(p.getSent()) > 0 })
			select {
			case prompt := <-as.prompts:
				t.Fatalf("cooling provider received %q", prompt)
			default:
			}
			if out := strings.Join(p.getSent(), "\n"); !strings.Contains(out, "冷却") {
				t.Fatalf("cooldown notice missing: %q", out)
			}
			// Advance the deadline instead of paying for a retry during cooldown.
			e.capMu.Lock()
			e.quotaUntil = time.Now().Add(-time.Second)
			e.capMu.Unlock()
			p.clearSent()
			send("third")
			inputPrompt(t, &inputTestAgent{session: as.inputTestSession})
			as.events <- Event{Type: EventResult, Content: "next-answer", SessionID: as.id, Done: true}
			inputWait(t, func() bool { return !s.Busy() })
			if out := strings.Join(p.getSent(), "\n"); !strings.Contains(out, "next-answer") || strings.Contains(out, "额度已用完") {
				t.Fatalf("next turn sent = %q", out)
			}
		})
	}
}
