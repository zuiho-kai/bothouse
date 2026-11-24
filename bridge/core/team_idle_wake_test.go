package core

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// #1972: a retry that fails on config (ws-handoff exit 3: the recorded model is not in the list)
// stops the retries once — board wait-stop — instead of trying again every ten minutes.
func TestResumeWaitingExternalStopsOnConfigError(t *testing.T) {
	for _, tc := range []struct {
		exit    string
		stopped bool
	}{{"3", true}, {"1", false}} {
		e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
		t.Cleanup(e.cancel)
		e.SetDataDir(t.TempDir())
		lead := filepath.Join(e.dataDir, "collaboration", "lead")
		if err := os.MkdirAll(lead, 0o700); err != nil {
			t.Fatal(err)
		}
		args := filepath.Join(t.TempDir(), "board-args")
		ws := "#!/bin/sh\necho 'ws-handoff: #5 记着的模型 保持现状 不能用：模型 保持现状 不在本项目的模型列表里' >&2\nexit " + tc.exit + "\n"
		board := "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\" >> " + args + "; done\n"
		if err := os.WriteFile(filepath.Join(lead, "ws-handoff"), []byte(ws), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(lead, "board"), []byte(board), 0o700); err != nil {
			t.Fatal(err)
		}
		e.resumeWaitingExternal(teamTaskBoardItem{ID: 5, Chat: "room:main", Paused: "11-24 08:00", PauseWhy: team.WaitExternalWhy + "等 CI"})
		raw, _ := os.ReadFile(args)
		got := strings.Split(strings.TrimSpace(string(raw)), "\n")
		if !tc.stopped {
			if len(raw) != 0 {
				t.Fatalf("exit %s: board called %q, want no stop", tc.exit, got)
			}
			continue
		}
		if len(got) != 3 || got[0] != "wait-stop" || got[1] != "5" || !strings.Contains(got[2], "不能用") {
			t.Fatalf("exit %s: board args = %q", tc.exit, got)
		}
	}
}

// #1972: the handback guard asks the bridge first. A workspace with a live background command is
// working (look again later); a paused or removed item needs no look; otherwise the lead is woken.
func TestGuardVerdict(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "busy", Chat: "discord:chat", WS: "discord:ws1"},
		teamTaskBoardItem{ID: 2, What: "quiet", Chat: "discord:chat", WS: "discord:ws2"},
		teamTaskBoardItem{ID: 3, What: "paused", Chat: "discord:chat", Paused: "11-24 08:00", PauseWhy: "等主角色定"},
	)
	run := filepath.Join(e.backgroundRunsDir(), "1124-180000-build-1")
	if err := os.MkdirAll(run, 0o700); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(run, "session"), []byte("discord:ws1\n"), 0o600)
	_ = os.WriteFile(filepath.Join(run, "pid"), []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600)
	for id, want := range map[int]string{1: "busy", 2: "", 3: "done", 9: "done"} {
		job := &TimerJob{Guard: true, Description: "兜底 #" + strconv.Itoa(id) + "：工作区 30m 没交回就查"}
		if got := e.guardVerdict(job); got != want {
			t.Errorf("#%d: verdict %q, want %q", id, got, want)
		}
	}
	_ = time.Second
}
