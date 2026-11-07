package core

// 来源：交接 /Users/xinyangzhai/agents-demo/notes/review126-deep-resume-20261104.md:31-33
// 两处待核实阻断；以及 PR980 描述「模型会被静默忽略时：slog.Warn + 设置页显示最近一次」。
// 本文件用 go test -overlay 注入固定头工作树，不落任何产品源码。

import (
	"testing"
	"time"
)

// fyComplexSetup：复杂档角色（deep）冷却，设置复杂档模型；其余非作者角色都不提供该模型。
func fyComplexSetup(t *testing.T, tier string, models []string) (*TimerStore, []*Engine) {
	t.Helper()
	SetTeamReviewTiers("deep", "deep") // 只登记一只档角色，两档都指向它，便于同套件对照
	SetTeamReviewModels("chosen-simple-model", "chosen-complex-model")
	SetTeamReviewPrices(nil)
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() {
		SetTeamReviewTiers("", "")
		SetTeamReviewModels("", "")
		SetTeamReviewPrices(nil)
		teamReviewModelNotice.Store(nil)
	})
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	t.Cleanup(ts.Stop)
	lead := standInRole(t, "cjiang", "C酱", dir, ts, true, &modelListAgent{current: "cheap"})
	deep := standInRole(t, "deep", "肥鱼", dir, ts, false, &modelListAgent{current: "chosen-complex-model", models: []string{"chosen-complex-model"}})
	other := standInRole(t, "doubao", "大豆包", dir, ts, false, &modelListAgent{current: "other-model", models: models})
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	deep.recordQuota(now.Add(600*time.Hour), "room:chat") // 档角色冷却，只能代审
	it := teamTaskBoardItem{ID: 980, What: "verify", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now, ReviewTier: tier}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep, other} }
	w.reconcileTaskReviews(now, false)
	return store, []*Engine{lead, deep, other}
}

// 复杂档：选了模型、没人能用，必须留提示；不能因为沿用原选人策略就静默丢模型。
func TestFY126_ComplexTierSilentModelDrop(t *testing.T) {
	store, _ := fyComplexSetup(t, "complex", nil)
	j := openReviewJob(store, 980)
	if j == nil {
		t.Fatal("复杂档没人能代审？用例前提不成立")
	}
	n := TeamReviewModelNotice()
	if j.Model == "" && n == nil {
		t.Fatalf("复杂档所选模型被静默放弃：role=%s model=%q notice=nil", j.Project, j.Model)
	}
	if n != nil && (n.Tier != "complex" || n.Model != "chosen-complex-model") {
		t.Fatalf("提示内容不对：%+v", n)
	}
}

// 对照：同一套件走简单档时提示能出现，证明上面的观察不是用例本身失灵。
func TestFY126_SimpleTierNoticeControl(t *testing.T) {
	store, _ := fyComplexSetup(t, "", nil)
	j := openReviewJob(store, 980)
	if j == nil {
		t.Fatal("简单档没人能代审？用例前提不成立")
	}
	if n := TeamReviewModelNotice(); n == nil || n.Tier != "simple" || n.Model != "chosen-simple-model" {
		t.Fatalf("简单档对照组同样没有提示，用例失灵：job=%+v notice=%+v", j, n)
	}
}

// 执行时：后端仍实现 ModelSwitcher，但模型列表里没有所选模型（ACP 的 applyModel 此时只记适配器
// 日志后继续），必须按「当前实际 Agent」判断并出提示。
func TestFY126_RunTimeModelNotInBackendList(t *testing.T) {
	SetTeamReviewPrices(nil)
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { teamReviewModelNotice.Store(nil) })
	job := &TimerJob{ID: "fy126-run", Model: "chosen-complex-model", TaskReview: &taskReviewRef{Board: 980, Tier: "complex"}}
	backend := &modelListAgent{current: "other-model", models: []string{"other-model"}}
	noteTurnModelIgnored(job, backend, "standin")
	if n := TeamReviewModelNotice(); n == nil || n.Model != job.Model {
		t.Fatalf("执行时后端列表没有所选模型却没有提示：notice=%+v", n)
	}
}

// 反向对照：后端确实提供该模型时不该误报。
func TestFY126_RunTimeModelSupportedNoNotice(t *testing.T) {
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() { teamReviewModelNotice.Store(nil) })
	job := &TimerJob{ID: "fy126-run-ok", Model: "chosen-complex-model", TaskReview: &taskReviewRef{Board: 980}}
	backend := &modelListAgent{current: "chosen-complex-model", models: []string{"chosen-complex-model"}}
	noteTurnModelIgnored(job, backend, "standin")
	if n := TeamReviewModelNotice(); n != nil {
		t.Fatalf("能用的模型被误报：%+v", n)
	}
}

// 整点汇总复核（roundup）：肥鱼复核非阻断①问它是否纳入提示范围。作者明确为有意边界——汇总保留
// 频道会话、按该会话模型跑，不带档模型（保留会话与换模型互斥），不算静默忽略。本用例锁住这条边界。
func TestFY126_RoundupKeepsChannelSession(t *testing.T) {
	SetTeamReviewTiers("deep", "deep")
	SetTeamReviewModels("roundup-model", "")
	SetTeamReviewPrices(nil)
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() {
		SetTeamReviewTiers("", "")
		SetTeamReviewModels("", "")
		teamReviewModelNotice.Store(nil)
	})
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	t.Cleanup(ts.Stop)
	lead := standInRole(t, "cjiang", "C酱", dir, ts, true, &modelListAgent{current: "cheap"})
	deep := standInRole(t, "deep", "肥鱼", dir, ts, false, &modelListAgent{current: "own", models: []string{"own", "roundup-model"}})
	// 用将来的整点，避免测试进程里真的把已排队任务跑到执行分支（那会和本用例读写同一 job 竞争）。
	now := time.Now().Add(2 * time.Hour).Truncate(time.Hour).Add(30 * time.Minute)
	it := teamTaskBoardItem{ID: 981, What: "verify", Chat: "room:chat", Who: "工作区1C酱", ReturnedAt: now}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep} }
	w.reconcileTaskReviews(now, false)
	first := openReviewJob(store, 981)
	if first == nil || first.Model != "roundup-model" {
		t.Fatalf("首轮审核任务应带档模型：%+v", first)
	}
	// 该任务已经跑过一轮，下一小时走整点汇总。
	first.Fired, first.ScheduledAt = true, now.Add(-2*time.Hour)
	w.reconcileTaskReviews(now, true)
	var roundup *TimerJob
	for _, j := range store.List() {
		if j.TaskReview != nil && j.TaskReview.Stage == "roundup" {
			roundup = j
		}
	}
	if roundup == nil {
		for _, j := range store.List() {
			t.Logf("job %s board=%d fired=%v model=%q stage=%v", j.ID, j.ReplyBoard, j.Fired, j.Model, j.TaskReview)
		}
		t.Fatal("没有生成整点汇总任务？用例前提不成立")
	}
	// 作者按复核意见③明确：整点汇总保留频道会话、按该会话模型跑，不换档模型，也不算静默忽略
	// （team_task_review.go taskReviewSessionAtRun 注释）。锁住这条边界。
	if roundup.Model != "" || roundup.SessionMode == "new_per_run" {
		t.Fatalf("整点汇总应保留频道会话、不带档模型：model=%q mode=%q", roundup.Model, roundup.SessionMode)
	}
}

// 同一类静默丢弃的另一个入口：设置里只留了档模型、档角色被清空（模型下拉随角色隐藏，但已存的值仍在）。
// 这时根本不走 rankTaskReviewStandIns，pool 直选后 taskReviewModelFor 返回空，也没有任何提示。
func TestFY126_NoTierRoleStillSilent(t *testing.T) {
	SetTeamReviewTiers("", "")
	SetTeamReviewModels("leftover-model", "")
	SetTeamReviewPrices(nil)
	teamReviewModelNotice.Store(nil)
	t.Cleanup(func() {
		SetTeamReviewTiers("", "")
		SetTeamReviewModels("", "")
		teamReviewModelNotice.Store(nil)
	})
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	t.Cleanup(ts.Stop)
	lead := standInRole(t, "cjiang", "C酱", dir, ts, true, &modelListAgent{current: "cheap"})
	deep := standInRole(t, "deep", "肥鱼", dir, ts, false, &modelListAgent{current: "own", models: []string{"own"}})
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 982, What: "verify", Chat: "room:chat", Who: "工作区1C酱", ReturnedAt: now}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep} }
	w.reconcileTaskReviews(now, false)
	j := openReviewJob(store, 982)
	if j == nil {
		t.Fatal("没派审核？用例前提不成立")
	}
	if j.Model == "" && TeamReviewModelNotice() == nil {
		t.Fatalf("档角色为空但档模型非空时同样静默丢弃：role=%s model=%q notice=nil", j.Project, j.Model)
	}
}
