package core

import (
	"reflect"
	"testing"
	"time"
)

// Pin shutdown before either queue consumer runs, without depending on SIGTERM
// timing. Reopen the journal as a restart does: the interrupted request and
// every queued request must survive with their original order.
func TestShutdown1368_PreservesActiveTurnAndQueue(t *testing.T) {
	for _, path := range []string{"drain", "result"} {
		for _, stop := range []string{"stopping", "cancelled"} {
			t.Run(path+"/"+stop, func(t *testing.T) {
				p := &stubPlatformEngine{n: "test"}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				t.Cleanup(e.cancel)
				dir := t.TempDir()
				e.SetDataDir(dir)
				const key = "test:shutdown1368"
				const original = "the trip plan being worked on"
				session := e.sessions.GetOrCreateActive(key)
				if !session.TryLock() {
					t.Fatal("session must start idle")
				}
				as := newCUJAgentSession()
				t.Cleanup(func() { _ = as.Close() })
				state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx",
					pendingMessages: []queuedMessage{
						{platform: p, replyCtx: "ctx", content: "book the hotel", userID: "u", msgSessionKey: key, msgPlatform: "test"},
						{platform: p, replyCtx: "ctx", content: "near West Lake", userID: "u", msgSessionKey: key, msgPlatform: "test"},
					}}
				id := e.journalTurnBegin(&Message{SessionKey: key, Platform: "test", Content: original}, key, "", nil)
				if id == "" {
					t.Fatal("could not begin journal")
				}
				e.journalSyncQueued(state, key)
				before, _ := e.turnJournalStore().Get(id)
				if stop == "stopping" {
					e.platformLifecycleMu.Lock()
					e.stopping = true
					e.platformLifecycleMu.Unlock()
				} else {
					e.cancel()
				}
				if path == "result" {
					as.events <- Event{Type: EventResult, Content: "closing", Done: true}
					e.processInteractiveEvents(state, session, e.sessions, key, "original", time.Now(), nil, nil, "ctx")
				}
				if !e.drainPendingMessages(state, session, e.sessions, key) || session.Busy() {
					t.Error("shutdown drain must release the session")
				}
				e.journalTurnEnd(id)
				j, err := OpenTurnJournal(TurnJournalPath(dir, "test"))
				if err != nil {
					t.Fatal(err)
				}
				entries := j.Inherited()
				if len(entries) != 1 {
					t.Fatalf("want one interrupted turn, got %d", len(entries))
				}
				got := entries[0]
				if got.LastUserMessage != original || !reflect.DeepEqual(got.QueuedMessages, before.QueuedMessages) || !got.Interrupted {
					t.Errorf("shutdown replaced the active request or consumed its queue: last=%q queued=%q interrupted=%v", got.LastUserMessage, got.QueuedMessages, got.Interrupted)
				}
				if len(state.pendingMessages) != 2 || len(as.getSentPrompts()) != 0 {
					t.Errorf("shutdown dispatched pending work: pending=%d prompts=%q", len(state.pendingMessages), as.getSentPrompts())
				}
			})
		}
	}
}
