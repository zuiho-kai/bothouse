package core

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestTurnJournalBeginWritesAndDeleteRemoves(t *testing.T) {
	path := TurnJournalPath(t.TempDir(), "proj/a")
	j, err := OpenTurnJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	en, err := j.Begin(TurnJournalEntry{Project: "proj", SessionKey: "discord:1", InteractiveKey: "discord:1",
		Trigger: TurnTriggerUser, AgentSessionID: "sid", AgentPID: 42, AgentPGID: 42, LastUserMessage: "do it"})
	if err != nil || en.TurnID == "" || en.StartedAt.IsZero() {
		t.Fatalf("begin: %+v %v", en, err)
	}
	if fi, err := os.Stat(path); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("journal file: %v %v", fi, err)
	}
	re, _ := OpenTurnJournal(path)
	if got := re.List(); len(got) != 1 || got[0].AgentPID != 42 || got[0].Trigger != TurnTriggerUser || got[0].LastUserMessage != "do it" {
		t.Fatalf("on disk: %+v", got)
	}
	// A stale turn id does not delete a newer turn's entry.
	if err := j.Delete("other"); err != nil || len(j.List()) != 1 {
		t.Fatalf("stale delete removed entry: %v", err)
	}
	if got := j.List(); got[0].Kind != TurnKindTurn || j.Active("discord:1") != en.TurnID {
		t.Fatalf("kind/active: %+v %q", got, j.Active("discord:1"))
	}
	if err := j.Delete(en.TurnID); err != nil {
		t.Fatal(err)
	}
	re, _ = OpenTurnJournal(path)
	if got := re.List(); len(got) != 0 {
		t.Fatalf("entry left after delete: %+v", got)
	}
}

func TestTurnJournalCrashLeavesReadableEntry(t *testing.T) {
	path := TurnJournalPath(t.TempDir(), "p")
	j, _ := OpenTurnJournal(path)
	en, _ := j.Begin(TurnJournalEntry{InteractiveKey: "k", SessionKey: "k", Trigger: TurnTriggerTimer, ResumedFrom: "old-turn", NoProgressCount: 1})
	// "Crash": no Delete; a new process opens the same file.
	re, err := OpenTurnJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	got := re.List()
	if len(got) != 1 || got[0].TurnID != en.TurnID || got[0].ResumedFrom != "old-turn" || got[0].NoProgressCount != 1 || got[0].Interrupted {
		t.Fatalf("after crash: %+v", got)
	}
	ok, err := re.Mark(en.TurnID)
	if !ok || err != nil {
		t.Fatalf("mark: %v %v", ok, err)
	}
	if got := re.List(); !got[0].Interrupted || got[0].InterruptedAt.IsZero() {
		t.Fatalf("not marked: %+v", got)
	}
}

func TestTurnJournalBrokenFileIsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "turn-journal", "p.json")
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = os.WriteFile(path, []byte("{not json"), 0o600)
	j, err := OpenTurnJournal(path)
	if err != nil || len(j.List()) != 0 {
		t.Fatalf("broken file: %v %+v", err, j.List())
	}
}

func TestTurnJournalConcurrentSessionsDoNotOverwrite(t *testing.T) {
	path := TurnJournalPath(t.TempDir(), "p")
	j, _ := OpenTurnJournal(path)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := fmt.Sprintf("discord:%d", i)
			_, _ = j.Begin(TurnJournalEntry{InteractiveKey: k, SessionKey: k, Trigger: TurnTriggerUser})
		}(i)
	}
	wg.Wait()
	re, _ := OpenTurnJournal(path)
	if got := re.List(); len(got) != 20 {
		t.Fatalf("want 20 entries, got %d", len(got))
	}
}

func TestTurnJournalEngineStoppingMarksInterrupted(t *testing.T) {
	e := newTestEngine()
	e.SetDataDir(t.TempDir())
	msg := &Message{SessionKey: "test:1", Platform: "test", Content: "hi", turnTrigger: TurnTriggerCron}
	id := e.journalTurnBegin(msg, "test:1", "", nil)
	if id == "" {
		t.Fatal("no turn id")
	}
	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()
	e.journalTurnEnd(id)
	re, _ := OpenTurnJournal(TurnJournalPath(e.dataDir, e.name))
	got := re.List()
	if len(got) != 1 || !got[0].Interrupted || got[0].Trigger != TurnTriggerCron {
		t.Fatalf("stopping end: %+v", got)
	}
}

type journalPidSession struct {
	*resultAgentSession
	e        *Engine
	duringMu sync.Mutex
	during   []TurnJournalEntry
}

func (s *journalPidSession) ProcessID() int      { return 4321 }
func (s *journalPidSession) ProcessGroupID() int { return 4321 }
func (s *journalPidSession) Send(prompt, id string, im []ImageAttachment, f []FileAttachment) error {
	s.duringMu.Lock()
	s.during = s.e.TurnJournal().List()
	s.duringMu.Unlock()
	return s.resultAgentSession.Send(prompt, id, im, f)
}

func TestTurnJournalEngineTurnWritesThenDeletes(t *testing.T) {
	as := &journalPidSession{resultAgentSession: newResultAgentSession("done")}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(t.TempDir())
	as.e = e
	key := "test:journal"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("busy")
	}
	e.processInteractiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "build it", ReplyCtx: "rc"}, session)
	as.duringMu.Lock()
	during := as.during
	as.duringMu.Unlock()
	if len(during) != 1 || during[0].SessionKey != key || during[0].AgentPID != 4321 || during[0].AgentPGID != 4321 ||
		during[0].Trigger != TurnTriggerUser || during[0].LastUserMessage != "build it" || during[0].Project != "test" {
		t.Fatalf("entry during turn: %+v", during)
	}
	if got := e.TurnJournal().List(); len(got) != 0 {
		t.Fatalf("entry left after normal end: %+v", got)
	}
}

// M1: an entry left by an earlier process survives a new turn on the same
// interactive key; only the turn resuming it removes it.
func TestTurnJournalNewTurnDoesNotOverwriteInterrupted(t *testing.T) {
	path := TurnJournalPath(t.TempDir(), "p")
	j, _ := OpenTurnJournal(path)
	old, _ := j.Begin(TurnJournalEntry{InteractiveKey: "k", SessionKey: "k", Trigger: TurnTriggerUser, LastUserMessage: "old"})
	re, _ := OpenTurnJournal(path) // restart
	if re.Active("k") != "" {
		t.Fatal("loaded entry must not be active in the new process")
	}
	if _, err := re.Mark(old.TurnID); err != nil {
		t.Fatal(err)
	}
	nu, _ := re.Begin(TurnJournalEntry{InteractiveKey: "k", SessionKey: "k", Trigger: TurnTriggerUser, LastUserMessage: "new"})
	if got := re.List(); len(got) != 2 {
		t.Fatalf("new turn replaced old entry: %+v", got)
	}
	_ = re.Delete(nu.TurnID)
	re2, _ := OpenTurnJournal(path)
	if got := re2.List(); len(got) != 1 || got[0].TurnID != old.TurnID || !got[0].Interrupted || got[0].LastUserMessage != "old" {
		t.Fatalf("old entry lost: %+v", got)
	}
	res, _ := re2.Begin(TurnJournalEntry{InteractiveKey: "k", SessionKey: "k", ResumedFrom: old.TurnID})
	if got := re2.List(); len(got) != 1 || got[0].TurnID != res.TurnID {
		t.Fatalf("resume did not replace the entry it continues: %+v", got)
	}
}

// journalSnapSession answers every Send with a result and records the journal
// as it stood during that Send. onSend (optional) runs first, with the call index.
type journalSnapSession struct {
	e      *Engine
	events chan Event
	onSend func(i int)
	mu     sync.Mutex
	snaps  [][]TurnJournalEntry
}

func newJournalSnapSession() *journalSnapSession {
	return &journalSnapSession{events: make(chan Event, 8)}
}

func (s *journalSnapSession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	i := len(s.snaps)
	s.snaps = append(s.snaps, s.e.TurnJournal().List())
	s.mu.Unlock()
	if s.onSend != nil {
		s.onSend(i)
	}
	s.events <- Event{Type: EventResult, Content: "done", Done: true}
	return nil
}
func (s *journalSnapSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *journalSnapSession) Events() <-chan Event                             { return s.events }
func (s *journalSnapSession) CurrentSessionID() string                         { return "snap-session" }
func (s *journalSnapSession) Alive() bool                                      { return true }
func (s *journalSnapSession) Close() error                                     { return nil }
func (s *journalSnapSession) ProcessID() int                                   { return 77 }
func (s *journalSnapSession) ProcessGroupID() int                              { return 77 }

func (s *journalSnapSession) snapshots() [][]TurnJournalEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([][]TurnJournalEntry(nil), s.snaps...)
}

func newJournalEngine(t *testing.T, as *journalSnapSession) (*Engine, *stubPlatformEngine) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(t.TempDir())
	as.e = e
	return e, p
}

func journalState(e *Engine, key string) *interactiveState {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	return e.interactiveStates[key]
}

// M2: A then queued B; while B runs (and could be killed) the entry is B's.
func TestTurnJournalChainedQueuedMessageUpdatesEntry(t *testing.T) {
	as := newJournalSnapSession()
	e, p := newJournalEngine(t, as)
	key := "test:chain"
	as.onSend = func(i int) {
		if i != 0 {
			return
		}
		st := journalState(e, key)
		st.mu.Lock()
		st.pendingMessages = append(st.pendingMessages, queuedMessage{platform: p, replyCtx: "rc", content: "task B",
			msgSessionKey: key, msgPlatform: "test", userID: "cron", turnTrigger: TurnTriggerCron})
		st.mu.Unlock()
	}
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("busy")
	}
	e.processInteractiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "task A", ReplyCtx: "rc"}, session)
	snaps := as.snapshots()
	if len(snaps) != 2 {
		t.Fatalf("want 2 sends, got %d", len(snaps))
	}
	if a := snaps[0]; len(a) != 1 || a[0].LastUserMessage != "task A" || a[0].Trigger != TurnTriggerUser {
		t.Fatalf("during A: %+v", a)
	}
	b := snaps[1]
	if len(b) != 1 || b[0].LastUserMessage != "task B" || b[0].Trigger != TurnTriggerCron || b[0].TurnID != snaps[0][0].TurnID ||
		!b[0].StartedAt.After(snaps[0][0].StartedAt) {
		t.Fatalf("during B: %+v (A %+v)", b, snaps[0])
	}
	if got := e.TurnJournal().List(); len(got) != 0 {
		t.Fatalf("entry left: %+v", got)
	}
}

// M3: queue drains that run outside processInteractiveMessageWith (orphaned
// queue, after /compress) write their own entry per message.
func TestTurnJournalDrainPathsRecordQueuedTurns(t *testing.T) {
	for _, path := range []string{"orphaned", "compress"} {
		t.Run(path, func(t *testing.T) {
			as := newJournalSnapSession()
			e, p := newJournalEngine(t, as)
			key := "test:drain-" + path
			session := e.sessions.GetOrCreateActive(key)
			if !session.TryLock() {
				t.Fatal("busy")
			}
			e.processInteractiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "warm up", ReplyCtx: "rc"}, session)
			st := journalState(e, key)
			if st == nil || st.agentSession == nil {
				t.Fatal("no state")
			}
			st.mu.Lock()
			st.pendingMessages = append(st.pendingMessages, queuedMessage{platform: p, replyCtx: "rc", content: "queued C",
				msgSessionKey: key, msgPlatform: "test", userID: "u"})
			st.mu.Unlock()
			if !session.TryLock() {
				t.Fatal("busy after warm-up")
			}
			if path == "orphaned" {
				e.drainOrphanedQueue(session, e.sessions, key, e.agent, "")
			} else {
				unlocked := false
				e.drainQueuedMessagesAfterCompress(st, session, e.sessions, key, &unlocked)
				if !unlocked {
					session.Unlock()
				}
			}
			snaps := as.snapshots()
			if len(snaps) != 2 {
				t.Fatalf("want 2 sends, got %d", len(snaps))
			}
			if c := snaps[1]; len(c) != 1 || c[0].LastUserMessage != "queued C" || c[0].Trigger != TurnTriggerUser || c[0].AgentPID != 77 {
				t.Fatalf("during drained turn: %+v", c)
			}
			if got := e.TurnJournal().List(); len(got) != 0 {
				t.Fatalf("entry left: %+v", got)
			}
		})
	}
}

// gatedAgent blocks StartSession until release is closed (agent cold start).
type gatedAgent struct {
	session AgentSession
	started chan struct{}
	release chan struct{}
}

func (a *gatedAgent) Name() string { return "stub" }
func (a *gatedAgent) StartSession(context.Context, string) (AgentSession, error) {
	close(a.started)
	<-a.release
	return a.session, nil
}
func (a *gatedAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *gatedAgent) Stop() error                                              { return nil }

// M4: the entry is on disk before the agent starts, so a kill during the
// (cold) start still leaves it; pid follows once the agent is up.
func TestTurnJournalEntryWrittenBeforeAgentStart(t *testing.T) {
	as := newJournalSnapSession()
	ag := &gatedAgent{session: as, started: make(chan struct{}), release: make(chan struct{})}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", ag, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(t.TempDir())
	as.e = e
	key := "test:cold"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("busy")
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.processInteractiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "cold", ReplyCtx: "rc"}, session)
	}()
	<-ag.started
	// "Killed" here: a new process reads the file.
	re, _ := OpenTurnJournal(TurnJournalPath(e.dataDir, e.name))
	if got := re.List(); len(got) != 1 || got[0].LastUserMessage != "cold" || got[0].AgentPID != 0 {
		t.Fatalf("entry during agent start: %+v", got)
	}
	close(ag.release)
	<-done
	if snaps := as.snapshots(); len(snaps) != 1 || len(snaps[0]) != 1 || snaps[0][0].AgentPID != 77 || snaps[0][0].AgentSessionID != "snap-session" {
		t.Fatalf("pid not recorded after start: %+v", snaps)
	}
}
