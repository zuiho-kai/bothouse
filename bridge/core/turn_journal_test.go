package core

import (
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
	if err := j.Delete("discord:1", "other"); err != nil || len(j.List()) != 1 {
		t.Fatalf("stale delete removed entry: %v", err)
	}
	if err := j.Delete("discord:1", en.TurnID); err != nil {
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
	ok, err := re.Mark("k")
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
	id := e.journalTurnBegin(msg, "test:1", "", nil, nil)
	if id == "" {
		t.Fatal("no turn id")
	}
	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()
	e.journalTurnEnd("test:1", id)
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
