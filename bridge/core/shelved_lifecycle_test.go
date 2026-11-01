package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestShelvedLifecycle_WaitingQuestionSurvivesAge(t *testing.T) {
	now := time.Date(2026, 11, 1, 1, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "选择发布范围", Status: "等待用户答复", Paused: "10-29 02:00", PauseWhy: "等待用户答复：发布范围", At: "10-29 02:00", SK: "discord:main"},
	})
	got := renderTeamTaskTable(items, nil, "discord:main", now)
	if !strings.Contains(got, "等你看 1") || !strings.Contains(got, "选择发布范围") {
		t.Fatalf("pending question disappeared: %s", got)
	}
}

func TestShelvedLifecycle_EndedWorkspaceIsNotAcceptance(t *testing.T) {
	now := time.Date(2026, 11, 1, 1, 0, 0, 0, time.Local)
	p := testTaskBoardPlacer()
	p.handoffEnded = func(string, string, time.Time) bool { return true }
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 1, What: "尚未验收的交接", Status: "已交接", WS: "feishu:oc_ws", Chat: "feishu:oc_a", Bound: now.Add(-72 * time.Hour).Format(time.RFC3339), At: "10-29 01:00"},
	})
	for name, got := range map[string]string{
		"table": renderTeamTaskTable(items, nil, "feishu:oc_a", now),
		"board": renderTeamTaskBoard(items, "feishu:oc_a", now),
	} {
		if !strings.Contains(got, "尚未验收的交接") || !strings.Contains(got, "待主角色核对") {
			t.Errorf("%s lost unaccepted work: %s", name, got)
		}
	}
	if teamTaskBoardLive(items, "feishu:oc_a") {
		t.Fatal("ended handoff must not count as active work")
	}
}

func TestShelvedLifecycle_RoleBoardUsesRenderedSource(t *testing.T) {
	e := NewEngine("test", &stubAgent{}, nil, "", LangEnglish)
	dataDir, _ := roleEnvFixture(t, e)
	boardDir := t.TempDir()
	e.team = &teamState{dir: boardDir}
	cmd := exec.Command("sh", "-c", "board add lifecycle fixture running owner --short lifecycle")
	cmd.Env = append(os.Environ(), e.roleSessionEnv("discord:main")...)
	cmd.Env = append(cmd.Env, "CC_BIN=/usr/bin/false")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("board CLI: %v %s", err, out)
	}
	items := readTeamTaskBoard(boardDir)
	if len(items) != 1 {
		t.Fatalf("CLI wrote a different board: rendered=%d default=%d", len(items), len(readTeamTaskBoard(filepath.Join(dataDir, "team"))))
	}
}
