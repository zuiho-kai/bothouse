package core

import (
	"testing"
	"time"
)

// #1421: a message can queue before the running turn's journal entry exists —
// enqueueForBusySession syncs through j.Active(interactiveKey), which is empty
// until journalTurnBegin. When the queue was written in that window and the
// bridge was then shut down (SIGTERM), the queue survived only in memory: the
// log said "queued messages kept for resume after shutdown", the journal entry
// carried no queued_messages, and the restart resumed the turn without them.
// The turn must attach whatever queued before it once its entry exists.
func TestJournalQueuedBeforeTurnEntry513(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newBlockingSendSession("busy-513")
	e := NewEngine("test", &controllableAgent{nextSession: sess}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	t.Cleanup(e.cancel)

	const key = "test:journal513"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("session must start idle")
	}

	// The burst: two messages queue while the first turn is being accepted,
	// before its journal entry is on disk.
	e.ensureInteractiveStateForQueueing(key, p, "ctx")
	for _, text := range []string{"second one", "third one"} {
		if out := e.enqueueForBusySession(p, &Message{
			SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: text, ReplyCtx: "ctx",
		}, key, nil); out != queueAccepted {
			t.Fatalf("queue %q: outcome %v, want accepted", text, out)
		}
	}
	if id := e.turnJournalStore().Active(key); id != "" {
		t.Fatalf("no journal entry should exist before the turn begins, got %q", id)
	}

	done := make(chan struct{})
	go func() {
		e.processInteractiveMessageWith(p, &Message{
			SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "the long turn", ReplyCtx: "ctx",
		}, session, e.agent, e.sessions, key, "", "")
		close(done)
	}()
	select {
	case <-sess.sendStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("turn never reached the agent")
	}

	id := e.turnJournalStore().Active(key)
	if id == "" {
		t.Fatal("running turn has no journal entry")
	}
	en, ok := e.turnJournalStore().Get(id)
	if !ok {
		t.Fatal("journal get: entry not found")
	}
	if len(en.QueuedMessages) != 2 || en.QueuedMessages[0] != "second one" || en.QueuedMessages[1] != "third one" {
		t.Errorf("queued messages missing from the running turn's journal entry: %q", en.QueuedMessages)
	}

	// Shut down while both are still queued: they must stay on disk in order.
	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()
	close(sess.unblock)
	sess.events <- Event{Type: EventResult, Content: "closing", Done: true}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("turn did not finish")
	}
	j, err := OpenTurnJournal(TurnJournalPath(e.dataDir, "test"))
	if err != nil {
		t.Fatal(err)
	}
	entries := j.Inherited()
	if len(entries) != 1 {
		t.Fatalf("want one interrupted turn, got %d", len(entries))
	}
	if got := entries[0].QueuedMessages; len(got) != 2 || got[0] != "second one" || got[1] != "third one" {
		t.Errorf("queue lost at shutdown: %q", got)
	}
}
