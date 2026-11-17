package core

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// #857: a second claim moved the task's state but left its original handoff and
// session running. Reproduce through the same entry point ws-handoff calls.
func TestWorkspaceActiveTaskCannotClaimAnotherWorkspace(t *testing.T) {
	for _, working := range []bool{false, true} {
		e, _, _ := exitFixture(t, nil)
		e.SetTeam(t.TempDir(), "橘", true)
		e.teamWS = newTeamWorkspaces()
		if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#823", 823); err != nil {
			t.Fatal(err)
		}
		if working {
			e.teamTaskTurnStarted("discord:ws1")
		}
		err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#823", 823)
		if !errors.Is(err, ErrTeamTaskTransition) {
			t.Fatalf("working=%v: second workspace claim = %v, want ownership transition refused", working, err)
		}
		s := &APIServer{engines: map[string]*Engine{"lead": e}}
		rec := httptest.NewRecorder()
		s.handleTeamWorkspaceClaim(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/claim",
			strings.NewReader(`{"session_key":"discord:chatA","workspace_id":"ws2","name":"工作区2","board":823}`)))
		if rec.Code != http.StatusConflict {
			t.Fatalf("HTTP duplicate claim = %d %s, want 409", rec.Code, rec.Body.String())
		}
		task, _, err := e.TeamTask(823)
		if err != nil || task.WS != "discord:ws1" {
			t.Fatalf("original assignment changed: %+v, %v", task, err)
		}
		if rows := handoffsOf(e, "discord:ws2"); len(rows) != 0 {
			t.Fatalf("refused claim created a second handoff: %+v", rows)
		}
		if _, owned := e.WorkspaceParent("discord:ws2"); owned {
			t.Fatal("refused claim retained the second workspace")
		}
		if _, err := e.ParkTeamWorkspace("discord:ws1"); err != nil {
			t.Fatal(err)
		}
		if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#823", 823); err != nil {
			t.Fatalf("explicitly paused task cannot move to another workspace: %v", err)
		}
	}
}

// The public board may still show its old workspace while the authoritative task
// has already yielded. An idle callback must consult the task state too.
func TestWorkspaceIdleWakeStopsAfterTaskRelinquished(t *testing.T) {
	e, _, _, h := watchFixtureBoard(t, "", "#823 task", 823)
	writeReleaseBoard(t, e, map[string]any{"id": 823, "what": "task", "status": "在做", "who": "橘", "ws": "discord:ws1", "chat": "discord:chatA"})
	teamWorkspaceStore.mu.Lock()
	_, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: 823, To: TeamTaskPaused, By: "yield"}, time.Now())
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	h.Idle.Ended = time.Now()
	e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle })
	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Wakes != 0 || !got.Idle.Returned {
		t.Fatalf("relinquished task was still woken: %+v", got.Idle)
	}
}

func TestWorkspaceTrackedBackgroundCountsAsProgress(t *testing.T) {
	e, _, w, h := progressFixture(t, "")
	dir := filepath.Join(e.backgroundRunsDir(), "waiting")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{"pid": strconv.Itoa(os.Getpid()), "session": "discord:ws1"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if progress, err := w.workspaceProgress("discord:ws1", h, h.At); err != nil || progress != watchProgressReal {
		t.Fatalf("tracked background command was judged idle: progress=%v err=%v", progress, err)
	}
	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Wakes != 0 {
		t.Fatalf("running background command was woken: %+v", got.Idle)
	}
	if err := os.WriteFile(filepath.Join(dir, "exit"), []byte("0"), 0o600); err != nil {
		t.Fatal(err)
	}
	if running, _ := w.workspaceBackgroundProgress("discord:ws1", h.At); running {
		t.Fatal("completed background run still holds the workspace")
	}
}
