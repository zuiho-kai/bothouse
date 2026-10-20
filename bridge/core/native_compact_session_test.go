package core

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// compactingAgent is a native compactor that also starts chat sessions and
// takes per-session model / instructions like the codex agent.
type compactingAgent struct {
	session AgentSession
	called  chan string
	release chan error

	mu           sync.Mutex
	sessionModel string
	instrPath    string
}

func (a *compactingAgent) Name() string { return "stub" }
func (a *compactingAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.session, nil
}
func (a *compactingAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *compactingAgent) Stop() error                                            { return nil }
func (a *compactingAgent) SetSessionModel(m string) {
	a.mu.Lock()
	a.sessionModel = m
	a.mu.Unlock()
}
func (a *compactingAgent) SetSessionInstructions(path, _ string) {
	a.mu.Lock()
	a.instrPath = path
	a.mu.Unlock()
}
func (a *compactingAgent) CompactSession(ctx context.Context, id string) error {
	return a.CompactSessionWith(ctx, id, SessionSettings{Model: "unscoped:" + a.sessionModel, InstructionsPath: a.instrPath})
}
func (a *compactingAgent) CompactSessionWith(ctx context.Context, id string, s SessionSettings) error {
	a.called <- id + "|" + s.Model + "|" + s.InstructionsPath
	select {
	case err := <-a.release:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func newCompactingAgent(as AgentSession) *compactingAgent {
	return &compactingAgent{session: as, called: make(chan string, 4), release: make(chan error, 4)}
}

func waitCompactCall(t *testing.T, a *compactingAgent) string {
	t.Helper()
	select {
	case got := <-a.called:
		return got
	case <-time.After(3 * time.Second):
		t.Fatal("native compaction not called")
		return ""
	}
}

// /compact applies the compacted session's own [projects.session_models] and
// [projects.session_instructions] entries, not whatever the shared agent was
// last set to by another channel's session start.
func TestNativeCompactAppliesSessionModelAndInstructions(t *testing.T) {
	dir := t.TempDir()
	instrA := dir + "/a.md"
	if err := os.WriteFile(instrA, []byte("channel A prompt"), 0o600); err != nil {
		t.Fatal(err)
	}
	a := newCompactingAgent(nil)
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("test", a, []Platform{p}, dir+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() }) // joins workers before TempDir is removed
	e.SetSessionModels(map[string]string{"discord:chan-a": "model-a", "discord:chan-b": "model-b"})
	e.SetSessionInstructions(map[string]string{"discord:chan-a": instrA})

	// Channel B started a session last: the shared agent now holds B's settings.
	e.applySessionModel(a, "discord:chan-b")
	e.applySessionInstructions(a, "discord:chan-b")

	e.sessions.GetOrCreateActive("discord:chan-a").SetAgentSessionID("thread-a", a.Name())
	e.cmdCompress(p, &Message{SessionKey: "discord:chan-a", Platform: "discord", UserID: "u", Content: "/compact", ReplyCtx: "rc"})
	if got, want := waitCompactCall(t, a), "thread-a|model-a|"+instrA; got != want {
		t.Fatalf("compaction ran with %q, want %q", got, want)
	}
	// Passed in, not written to the shared agent: a session starting on
	// channel B meanwhile must still get B's settings.
	a.mu.Lock()
	shared := a.sessionModel + "|" + a.instrPath
	a.mu.Unlock()
	if shared != "model-b|" {
		t.Fatalf("compaction rewrote the shared agent settings to %q, want channel B's %q", shared, "model-b|")
	}
	a.release <- nil

	// A channel with no entries compacts on the defaults, not on A's leftovers.
	e.sessions.GetOrCreateActive("discord:chan-c").SetAgentSessionID("thread-c", a.Name())
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
	e.cmdCompress(p, &Message{SessionKey: "discord:chan-c", Platform: "discord", UserID: "u", Content: "/compact", ReplyCtx: "rc"})
	if got, want := waitCompactCall(t, a), "thread-c||"; got != want {
		t.Fatalf("compaction ran with %q, want %q", got, want)
	}
	a.release <- nil
}

// A cron job or a capacity re-delivery that hits a session under native
// /compact waits in the queue and runs when the compaction ends, instead of
// failing as "busy" (cron) or being dropped (re-delivery).
func TestNativeCompact_ScheduledAndRedeliveredTurnsQueueUntilDone(t *testing.T) {
	as := newCountingResultSession()
	a := newCompactingAgent(as)
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() }) // joins workers before TempDir is removed
	key := "discord:channel-1:user-1"
	e.sessions.GetOrCreateActive(key).SetAgentSessionID("thread-1", a.Name())

	e.cmdCompress(p, &Message{SessionKey: key, Platform: "discord", UserID: "u", Content: "/compact", ReplyCtx: "rc"})
	waitCompactCall(t, a)

	job := &CronJob{ID: "c1", SessionKey: key, Prompt: "daily digest", Description: "digest"}
	if err := e.ExecuteCronJob(job); err != nil {
		t.Fatalf("ExecuteCronJob() during /compact = %v, want nil (queued)", err)
	}
	e.redeliverMessage(p, &Message{SessionKey: key, Platform: "discord", UserID: "u", UserName: "u", Content: "retry me", ReplyCtx: "rc"}, a, e.sessions, key, "")
	for _, s := range p.getSent() {
		if strings.Contains(s, "没能重试") {
			t.Fatalf("re-delivery dropped during /compact: %#v", p.getSent())
		}
	}
	if n := as.count(); n != 0 {
		t.Fatalf("agent got %d turns while compacting, want 0", n)
	}

	a.release <- nil
	waitFor(t, "both queued turns ran after /compact", func() bool { return as.count() == 2 })
	waitFor(t, "session idle", func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
	prompts := strings.Join(as.sentPrompts(), "\n---\n")
	for _, want := range []string{"daily digest", "retry me"} {
		if !strings.Contains(prompts, want) {
			t.Fatalf("prompts lack %q:\n%s", want, prompts)
		}
	}
}
