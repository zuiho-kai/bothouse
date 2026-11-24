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

// #1921: a held report wakes the lead and also the session that handed the work out.
func TestHeldReportWakesDispatcher(t *testing.T) {
	e, p, leadStore, item := heldFixture(t)
	cstore, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(cstore)
	e.cronScheduler = cs
	dstore, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d := &Engine{name: "disp", timerScheduler: NewTimerScheduler(dstore)}
	t.Cleanup(d.timerScheduler.Stop)
	cs.RegisterEngine(e.name, e)
	cs.RegisterEngine("disp", d)
	if err := cs.AddJob(&CronJob{ID: "onrep", Project: "gone", SessionKey: "discord:c", Event: EventWorkspaceReport,
		Match: map[string]string{"board": "46"}, Prompt: "x", Enabled: true, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	item.Dispatcher = "disp"
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	if n := len(leadStore.List()); n != 1 {
		t.Fatalf("lead wakes = %d", n)
	}
	jobs := dstore.List()
	if len(jobs) != 1 {
		t.Fatalf("dispatcher wakes = %d", len(jobs))
	}
	if jobs[0].SessionKey != "discord:chat1" || jobs[0].Project != "disp" || !jobs[0].InjectIfBusy {
		t.Fatalf("dispatcher wake target = %+v", jobs[0])
	}
	for _, want := range []string{"#46", "交回已送主角色 " + e.name, "改好了，已上线"} {
		if !strings.Contains(jobs[0].Prompt, want) {
			t.Fatalf("dispatcher prompt misses %q:\n%s", want, jobs[0].Prompt)
		}
	}
	cs.runs.Wait()
	if cstore.Get("onrep").LastRun.IsZero() {
		t.Fatal("workspace.report event job did not run")
	}
}

// The dispatcher is the lead: the lead's acceptance wake is the only one.
func TestHeldReportDispatcherIsLead(t *testing.T) {
	e, p, leadStore, item := heldFixture(t)
	cstore, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(cstore)
	e.cronScheduler = cs
	cs.RegisterEngine(e.name, e)
	item.Dispatcher = e.name
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	if n := len(leadStore.List()); n != 1 {
		t.Fatalf("lead wakes = %d, want 1", n)
	}
}
