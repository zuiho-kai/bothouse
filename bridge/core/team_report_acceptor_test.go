package core

import (
	"os"
	"strings"
	"testing"
)

// User 11-24 「验收权跟派活人走」: a workspace report is held for the dispatcher on the board row and
// wakes that role, not the configured lead (#1921 reached only the lead twice).
func TestHeldReportGoesToDispatcher(t *testing.T) {
	e, p, leadStore, item := heldFixture(t)
	dstore, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d := &Engine{name: "disp", platformReady: map[Platform]bool{p: true}, timerScheduler: NewTimerScheduler(dstore)}
	t.Cleanup(d.timerScheduler.Stop)
	rm := NewRelayManager(t.TempDir())
	rm.RegisterEngine(e.name, e)
	rm.RegisterEngine(d.name, d)
	e.relayManager, d.relayManager = rm, rm
	item.Dispatcher = "disp"
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	if n := len(leadStore.List()); n != 0 {
		t.Fatalf("lead woken %d times; acceptance belongs to the dispatcher", n)
	}
	jobs := dstore.List()
	if len(jobs) != 1 || jobs[0].Project != "disp" || jobs[0].SessionKey != "discord:chat1" {
		t.Fatalf("dispatcher wakes = %+v", jobs)
	}
	if !strings.Contains(jobs[0].Prompt, "验收归派活人") || !strings.Contains(jobs[0].Prompt, "ws-pass --id 46") {
		t.Fatalf("dispatcher prompt:\n%s", jobs[0].Prompt)
	}
	if d.heldReportFor(46) == nil || e.heldReportFor(46) != nil {
		t.Fatal("held record not kept on the dispatcher")
	}
	if !e.reportHeldForLead("discord", 46) {
		t.Fatal("reportHeldForLead does not see the dispatcher's hold")
	}
}

// No dispatcher on the row, or one not running here: the lead accepts, as before.
func TestHeldReportDispatcherMissingFallsBackToLead(t *testing.T) {
	e, p, leadStore, item := heldFixture(t)
	item.Dispatcher = "nobody"
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	if n := len(leadStore.List()); n != 1 {
		t.Fatalf("lead wakes = %d, want 1", n)
	}
	if strings.Contains(leadStore.List()[0].Prompt, "验收归派活人") {
		t.Fatal("lead prompt says the dispatcher accepts")
	}
}

// User 11-25 「为什么没有给我交回这个频道？」: #1139 was dispatched by 大豆包 and done in its own
// workspace, so its report woke 大豆包 to accept itself. The writer never accepts its own report;
// the lead does, and the lookups from either engine find that hold.
func TestHeldReportDispatcherIsWriterGoesToLead(t *testing.T) {
	e, p, writerStore, item := heldFixture(t)
	lstore, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	l := &Engine{name: "lead", ctx: e.ctx, platformReady: map[Platform]bool{p: true}, timerScheduler: NewTimerScheduler(lstore)}
	t.Cleanup(l.timerScheduler.Stop)
	l.SetTeam(t.TempDir(), "主角色", true)
	rm := NewRelayManager(t.TempDir())
	rm.RegisterEngine(e.name, e)
	rm.RegisterEngine(l.name, l)
	e.relayManager, l.relayManager = rm, rm
	if e.dataDir == "" {
		e.dataDir = t.TempDir()
	}
	l.dataDir = e.dataDir
	if err := os.WriteFile(e.leadStatePath(), []byte(`{"lead":"lead"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if e.isTeamLead() || !l.isTeamLead() {
		t.Fatalf("fixture: writer lead=%v, lead lead=%v", e.isTeamLead(), l.isTeamLead())
	}
	item.Dispatcher = e.name
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	if n := len(writerStore.List()); n != 0 {
		t.Fatalf("writer woken %d times to accept its own report", n)
	}
	jobs := lstore.List()
	if len(jobs) != 1 || jobs[0].Project != "lead" || jobs[0].SessionKey != "discord:chat1" {
		t.Fatalf("lead wakes = %+v", jobs)
	}
	if strings.Contains(jobs[0].Prompt, "验收归派活人") {
		t.Fatalf("lead prompt says the dispatcher accepts:\n%s", jobs[0].Prompt)
	}
	if l.heldReportFor(46) == nil || e.heldReportFor(46) != nil {
		t.Fatal("held record not kept on the lead")
	}
	if !e.reportHeldForLead("discord", 46) || !l.reportHeldForLead("discord", 46) {
		t.Fatal("reportHeldForLead misses the lead's hold")
	}
	if l.heldReportThisRound("discord", *item) == nil {
		t.Fatal("the lead's handoff lines miss the hold")
	}
}
