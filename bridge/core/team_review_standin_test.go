package core

import (
	"context"
	"testing"
	"time"
)

// modelListAgent: a stub agent whose backend offers models (ModelSwitcher).
type modelListAgent struct {
	stubAgent
	current string
	models  []string
}

func (a *modelListAgent) SetModel(m string) { a.current = m }
func (a *modelListAgent) GetModel() string  { return a.current }
func (a *modelListAgent) AvailableModels(context.Context) []ModelOption {
	out := make([]ModelOption, len(a.models))
	for i, m := range a.models {
		out[i] = ModelOption{Name: m}
	}
	return out
}

func standInRole(t *testing.T, name, team, dir string, ts *TimerScheduler, lead bool, agent Agent) *Engine {
	t.Helper()
	x := NewEngine(name, agent, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(x.cancel)
	x.dataDir = t.TempDir()
	x.SetTeam(dir, team, lead)
	x.SetTimerScheduler(ts)
	return x
}

func openReviewJob(store *TimerStore, board int) *TimerJob {
	for _, j := range store.List() {
		if j.ReplyBoard == board && !j.Fired && j.TaskReview != nil {
			return j
		}
	}
	return nil
}

// User 2026-11-04「简单的交给便宜模型」: the simple tier's role is cooling; a stand-in whose
// backend offers the tier model reviews on it, else the cheapest role reviews, and the case where
// the model cannot apply is logged for the settings page.
func TestTaskReviewStandInTierModel(t *testing.T) {
	SetTeamReviewTiers("deep", "gge")
	SetTeamReviewModels("cheap-model", "")
	SetTeamReviewPrices(nil)
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { SetTeamReviewTiers("", ""); SetTeamReviewModels("", ""); teamReviewModelNotice.Store(nil) })
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)

	newTeam := func(ggeModels, dbModels []string) (*TimerStore, *handoffWatch, *Engine, []*Engine) {
		dir := t.TempDir()
		store, err := NewTimerStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		ts := NewTimerScheduler(store)
		t.Cleanup(ts.Stop)
		lead := standInRole(t, "cjiang", "C酱", dir, ts, true, &modelListAgent{current: "claude-haiku-5-5"})
		gge := standInRole(t, "gge", "G哥", dir, ts, false, &modelListAgent{current: "claude-opus-5-5", models: ggeModels})
		db := standInRole(t, "doubao", "大豆包", dir, ts, false, &modelListAgent{current: "claude-sonnet-4-6", models: dbModels})
		deep := standInRole(t, "deep", "肥鱼", dir, ts, false, &modelListAgent{current: "cheap-model", models: []string{"cheap-model"}})
		deep.recordQuota(now.Add(624*time.Hour), "room:chat") // the simple tier's role cools
		w := newHandoffWatch(lead)
		w.engines = func() []*Engine { return []*Engine{lead, gge, db, deep} }
		return store, w, lead, []*Engine{lead, gge, db, deep}
	}
	// Author is the lead's workspace, so the lead (cheapest) cannot take it.
	it := teamTaskBoardItem{ID: 601, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now}

	// 1. The pricier gge offers the tier model: it reviews on it, in a new session.
	store, w, lead, _ := newTeam([]string{"cheap-model", "other"}, nil)
	writeReviewBoard(t, lead, it)
	w.reconcileTaskReviews(now, false)
	j := openReviewJob(store, 601)
	if j == nil || j.Project != "gge" || j.Model != "cheap-model" || !j.UsesNewSessionPerRun() {
		t.Fatalf("stand-in with the tier model: %+v; want gge on cheap-model in a new session", j)
	}
	if n := TeamReviewModelNotice(); n != nil {
		t.Fatalf("model applies, yet a notice: %+v", n)
	}

	// 2. Nobody else offers it: the cheapest non-author role (doubao, sonnet < opus) reviews on its
	// own model, and the settings page is told the tier model did not apply.
	store, w, lead, _ = newTeam(nil, nil)
	writeReviewBoard(t, lead, it)
	w.reconcileTaskReviews(now, false)
	j = openReviewJob(store, 601)
	if j == nil || j.Project != "doubao" || j.Model != "" {
		t.Fatalf("no stand-in offers the model: %+v; want doubao (cheapest) on its own model", j)
	}
	if n := TeamReviewModelNotice(); n == nil || n.Board != 601 || n.Model != "cheap-model" || n.Tier != "simple" {
		t.Fatalf("notice: %+v; want board 601 simple cheap-model", n)
	}

	// 3. Complex tier with no model offered elsewhere: the usual pick (designated/least-loaded,
	// idle first), no cost ranking.
	teamReviewModelNotice.Store(nil)
	SetTeamReviewTiers("", "deep")
	store, w, lead, _ = newTeam(nil, nil)
	cx := it
	cx.ID, cx.ReviewTier = 602, "complex"
	writeReviewBoard(t, lead, cx)
	w.reconcileTaskReviews(now, false)
	j = openReviewJob(store, 602)
	if j == nil || j.Project == "deep" || j.Project == "cjiang" || j.Model != "" {
		t.Fatalf("complex stand-in: %+v; want a non-author, non-cooling role on its own model", j)
	}
}

// The tier role itself cannot switch models: the review still goes to it (the user's choice), and
// the ignored model is logged instead of passing silently.
func TestTaskReviewTierModelIgnoredNotice(t *testing.T) {
	SetTeamReviewTiers("deep", "")
	SetTeamReviewModels("cheap-model", "")
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { SetTeamReviewTiers("", ""); SetTeamReviewModels("", ""); teamReviewModelNotice.Store(nil) })
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := standInRole(t, "cjiang", "C酱", dir, ts, true, &stubAgent{})
	deep := standInRole(t, "deep", "肥鱼", dir, ts, false, &stubAgent{})
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 603, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep} }
	w.reconcileTaskReviews(now, false)
	if j := openReviewJob(store, 603); j == nil || j.Project != "deep" {
		t.Fatalf("tier role: %+v", j)
	}
	if n := TeamReviewModelNotice(); n == nil || n.Role != "deep" || n.Reason == "" {
		t.Fatalf("notice: %+v; want deep's model flagged as ignored", n)
	}
}

// At run time a side turn whose agent cannot switch models is logged too.
func TestTurnModelIgnoredAtRun(t *testing.T) {
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { teamReviewModelNotice.Store(nil) })
	job := &TimerJob{ID: "review-y", Model: "cheap-model", TaskReview: &taskReviewRef{Board: 7, Tier: "complex"}}
	noteTurnModelIgnored(job, &modelListAgent{models: []string{"cheap-model"}}, "gge")
	if TeamReviewModelNotice() != nil {
		t.Fatal("an agent offering the model was flagged")
	}
	noteTurnModelIgnored(job, &stubAgent{}, "gge")
	if n := TeamReviewModelNotice(); n == nil || n.Board != 7 || n.Tier != "complex" || n.Model != "cheap-model" {
		t.Fatalf("notice: %+v", n)
	}
}
