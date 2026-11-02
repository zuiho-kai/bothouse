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
		if !strings.Contains(got, "尚未验收的交接") || !strings.Contains(got, "暂停") {
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

func TestShelvedLifecycle_StuckAfterProgressAndWatchdog(t *testing.T) {
	now := time.Date(2026, 11, 1, 3, 0, 0, 0, time.Local)
	p := testTaskBoardPlacer()
	p.handoffOf = func(ws, chat string, bound time.Time) (TeamHandoff, bool) {
		switch ws {
		case "feishu:oc_ws_nudged":
			return TeamHandoff{Chat: chat, At: now.Add(-40 * time.Minute), Since: now.Add(-20 * time.Minute), Nudged: true}, true
		case "feishu:oc_ws_park":
			return TeamHandoff{Chat: chat, At: now.Add(-30 * time.Minute), ParkFails: 1}, true
		case "feishu:oc_ws_idle":
			return TeamHandoff{Chat: chat, At: now.Add(-30 * time.Minute), Idle: watchIdleState{Reported: true}}, true
		default:
			return TeamHandoff{Chat: chat, At: now.Add(-3 * time.Hour)}, true
		}
	}
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{
			ID:         1,
			What:       "报过一次进度后停滞",
			Status:     "收集中",
			WS:         "feishu:oc_ws",
			Chat:       "feishu:oc_a",
			Bound:      now.Add(-3 * time.Hour).Format(time.RFC3339),
			At:         "11-01 00:00",
			ProgressAt: float64(now.Add(-2 * time.Hour).Unix()),
		},
		{
			ID:     2,
			What:   "被看门催促无回应",
			Status: "处理中",
			WS:     "feishu:oc_ws_nudged",
			Chat:   "feishu:oc_a",
			Bound:  now.Add(-40 * time.Minute).Format(time.RFC3339),
			At:     "11-01 02:20",
		},
		{
			ID:     3,
			What:   "看门暂停失败",
			Status: "处理中",
			WS:     "feishu:oc_ws_park",
			Chat:   "feishu:oc_a",
			Bound:  now.Add(-30 * time.Minute).Format(time.RFC3339),
			At:     "11-01 02:30",
		},
		{
			ID:     4,
			What:   "连续唤醒无响应",
			Status: "处理中",
			WS:     "feishu:oc_ws_idle",
			Chat:   "feishu:oc_a",
			Bound:  now.Add(-30 * time.Minute).Format(time.RFC3339),
			At:     "11-01 02:30",
		},
	})
	wantNotes := map[int]string{
		1: "2 小时无进展",
		2: "看门催促无进展",
		3: "看门暂停失败，待主角色处理",
		4: "连续唤醒无响应，已升级主角色",
	}
	for _, it := range items {
		st, note := teamTaskBoardStateOf(it, now)
		if st != teamTaskStuck || note != wantNotes[it.ID] {
			t.Errorf("id=%d state=%v note=%q, want stuck %q", it.ID, st, note, wantNotes[it.ID])
		}
	}
}

func TestShelvedLifecycle_ReconcilesActiveWorkspaceHandoff(t *testing.T) {
	now := time.Date(2026, 11, 1, 1, 30, 0, 0, time.Local)
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	e.SetDataDir(t.TempDir())
	if err := e.ClaimTeamWorkspaceFor("discord:main", "ws1", "工作区1", "豆", "发布部署实测"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceFor("discord:main", "ws2", "工作区2", "豆", "任务板对账修复"); err != nil {
		t.Fatal(err)
	}

	items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), []teamTaskBoardItem{
		{
			ID:       43,
			What:     "任务板对账修复",
			Short:    "任务板对账修复",
			Status:   "进行中",
			Paused:   "11-01 01:00",
			PauseWhy: "超时暂停",
			WSWas:    "discord:ws2",
			Chat:     "discord:main",
			At:       "11-01 00:30",
		},
	})
	if len(items) != 2 {
		t.Fatalf("placed items = %d, want 2 (1 rebound + 1 synthesized): %+v", len(items), items)
	}
	table := renderTeamTaskTable(items, nil, "discord:main", now)
	for _, want := range []string{"**工作区 2**", "🟢 工作区1 · 发布部署实测", "🟢 工作区2 · 任务板对账修复"} {
		if !strings.Contains(table, want) {
			t.Errorf("parent table missing %q:\n%s", want, table)
		}
	}
	wsBoard := renderWorkspaceTaskBoardFit(items, "discord:ws1", now, 500)
	if !strings.Contains(wsBoard, "**这里在做**") || !strings.Contains(wsBoard, "发布部署实测") {
		t.Errorf("workspace 1 board missing synthesized handoff:\n%s", wsBoard)
	}
}

func TestShelvedLifecycle_EndWorkspaceTaskFallsBackToGateBoard(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	dataDir := t.TempDir()
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	e.SetDataDir(dataDir)
	e.productPyBin.Store(t.TempDir())
	boardDir := t.TempDir()
	e.SetTeam(boardDir, "橘", true)
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(
		`{"id":1,"what":"待收口工作区任务","short":"待收口","status":"进行中","who":"豆","ws":"discord:ws1","sk":"discord:ws1","chat":"discord:main","at":"11-01 01:00"}`+"\n",
	), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "collaboration", "lead", "board")); !os.IsNotExist(err) {
		t.Fatalf("expected no collaboration/lead/board in fixture, got err=%v", err)
	}
	if err := e.ClaimTeamWorkspaceFor("discord:main", "ws1", "工作区1", "豆", "待收口"); err != nil {
		t.Fatal(err)
	}
	e.endWorkspaceTask("discord:main", "discord:ws1", exitKindReport, 1)
	if got := readTeamTaskBoard(boardDir); len(got) != 1 || got[0].ReturnedAt.IsZero() || got[0].WS != "" {
		t.Fatalf("expected durable pending handback via gate/board.py fallback: %+v", got)
	}
}

func TestReview42_ReusedWorkspaceDoesNotReviveUnrelatedTask(t *testing.T) {
	now := time.Now()
	t.Run("different_board_id", func(t *testing.T) {
		p := testTaskBoardPlacer()
		p.openHandoffs = func() map[string]TeamHandoff {
			return map[string]TeamHandoff{
				"discord:ws1": {Board: 2, Chat: "discord:main", Title: "new task", At: now},
			}
		}
		got := placeTeamTaskBoard(p, []teamTaskBoardItem{
			{ID: 1, What: "old unrelated task", Paused: "11-01 01:00", PauseWhy: "超时暂停", WSWas: "discord:ws1", Chat: "discord:main"},
		})
		found := false
		for _, it := range got {
			if it.ID == 1 && it.Paused == "" {
				t.Errorf("unrelated old task revived: %+v", it)
			}
			if it.ID == 2 && it.Paused == "" && it.WS == "discord:ws1" {
				found = true
			}
		}
		if !found {
			t.Errorf("current handoff task missing: %+v", got)
		}
	})

	t.Run("legacy_handoff_without_board_id", func(t *testing.T) {
		p := testTaskBoardPlacer()
		p.openHandoffs = func() map[string]TeamHandoff {
			return map[string]TeamHandoff{
				"discord:ws1": {Chat: "discord:main", Title: "new task without board id", At: now},
			}
		}
		got := placeTeamTaskBoard(p, []teamTaskBoardItem{
			{ID: 1, What: "old unrelated task", Short: "old task", Paused: "11-01 01:00", PauseWhy: "超时暂停", WSWas: "discord:ws1", Chat: "discord:main"},
		})
		found := false
		for _, it := range got {
			if it.ID == 1 && it.Paused == "" {
				t.Errorf("unrelated old task revived on legacy handoff: %+v", it)
			}
			if it.What == "new task without board id" && it.Paused == "" && it.WS == "discord:ws1" {
				found = true
			}
		}
		if !found {
			t.Errorf("current legacy handoff task missing: %+v", got)
		}
	})

	t.Run("old_bound_and_mismatched_chat", func(t *testing.T) {
		p := testTaskBoardPlacer()
		p.openHandoffs = func() map[string]TeamHandoff {
			return map[string]TeamHandoff{
				"discord:ws1": {Chat: "discord:main", Title: "shared task title", At: now},
				"discord:ws2": {Board: 5, Chat: "discord:main", Title: "chat-scoped task", At: now},
			}
		}
		got := placeTeamTaskBoard(p, []teamTaskBoardItem{
			{
				ID:       1,
				What:     "shared task title",
				Short:    "shared task title",
				Paused:   "11-01 01:00",
				PauseWhy: "超时暂停",
				WSWas:    "discord:ws1",
				Chat:     "discord:main",
				Bound:    now.Add(-30 * time.Minute).UTC().Format(time.RFC3339Nano),
			},
			{
				ID:       5,
				What:     "chat-scoped task",
				Paused:   "11-01 01:00",
				PauseWhy: "超时暂停",
				WSWas:    "discord:ws2",
				Chat:     "discord:other_chat",
			},
		})
		ws1Syn, ws2Syn := false, false
		for _, it := range got {
			if (it.ID == 1 || (it.ID == 5 && it.Chat == "discord:other_chat")) && it.Paused == "" {
				t.Errorf("item with stale Bound or mismatched Chat revived: %+v", it)
			}
			if it.WS == "discord:ws1" && it.Paused == "" && it.ID == 0 {
				ws1Syn = true
			}
			if it.WS == "discord:ws2" && it.Paused == "" && it.ID == 5 && it.Chat == "discord:main" {
				ws2Syn = true
			}
		}
		if !ws1Syn || !ws2Syn {
			t.Errorf("expected synthesized active items for ws1=%v ws2=%v, got %+v", ws1Syn, ws2Syn, got)
		}
	})
}
