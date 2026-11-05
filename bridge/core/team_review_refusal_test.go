package core

import (
	"testing"
	"time"
)

// #1109: the only non-author refused; the lead verifies its own work instead of leaving it hanging.
func TestTaskReviewRefusedFallsBackToLead(t *testing.T) {
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
	it := teamTaskBoardItem{ID: 5, What: "p1", Chat: "discord:1567741273895600199", Who: "工作区2鲸鱼娘", Reviewer: "jingyu", ReviewTier: "complex", ReturnedAt: now.Add(-time.Hour)}
	writeReviewBoard(t, lead, it)
	recordReviewRefused(dir, it, "kimi")
	for _, b := range readTeamTaskBoard(lead.team.dir) {
		t.Logf("board %d key %s refused=%v file=%v", b.ID, reviewRefusedKey(b), taskReviewRefusedBy(lead.team.dir, b, "kimi"), readReviewRefused(dir))
	}
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return engines }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "jingyu" {
		for _, j := range jobs {
			t.Logf("job %s %s", j.Project, j.Description)
		}
		t.Fatalf("jobs = %d, want one for the lead", len(jobs))
	}
}

func TestIsModelRefusal(t *testing.T) {
	cases := map[string]bool{
		"我无法继续这次验收，因为它包含对已确认的身份与权限漏洞进行复现和回归验证。这类操作超出了本服务允许的协助范围；": true,
		"I can't help with that because it is against my usage policies.": true,
		"龙娘拒答了，她说我无法继续，超出了本服务允许的协助范围。":                                    false,
		"我无法继续，卡在上游权限。":                                                   false,
		"[report] #5 背景：我无法继续，超出了本服务允许的协助范围":                              false,
	}
	for s, want := range cases {
		if got := isModelRefusal(s); got != want {
			t.Errorf("%q: got %v want %v", s, got, want)
		}
	}
}
