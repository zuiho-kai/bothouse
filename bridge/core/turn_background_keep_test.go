package core

import (
	"strings"
	"testing"
	"time"
)

// #1894: a process kept for background work leaves a restart record that a new
// bridge reads and turns into a wake-up for the session; a normal close removes it.
func TestTurnEnd_BackgroundKeepLeavesRestartRecord(t *testing.T) {
	base := &turnLifetimeAgent{background: 1}
	agent := strictTurnLifetimeAgent{base}
	e := newTurnLifetimeEngine(t, agent)
	e.dataDir = t.TempDir()
	key := "test:chat:u1"
	runTurnLifetimeTurn(t, e, agent, key)

	var bg []TurnJournalEntry
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		bg = backgroundEntries(e.turnJournalStore(), key)
		if len(bg) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(bg) != 1 {
		t.Fatalf("background keep left %d restart records, want 1", len(bg))
	}
	if bg[0].SessionKey != key || bg[0].Platform != "test" || bg[0].LastUserMessage == "" || bg[0].BackgroundWork == "" {
		t.Fatalf("restart record lacks the chat routing: %+v", bg[0])
	}

	// A new bridge reads the record and resumes it with the background wording.
	j2, err := OpenTurnJournal(TurnJournalPath(e.dataDir, e.name))
	if err != nil {
		t.Fatal(err)
	}
	plans := planTurnResumes(j2.Inherited(), turnResumeEnv{now: time.Now(), startTime: time.Now()})
	if len(plans) != 1 || plans[0].action != turnResumeDeliver {
		t.Fatalf("restart record not resumed: %+v", plans)
	}
	if p := buildTurnResumePrompt(plans[0].entry, false); !strings.Contains(p, "桥重启停掉了后台活") || !strings.Contains(p, bg[0].BackgroundWork) {
		t.Fatalf("wake-up text does not name the stopped background work: %q", p)
	}

	// The work reports back and the process closes: the record goes.
	_, sessions := base.snapshot()
	sessions[0].background.Store(0)
	sessions[0].events <- Event{Type: EventResult, Content: "background finished", Done: true}
	waitForInteractiveStateRemoved(t, e, key)
	if n := len(backgroundEntries(e.turnJournalStore(), key)); n != 0 {
		t.Fatalf("closed process left %d restart records", n)
	}
}

func TestPlanTurnResumes_BackgroundRecordFoldedKeepsItsWork(t *testing.T) {
	now := time.Now()
	bg := TurnJournalEntry{TurnID: "bg", Kind: TurnKindTurn, InteractiveKey: "k", SessionKey: "k",
		LastUserMessage: "派 Fable 查定位", BackgroundWork: "子 agent「定位方案」", StartedAt: now.Add(-3 * time.Minute)}
	turn := TurnJournalEntry{TurnID: "t", Kind: TurnKindTurn, InteractiveKey: "k", SessionKey: "k",
		LastUserMessage: "什么进度", StartedAt: now.Add(-time.Minute), Interrupted: true}
	plans := planTurnResumes([]TurnJournalEntry{bg, turn}, turnResumeEnv{now: now, startTime: now})
	var deliver *turnResumePlan
	for i := range plans {
		if plans[i].action == turnResumeDeliver {
			deliver = &plans[i]
		}
	}
	if deliver == nil || deliver.entry.TurnID != "t" {
		t.Fatalf("newest turn not delivered: %+v", plans)
	}
	p := buildTurnResumePrompt(deliver.entry, false)
	if !strings.Contains(p, "子 agent「定位方案」") {
		t.Fatalf("folded background record lost its work: %q", p)
	}
}

func backgroundEntries(j *TurnJournal, key string) []TurnJournalEntry {
	if j == nil {
		return nil
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []TurnJournalEntry
	for _, en := range j.entries {
		if en.InteractiveKey == key && en.BackgroundWork != "" {
			out = append(out, *en)
		}
	}
	return out
}
