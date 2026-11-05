package core

import (
	"context"
	"sync"
	"testing"
	"time"
)

// User 2026-11-04 13:20「DSH 设置简单/复杂档可直接选模型」: each tier's role reviews on the model
// picked in settings, in a new session; a stand-in role keeps its own model.
func TestTaskReviewTierModels(t *testing.T) {
	SetTeamReviewTiers("deep", "gge")
	SetTeamReviewModels("cheap-model", "strong-model")
	t.Cleanup(func() { SetTeamReviewTiers("", ""); SetTeamReviewModels("", "") })
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "cjiang", "C酱", dir, ts, true)
	gge := reviewPickRole(t, "gge", "G哥", dir, ts, false)
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 501, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, gge, deep} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	// deep is idle, but a chosen model still takes a new session: the channel keeps its model.
	if len(jobs) != 1 || jobs[0].Project != "deep" || jobs[0].Model != "cheap-model" || !jobs[0].UsesNewSessionPerRun() {
		t.Fatalf("simple tier: %+v; want deep on cheap-model in a new session", jobs)
	}
	if p, err := deep.prepareTaskReview(jobs[0], now); err != nil || p == nil || p.Model != "cheap-model" {
		t.Fatalf("prepare dropped the model: %+v, %v", p, err)
	}
	store.MarkFired(jobs[0].ID, nil)
	it.ReviewTier = "complex"
	writeReviewBoard(t, lead, it)
	w.reconcileTaskReviews(now, false)
	var open []*TimerJob
	for _, j := range store.List() {
		if !j.Fired {
			open = append(open, j)
		}
	}
	if len(open) != 1 || open[0].Project != "gge" || open[0].Model != "strong-model" {
		t.Fatalf("complex tier: %+v; want gge on strong-model", open)
	}

	// The tier role is cooling: the stand-in reviews on its own model, not the tier's.
	it2 := teamTaskBoardItem{ID: 502, What: "b", Chat: "room:chat", Who: "工作区2C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, it2)
	deep.recordQuota(now.Add(time.Hour), "room:chat")
	w.reconcileTaskReviews(now, false)
	for _, j := range store.List() {
		if j.ReplyBoard == 502 && (j.Project == "deep" || j.Model != "") {
			t.Fatalf("stand-in review: %+v; want another role on its own model", j)
		}
	}

	// No model chosen: as before, the role's own model and the channel session when idle.
	SetTeamReviewModels("", "")
	if m := taskReviewTierModel(it, "gge"); m != "" {
		t.Fatalf("no model chosen, got %q", m)
	}
}

type modelRecordingAgent struct {
	cujAgent
	mu     sync.Mutex
	models []string
}

func (a *modelRecordingAgent) StartSession(ctx context.Context, id string) (AgentSession, error) {
	s, _ := SessionSettingsFromContext(ctx)
	a.mu.Lock()
	a.models = append(a.models, s.Model)
	a.mu.Unlock()
	return a.cujAgent.StartSession(ctx, id)
}

// waitStarted: the turn may start the agent after ExecuteTimerJob returns.
func (a *modelRecordingAgent) waitStarted(n int) []string {
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if got := a.started(); len(got) >= n {
			return got
		}
	}
	return a.started()
}

func (a *modelRecordingAgent) started() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.models...)
}

// A side turn with TimerJob.Model starts the agent on that model; the channel's next turn does
// not inherit it.
func TestTimerSideTurnModel(t *testing.T) {
	plat := &cujReplyCtxPlatform{stubPlatformEngine: &stubPlatformEngine{n: "test"}}
	agent := &modelRecordingAgent{}
	e := NewEngine("test", agent, []Platform{plat}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	job := &TimerJob{ID: "review-x", Project: "test", SessionKey: "test:chat", Prompt: "verify", SessionMode: "new_per_run", Model: "cheap-model", CreatedAt: time.Now()}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatal(err)
	}
	if got := agent.waitStarted(1); len(got) != 1 || got[0] != "cheap-model" {
		t.Fatalf("side turn started on %v; want [cheap-model]", got)
	}
	plain := &TimerJob{ID: "plain", Project: "test", SessionKey: "test:chat", Prompt: "hi", SessionMode: "new_per_run", CreatedAt: time.Now()}
	if err := e.ExecuteTimerJob(plain); err != nil {
		t.Fatal(err)
	}
	if got := agent.waitStarted(2); len(got) != 2 || got[1] != "" {
		t.Fatalf("next side turn inherited the review model: %v", got)
	}
}
