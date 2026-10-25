package core

import (
	"encoding/json"
	"testing"
)

// #597 G25: the ws-handoff wake-up (timer --handoff) is handed-over work, not a
// routine timer, so its turn opens the automatic progress card in the workspace.
func TestAutoProgress_HandoffTimerTurnGetsAutoCard(t *testing.T) {
	if got := timerTurnUser(&TimerJob{Handoff: true}); got != "handoff" {
		t.Fatalf("handoff timer user = %q", got)
	}
	if got := timerTurnUser(&TimerJob{}); got != "timer" {
		t.Fatalf("plain timer user = %q", got)
	}
	if scheduledTurnUser(timerTurnUser(&TimerJob{Handoff: true})) {
		t.Fatal("handoff wake-up treated as a routine scheduled turn")
	}
	platform := newProgressPlatform()
	e := NewEngine("fish", &stubAgent{}, []Platform{platform}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	markWorkspace(t, e, "room:ws")
	st := &interactiveState{platform: platform, turnDesc: "⏰ 工作区接手",
		turnScheduled: scheduledTurnUser(timerTurnUser(&TimerJob{Handoff: true}))}
	e.withPublicProgress("prompt", st, "room:ws", false, false)
	e.notePublicProgressTool(st, "ls")
	e.notePublicProgressTool(st, "cat")
	if n := len(e.publicProgress.Tasks("room:ws", 10)); n != 1 {
		t.Fatalf("handoff wake-up opened %d cards, want 1", n)
	}
	e.finishPublicProgress(st, "result")
}

func TestTimerAddRequest_HandoffReachesJob(t *testing.T) {
	var req TimerAddRequest
	if err := json.Unmarshal([]byte(`{"session_key":"discord:1","delay":"1m","prompt":"p","handoff":true}`), &req); err != nil {
		t.Fatal(err)
	}
	if !req.Handoff {
		t.Fatal("handoff not decoded")
	}
}
