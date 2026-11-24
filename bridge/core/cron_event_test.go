package core

import (
	"strings"
	"testing"
	"time"
)

func TestEventJobLivesInCronStoreWithoutSchedule(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(store)
	job := &CronJob{ID: "ev1", Project: "p", SessionKey: "discord:c", Event: "workspace.report",
		Match: map[string]string{"board": "46"}, Prompt: "看交回", Enabled: true, CreatedAt: time.Now()}
	if err := cs.AddJob(job); err != nil {
		t.Fatalf("event job refused: %v", err)
	}
	if _, scheduled := cs.entries["ev1"]; scheduled {
		t.Fatal("event job was put on the clock")
	}
	both := *job
	both.ID, both.CronExpr = "ev2", "0 9 * * *"
	if err := cs.AddJob(&both); err == nil {
		t.Fatal("job with both a schedule and an event accepted")
	}
	if err := cs.UpdateJob("ev1", "match", "board=47, dispatcher=maomao"); err != nil {
		t.Fatal(err)
	}
	if m := store.Get("ev1").Match; m["board"] != "47" || m["dispatcher"] != "maomao" {
		t.Fatalf("match edit = %v", m)
	}
	if err := cs.UpdateJob("ev1", "enabled", true); err != nil {
		t.Fatal(err)
	}
	if _, scheduled := cs.entries["ev1"]; scheduled {
		t.Fatal("re-enabling put the event job on the clock")
	}
}

func TestEventJobMatches(t *testing.T) {
	j := &CronJob{Event: "member.*", Match: map[string]string{"guild": "Home"}}
	if !eventJobMatches(j, TriggerEvent{Name: "member.join", Fields: map[string]string{"guild": "home"}}) {
		t.Fatal("group pattern with matching field missed")
	}
	if eventJobMatches(j, TriggerEvent{Name: "member.join", Fields: map[string]string{"guild": "other"}}) {
		t.Fatal("field mismatch matched")
	}
	if eventJobMatches(j, TriggerEvent{Name: "message.received", Fields: map[string]string{"guild": "home"}}) {
		t.Fatal("other event matched")
	}
	b := eventPromptBlock(TriggerEvent{Name: "bgrun.exit", Fields: map[string]string{"exit": "0", "id": "x"}, Text: "done"})
	if b != "【事件 bgrun.exit】 exit=0 id=x\ndone" {
		t.Fatalf("prompt block = %q", b)
	}
}

// FireEvent runs a matching enabled event job (here its project is missing, so the run records
// that error) and leaves the others alone.
func TestFireEventRunsMatchingJobs(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(store)
	add := func(id, ev string, match map[string]string, enabled bool) {
		if err := cs.AddJob(&CronJob{ID: id, Project: "gone", SessionKey: "discord:c", Event: ev, Match: match,
			Prompt: "x", Enabled: enabled, CreatedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	add("hit", "bgrun.exit", map[string]string{"id": "r1"}, true)
	add("other", "bgrun.exit", map[string]string{"id": "r2"}, true)
	add("off", "bgrun.exit", nil, false)
	if n := cs.FireEvent(TriggerEvent{Name: "bgrun.exit", Fields: map[string]string{"id": "r1"}}); n != 1 {
		t.Fatalf("started %d jobs, want 1", n)
	}
	cs.runs.Wait()
	if j := store.Get("hit"); j.LastRun.IsZero() || !strings.Contains(j.LastError, "gone") {
		t.Fatalf("matching job did not run: %+v", j)
	}
	if !store.Get("other").LastRun.IsZero() || !store.Get("off").LastRun.IsZero() {
		t.Fatal("non-matching or disabled job ran")
	}
}

// A held report fires workspace.report: an event job matching its board runs, and the event names
// who accepts it.
func TestHeldReportFiresWorkspaceReport(t *testing.T) {
	e, p, _, item := heldFixture(t)
	cstore, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(cstore)
	e.cronScheduler = cs
	cs.RegisterEngine(e.name, e)
	if err := cs.AddJob(&CronJob{ID: "onrep", Project: "gone", SessionKey: "discord:c", Event: EventWorkspaceReport,
		Match: map[string]string{"board": "46", "acceptor": e.name}, Prompt: "x", Enabled: true, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	holdForTest(t, e, p, item, "")
	cs.runs.Wait()
	if cstore.Get("onrep").LastRun.IsZero() {
		t.Fatal("workspace.report event job did not run")
	}
}
