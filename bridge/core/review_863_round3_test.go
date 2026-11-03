package core

import (
	"fmt"
	"strings"
	"testing"
)

func round3Engine(t *testing.T, key string, dataDir bool) (*Engine, *interactiveState, Platform) {
	t.Helper()
	p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
	as := newPromptCaptureSession()
	e := NewEngine("round3-review", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	t.Cleanup(e.cancel)
	if dataDir {
		e.SetDataDir(t.TempDir())
	}
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	_, state := busySessionWithLiveState(t, e, p, key, as)
	return e, state, p
}

// A message folded into its neighbour's contextBefore is still accepted: the queue journal of the
// running turn keeps it, so a restart resumes with it, in arrival order (review 4449808789).
func TestReview863Round3JournalKeepsFoldedContext(t *testing.T) {
	const key = "qq:group:round3-journal"
	e, _, p := round3Engine(t, key, true)
	j := e.turnJournalStore()
	active, err := j.Begin(TurnJournalEntry{Project: e.name, SessionKey: key, InteractiveKey: key, LastUserMessage: "running"})
	if err != nil {
		t.Fatal(err)
	}
	n := maxQueuedOverflow + 3
	for i := 0; i < n; i++ {
		m := &Message{SessionKey: key, Platform: "qq", UserID: fmt.Sprintf("user-%d", i), UserName: fmt.Sprintf("User%d", i), MessageID: fmt.Sprintf("msg-%d", i), Content: fmt.Sprintf("ARRIVAL_%03d", i)}
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	re, err := OpenTurnJournal(TurnJournalPath(e.dataDir, e.name))
	if err != nil {
		t.Fatal(err)
	}
	en, ok := re.Get(active.TurnID)
	if !ok {
		t.Fatal("running entry missing on disk")
	}
	all := strings.Join(en.QueuedMessages, "\n")
	prev := -1
	for i := 0; i < n; i++ {
		at := strings.Index(all, fmt.Sprintf("ARRIVAL_%03d", i))
		if at < 0 {
			t.Errorf("accepted ARRIVAL_%03d not in the queue journal (%d entries on disk)", i, len(en.QueuedMessages))
			continue
		}
		if at <= prev {
			t.Errorf("ARRIVAL_%03d out of arrival order in the queue journal", i)
		}
		prev = at
	}
}

// During an authorized turn every queued message gets its own journal entry and cannot ride as
// context; one that arrives at a full group queue holds a place instead of becoming an uncounted,
// never-folded context entry (review 4449808797).
func TestReview863Round3JournaledMessageNeverContextOnly(t *testing.T) {
	const key = "qq:group:round3-authorized"
	e, state, p := round3Engine(t, key, true)
	state.authorization = &AuthorizationTurn{Project: e.name, TaskID: "task", DecisionID: "decision"}
	for i := 0; i < 3; i++ {
		m := &Message{SessionKey: key, Platform: "qq", UserID: fmt.Sprintf("user-%d", i), UserName: fmt.Sprintf("User%d", i), MessageID: fmt.Sprintf("msg-%d", i), Content: fmt.Sprintf("AUTH_%d", i)}
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	for i := range state.pendingMessages {
		q := &state.pendingMessages[i]
		if q.resumedFrom == "" {
			t.Errorf("%s: not journaled during an authorized turn", q.messageID)
		}
		if q.overflow && !batchableQueued(q) {
			t.Errorf("%s: context-only but never batchable (journaled %s)", q.messageID, q.resumedFrom)
		}
	}
	if got := countQueuedLocked(state); got != len(state.pendingMessages) {
		t.Errorf("queue cap counts %d of %d turns waiting", got, len(state.pendingMessages))
	}
}

// A message turned away because its journal entry failed leaves the queue as it was: no older
// message gives up its own turn for it (review 4449808808).
func TestReview863Round3JournalFailureKeepsQueue(t *testing.T) {
	const key = "qq:group:round3-journal-fail"
	e, state, p := round3Engine(t, key, false) // no data dir: the authorization journal fails
	if e.enqueueForBusySession(p, &Message{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "older", Content: "OLDER"}, key, nil) != queueAccepted {
		t.Fatal("setup: older message not accepted")
	}
	state.mu.Lock()
	state.authorization = &AuthorizationTurn{Project: e.name, TaskID: "task", DecisionID: "decision"}
	state.mu.Unlock()
	if got := e.enqueueForBusySession(p, &Message{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "rejected", Content: "REJECTED"}, key, nil); got != queueRejected {
		t.Fatalf("outcome=%v, want rejected on journal failure", got)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.pendingMessages) != 1 || state.pendingMessages[0].messageID != "older" {
		t.Fatalf("queue changed: %d entries", len(state.pendingMessages))
	}
	if state.pendingMessages[0].overflow {
		t.Error("older message filed as context for a message that was never accepted")
	}
}

// The turn's quote is the one of the messages holding a place; an earlier context-only message's
// quote stays in its own text and never replaces it (review 4449808817).
func TestReview863Round3HolderKeepsItsQuote(t *testing.T) {
	const key = "qq:group:round3-quote"
	e, state, p := round3Engine(t, key, false)
	for _, m := range []*Message{
		{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "context", Content: "[replying to Earlier: UNIQUE_EARLIER_QUOTE]\nEARLIER_MESSAGE", Reference: &MessageReference{ID: "quote-a", Full: "[replying to Earlier: UNIQUE_EARLIER_QUOTE]\n", Text: "UNIQUE_EARLIER_QUOTE"}},
		{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "holder", Content: "[replying to Latest: UNIQUE_HOLDER_QUOTE]\nLATEST_QUESTION", Mentioned: true, Reference: &MessageReference{ID: "quote-b", Full: "[replying to Latest: UNIQUE_HOLDER_QUOTE]\n", Text: "UNIQUE_HOLDER_QUOTE"}},
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	state.mu.Lock()
	q := takeQueuedBatchLocked(state)
	state.mu.Unlock()
	if q.messageID != "holder" || q.userID != "bob" {
		t.Fatalf("reply target=%s/%s want holder/bob", q.messageID, q.userID)
	}
	if q.reference == nil || q.reference.ID != "quote-b" {
		t.Fatalf("turn quote=%+v, want the holder's quote-b", q.reference)
	}
	for _, s := range []string{"UNIQUE_EARLIER_QUOTE", "EARLIER_MESSAGE", "UNIQUE_HOLDER_QUOTE", "LATEST_QUESTION"} {
		if !strings.Contains(q.content, s) {
			t.Errorf("%s missing from the turn", s)
		}
	}
	if strings.Index(q.content, "EARLIER_MESSAGE") > strings.Index(q.content, "LATEST_QUESTION") {
		t.Error("arrival order lost")
	}
}

// With no holder quoting anything, a context-only message's quote is still the turn's quote, as
// before (the fix only stops it from replacing a holder's own).
func TestReview863Round3ContextQuoteWhenHolderHasNone(t *testing.T) {
	const key = "qq:group:round3-quote-fallback"
	e, state, p := round3Engine(t, key, false)
	for _, m := range []*Message{
		{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "context", Content: "EARLIER", Reference: &MessageReference{ID: "quote-a", Text: "Q"}},
		{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "holder", Content: "LATEST", Mentioned: true},
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	state.mu.Lock()
	q := takeQueuedBatchLocked(state)
	state.mu.Unlock()
	if q.messageID != "holder" || q.reference == nil || q.reference.ID != "quote-a" {
		t.Fatalf("turn=%s quote=%+v", q.messageID, q.reference)
	}
}
