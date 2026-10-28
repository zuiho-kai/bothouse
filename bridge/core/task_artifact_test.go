package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// journalModel is a platform without task cards: exactly the QQ-like case this
// product needs. Tasks are recorded, nothing is claimed as delivered.
func journalModel(t *testing.T, dir, project string) (*PublicProgress, *stubPlatformEngine) {
	t.Helper()
	platform := &stubPlatformEngine{n: "plain"}
	p, err := NewPublicProgress(dir, project, []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	p.workspaceChat = func(string) bool { return false }
	return p, platform
}

func startTask(t *testing.T, p *PublicProgress, platform *stubPlatformEngine, session, title string) (string, string) {
	t.Helper()
	run := p.begin(platform, session, LangEnglish, nil)
	if run == "" {
		t.Fatal("platform without cards cannot record a task")
	}
	req := PublicProgressRequest{Project: p.project, SessionKey: session, Run: run, Seq: 1, Kind: "start", Title: title, Summary: "accepted"}
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	return run, id
}

// TestTaskArtifactAndRework covers the first product loop: submit material or
// a request, link it to one task, query it, attach an output and rework that
// named revision without losing history or faking acceptance.
func TestTaskArtifactAndRework(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	session := "plain:room:user"
	run, id := startTask(t, p, platform, session, "封面")

	input, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "input", Kind: "image", Label: "用户原图", Ref: "https://example.test/original.png"})
	if err != nil {
		t.Fatal(err)
	}
	if input.Role != TaskArtifactInput || input.Revision != 1 || input.ID == "" {
		t.Fatalf("unexpected input artifact: %+v", input)
	}
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "初稿", Ref: "/tmp/cover-v1.png", Summary: "第一版"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "初稿", Ref: "/tmp/cover-v1.png", Summary: "第一版"})
	if err != nil || again.ID != draft.ID {
		t.Fatalf("identical attach was not idempotent: %+v %v", again, err)
	}
	got, ok := p.Task(id)
	if !ok || got.RevisionNo() != 1 || len(got.Artifacts) != 2 {
		t.Fatalf("task query lost artifacts: %+v", got)
	}

	req := PublicProgressRequest{Project: "fish", SessionKey: session, Run: run, Seq: 2, Kind: "result", Summary: "初稿已交，待你看"}
	if _, err := p.Report(req); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	reworked, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: draft.ID, RequestID: "rw-1", Feedback: "把背景改成蓝色"})
	if err != nil {
		t.Fatal(err)
	}
	if reworked.RevisionNo() != 2 || reworked.State != TaskStateInProgress || reworked.ResultSummary != "" {
		t.Fatalf("rework did not reopen the task cleanly: %+v", reworked)
	}
	if len(reworked.Artifacts) != 2 {
		t.Fatalf("rework dropped artifacts: %+v", reworked.Artifacts)
	}
	last := reworked.Events[len(reworked.Events)-1]
	if last.Kind != TaskEventRequirementChanged || !strings.Contains(last.Detail, draft.ID) {
		t.Fatalf("rework event lost the target artifact: %+v", last)
	}
	if reworked.State == TaskStateCompleted || reworked.FactStage == FactStageVerified {
		t.Fatal("rework invented an acceptance")
	}

	// The next turn continues the same task by id, not a new one.
	run2 := p.begin(platform, session, LangEnglish, nil)
	req = PublicProgressRequest{Project: "fish", SessionKey: session, Run: run2, TaskID: id, Seq: 3, Kind: "update", Summary: "正在改背景"}
	if continued, err := p.Report(req); err != nil || continued != id {
		t.Fatalf("reworked task was not continuable: %s %v", continued, err)
	}
	if _, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "第二版", Ref: "/tmp/cover-v2.png"}); err != nil {
		t.Fatal(err)
	}
	p.finish(run2, "result")

	// Several output revisions exist, so an unnamed rework must ask which one.
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, RequestID: "rw-unnamed", Feedback: "再改一次"}); err == nil || !strings.Contains(err.Error(), draft.ID) {
		t.Fatalf("unnamed rework with several outputs was not refused with ids: %v", err)
	}

	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	after, ok := restored.Task(id)
	if !ok || after.RevisionNo() != 2 || len(after.Artifacts) != 3 || after.State != TaskStateInProgress {
		t.Fatalf("restart lost artifacts, revision or state: %+v", after)
	}
	if after.Artifacts[2].Revision != 2 {
		t.Fatalf("artifact did not record its revision: %+v", after.Artifacts[2])
	}

	// A failed write must not acknowledge or keep the in-memory change.
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	journalDir := restored.dir
	restored.dir = blocker
	if _, err := restored.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "丢失", Ref: "/tmp/lost.png"}); err == nil {
		t.Fatal("artifact attach was acknowledged before it was persisted")
	}
	if _, err := restored.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: draft.ID, RequestID: "rw-write-fail", Feedback: "不应写入"}); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("rework did not reach the persistence failure: %v", err)
	}
	if _, ok := restored.records[id].record.Reworks["rw-write-fail"]; ok {
		t.Fatal("failed write left an idempotency receipt")
	}
	restored.dir = journalDir
	if got, _ := restored.Task(id); got.RevisionNo() != 2 || len(got.Artifacts) != 3 {
		t.Fatalf("failed write leaked into the journal: revision %d artifacts %d", got.RevisionNo(), len(got.Artifacts))
	}

	// An artifact from another task is never accepted as this task's revision.
	run3 := restored.begin(platform, "plain:other:user", LangEnglish, nil)
	other, err := restored.Report(PublicProgressRequest{Project: "fish", SessionKey: "plain:other:user", Run: run3, Seq: 1, Kind: "start", Title: "别的活", Summary: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restored.Rework(TaskReworkRequest{Project: "fish", TaskID: other, ArtifactID: draft.ID, RequestID: "rw-cross", Feedback: "串任务"}); err == nil {
		t.Fatal("rework accepted an artifact from another task")
	}

	// A finished task cannot take artifacts or rework.
	if _, err := restored.Report(PublicProgressRequest{Project: "fish", SessionKey: "plain:other:user", Run: run3, Seq: 2, Kind: "result", Summary: "完成"}); err != nil {
		t.Fatal(err)
	}
	restored.finish(run3, "result")
	if _, err := restored.Accept(other, "主人"); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: other, Role: "output", Kind: "file", Label: "晚了", Ref: "/tmp/late.png"}); err == nil {
		t.Fatal("accepted task took a new artifact")
	}
	if _, err := restored.Rework(TaskReworkRequest{Project: "fish", TaskID: other, RequestID: "rw-late", Feedback: "晚了"}); err == nil {
		t.Fatal("accepted task was reworked")
	}
}

func TestTaskArtifactValidation(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "task")
	base := TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "x", Ref: "/tmp/x"}
	cases := map[string]func(*TaskArtifactRequest){
		"bad role":     func(r *TaskArtifactRequest) { r.Role = "sideways" },
		"bad kind":     func(r *TaskArtifactRequest) { r.Kind = "binary" },
		"empty label":  func(r *TaskArtifactRequest) { r.Label = "  " },
		"newline ref":  func(r *TaskArtifactRequest) { r.Ref = "/tmp/a\n/tmp/b" },
		"empty ref":    func(r *TaskArtifactRequest) { r.Ref = "" },
		"unknown task": func(r *TaskArtifactRequest) { r.TaskID = "task-missing" },
		"wrong project": func(r *TaskArtifactRequest) {
			r.Project = "other"
		},
	}
	for name, mutate := range cases {
		req := base
		mutate(&req)
		if _, err := p.AttachArtifact(req); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, RequestID: "rw-long", Feedback: strings.Repeat("长", 501)}); err == nil {
		t.Fatal("overlong feedback was accepted")
	}
}

// TestTaskArtifactPrompt checks that both progress modes tell the agent how to
// record supplied material, deliverables and a specified rework. Without this
// the API would exist but no turn would know to use it.
func TestTaskArtifactPrompt(t *testing.T) {
	dir := t.TempDir()
	_, e, _, platform, _ := inputFixture(t)
	e.workspaceChatForTest = func(string) bool { return false }
	e.SetDataDir(dir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	want := []string{"[Task artifacts]", "artifact --id TASK_ID", "rework --id TASK_ID", "--request-id", "input material is history", "not an upload, publication or delivery", "show --id TASK_ID"}
	state := &interactiveState{platform: platform}
	prompt := e.withPublicProgress("user content", state, "test:room:user", false, false)
	for _, s := range want {
		if !strings.Contains(prompt, s) {
			t.Fatalf("journal prompt missing %q", s)
		}
	}
	e.finishPublicProgress(state, "result")

	e.workspaceChatForTest = func(string) bool { return true }
	cardState := &interactiveState{platform: newProgressPlatform()}
	cardPrompt := e.withPublicProgress("user content", cardState, "test:room:user", false, false)
	if !strings.Contains(cardPrompt, "[Task artifacts]") || !strings.Contains(cardPrompt, "[Task card members]") {
		t.Fatalf("card prompt missing artifact instructions: %s", cardPrompt)
	}
	e.finishPublicProgress(cardState, "result")
}

// TestTaskReworkRequestIDIdempotencyAndConflict: one rework action carries one
// stable request id. A retry returns the committed receipt (no new revision or
// event); the same id with different content is refused; the same words under a
// new id are a new request. Reproduces the reviewer's double-mutation finding.
func TestTaskReworkRequestIDIdempotencyAndConflict(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := p.Task(id)
	base := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: draft.ID, RequestID: "change-1", Feedback: "make it blue"}
	first, err := p.Rework(base)
	if err != nil {
		t.Fatal(err)
	}
	if first.RevisionNo() != 2 || len(first.Events) != len(before.Events)+1 {
		t.Fatalf("first rework did not open revision 2 with one event: %+v", first)
	}
	second, err := p.Rework(base)
	if err != nil {
		t.Fatalf("lost-ack retry failed: %v", err)
	}
	if second.RevisionNo() != 2 || len(second.Events) != len(first.Events) {
		t.Fatalf("retry opened another revision or event: revision %d events %d", second.RevisionNo(), len(second.Events))
	}
	conflict := base
	conflict.Feedback = "make it green"
	if _, err := p.Rework(conflict); err == nil || !strings.Contains(err.Error(), "different content") {
		t.Fatalf("same request id with different content was accepted: %v", err)
	}
	next := base
	next.RequestID = "change-2"
	third, err := p.Rework(next)
	if err != nil {
		t.Fatal(err)
	}
	if third.RevisionNo() != 3 {
		t.Fatalf("a new id with the same words was not a new request: %+v", third)
	}
}

// TestTaskReworkRequestIDSurvivesRestart: the receipt is written with the task
// journal, so a retry after a bridge restart still returns the committed change
// instead of advancing the revision again.
func TestTaskReworkRequestIDSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	run, id := startTask(t, p, platform, "plain:room:user", "cover")
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"})
	if err != nil {
		t.Fatal(err)
	}
	rework := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: draft.ID, RequestID: "restart-1", Feedback: "change it"}
	if _, err := p.Rework(rework); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")

	restarted, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	before, ok := restarted.Task(id)
	if !ok {
		t.Fatal("task lost across restart")
	}
	again, err := restarted.Rework(rework)
	if err != nil {
		t.Fatalf("retry after restart failed: %v", err)
	}
	if again.RevisionNo() != before.RevisionNo() || len(again.Events) != len(before.Events) {
		t.Fatalf("retry after restart advanced the task: revision %d -> %d events %d -> %d", before.RevisionNo(), again.RevisionNo(), len(before.Events), len(again.Events))
	}
}

// TestTaskReworkRequestIDDelayedBinding: a delayed retry of an older request
// arriving after a newer one still returns its own receipt and does not mutate
// the current revision.
func TestTaskReworkRequestIDDelayedBinding(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	a, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "a", Ref: "/tmp/a.png"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "b", Ref: "/tmp/b.png"})
	if err != nil {
		t.Fatal(err)
	}
	r1 := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: a.ID, RequestID: "r1", Feedback: "first"}
	if _, err := p.Rework(r1); err != nil {
		t.Fatal(err)
	}
	r2 := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: b.ID, RequestID: "r2", Feedback: "second"}
	if _, err := p.Rework(r2); err != nil {
		t.Fatal(err)
	}
	delayed, err := p.Rework(r1)
	if err != nil {
		t.Fatalf("delayed retry failed: %v", err)
	}
	if delayed.RevisionNo() != 3 {
		t.Fatalf("delayed retry mutated the current revision: %+v", delayed)
	}
	receipt := p.records[id].record.Reworks["r1"]
	if receipt.Revision != 2 || receipt.ArtifactID != a.ID || receipt.Hash == "" || receipt.EventID == "" {
		t.Fatalf("receipt did not keep the original binding: %+v", receipt)
	}
}

// TestTaskReworkRejectsInputTarget: input material is history; naming it as the
// deliverable to rework is refused before anything is written.
func TestTaskReworkRejectsInputTarget(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	in, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, Role: "input", Kind: "image", Label: "source", Ref: "/tmp/source.png"})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := p.Task(id)
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: in.ID, RequestID: "bad-input", Feedback: "redo the source"}); err == nil || !strings.Contains(err.Error(), "input material") {
		t.Fatalf("input material was accepted as a rework target: %v", err)
	}
	after, _ := p.Task(id)
	if after.RevisionNo() != before.RevisionNo() || len(after.Events) != len(before.Events) || after.State != before.State {
		t.Fatalf("refused input target changed the task: %+v", after)
	}
}

// TestTaskArtifactRetryDoesNotRebindAfterRework: an identical attach retried
// after a revision bump is the same operation and keeps its original revision,
// instead of being rebound to the new revision.
func TestTaskArtifactRetryDoesNotRebindAfterRework(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	attach := TaskArtifactRequest{Project: "fish", TaskID: id, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"}
	first, err := p.AttachArtifact(attach)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: first.ID, RequestID: "rw", Feedback: "change it"}); err != nil {
		t.Fatal(err)
	}
	again, err := p.AttachArtifact(attach)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID || again.Revision != 1 {
		t.Fatalf("retried attach was rebound to the new revision: %+v", again)
	}
	got, _ := p.Task(id)
	if len(got.Artifacts) != 1 {
		t.Fatalf("retried attach duplicated the artifact: %+v", got.Artifacts)
	}
}
