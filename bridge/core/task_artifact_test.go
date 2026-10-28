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

	input, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "input-1", Revision: 1, Role: "input", Kind: "image", Label: "用户原图", Ref: "https://example.test/original.png"})
	if err != nil {
		t.Fatal(err)
	}
	if input.Role != TaskArtifactInput || input.Revision != 1 || input.ID == "" {
		t.Fatalf("unexpected input artifact: %+v", input)
	}
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-1", Revision: 1, Role: "output", Kind: "file", Label: "初稿", Ref: "/tmp/cover-v1.png", Summary: "第一版"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-1", Revision: 1, Role: "output", Kind: "file", Label: "初稿", Ref: "/tmp/cover-v1.png", Summary: "第一版"})
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
	if _, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-2", Revision: 2, Role: "output", Kind: "file", Label: "第二版", Ref: "/tmp/cover-v2.png"}); err != nil {
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
	if _, err := restored.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "lost-1", Revision: 2, Role: "output", Kind: "file", Label: "丢失", Ref: "/tmp/lost.png"}); err == nil {
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
	if _, err := restored.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: other, RequestID: "late-1", Revision: 1, Role: "output", Kind: "file", Label: "晚了", Ref: "/tmp/late.png"}); err == nil {
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
	base := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "valid-1", Revision: 1, Role: "output", Kind: "file", Label: "x", Ref: "/tmp/x"}
	cases := map[string]func(*TaskArtifactRequest){
		"bad role":          func(r *TaskArtifactRequest) { r.Role = "sideways" },
		"bad kind":          func(r *TaskArtifactRequest) { r.Kind = "binary" },
		"empty label":       func(r *TaskArtifactRequest) { r.Label = "  " },
		"newline ref":       func(r *TaskArtifactRequest) { r.Ref = "/tmp/a\n/tmp/b" },
		"empty ref":         func(r *TaskArtifactRequest) { r.Ref = "" },
		"empty request id":  func(r *TaskArtifactRequest) { r.RequestID = "  " },
		"zero revision":     func(r *TaskArtifactRequest) { r.Revision = 0 },
		"negative revision": func(r *TaskArtifactRequest) { r.Revision = -1 },
		"unknown task":      func(r *TaskArtifactRequest) { r.TaskID = "task-missing" },
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
	want := []string{"[Task artifacts]", "artifact --id TASK_ID", "--request-id STABLE_ATTACH_ID", "--revision CURRENT_REVISION", "rework --id TASK_ID", "--request-id", "input material is history", "not an upload, publication or delivery", "show --id TASK_ID"}
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
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-1", Revision: 1, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"})
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
	draft, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-1", Revision: 1, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"})
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
	a, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "a-op", Revision: 1, Role: "output", Kind: "file", Label: "a", Ref: "/tmp/a.png"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "b-op", Revision: 1, Role: "output", Kind: "file", Label: "b", Ref: "/tmp/b.png"})
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
	in, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "source-op", Revision: 1, Role: "input", Kind: "image", Label: "source", Ref: "/tmp/source.png"})
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

// TestTaskArtifactRetryDoesNotRebindAfterRework: a lost-ack retry of one
// attach operation keeps its original revision after a revision bump, instead
// of being rebound to the new revision. The operation id, not the identical
// fields, is what makes it a retry.
func TestTaskArtifactRetryDoesNotRebindAfterRework(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	attach := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "draft-op-1", Revision: 1, Role: "output", Kind: "file", Label: "draft", Ref: "/tmp/draft.png"}
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

// TestTaskArtifactSameLocatorNewRevision records a real new version written to
// the same output pathname with the same label, kind and summary. Only the
// operation id and its target revision distinguish it from the old attach; it
// must land on the new revision, not return v1.
func TestTaskArtifactSameLocatorNewRevision(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	file := filepath.Join(t.TempDir(), "cover.svg")
	if err := os.WriteFile(file, []byte("<svg>red</svg>"), 0600); err != nil {
		t.Fatal(err)
	}
	req := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "cover-op-1", Revision: 1, Role: "output", Kind: "image", Label: "cover", Ref: file}
	first, err := p.AttachArtifact(req)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 1 {
		t.Fatalf("first artifact revision = %d", first.Revision)
	}
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: first.ID, RequestID: "make-it-blue", Feedback: "make it blue"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("<svg>blue</svg>"), 0600); err != nil {
		t.Fatal(err)
	}
	secondReq := req
	secondReq.RequestID = "cover-op-2"
	secondReq.Revision = 2
	second, err := p.AttachArtifact(secondReq)
	if err != nil {
		t.Fatal(err)
	}
	current, _ := p.Task(id)
	if second.ID == first.ID || second.Revision != current.RevisionNo() || len(current.Artifacts) != 2 {
		t.Fatalf("new output swallowed: current revision=%d returned revision=%d same id=%t artifact count=%d", current.RevisionNo(), second.Revision, second.ID == first.ID, len(current.Artifacts))
	}
	if current.Artifacts[1].Revision != 2 {
		t.Fatalf("new artifact did not record revision 2: %+v", current.Artifacts[1])
	}
}

// TestTaskArtifactRequestIDRevisions covers the two directions together: a new
// operation with the same fields records on the new revision, while a retry of
// the old operation still returns its original artifact. It also refuses a
// reused id with different content and a new operation pinned to a stale
// revision, and proves the receipt survives a restart.
func TestTaskArtifactRequestIDRevisions(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	firstReq := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "cover-op-1", Revision: 1, Role: "output", Kind: "file", Label: "cover", Ref: "/tmp/cover.svg"}
	first, err := p.AttachArtifact(firstReq)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := p.AttachArtifact(firstReq)
	if err != nil || retry.ID != first.ID || retry.Revision != 1 {
		t.Fatalf("same-id retry at the same revision changed the artifact: %+v %v", retry, err)
	}
	conflict := firstReq
	conflict.Ref = "/tmp/other.svg"
	if _, err := p.AttachArtifact(conflict); err == nil || !strings.Contains(err.Error(), "different content") {
		t.Fatalf("same id with different content was accepted: %v", err)
	}
	conflictRevision := firstReq
	conflictRevision.Revision = 2
	if _, err := p.AttachArtifact(conflictRevision); err == nil || !strings.Contains(err.Error(), "different content") {
		t.Fatalf("same id with a different target revision was accepted: %v", err)
	}
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: first.ID, RequestID: "rw-2", Feedback: "make it blue"}); err != nil {
		t.Fatal(err)
	}
	// A new operation that still claims revision 1 is stale and must not be
	// silently attached to revision 2.
	stale := firstReq
	stale.RequestID = "cover-op-stale"
	if _, err := p.AttachArtifact(stale); err == nil || !strings.Contains(err.Error(), "current revision 2") {
		t.Fatalf("stale revision was silently accepted: %v", err)
	}
	// A new operation with identical fields lands on revision 2.
	secondReq := firstReq
	secondReq.RequestID = "cover-op-2"
	secondReq.Revision = 2
	second, err := p.AttachArtifact(secondReq)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.Revision != 2 {
		t.Fatalf("new operation did not record a revision-2 artifact: %+v", second)
	}
	// The old operation retried late keeps its own revision and target.
	late, err := p.AttachArtifact(firstReq)
	if err != nil || late.ID != first.ID || late.Revision != 1 {
		t.Fatalf("late retry was rebound: %+v %v", late, err)
	}
	got, _ := p.Task(id)
	if got.RevisionNo() != 2 || len(got.Artifacts) != 2 {
		t.Fatalf("late retry changed the task: rev=%d artifacts=%d", got.RevisionNo(), len(got.Artifacts))
	}

	restarted, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	again, err := restarted.AttachArtifact(firstReq)
	if err != nil || again.ID != first.ID || again.Revision != 1 {
		t.Fatalf("receipt did not survive restart: %+v %v", again, err)
	}
	again2, err := restarted.AttachArtifact(secondReq)
	if err != nil || again2.ID != second.ID {
		t.Fatalf("second receipt did not survive restart: %+v %v", again2, err)
	}
}

// TestTaskArtifactSameRevisionNewOperationReceipt: two distinct operation ids
// with identical fields on the same revision are two operations, not one. Each
// records its own artifact and durable receipt; a later retry of the second
// still returns its own artifact after a rework and a restart, never the first
// operation's result.
func TestTaskArtifactSameRevisionNewOperationReceipt(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	firstReq := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "attach-1", Revision: 1, Role: "output", Kind: "file", Label: "cover", Ref: "/tmp/cover.svg"}
	first, err := p.AttachArtifact(firstReq)
	if err != nil {
		t.Fatal(err)
	}
	secondReq := firstReq
	secondReq.RequestID = "attach-2"
	second, err := p.AttachArtifact(secondReq)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatalf("a new operation id was swallowed on the same revision: %s", second.ID)
	}
	got, _ := p.Task(id)
	if len(got.Artifacts) != 2 || got.Artifacts[0].ID != first.ID || got.Artifacts[1].ID != second.ID {
		t.Fatalf("two operations on one revision did not record two artifacts: %+v", got.Artifacts)
	}
	for _, requestID := range []string{"attach-1", "attach-2"} {
		rec, ok := p.records[id].record.ArtifactRequests[requestID]
		if !ok || rec.Revision != 1 || rec.Hash == "" {
			t.Fatalf("operation %s has no durable receipt: %+v", requestID, rec)
		}
	}
	retry, err := p.AttachArtifact(secondReq)
	if err != nil || retry.ID != second.ID || retry.Revision != 1 {
		t.Fatalf("same-id retry did not return the second operation: %+v %v", retry, err)
	}
	if _, err := p.Rework(TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: first.ID, RequestID: "rw-same-revision", Feedback: "make it blue"}); err != nil {
		t.Fatal(err)
	}
	late, err := p.AttachArtifact(secondReq)
	if err != nil || late.ID != second.ID || late.Revision != 1 {
		t.Fatalf("late retry of the second operation was rebound: %+v %v", late, err)
	}

	restarted, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	after, err := restarted.AttachArtifact(secondReq)
	if err != nil || after.ID != second.ID || after.Revision != 1 {
		t.Fatalf("second operation receipt did not survive restart: %+v %v", after, err)
	}
}

// TestTaskArtifactRequestIDRollback: a failed write must not leave either the
// artifact or its operation receipt, and the same request id must succeed once
// the journal is writable again.
func TestTaskArtifactRequestIDRollback(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	good := TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "cover-op-ok", Revision: 1, Role: "output", Kind: "file", Label: "cover", Ref: "/tmp/cover.svg"}
	if _, err := p.AttachArtifact(good); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	journalDir := p.dir
	p.dir = blocker
	failing := good
	failing.RequestID = "cover-op-fail"
	failing.Ref = "/tmp/other.svg"
	if _, err := p.AttachArtifact(failing); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("attach did not reach the persistence failure: %v", err)
	}
	if _, ok := p.records[id].record.ArtifactRequests["cover-op-fail"]; ok {
		t.Fatal("failed write left an artifact operation receipt")
	}
	p.dir = journalDir
	if got, _ := p.Task(id); len(got.Artifacts) != 1 {
		t.Fatalf("failed write leaked into the task: %+v", got.Artifacts)
	}
	if _, err := p.AttachArtifact(failing); err != nil {
		t.Fatalf("retry after a failed write failed: %v", err)
	}
	if got, _ := p.Task(id); len(got.Artifacts) != 2 {
		t.Fatalf("successful retry did not record exactly one artifact: %+v", got.Artifacts)
	}
}

// TestTaskReworkReceiptDelayedRetry: r1 opens v2, r2 opens v3, and a late retry
// of r1 returns r1's own receipt (revision, event, target) while the task stays
// at v3 and the receipt survives a restart. A retry never rolls the task back.
func TestTaskReworkReceiptDelayedRetry(t *testing.T) {
	dir := t.TempDir()
	p, platform := journalModel(t, dir, "fish")
	_, id := startTask(t, p, platform, "plain:room:user", "cover")
	a, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "a", Revision: 1, Role: "output", Kind: "file", Label: "a", Ref: "/tmp/a.png"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.AttachArtifact(TaskArtifactRequest{Project: "fish", TaskID: id, RequestID: "b", Revision: 1, Role: "output", Kind: "file", Label: "b", Ref: "/tmp/b.png"})
	if err != nil {
		t.Fatal(err)
	}
	r1 := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: a.ID, RequestID: "r1", Feedback: "first"}
	first, err := p.Rework(r1)
	if err != nil {
		t.Fatal(err)
	}
	if first.Receipt.RequestID != "r1" || first.Receipt.Revision != 2 || first.Receipt.ArtifactID != a.ID || first.Receipt.EventID == "" || first.Receipt.Seq == 0 {
		t.Fatalf("first rework receipt is incomplete: %+v", first.Receipt)
	}
	r2 := TaskReworkRequest{Project: "fish", TaskID: id, ArtifactID: b.ID, RequestID: "r2", Feedback: "second"}
	second, err := p.Rework(r2)
	if err != nil {
		t.Fatal(err)
	}
	if second.Receipt.Revision != 3 || second.Receipt.ArtifactID != b.ID {
		t.Fatalf("second rework receipt is wrong: %+v", second.Receipt)
	}
	late, err := p.Rework(r1)
	if err != nil {
		t.Fatalf("delayed retry failed: %v", err)
	}
	if late.RevisionNo() != 3 {
		t.Fatalf("delayed retry rolled the task back: %+v", late.Task)
	}
	if late.Receipt != first.Receipt {
		t.Fatalf("late retry did not return the original receipt:\nfirst=%+v\nlate =%+v", first.Receipt, late.Receipt)
	}

	restarted, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	after, err := restarted.Rework(r1)
	if err != nil {
		t.Fatalf("retry after restart failed: %v", err)
	}
	if after.RevisionNo() != 3 || after.Receipt != first.Receipt {
		t.Fatalf("receipt did not survive restart: rev=%d receipt=%+v", after.RevisionNo(), after.Receipt)
	}
}
