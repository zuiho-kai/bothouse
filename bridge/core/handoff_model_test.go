package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #2075: a model picked at handoff runs the task, and the workspace's own selection comes back
// when the workspace is given back, also across a restart.
func TestHandoffModelRestoredOnGiveBack(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "gemini-3.8-flash-high"},
		models: []ModelOption{{Name: "gemini-3.8-flash-high"}, {Name: "gemini-4-neon-high"}, {Name: "gemini-pro-orchestrator-neon"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetProjectStateStore(NewProjectStateStore(statePath))
	// ws1 had a hand-picked model before; ws2 had none.
	if err := e.saveSessionSelection("discord:ws1", "gemini-3.8-flash-high", ""); err != nil {
		t.Fatal(err)
	}
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", ""); !r.OK {
		t.Fatalf("handoff ws1 = %+v", r)
	}
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws2", "gemini-pro-orchestrator-neon", ""); !r.OK {
		t.Fatalf("handoff ws2 = %+v", r)
	}
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws3", "nope", ""); r.OK || len(r.Candidates) != 3 {
		t.Fatalf("unknown model must be refused with candidates: %+v", r)
	}
	e.applyPendingSwitch("discord:ws1") // the handed-off turn starts on the task's model
	if got := e.sessionModelFor("discord:ws1"); got != "gemini-4-neon-high" {
		t.Fatalf("ws1 task model = %q", got)
	}
	// Re-picked for the same task (ws-forward --model): the remembered selection stays the first one.
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-pro-orchestrator-neon", ""); !r.OK {
		t.Fatalf("re-pick = %+v", r)
	}
	e.applyPendingSwitch("discord:ws1")

	// Restart before give-back: the remembered selection survives.
	e2 := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e2.Stop() })
	e2.SetProjectStateStore(NewProjectStateStore(statePath))
	for _, ws := range []string{"discord:ws1", "discord:ws2"} { // ws2's switch was never applied: dropped from the queue
		if err := e2.restoreWorkspaceHandoffModels(ws); err != nil {
			t.Fatal(err)
		}
	}
	if got := e2.sessionModelFor("discord:ws1"); got != "gemini-3.8-flash-high" {
		t.Fatalf("ws1 after give-back = %q, want its own model back", got)
	}
	if got := e2.sessionModelFor("discord:ws2"); got != "" {
		t.Fatalf("ws2 after give-back = %q, want none", got)
	}
	if st := e2.ModelStatus(context.Background(), "discord:ws2"); st.Pending != "" {
		t.Fatalf("ws2 still has a queued switch: %q", st.Pending)
	}
	state := NewProjectStateStore(statePath).state
	if len(state.HandoffModelBases) != 0 || len(state.PendingModelSwitches) != 0 {
		t.Fatalf("leftovers after give-back: bases=%v pending=%v", state.HandoffModelBases, state.PendingModelSwitches)
	}
	// A plain `model set` (not a handoff) is never undone by a give-back.
	if r := e2.QueueModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", "", false); !r.OK {
		t.Fatal(r.Message)
	}
	e2.applyPendingSwitch("discord:ws1")
	if err := e2.restoreWorkspaceHandoffModels("discord:ws1"); err != nil {
		t.Fatal(err)
	}
	if got := e2.sessionModelFor("discord:ws1"); got != "gemini-4-neon-high" {
		t.Fatalf("plain pick undone by give-back: %q", got)
	}
}

// #2075: the pinned table's workspace row shows the model the handoff picked for the task.
func TestTaskTableShowsHandoffModel(t *testing.T) {
	now := time.Date(2026, 11, 22, 15, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 961, What: "交活指定模型", Short: "交活指定模型", Status: "已交接", WS: "discord:ws1", Chat: "discord:main",
			SK: "discord:ws1", Model: "gemini-4-neon-high", Effort: "high", Bound: now.Add(-time.Minute).Format(time.RFC3339), At: "11-22 14:59"},
		{ID: 962, What: "没指定模型", Short: "没指定模型", Status: "已交接", WS: "discord:ws2", Chat: "discord:main",
			SK: "discord:ws2", Bound: now.Add(-time.Minute).Format(time.RFC3339), At: "11-22 14:59"},
	})
	got := renderTeamTaskTable(items, nil, "discord:main", now)
	if !strings.Contains(got, "交活指定模型 · gemini-4-neon-high high") {
		t.Fatalf("model missing from the workspace row:\n%s", got)
	}
	if strings.Contains(got, "没指定模型 · gemini") {
		t.Fatalf("a task without a pick shows a model:\n%s", got)
	}
}

// Review #2076 item 1: the queued switch and the selection to restore are one write. A failed
// write keeps neither; a failed give-back write keeps both, and the next give-back restores.
func TestHandoffModelWriteFailureKeepsStateConsistent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	statePath := filepath.Join(dir, "state.json")
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "gemini-3.8-flash-high"},
		models: []ModelOption{{Name: "gemini-3.8-flash-high"}, {Name: "gemini-4-neon-high"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetProjectStateStore(NewProjectStateStore(statePath))
	if err := e.saveSessionSelection("discord:ws1", "gemini-3.8-flash-high", ""); err != nil {
		t.Fatal(err)
	}
	readOnly := func() {
		if err := os.Chmod(dir, 0o555); err != nil {
			t.Fatal(err)
		}
	}
	writable := func() {
		if err := os.Chmod(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(writable)

	readOnly()
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", ""); r.OK {
		t.Fatalf("handoff with an unwritable state file reported OK: %+v", r)
	}
	if st := e.ModelStatus(context.Background(), "discord:ws1"); st.Pending != "" {
		t.Fatalf("failed write left a queued switch: %q", st.Pending)
	}
	if len(e.projectState.state.HandoffModelBases) != 0 {
		t.Fatalf("failed write left a remembered selection: %v", e.projectState.state.HandoffModelBases)
	}

	writable()
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", ""); !r.OK {
		t.Fatalf("handoff = %+v", r)
	}
	disk := NewProjectStateStore(statePath).state
	if disk.PendingModelSwitches["discord:ws1"].Model != "gemini-4-neon-high" || disk.HandoffModelBases["discord:ws1"].Model != "gemini-3.8-flash-high" {
		t.Fatalf("switch and base not saved together: pending=%v bases=%v", disk.PendingModelSwitches, disk.HandoffModelBases)
	}
	e.applyPendingSwitch("discord:ws1")

	readOnly()
	if _, err := e.restoreHandoffModels("discord:ws1"); err == nil { // review #2076 round 2: the failure reaches the caller
		t.Fatal("restore with an unwritable state file reported success")
	}
	if got := e.sessionModelFor("discord:ws1"); got != "gemini-4-neon-high" {
		t.Fatalf("failed restore changed the model in memory: %q", got)
	}
	if _, ok := e.projectState.state.HandoffModelBases["discord:ws1"]; !ok {
		t.Fatal("failed restore dropped the selection to restore")
	}
}

// Review #2076 round 2: a park whose model restore cannot be saved is refused: the workspace stays
// with its task (not given back on the task's model) and the task stays in work; once the state
// file is writable again the park frees it and the workspace is back on its own model.
func TestParkRefusedWhenHandoffModelRestoreFails(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	dir := filepath.Join(t.TempDir(), "state")
	e.SetProjectStateStore(NewProjectStateStore(filepath.Join(dir, "state.json")))
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.saveSessionSelection(exitWSKey, "own-model", ""); err != nil {
		t.Fatal(err)
	}
	if err := e.queueHandoffSwitch(exitWSKey, pendingModelSwitch{Model: "task-model"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	freed, err := e.ParkTeamWorkspace("discord:ws1")
	if err == nil || freed || !strings.Contains(err.Error(), "not given back") {
		t.Fatalf("park with an unsaved model restore = %v, %v; want refused", freed, err)
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("workspace given back although its model was not restored: parent %q,%v", p, ok)
	}
	if hs := handoffsOf(e, "discord:ws1"); len(hs) != 1 || !hs[0].Parked.IsZero() {
		t.Fatalf("refused park still parked the handoff: %+v", hs)
	}
	if e.projectState.state.PendingModelSwitches[exitWSKey].Model != "task-model" {
		t.Fatalf("refused park dropped the task's switch: %v", e.projectState.state.PendingModelSwitches)
	}

	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if freed, err := e.ParkTeamWorkspace("discord:ws1"); err != nil || !freed {
		t.Fatalf("park after the state file is writable = %v, %v; want freed", freed, err)
	}
	st := e.projectState.state
	if got := st.SessionModelOverrides[exitWSKey].Model; got != "own-model" || len(st.PendingModelSwitches) != 0 || len(st.HandoffModelBases) != 0 {
		t.Fatalf("after give-back: own=%q pending=%v bases=%v", got, st.PendingModelSwitches, st.HandoffModelBases)
	}
}

// Review #2076 item 3: while the workspace runs a turn, a handoff model is refused: the forward
// would reach the model running now. Nothing is queued or remembered.
func TestHandoffModelRefusedWhileTurnRuns(t *testing.T) {
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "gemini-3.8-flash-high"},
		models: []ModelOption{{Name: "gemini-3.8-flash-high"}, {Name: "gemini-4-neon-high"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetProjectStateStore(NewProjectStateStore(filepath.Join(t.TempDir(), "state.json")))
	session := e.sessions.GetOrCreateActive("discord:ws1")
	if !session.TryLock() {
		t.Fatal("lock")
	}
	r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", "")
	if r.OK || !strings.Contains(r.Message, "middle of a turn") {
		t.Fatalf("busy workspace: %+v", r)
	}
	if st := e.ModelStatus(context.Background(), "discord:ws1"); st.Pending != "" {
		t.Fatalf("refused pick still queued: %q", st.Pending)
	}
	if len(e.projectState.state.HandoffModelBases) != 0 {
		t.Fatal("refused pick remembered a selection")
	}
	session.Unlock()
	if r := e.QueueHandoffModelSwitch(context.Background(), "discord:ws1", "gemini-4-neon-high", ""); !r.OK {
		t.Fatalf("idle workspace = %+v", r)
	}
}
