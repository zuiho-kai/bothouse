package core

import (
	"context"
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
	e2.ResetTeamWorkspaceSessions("discord:ws1")
	e2.ResetTeamWorkspaceSessions("discord:ws2") // its switch was never applied: dropped from the queue
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
	e2.ResetTeamWorkspaceSessions("discord:ws1")
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
