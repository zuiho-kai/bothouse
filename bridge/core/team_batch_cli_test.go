package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Run with CONEST_PROGRESS_BINARY pointing at the candidate executable. Only
// model/platform I/O is replaced: scripts, CLI, Unix HTTP and both task stores are real.
func TestCUJ_WorkspaceBatchCLI(t *testing.T) {
	binary := os.Getenv("CONEST_PROGRESS_BINARY")
	if binary == "" {
		t.Skip("candidate executable required")
	}
	binary, _ = filepath.Abs(binary)
	lead, p, _, item := heldFixture(t)
	worker, wp := reportFixture(t)
	worker.name, worker.dataDir = "worker", lead.dataDir
	worker.SetTeam(lead.team.dir, "Worker", false)
	worker.sessions.GetOrCreateActive("discord:ws1")
	worker.platformReady = map[Platform]bool{wp: true}
	lead.SetTeamWorkspaces(true)
	rm := NewRelayManager("")
	rm.RegisterEngine(lead.name, lead)
	rm.RegisterEngine(worker.name, worker)
	lead.SetRelayManager(rm)
	worker.SetRelayManager(rm)
	root, _ := filepath.Abs("../contrib")
	data := lead.dataDir
	t.Setenv("HOME", data)
	t.Setenv("CC_DATA_DIR", data)
	t.Setenv("BOTHOUSE_DATA_DIR", data)
	t.Setenv("GATE_SETUP_DIR", data)
	t.Setenv("BOARD_DIR", lead.team.dir)
	t.Setenv("GATE_DIR", filepath.Join(root, "gate"))
	t.Setenv("CC_BIN", binary)
	t.Setenv("BOTHOUSE_TEST", "1")
	// The engine normally sets CC_BIN to itself; this fixture's process is go test.
	// Keep the real board script but route its nested transitions to the candidate CLI.
	bin := filepath.Join(data, "collaboration", "lead", "board")
	if err := os.MkdirAll(filepath.Dir(bin), 0755); err != nil {
		t.Fatal(err)
	}
	script := fmt.Sprintf("#!/bin/sh\nexport CC_BIN='%s'\nexec python3 -I '%s' \"$@\"\n", binary, filepath.Join(root, "gate", "board.py"))
	if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	notes, draft := filepath.Join(data, "notes.md"), filepath.Join(data, "report.md")
	if err := os.WriteFile(notes, []byte("# 用户原话\n分批交回，每批单独验收。\n"), 0600); err != nil {
		t.Fatal(err)
	}
	item.Where, item.Bound = notes, time.Now().UTC().Format(time.RFC3339Nano)
	item.WS = "discord:ws1"
	item.Who = "工作区1worker"
	writeReviewBoard(t, lead, *item)
	api, err := NewAPIServer(data)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine(lead.name, lead)
	api.RegisterEngine(worker.name, worker)
	api.SetTimerScheduler(lead.timerScheduler)
	// Serve the actual routes without starting unrelated background watchers.
	api.server = &http.Server{Handler: api.mux}
	go api.server.Serve(api.listener)
	t.Cleanup(api.Stop)
	call := func(session, project string, argv ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
		cmd.Env = append(os.Environ(), "CC_SESSION_KEY="+session, "CC_PROJECT="+project)
		out, err := cmd.CombinedOutput()
		t.Logf("%s\n%s", strings.Join(argv, " "), out)
		if err != nil {
			t.Fatalf("command failed: %v", err)
		}
	}
	state := func(want TeamTaskState, bound bool) {
		t.Helper()
		task, ok, err := lead.TeamTask(46)
		row := lead.boardItemByID(46)
		if err != nil || !ok || task.State != want || row == nil || (row.WS != "") != bound {
			t.Fatalf("state=%+v board=%+v error=%v", task, row, err)
		}
		t.Logf("state=%s workspace=%s board_workspace=%s returned=%v done=%s", task.State, task.WS, row.WS, !row.ReturnedAt.IsZero(), row.DoneAt)
	}
	if err := lead.ClaimTeamWorkspace("discord:chat1", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	call("discord:chat1", lead.name, binary, "workspace", "claim", "ws1", "--board", "46")
	state(TeamTaskDispatched, true)
	report := func(phase, kind string) {
		t.Helper()
		body := fmt.Sprintf("[report] #46 背景：分批交回。\n%s\n要你做的：没有\n我加的：无\n细节：\n入口自验：\n```\nok\n```\n", phase)
		if err := os.WriteFile(draft, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		call("discord:ws1", worker.name, "python3", "-I", filepath.Join(root, "lead", "ws-up"), "--notes", notes, "--report", draft, kind)
	}
	pass := func() {
		t.Helper()
		call("discord:chat1", lead.name, "python3", "-I", filepath.Join(root, "lead", "ws-pass"), "--id", "46", "--verdict", "交付与证据相符")
	}
	report("第一批完成", "--batch")
	pass()
	state(TeamTaskDispatched, true)
	report("第二批完成", "--batch")
	cache, _ := json.Marshal(map[string]any{"tasks": map[string]any{notes: map[string]any{"file": notes, "channel": "ws1", "chat": "discord:chat1", "project": worker.name, "board": []int{46}}}})
	if err := os.WriteFile(filepath.Join(data, "ws-handoff-last.json"), cache, 0600); err != nil {
		t.Fatal(err)
	}
	call("discord:chat1", lead.name, "python3", "-I", filepath.Join(root, "lead", "ws-forward"), "--id", "46", "第二批补证据后重交")
	state(TeamTaskDispatched, true)
	report("第二批完成", "--batch")
	pass()
	state(TeamTaskDispatched, true)
	report("最终交回", "--final")
	state(TeamTaskReturned, false)
	pass()
	state(TeamTaskClosed, false)
	if len(p.sentTo("discord:chat1")) != 3 {
		t.Fatalf("accepted deliveries=%q", p.sentTo("discord:chat1"))
	}
}
