package core

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// catchUpSession answers every Send at once and records the prompts.
type catchUpSession struct {
	events  chan Event
	mu      sync.Mutex
	prompts []string
}

func (s *catchUpSession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	s.events <- Event{Type: EventResult, Content: "收到", Done: true}
	return nil
}
func (s *catchUpSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *catchUpSession) Events() <-chan Event                             { return s.events }
func (s *catchUpSession) CurrentSessionID() string                         { return "catchup-session" }
func (s *catchUpSession) Alive() bool                                      { return true }
func (s *catchUpSession) Close() error                                     { return nil }
func (s *catchUpSession) got() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.prompts...)
}

// missedPlatform is a platform whose channel holds posts made while the bridge was down.
type missedPlatform struct {
	stubPlatformEngine
	mu     sync.Mutex
	posts  []*Message
	reads  int
	afters []string
	sinces []time.Time
}

func (p *missedPlatform) MissedMessages(channelID, afterID string, since time.Time) ([]*Message, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.reads++
	p.afters = append(p.afters, afterID)
	p.sinces = append(p.sinces, since)
	var out []*Message
	for _, m := range p.posts {
		if m.ChannelID == channelID && snowflakeAfter(m.MessageID, afterID) {
			cp := *m
			out = append(out, &cp)
		}
	}
	return out, nil
}

func waitCatchUp(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// #1856: a message queued behind a running turn is on disk with its id, so after a restart
// catch-up leaves it to the resume; the posts made while the bridge was down get one turn per
// session; a second restart does not answer them again.
func TestRestartCatchUp_QueuedOnDiskAndMissedAnsweredOnce(t *testing.T) {
	dataDir := t.TempDir()
	sessPath := t.TempDir() + "/sessions.json"
	key := "test:c1:u1"

	// Process 1: a turn on message 200 runs, message 201 is queued behind it; then it dies.
	j1, _ := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
	en, _ := j1.Begin(TurnJournalEntry{Project: "test", SessionKey: key, InteractiveKey: key, Trigger: TurnTriggerUser, MessageID: "200", LastUserMessage: "先做这个"})
	if err := j1.SetQueuedWithIDs(en.TurnID, []string{"排队的话"}, []string{"201"}); err != nil {
		t.Fatal(err)
	}

	// Process 2 starts: same data dir, same sessions file.
	as := &catchUpSession{events: make(chan Event, 8)}
	p := &missedPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, sessPath, LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(dataDir)
	s := e.sessions.GetOrCreateActive(key)
	s.SetLastSeenMsgID("199")

	skip := e.journalMessageIDs()
	if !skip["200"] || !skip["201"] {
		t.Fatalf("journal ids after restart: %v", skip)
	}

	mk := func(id, text string) *Message {
		return &Message{SessionKey: key, Platform: "test", ChannelID: "c1", MessageID: id, UserID: "u1", UserName: "u1", Content: text, ReplyCtx: "rc"}
	}
	p.posts = []*Message{mk("201", "排队的话"), mk("202", "停机时第一句"), mk("203", "停机时第二句")}

	e.catchUpMissed(p, skip)
	waitCatchUp(t, "catch-up turn", func() bool { return len(as.got()) >= 1 })
	time.Sleep(200 * time.Millisecond) // a second turn, if any, would have started by now
	got := as.got()
	if len(got) != 1 {
		t.Fatalf("want one merged turn, got %d: %q", len(got), got)
	}
	if !strings.Contains(got[0], "停机时第二句") {
		t.Fatalf("turn is not on the newest missed message: %q", got[0])
	}
	if !strings.Contains(got[0], "停机时第一句") {
		t.Fatalf("older missed message not in the merged turn: %q", got[0])
	}
	if strings.Contains(got[0], "排队的话") {
		t.Fatalf("message held by the journal answered again: %q", got[0])
	}
	if !strings.Contains(got[0], "桥停机时发来") {
		t.Fatalf("turn does not say it was posted while down: %q", got[0])
	}
	// 11-24: down 00:42 to 11:32, the @s from 01:54 must still be read.
	if since := p.sinces[0]; time.Since(since) < 10*time.Hour {
		t.Fatalf("catch-up window starts %v ago, a night's downtime is not covered", time.Since(since))
	}
	waitCatchUp(t, "last-seen advanced", func() bool { return s.GetLastSeenMsgID() == "203" })

	// Another restart: the mark is past the posts, nothing is answered twice.
	e.catchUpMissed(p, map[string]bool{})
	time.Sleep(200 * time.Millisecond)
	if n := len(as.got()); n != 1 {
		t.Fatalf("restart answered again: %d turns", n)
	}
	if last := p.afters[len(p.afters)-1]; last != "203" {
		t.Fatalf("second read after %q, want 203", last)
	}
}

// Catch-up runs once per platform: a reconnect (ready again) does not read again.
func TestRestartCatchUp_OncePerPlatform(t *testing.T) {
	p := &missedPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(t.TempDir())
	e.sessions.GetOrCreateActive("test:c1:u1").SetLastSeenMsgID("100")
	e.onPlatformReady(p)
	e.markPlatformUnavailable(p)
	e.onPlatformReady(p)
	waitCatchUp(t, "first read", func() bool { p.mu.Lock(); defer p.mu.Unlock(); return p.reads >= 1 })
	time.Sleep(200 * time.Millisecond)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.reads != 1 {
		t.Fatalf("reads = %d, want 1", p.reads)
	}
}
