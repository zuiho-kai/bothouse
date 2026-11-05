package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1119: agentm #13 — 龙娘's reply opened with her persona name「本龙无法承接这份验收」, the refusal
// was not caught, and the only other role (the lead) wrote it, so nobody verified it all night.
func TestIsModelRefusalPersonaOpen(t *testing.T) {
	cases := map[string]bool{
		"本龙无法承接这份验收。结合交接和前面的返修要求，这项工作包含重新运行身份冒用的探针。这属于安全漏洞复现及触发条件验证，超出了本服务允许的防御性工作范围；": true,
		"本小姐不能协助这次验收，这超出了我被允许协助的范围。":         true,
		"这边无法接手：超出了本服务允许的内容范围。":              true,
		"本龙无法承接这份验收，卡在没有隔壁的权限。":              false,
		"龙娘说：本龙无法承接这份验收，超出了本服务允许的防御性工作范围。":   false,
		"[report] #13 背景：本龙无法承接，超出了本服务允许的范围": false,
	}
	for s, want := range cases {
		if got := isModelRefusal(s); got != want {
			t.Errorf("%q: got %v want %v", s, got, want)
		}
	}
}

// The lead wrote #13 and the only other role refused: the lead verifies through a clean-context
// sub-agent; when the lead's channel session refuses too, it retries once in a fresh side session;
// a refusal there leaves nobody (no endless loop).
func TestTaskReviewRefusedLeadCleanRetry(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "jingyu", "鲸鱼娘", dir, ts, true)
	kimi := reviewPickRole(t, "kimi", "龙娘", dir, ts, false)
	engines := []*Engine{lead, kimi}
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 13, What: "p13", Chat: "discord:1567741273895600199", Who: "工作区1鲸鱼娘", Reviewer: "kimi", ReturnedAt: now.Add(-time.Hour)}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return engines }
	scan := func() []*TimerJob { w.reconcileTaskReviews(now, false); return store.List() }

	jobs := scan()
	if len(jobs) != 1 || jobs[0].Project != "kimi" {
		t.Fatalf("first pick: %d jobs, want kimi", len(jobs))
	}
	markFired := func() {
		for _, j := range store.List() {
			store.MarkFired(j.ID, nil)
		}
	}
	markFired()
	recordReviewRefused(dir, it, "kimi")
	jobs = scan()
	var leadJob *TimerJob
	for _, j := range jobs {
		if j.Project == "jingyu" {
			leadJob = j
		}
	}
	if leadJob == nil {
		t.Fatalf("after kimi refused: no lead job (%d jobs)", len(jobs))
	}
	got, err := lead.prepareTaskReview(leadJob, now)
	if err != nil || got == nil || !strings.Contains(got.Prompt, "干净上下文的子 agent") {
		t.Fatalf("lead prompt lacks clean sub-agent line: %v %+v", err, got)
	}
	markFired()
	recordReviewRefused(dir, it, "jingyu") // the lead's channel session refused too
	n := len(store.List())
	jobs = scan()
	if len(jobs) != n+1 {
		t.Fatalf("lead refused: want one clean retry, jobs %d -> %d", n, len(jobs))
	}
	var clean *TimerJob
	for _, j := range jobs {
		if j.TaskReview != nil && j.TaskReview.Stage == taskReviewCleanStage {
			clean = j
		}
	}
	if clean == nil || clean.Project != "jingyu" || !clean.UsesNewSessionPerRun() {
		t.Fatalf("clean retry: %+v", clean)
	}
	if again := scan(); len(again) != len(jobs) {
		t.Fatalf("clean retry queued twice")
	}
	markFired()
	recordReviewRefused(dir, it, "jingyu"+taskReviewCleanMark)
	if after := scan(); len(after) != len(jobs) {
		t.Fatalf("nobody left: still queued a review (%d -> %d)", len(jobs), len(after))
	}
}

// #1116 follow-up: no other free member → the lead takes refused work (busy or not), never itself.
func TestCantDoLeadFallback(t *testing.T) {
	dir := t.TempDir()
	rm := NewRelayManager(dir)
	engines := map[string]*Engine{}
	for _, name := range []string{"orange", "longniang"} {
		p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
		e := NewEngine(name, &stubAgent{}, []Platform{p}, "", LangChinese)
		e.dataDir = dir
		e.team = &teamState{dir: filepath.Join(dir, "team"), name: name, inject: name == "orange", seen: map[string]*teamSession{}}
		os.MkdirAll(e.team.dir, 0700)
		e.SetRelayManager(rm)
		rm.RegisterEngine(name, e)
		e.markPlatformReady(p)
		engines[name] = e
		t.Cleanup(func() { e.cancel(); e.Stop() })
	}
	ws := "discord:ws"
	if got := engines["longniang"].cantDoLead(ws, map[string]bool{"longniang": true}); got != engines["orange"] {
		t.Fatalf("worker refused: lead fallback = %v, want orange", got)
	}
	if got := engines["longniang"].cantDoLead(ws, map[string]bool{"longniang": true, "orange": true}); got != nil {
		t.Fatalf("lead refused too: fallback = %v, want nil", got.name)
	}
	if got := engines["orange"].cantDoLead(ws, nil); got != nil {
		t.Fatalf("the lead itself: fallback = %v, want nil", got.name)
	}
}
