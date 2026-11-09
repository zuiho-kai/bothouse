package core

import (
	"testing"
	"time"
)

// Source: the handoff requires an ignored tier model to be visible in logs/DSH,
// including complex reviews; complex fallback must retain its existing selection policy.
func TestReview980_ComplexStandInModelFallbackNotice(t *testing.T) {
	SetTeamReviewTiers("", "deep")
	SetTeamReviewModels("", "selected-complex-model")
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() {
		SetTeamReviewTiers("", "")
		SetTeamReviewModels("", "")
		teamReviewModelNotice.Store(nil)
	})
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	t.Cleanup(ts.Stop)
	dir := t.TempDir()
	author := standInRole(t, "author", "Author", dir, ts, true, &stubAgent{})
	deep := standInRole(t, "deep", "Deep", dir, ts, false, &modelListAgent{current: "selected-complex-model"})
	standin := standInRole(t, "standin", "StandIn", dir, ts, false, &modelListAgent{current: "other-model", models: []string{"other-model"}})
	now := time.Now().Add(time.Hour)
	deep.recordQuota(now.Add(time.Hour), "room:chat")
	it := teamTaskBoardItem{ID: 980, What: "verify", Chat: "room:chat", Who: "Author", Reviewer: "author", ReturnedAt: now, ReviewTier: "complex"}
	writeReviewBoard(t, author, it)
	w := newHandoffWatch(author)
	w.engines = func() []*Engine { return []*Engine{author, deep, standin} }
	w.reconcileTaskReviews(now, false)
	j := openReviewJob(store, it.ID)
	if j == nil || j.Project != "standin" || j.Model != "" {
		t.Fatalf("unexpected fallback job: %+v", j)
	}
	if n := TeamReviewModelNotice(); n == nil || n.Board != it.ID || n.Tier != "complex" || n.Model != "selected-complex-model" {
		t.Fatalf("complex model silently replaced: job role=%s model=%q; notice=%+v", j.Project, j.Model, n)
	}
}

// Source: the handoff and implementation comment promise another capability check
// when the queued review starts, including when the backend has changed.
func TestReview980_RunChecksSelectedModel(t *testing.T) {
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { teamReviewModelNotice.Store(nil) })
	job := &TimerJob{ID: "review-980", Model: "selected-model", TaskReview: &taskReviewRef{Board: 980}}
	changedBackend := &modelListAgent{current: "other-model", models: []string{"other-model"}}
	noteTurnModelIgnored(job, changedBackend, "standin")
	if n := TeamReviewModelNotice(); n == nil || n.Model != job.Model {
		t.Fatalf("run-time model absent from backend list went unreported: notice=%+v", n)
	}
}

// Source: fallback must use the existing configurable usage price table and the
// model selected in the source channel, rather than only the agent default.
func TestReview980_ConfiguredPricesAndChannelModel(t *testing.T) {
	SetTeamReviewPrices(map[string]TokenPrice{
		"low":  {Input: 1, Output: 1},
		"high": {Input: 10, Output: 10},
	})
	SetTeamReviewModels("", "")
	t.Cleanup(func() { SetTeamReviewPrices(nil); SetTeamReviewModels("", "") })
	a := NewEngine("a", &modelListAgent{current: "high"}, reviewTestPlatforms(), "", LangChinese)
	b := NewEngine("b", &modelListAgent{current: "low"}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(a.cancel)
	t.Cleanup(b.cancel)
	a.SetSessionModels(map[string]string{"room:chat": "low"})
	b.SetSessionModels(map[string]string{"room:chat": "high"})
	pool := []*Engine{b, a}
	if !rankTaskReviewStandIns(teamTaskBoardItem{}, pool, "room:chat") || pool[0] != a {
		t.Fatal("fallback did not choose the cheaper configured channel model")
	}
}
