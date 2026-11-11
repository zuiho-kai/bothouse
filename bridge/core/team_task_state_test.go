package core

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// #699: the state of a task changes only through transitionTeamTaskLocked, in the allowed steps,
// and every change is one line of the event log.
func TestTeamTaskTransitions(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	step := func(ev teamTaskEvent) (TeamTask, error) {
		teamWorkspaceStore.mu.Lock()
		defer teamWorkspaceStore.mu.Unlock()
		return transitionTeamTaskLocked(dir, ev, now)
	}
	if _, err := step(teamTaskEvent{ID: 5, To: TeamTaskPaused}); !errors.Is(err, ErrTeamTaskTransition) {
		t.Fatalf("pause of an unknown task = %v, want refused", err)
	}
	got, err := step(teamTaskEvent{ID: 5, To: TeamTaskDispatched, WS: "discord:ws1:u1", Chat: "discord:main", By: "claim"})
	if err != nil || got.State != TeamTaskDispatched || got.WS != "discord:ws1" {
		t.Fatalf("dispatch = %+v, %v", got, err)
	}
	if got, err = step(teamTaskEvent{ID: 5, To: TeamTaskWorking}); err != nil || got.WS != "discord:ws1" {
		t.Fatalf("working = %+v, %v", got, err)
	}
	if got, err = step(teamTaskEvent{ID: 5, To: TeamTaskPaused, Why: "watch: no progress"}); err != nil || got.WS != "" || got.Why != "watch: no progress" || got.Chat != "discord:main" {
		t.Fatalf("paused = %+v, %v (leaves the workspace, keeps the chat)", got, err)
	}
	if _, err = step(teamTaskEvent{ID: 5, To: TeamTaskWorking}); !errors.Is(err, ErrTeamTaskTransition) {
		t.Fatalf("paused → working = %v, want refused (a resume dispatches again)", err)
	}
	if _, err = step(teamTaskEvent{ID: 5, To: TeamTaskClosed}); err != nil {
		t.Fatal(err)
	}
	if _, err = step(teamTaskEvent{ID: 5, To: TeamTaskDispatched, WS: "discord:ws2"}); !errors.Is(err, ErrTeamTaskTransition) {
		t.Fatalf("closed → dispatched = %v, want refused", err)
	}
	log, err := os.ReadFile(filepath.Join(dir, teamTaskLogFile))
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(log), "\n"); n != 4 {
		t.Fatalf("event log has %d lines, want 4 applied transitions:\n%s", n, log)
	}
}

// cancelCountSession is a running turn that only records CancelTurn.
type cancelCountSession struct {
	mu      sync.Mutex
	cancels int
	events  chan Event
}

func (s *cancelCountSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	return nil
}
func (s *cancelCountSession) CancelTurn() error {
	s.mu.Lock()
	s.cancels++
	s.mu.Unlock()
	return nil
}
func (s *cancelCountSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *cancelCountSession) Events() <-chan Event                             { return s.events }
func (s *cancelCountSession) CurrentSessionID() string                         { return "running-1" }
func (s *cancelCountSession) Alive() bool                                      { return true }
func (s *cancelCountSession) Close() error                                     { return nil }

// #698 ①③ (11-11 15:42, 工作区3): the watch parked #677 for no progress but its turn kept running
// (team_watch.go:174 parked with stop=false), and the drain handed #679 to the same workspace while
// it ran. The watch's park now stops the turn before the workspace is given back, and the task's
// state says paused with the watch's reason.
func TestWatchParkStopsTheRunningTurn(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#677 Win DSH", 677); err != nil {
		t.Fatal(err)
	}
	running := &cancelCountSession{events: make(chan Event, 1)}
	e.interactiveMu.Lock()
	e.interactiveStates["discord:ws1:u1"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()

	s := &APIServer{engines: map[string]*Engine{"lead": e}}
	h := handoffsOf(e, "discord:ws1")[0]
	freed, err := s.watchPark(e)("discord:ws1", h.Chat, h.At)
	if err != nil || !freed {
		t.Fatalf("watch park = %v, %v", freed, err)
	}
	running.mu.Lock()
	cancels := running.cancels
	running.mu.Unlock()
	if cancels != 1 {
		t.Fatalf("running turn cancelled %d times by the watch's park, want 1", cancels)
	}
	task, ok := e.TeamTask(677)
	if !ok || task.State != TeamTaskPaused || task.WS != "" || task.Why != "watch: no progress" {
		t.Fatalf("task #677 = %+v, want paused by the watch, out of the workspace", task)
	}
}

// ws-up --ask parks from inside the workspace's own turn: that turn is not stopped (its reply is
// the [ask]), and the state still records the pause.
func TestSelfParkKeepsItsOwnTurn(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#5 问用户", 5); err != nil {
		t.Fatal(err)
	}
	running := &cancelCountSession{events: make(chan Event, 1)}
	e.interactiveMu.Lock()
	e.interactiveStates["discord:ws1:u1"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	if freed, err := e.ParkTeamWorkspace("discord:ws1"); err != nil || !freed {
		t.Fatalf("self park = %v, %v", freed, err)
	}
	if running.cancels != 0 {
		t.Fatal("a park from inside the turn stopped that turn")
	}
	if task, _ := e.TeamTask(5); task.State != TeamTaskPaused {
		t.Fatalf("task #5 = %+v, want paused", task)
	}
}

// #698 ② (11-11 16:05/16:15): after the watch paused #677 (the board row untouched, still on
// 工作区3), #679 was handed to the same workspace and its renewals were written onto #677's row:
// the watch found "the row of this workspace" by guessing (handoffBoardID). The row is now the one
// the claim named, and only while that task's state is in work there.
func TestProgressOfNextTaskDoesNotLandOnPausedRow(t *testing.T) {
	e, p, w, h := progressFixtureBoard(t, "<@"+k5aOwner+">", 677)
	boardDir := e.teamStatusDir()
	rows := `{"id":677,"what":"Win DSH","status":"在做：装 DSH","who":"工作区1橘","ws":"discord:ws1","chat":"discord:chatA","at":"11-11 15:00"}` + "\n" +
		`{"id":679,"what":"下一件","status":"已交接","who":"工作区1橘","chat":"discord:chatA","at":"11-11 15:52"}` + "\n"
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err != nil {
		t.Fatal(err)
	}
	// #679 claimed the way ws-handoff did on 11-11 (no board id on the claim).
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", "<@"+k5aOwner+">", "下一件"); err != nil {
		t.Fatal(err)
	}
	next := handoffsOf(e, "discord:ws1")[1]
	now := next.At.Add(10 * time.Minute)
	p.post("ws1", k5aOwner, "在做下一件", now.Add(-time.Minute))
	w.markBoardProgress("discord:ws1", next, next.At, now)
	if got := boardItemOf(t, boardDir, 677); got.ProgressAt != 0 || got.Status != "在做：装 DSH" {
		t.Fatalf("paused #677's row was written by the next task's renewal: %+v", got)
	}
	// Claimed with its board id, #679 gets its own row.
	if _, err := e.ParkTeamWorkspaceFor("discord:ws1", "discord:chatA", next.At); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "<@"+k5aOwner+">", "下一件", 679); err != nil {
		t.Fatal(err)
	}
	third := handoffsOf(e, "discord:ws1")[2]
	w.markBoardProgress("discord:ws1", third, third.At, now)
	if got := boardItemOf(t, boardDir, 677); got.ProgressAt != 0 {
		t.Fatalf("#677 written: %+v", got)
	}
	if task, _ := e.TeamTask(679); task.State != TeamTaskWorking {
		t.Fatalf("task #679 = %+v, want working after its first progress", task)
	}
}

// #698 ④ (11-11 15:43:13): a message of #677 held through the quota cooldown was re-delivered
// after #677 was paused, opening a turn of the paused task on the workspace's fresh session.
func TestHeldMessageOfPausedTaskIsNotRedelivered(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#677", 677); err != nil {
		t.Fatal(err)
	}
	ref := e.capHandoffAt("discord:ws1:u1")
	if ref.key == "" {
		t.Fatal("held message carries no handoff")
	}
	if !e.stillOwnsHandoff(ref) {
		t.Fatal("held message of a task in work is dropped")
	}
	if _, err := e.ParkTeamWorkspaceWhy("discord:ws1", "discord:chatA", time.Time{}, "watch: no progress", true); err != nil {
		t.Fatal(err)
	}
	if e.stillOwnsHandoff(ref) {
		t.Fatal("held message of the paused task would be re-delivered into the workspace")
	}
}

// 隔离实例走一遍 11-11 工作区3 的时间线（#699 方向④：每批在隔离实例上用真实入口走新状态机）：真引擎 +
// 真 APIServer（认领、暂停走 HTTP 处理函数）+ 真看门循环（BOTHOUSE_WATCH_TEST_SECONDS=1）+ 真
// contrib/gate/board.py 的板文件，数据目录、任务板都在临时目录，不连平台。#677 认领后一直没进展、
// 轮次还在跑 → 看门暂停它：轮次被停、状态记 paused、工作区放回；#679 认领进同一工作区、有进展 →
// 只写 #679 那一行，#677 那行一个字不动。
func TestTaskStateIsolatedInstanceWalk(t *testing.T) {
	setWatchCheckAfter(t, watchCheckAfter())
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "1")
	e, _, p := exitFixture(t, nil)
	hp := &historyTestPlatform{exitTestPlatform: p}
	e.platforms = []Platform{hp}
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(e.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	e.productPyBin.Store(t.TempDir())
	boardDir := t.TempDir()
	e.SetTeam(boardDir, "橘", true)
	rows := `{"id":677,"what":"Win DSH","short":"WinDSH","status":"已交接","who":"工作区1橘","ws":"discord:ws1","sk":"discord:ws1","chat":"discord:chatA","at":"11-11 15:00"}` + "\n" +
		`{"id":679,"what":"下一件","short":"下一件","status":"排队","who":"待接手","chat":"discord:chatA","at":"11-11 15:40"}` + "\n"
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	e.markPlatformReady(hp)
	e.teamWS = newTeamWorkspaces()
	s := &APIServer{engines: map[string]*Engine{"orange": e}}
	claim := func(body string) {
		t.Helper()
		rec := httptest.NewRecorder()
		s.handleTeamWorkspaceClaim(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/claim", strings.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("claim %s: %d %s", body, rec.Code, rec.Body.String())
		}
	}
	s.startHandoffWatch()
	t.Cleanup(func() { s.Stop() })
	// 15:22 #677 交给工作区1（ws-handoff 现在带 --board），工作区里一轮在跑、一直没发进展。
	claim(`{"session_key":"discord:chatA","workspace_id":"ws1","name":"工作区1","owner":"<@` + k5aOwner + `>","title":"#677 WinDSH","board":677}`)
	running := &cancelCountSession{events: make(chan Event, 1)}
	e.interactiveMu.Lock()
	e.interactiveStates["discord:ws1:u1"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()

	waitFor := func(what string, ok func() bool) {
		t.Helper()
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			if ok() {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatalf("隔离实例：等不到%s", what)
	}
	waitFor("看门暂停 #677", func() bool { tk, _ := e.TeamTask(677); return tk.State == TeamTaskPaused })
	tk, _ := e.TeamTask(677)
	running.mu.Lock()
	cancels := running.cancels
	running.mu.Unlock()
	t.Logf("#677 状态：%+v；在跑的那一轮被停 %d 次", tk, cancels)
	if cancels < 1 {
		t.Fatal("看门暂停了 #677，但工作区里那一轮没被停")
	}
	if _, owned := e.WorkspaceParent("ws1"); owned {
		t.Fatal("#677 暂停后工作区1 仍被占着")
	}
	// 15:52 #679 进同一工作区，有进展。
	claim(`{"session_key":"discord:chatA","workspace_id":"ws1","name":"工作区1","owner":"<@` + k5aOwner + `>","title":"#679 下一件","board":679}`)
	// ws-handoff 认领后把板上 #679 改成已交接、绑工作区1（board.update + board.rebind，真 board.py 来写）。
	if out, err := e.runLeadScript("discord:chatA", "board", "update", "679", "已交接"); err != nil {
		t.Fatalf("board update: %v %s", err, out)
	}
	raw, _ := os.ReadFile(filepath.Join(boardDir, teamTaskBoardFile))
	bound := strings.Replace(string(raw), `"id": 679,`, `"id": 679, "ws": "discord:ws1", "sk": "discord:ws1",`, 1)
	bound = strings.Replace(bound, `"id":679,`, `"id":679,"ws":"discord:ws1","sk":"discord:ws1",`, 1)
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(bound), 0o644); err != nil {
		t.Fatal(err)
	}
	h := handoffsOf(e, "discord:ws1")[1]
	hp.post("ws1", k5aOwner, "@橘 #679 在改", h.At.Add(time.Millisecond))
	j := e.turnJournalStore()
	en, err := j.Begin(TurnJournalEntry{InteractiveKey: "discord:ws1:u1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := j.Progress(en.TurnID, "Bash # 改 #679", "", true); err != nil {
		t.Fatal(err)
	}
	waitFor("#679 的进展写回", func() bool { return boardItemOf(t, boardDir, 679).ProgressAt != 0 })
	if got := boardItemOf(t, boardDir, 677); got.ProgressAt != 0 || got.Status != "已交接" {
		t.Fatalf("#679 的续期写到了 #677：%s", readBoardLine(t, boardDir, 677))
	}
	t.Logf("#677 行：%s", readBoardLine(t, boardDir, 677))
	t.Logf("#679 行：%s", readBoardLine(t, boardDir, 679))
	log, _ := os.ReadFile(filepath.Join(e.dataDir, teamTaskLogFile))
	t.Logf("状态事件日志：\n%s", log)
}
