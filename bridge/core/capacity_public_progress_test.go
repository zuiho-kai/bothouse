package core

import (
	"strings"
	"testing"
	"time"
)

// A turn re-sent after "model at capacity" inside runTurnWithCapacityRetry is a
// new attempt: the first attempt's run was closed when its event loop ended, so
// the re-sent prompt must carry a fresh, live public-progress token. The
// cooldown re-delivery and the prompt-too-long re-run already go back through
// processInteractiveMessageWith and mint their own.
func TestCapacityRetry_ResendGetsLivePublicProgressToken(t *testing.T) {
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "hold:second"}, release: make(chan struct{})}
	p := newProgressPlatform()
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Stop() })

	e.handleMessage(p, &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "u", UserName: "u", Content: "long task", ReplyCtx: "ctx"})
	waitFor(t, "second attempt sent", func() bool { return sess.sends() == 2 })
	sent := sess.sentPrompts()
	first, second := progressToken(t, sent[0]), progressToken(t, sent[1])
	if first == second {
		t.Fatal("capacity retry re-sent the first attempt's (already closed) progress token")
	}
	if _, err := e.publicProgress.Report(PublicProgressRequest{Project: "test", SessionKey: "discord:c1", Run: second, Seq: 1, Kind: "start", Title: "task", Summary: "working"}); err != nil {
		t.Fatalf("report with the retry's token rejected: %v", err)
	}
	close(sess.release)
	waitFor(t, "retry reply", func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "reply:second") })
}

// gatedDestinationPlatform holds TaskCardDestination (called when a run is
// minted) until gate is closed.
type gatedDestinationPlatform struct {
	*progressTestPlatform
	gate chan struct{}
}

func (p *gatedDestinationPlatform) TaskCardDestination(session string) (string, error) {
	<-p.gate
	return p.progressTestPlatform.TaskCardDestination(session)
}

// closedEventsSession is a live session whose event stream is already closed:
// the turn's event loop ends at once, before or after the send goroutine.
type closedEventsSession struct{ countingResultSession }

func newClosedEventsSession() *closedEventsSession {
	s := &closedEventsSession{}
	s.events = make(chan Event)
	close(s.events)
	return s
}
func (s *closedEventsSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	return nil
}

// Queued turn (drainPendingMessages, engine.go runTurnWithCapacityRetry call):
// the run is minted before the event loop starts, so when the loop ends first
// the run is still closed by it, not left open.
func TestQueuedTurn_PublicProgressRunClosedWhenEventLoopEndsFirst(t *testing.T) {
	as := newClosedEventsSession()
	p := &gatedDestinationPlatform{progressTestPlatform: newProgressPlatform(), gate: make(chan struct{})}
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Stop() })
	key := "discord:c1"
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.pendingMessages = []queuedMessage{{platform: p, replyCtx: "rc", content: "queued task", userID: "u", msgSessionKey: key}}

	go func() { time.Sleep(100 * time.Millisecond); close(p.gate) }()
	e.drainPendingMessages(state, session, e.sessions, key)
	waitFor(t, "queued prompt sent", func() bool { return as.count() == 1 })
	time.Sleep(50 * time.Millisecond)
	e.publicProgress.mu.Lock()
	open := len(e.publicProgress.runs)
	e.publicProgress.mu.Unlock()
	if open != 0 {
		t.Fatalf("%d public-progress run(s) left open after the turn ended", open)
	}
}
