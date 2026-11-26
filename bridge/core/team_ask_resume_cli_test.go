package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// askGuild lets the real `workspace list` see the chat channel and its two workspaces.
type askGuild struct {
	*reportTestPlatform
	channels []TeamChannel
}

func (g *askGuild) TeamGuildChannels(_ context.Context, id string) (TeamChannel, []TeamChannel, error) {
	for _, c := range g.channels {
		if c.ID == id {
			return c, g.channels, nil
		}
	}
	return TeamChannel{}, nil, fmt.Errorf("unknown channel %s", id)
}

func (g *askGuild) CreateTeamWorkspaceChannel(context.Context, string, string) (TeamChannel, error) {
	return TeamChannel{}, errors.New("this guild makes no new workspace")
}

// askAgent gives every engine session its own agent session, so the test can end one turn while
// another runs (the workspace's turn and the chat channel's turn that gets the question).
type askAgent struct {
	stubAgent
	n     atomic.Int32
	turns chan askTurn
}

func (a *askAgent) StartSession(_ context.Context, id string) (AgentSession, error) {
	if id == "" {
		id = fmt.Sprintf("agent-%d", a.n.Add(1))
	}
	return &askSession{id: id, events: make(chan Event, 8), turns: a.turns}, nil
}

type askSession struct {
	stubAgentSession
	id     string
	events chan Event
	turns  chan askTurn
}

func (s *askSession) Events() <-chan Event     { return s.events }
func (s *askSession) CurrentSessionID() string { return s.id }
func (s *askSession) Send(p, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.turns <- askTurn{s, p}
	return nil
}

// askTurn is one running turn of the worker: the agent session it runs in and its prompt.
type askTurn struct {
	s      *askSession
	prompt string
}

func (t askTurn) done(text string) {
	t.s.events <- Event{Type: EventResult, Done: true, Content: text, SessionID: t.s.id}
}

// askCUJ is task #46 of chat1 at work in 工作区2 (ws2) with 工作区1 (ws1) free, the 11-21 #928
// scene: the worker's first turn there is running.
type askCUJ struct {
	t              *testing.T
	lead, worker   *Engine
	agent          *askAgent
	binary, root   string
	notes, handoff string
}

func (f *askCUJ) call(session, project string, argv ...string) string {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "CC_SESSION_KEY="+session, "CC_PROJECT="+project)
	if session == "discord:ws2" {
		cmd.Env = append(cmd.Env, "CC_HANDOFF="+f.handoff) // what the bridge gives the workspace's process
	}
	out, err := cmd.CombinedOutput()
	f.t.Logf("$ %s\n%s", strings.Join(argv, " "), out)
	if err != nil {
		f.t.Fatalf("command failed: %v", err)
	}
	return string(out)
}

func (f *askCUJ) wait(what string, ok func() bool) {
	f.t.Helper()
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if ok() {
			return
		}
	}
	f.t.Fatalf("timed out waiting for %s", what)
}

// working logs and returns where task #46 is and which workspaces have a turn running.
func (f *askCUJ) working() (TeamTask, []string) {
	f.t.Helper()
	task, _, err := f.lead.TeamTask(46)
	if err != nil {
		f.t.Fatal(err)
	}
	var turns []string
	for _, ws := range []string{"discord:ws1", "discord:ws2"} {
		if teamTurnRunning(ws) {
			turns = append(turns, ws)
		}
	}
	f.t.Logf("#46 state=%s workspace=%q; workspaces with a turn running: %v", task.State, task.WS, turns)
	return task, turns
}

// next is the worker's next turn to start; its prompt carries want.
func (f *askCUJ) next(want string) askTurn {
	f.t.Helper()
	select {
	case turn := <-f.agent.turns:
		if !strings.Contains(turn.prompt, want) {
			f.t.Fatalf("turn in agent session %s got %q, want %q", turn.s.id, turn.prompt, want)
		}
		f.t.Logf("turn started in agent session %s: %s", turn.s.id, want)
		return turn
	case <-time.After(20 * time.Second):
		f.t.Fatalf("no turn started with %q", want)
		return askTurn{}
	}
}

// ask: the workspace's turn runs ws-up --ask. The question wakes the asking role's own session
// in the chat channel (ws-up: timer add -p <its project> -s <chat>).
func (f *askCUJ) ask() {
	f.t.Helper()
	f.call("discord:ws2", f.worker.name, "python3", "-I", filepath.Join(f.root, "lead", "ws-up"), "--notes", f.notes,
		"问题：汇报走 A 还是走 B\n背景：两种做法都能交，用户没说\n选项与推荐：\n- A 只改文案\n- B 连格式一起改\n推荐：B，因为格式也不对\n自验：无", "--ask")
	f.next("走 A 还是走 B").done("等主角色定")
}

// answer: the role's chat-channel session forwards the lead's decision (as on 11-21: 「定案（devin
// 聊天频道会话定的…）：走 B」); ws-forward has ws-handoff --resume hand the task to a workspace again.
func (f *askCUJ) answer() {
	f.t.Helper()
	f.call("discord:chat1", f.worker.name, "python3", "-I", filepath.Join(f.root, "lead", "ws-forward"), "--id", "46", "定案：走 B")
}

func askFixture(t *testing.T) *askCUJ {
	t.Helper()
	binary := os.Getenv("CONEST_PROGRESS_BINARY")
	if binary == "" {
		t.Skip("candidate executable required")
	}
	binary, _ = filepath.Abs(binary)
	lead, p, _, item := heldFixture(t)
	guild := &askGuild{reportTestPlatform: p, channels: []TeamChannel{
		{ID: "chat1", Name: "主频道", ParentID: "cat"}, {ID: "ws1", Name: "工作区1", ParentID: "cat"}, {ID: "ws2", Name: "工作区2", ParentID: "cat"}}}
	lead.platforms = []Platform{guild}
	lead.platformReady = map[Platform]bool{guild: true}
	worker, wp := reportFixture(t)
	agent := &askAgent{turns: make(chan askTurn, 8)}
	worker.name, worker.dataDir, worker.agent = "worker", lead.dataDir, agent
	worker.SetTeam(lead.team.dir, "Worker", false)
	worker.platformReady = map[Platform]bool{wp: true}
	lead.SetTeamWorkspaces(true)
	rm := NewRelayManager("")
	rm.RegisterEngine(lead.name, lead)
	rm.RegisterEngine(worker.name, worker)
	lead.SetRelayManager(rm)
	worker.SetRelayManager(rm)
	worker.timerScheduler = lead.timerScheduler
	lead.timerScheduler.RegisterEngine(lead.name, lead)
	lead.timerScheduler.RegisterEngine(worker.name, worker)
	root, _ := filepath.Abs("../contrib")
	data := lead.dataDir
	t.Setenv("HOME", data)
	t.Setenv("CC_DATA_DIR", data)
	t.Setenv("BOTHOUSE_DATA_DIR", data)
	t.Setenv("GATE_SETUP_DIR", data)
	t.Setenv("BOARD_DIR", lead.team.dir)
	t.Setenv("GATE_DIR", filepath.Join(root, "gate"))
	t.Setenv("CC_BIN", binary)
	t.Setenv("CC_RUNS_DIR", filepath.Join(data, "runs"))
	t.Setenv("BOTHOUSE_TEST", "1")
	// As in TestCUJ_WorkspaceBatchCLI: the real board script, its nested calls to the candidate CLI.
	bin := filepath.Join(data, "collaboration", "runtime", "lead", "board")
	if err := os.MkdirAll(filepath.Dir(bin), 0755); err != nil {
		t.Fatal(err)
	}
	script := fmt.Sprintf("#!/bin/sh\nexport CC_BIN='%s'\nexec python3 -I '%s' \"$@\"\n", binary, filepath.Join(root, "gate", "board.py"))
	if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	notes := filepath.Join(data, "notes.md")
	if err := os.WriteFile(notes, []byte("# 修汇报\n\n## 用户原话\n- 把汇报改好。\n\n## 总目标\n汇报能看懂。\n\n## 范围\n- 改：汇报。\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cache, _ := json.Marshal(map[string]any{"tasks": map[string]any{notes: map[string]any{"file": notes, "channel": "ws2", "chat": "discord:chat1", "project": worker.name, "board": []int{46}}}})
	if err := os.WriteFile(filepath.Join(data, "ws-handoff-last.json"), cache, 0600); err != nil {
		t.Fatal(err)
	}
	api, err := NewAPIServer(data)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine(lead.name, lead)
	api.RegisterEngine(worker.name, worker)
	api.SetTimerScheduler(lead.timerScheduler)
	api.server = &http.Server{Handler: api.mux}
	go api.server.Serve(api.listener)
	t.Cleanup(api.Stop)

	f := &askCUJ{t: t, lead: lead, worker: worker, agent: agent, binary: binary, root: root, notes: notes}
	f.call("discord:chat1", lead.name, binary, "workspace", "claim", "--session-key", "discord:chat1", "--title", "修汇报", "--board", "46", "ws2")
	f.handoff = worker.workspaceHandoffID("discord:ws2")
	// The board row is bound after the claim, as ws-handoff does (board.rebind): a park names the
	// handoff made at or before that moment.
	item.Where, item.Bound = notes, time.Now().UTC().Format(time.RFC3339Nano)
	item.WS, item.Who, item.Status = "discord:ws2", "工作区2worker", "在做"
	row, _ := json.Marshal(item)
	var fields map[string]any
	_ = json.Unmarshal(row, &fields)
	fields["dispatcher"] = worker.name // board.py: the project that works the task
	row, _ = json.Marshal(fields)
	if err := os.WriteFile(filepath.Join(lead.team.dir, team.TaskBoardFile), append(row, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	f.call("discord:chat1", lead.name, binary, "timer", "add", "-p", worker.name, "-s", "discord:ws2", "--delay", "1s", "--timeout-mins", "0",
		"--handoff", "--desc", "修汇报", "--prompt", "你是工作区频道里的主角色，从主频道接手一整块大活：修汇报（任务板 #46）。")
	return f
}

// The chain a workspace uses to ask: ws-up --ask from its own turn → the lead answers
// (ws-forward) → the task goes on. One task has one session at any moment. Run both with
// CONEST_PROGRESS_BINARY pointing at the candidate executable; scripts, CLI, the Unix socket
// API, task state, timers and both engines are real, only the model and the chat platform are
// stubs. (Short names: the test's temp dir holds the API socket, and a socket path is short.)
//
// 11-21 15:01 #928: the answer came while the asking turn still ran in 工作区7; it was handed
// to the free 工作区1 with a copy of the session, and both worked on the task.
func TestCUJ_AskInTurnCLI(t *testing.T) {
	f := askFixture(t)
	first := f.next("接手一整块大活")
	session := f.worker.sessions.GetOrCreateActive("discord:ws2").ID
	f.ask()
	if task, turns := f.working(); task.State != TeamTaskPaused || len(turns) != 1 || turns[0] != "discord:ws2" {
		t.Fatalf("after the ask: task %+v, turns %v; want paused with its turn still running in ws2", task, turns)
	}
	f.answer()
	f.wait("the resumed task's wake", func() bool {
		if teamTurnRunning("discord:ws1") {
			return true
		}
		for _, j := range f.lead.timerScheduler.store.List() {
			if j.Handoff && j.Fired && strings.Contains(j.Prompt, "定案：走 B") {
				return true
			}
		}
		return false
	})
	if task, turns := f.working(); task.WS != "discord:ws2" || len(turns) != 1 || turns[0] != "discord:ws2" {
		t.Fatalf("after the answer: task in %q, turns running in %v; want only ws2, where the asking turn runs", task.WS, turns)
	}
	first.done("不受影响的部分做完了")
	resumed := f.next("定案：走 B")
	if task, turns := f.working(); task.WS != "discord:ws2" || len(turns) != 1 || turns[0] != "discord:ws2" {
		t.Fatalf("answer's turn: task in %q, turns running in %v; want only ws2", task.WS, turns)
	}
	if cur := f.worker.sessions.GetOrCreateActive("discord:ws2").ID; cur != session || resumed.s.id != first.s.id {
		t.Fatalf("answer's turn runs in session %s (agent session %s), want %s (%s): the session that asked", cur, resumed.s.id, session, first.s.id)
	}
	resumed.done("按 B 做完了")
}

// 11-21 15:24 #928: the asking turn had ended and its workspace was back in the pool when the
// command it started ended; that wake opened a fresh session in the old workspace, which
// worked on the paused task next to the session the answer resumed.
func TestCUJ_AskBgWakeCLI(t *testing.T) {
	f := askFixture(t)
	first := f.next("接手一整块大活")
	f.ask()
	// The turn starts a command with bgrun and ends; bgrun wakes "its session" when the command ends.
	f.call("discord:ws2", f.worker.name, "python3", filepath.Join(f.root, "lead", "bgrun"), "cuj", "30", "sleep", "2")
	first.done("只剩等后台命令和答复，结束本轮")
	f.wait("ws2 given back", func() bool { _, owned := f.lead.WorkspaceParent("ws2"); return !owned })
	var wake *TimerJob
	f.wait("the command's wake to come due", func() bool {
		for _, j := range f.lead.timerScheduler.store.List() {
			if strings.HasPrefix(j.Description, "bgrun 结束") {
				wake = j
			}
		}
		return wake != nil && (time.Since(wake.ScheduledAt) > time.Second || teamTurnRunning("discord:ws2"))
	})
	if task, turns := f.working(); task.State != TeamTaskPaused || len(turns) != 0 || f.lead.timerScheduler.store.Get(wake.ID).Fired {
		t.Fatalf("command ended while the task waits for its answer: task %+v, turns %v, wake fired=%v; want no session working on it",
			task, turns, f.lead.timerScheduler.store.Get(wake.ID).Fired)
	}
	f.answer()
	resumed := f.next("定案：走 B")
	task, turns := f.working()
	if len(turns) != 1 || turns[0] != task.WS {
		t.Fatalf("after the answer: task in %q, turns running in %v; want one turn, in its workspace", task.WS, turns)
	}
	resumed.done("按 B 接着做")
	woken := f.next("后台命令结束")
	if got := f.lead.timerScheduler.store.Get(wake.ID).SessionKey; got != task.WS || woken.s.id != resumed.s.id {
		t.Fatalf("the command's wake went to %s (agent session %s), want the resumed task's session: %s (%s)", got, woken.s.id, task.WS, resumed.s.id)
	}
	woken.done("看过后台命令结果")
}
