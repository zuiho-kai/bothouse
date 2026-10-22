package core

import "testing"

// startCard opens a card on a fresh turn and returns the task id.
func startCard(t *testing.T, p *PublicProgress, platform Platform, session, title string) (string, string) {
	t.Helper()
	run := p.begin(platform, session, LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: run, Seq: 1, Kind: "start", Title: title, Summary: "开始"})
	if err != nil {
		t.Fatal(err)
	}
	return run, id
}

func TestPublicProgress_ContinuationReusesCardAcrossTurns(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}

	run, id := startCard(t, p, platform, "room:one", "改动画")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "改完了"}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	// The next turn offers the open card and the sequence that would continue it.
	next := p.begin(platform, "room:one", LangChinese, nil)
	taskID, resumeSeq, ok := p.runStart(next)
	if !ok || taskID != id || resumeSeq != 3 {
		t.Fatalf("runStart = %q/%d/%v, want %q/3/true", taskID, resumeSeq, ok, id)
	}
	// Continuing means reporting the offered sequence, not starting again.
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: next, Seq: 3, Kind: "milestone", Summary: "再补一版"}); err != nil {
		t.Fatal(err)
	}
	if n := len(p.Tasks("room:one", 10)); n != 1 {
		t.Fatalf("tasks = %d, want the single continued card", n)
	}
	task, ok2 := p.Task(id)
	if !ok2 || task.LatestProgress != "再补一版" {
		t.Fatalf("continued card not updated: %+v", task)
	}
}

// A new request in the same session is new work: it must open its own card and
// never silently overwrite the previous one.
func TestPublicProgress_NewStartInSameSessionOpensNewCard(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run, id := startCard(t, p, platform, "room:one", "第一个任务")
	p.finish(run, "result")

	next, id2 := startCard(t, p, platform, "room:one", "第二个任务")
	if id2 == id {
		t.Fatal("a new start reused the open card")
	}
	p.finish(next, "result")
	if n := len(p.Tasks("room:one", 10)); n != 2 {
		t.Fatalf("tasks = %d, want 2 cards", n)
	}
	// The newest card is the one a later turn continues.
	third := p.begin(platform, "room:one", LangChinese, nil)
	if taskID, resumeSeq, ok := p.runStart(third); !ok || taskID != id2 || resumeSeq != 2 {
		t.Fatalf("runStart = %q/%d/%v, want %q/2/true", taskID, resumeSeq, ok, id2)
	}
}

func TestPublicProgress_AcceptClosesCardAndNextTurnStartsNew(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run, id := startCard(t, p, platform, "room:one", "改动画")

	// A turn that has not delivered a result cannot be accepted.
	if _, err := p.Accept(id, "主人"); err == nil {
		t.Fatal("accepted an in-progress task")
	}
	if _, err := p.Accept(id, ""); err == nil {
		t.Fatal("accepted without naming the human")
	}

	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "改完了"}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	task, err := p.Accept(id, "主人")
	if err != nil {
		t.Fatal(err)
	}
	if task.State != TaskStateCompleted || task.FactStage != FactStageVerified {
		t.Fatalf("state=%q fact=%q, want completed/verified", task.State, task.FactStage)
	}
	if again, err := p.Accept(id, "主人"); err != nil || again.State != TaskStateCompleted {
		t.Fatalf("second acceptance not idempotent: %v %v", again, err)
	}

	// An accepted card is closed for good: the session offers nothing to continue.
	next := p.begin(platform, "room:one", LangChinese, nil)
	if taskID, _, ok := p.runStart(next); ok {
		t.Fatalf("accepted card still offered for continuation: %q", taskID)
	}
	if _, id2 := startCard(t, p, platform, "room:one", "下一件事"); id2 == id {
		t.Fatal("accepted card reused")
	}
	if n := len(p.Tasks("room:one", 10)); n != 2 {
		t.Fatalf("tasks = %d, want 2 cards", n)
	}
}

func TestPublicProgress_TaskQueryReportsOnlyPublicState(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run, id := startCard(t, p, platform, "room:one", "查进度")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "waiting", Summary: "等你决定"}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	task, ok := p.Task(id)
	if !ok {
		t.Fatal("task not found")
	}
	if task.State != TaskStateWaitingUser || task.Title != "查进度" {
		t.Fatalf("state=%q title=%q", task.State, task.Title)
	}
	if _, ok := p.Task("task-missing"); ok {
		t.Fatal("unknown task reported as found")
	}
	if other := p.Tasks("room:two", 10); len(other) != 0 {
		t.Fatalf("session filter leaked %d tasks", len(other))
	}
	if limited := p.Tasks("", 1); len(limited) != 1 {
		t.Fatalf("limit ignored: %d", len(limited))
	}
}

// A card that already delivered its result stays open on purpose: a turn result
// is not the owner's acceptance. The next turn is still offered that card, so the
// resume hint has to say which card it is and what state it reached. Without the
// state an agent doing unrelated new work reads the hint as "continue this card"
// and the owner never gets a card for the new task.
func TestPublicProgress_ResumeHintCarriesCardStateAndTitle(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}

	run, id := startCard(t, p, platform, "room:one", "复核私有房间隔离")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "复核完了"}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	next := p.begin(platform, "room:one", LangChinese, nil)
	taskID, resumeSeq, state, title, ok := p.resumeHint(next)
	if !ok || taskID != id || resumeSeq != 3 {
		t.Fatalf("resumeHint = %q/%d/%v, want %q/3/true", taskID, resumeSeq, ok, id)
	}
	if state != TaskStateResultReady {
		t.Fatalf("resumeHint state = %q, want %q so the hint can say the card already delivered", state, TaskStateResultReady)
	}
	if title != "复核私有房间隔离" {
		t.Fatalf("resumeHint title = %q, want the open card title", title)
	}

	// Acceptance is terminal: there is nothing left to continue.
	if _, err := p.Accept(id, "主人"); err != nil {
		t.Fatal(err)
	}
	third := p.begin(platform, "room:one", LangChinese, nil)
	if _, _, _, _, ok := p.resumeHint(third); ok {
		t.Fatal("an accepted card was still offered for continuation")
	}
}
