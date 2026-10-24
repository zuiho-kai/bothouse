package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// Two chat channels share pool workspace ws1: each report goes back to the chat that handed
// off its own task, not to the chat that claimed ws1 last.
func TestWorkspaceReportGoesToItsTaskOrigin(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	taskA, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	if !taskRef.MatchString(taskA) || taskA == taskB {
		t.Fatalf("task ids %q %q", taskA, taskB)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n"+taskA+" A 的活做完")
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n"+taskB+" B 的活做完")
	if got := p.sentTo("discord:chatA"); len(got) != 1 || !strings.Contains(got[0], "A 的活做完") {
		t.Fatalf("chatA got %q", got)
	}
	if got := p.sentTo("discord:chatB"); len(got) != 1 || !strings.Contains(got[0], "B 的活做完") {
		t.Fatalf("chatB got %q", got)
	}
	// An ask follows its task too, and the answer is taken only from that chat's ask record.
	id := e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n"+taskA+" 选哪个")
	if id == "" || len(p.sentTo("discord:chatA")) != 2 {
		t.Fatalf("ask not forwarded to chatA: %q", p.sentTo("discord:chatA"))
	}
	if e.takeAsk(id, "discord", "chatB") != nil {
		t.Fatal("ask answerable from the wrong chat")
	}
	if e.takeAsk(id, "discord", "chatA") == nil {
		t.Fatal("ask not recorded for chatA")
	}
}

// A report that names no task, from a workspace holding tasks of two chats, is not sent to the
// chat that claimed last (nor to any chat); the workspace gets a notice listing the tasks.
func TestWorkspaceReportAmbiguousIsNotGuessed(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	taskA, _ := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	taskB, _ := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1")
	if id := e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n没写是哪件"); id != "" {
		t.Fatalf("ambiguous ask forwarded as %s", id)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n没写是哪件")
	if a, b := p.sentTo("discord:chatA"), p.sentTo("discord:chatB"); len(a)+len(b) != 0 {
		t.Fatalf("guessed a chat: A=%q B=%q", a, b)
	}
	var notes []string
	for _, n := range p.sentTo(exitWSKey) {
		if strings.Contains(n, "没有转发") {
			notes = append(notes, n)
		}
	}
	if len(notes) != 2 || !strings.Contains(notes[0], taskA) || !strings.Contains(notes[0], taskB) {
		t.Fatalf("workspace notice = %q", notes)
	}
}

// One chat handing off several tasks to a workspace needs no task id.
func TestWorkspaceReportSingleOriginNeedsNoTaskID(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	_, _ = e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	_, _ = e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做完")
	if len(p.sentTo("discord:chatA")) != 1 {
		t.Fatalf("chatA got %q", p.sentTo("discord:chatA"))
	}
}

// A finished task (its workspace session reset) no longer makes a later chat's plain report
// ambiguous: A hands off, A's task closes, B hands off, B's plain report reaches B.
func TestWorkspaceReportAfterClosedTaskReachesNewChat(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	if _, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.closeWorkspaceHandoffs(exitWSKey, time.Now())
	taskB, err := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做好了")
	if got := p.sentTo("discord:chatB"); len(got) != 1 || !strings.Contains(got[0], "做好了") {
		t.Fatalf("chatB got %q", got)
	}
	if got := p.sentTo("discord:chatA"); len(got) != 0 {
		t.Fatalf("chatA got %q", got)
	}
	// A handoff claimed after the session's last activity is not closed by the reset.
	e.closeWorkspaceHandoffs(exitWSKey, time.Now().Add(-time.Hour))
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n还在做")
	if len(p.sentTo("discord:chatB")) != 2 {
		t.Fatalf("open task closed early: %q", p.sentTo("discord:chatB"))
	}
	_ = taskB
}

// The workspace receives the task id with the handoff, so it can quote it in [ask]/[report].
func TestWorkspaceHandoffNoticeCarriesTaskID(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	task, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	got := p.sentTo("discord:ws1")
	if len(got) != 1 || !strings.Contains(got[0], task) {
		t.Fatalf("workspace handoff notice = %q (task %s)", got, task)
	}
}

// exitPoolPlatform is exitTestPlatform that lists the pool with a settable in-progress count
// for ws1, the count the pool uses for busy (TeamChannel.Active).
type exitPoolPlatform struct {
	*exitTestPlatform
	mu     sync.Mutex
	active int
	known  bool // ActiveKnown: true like cloud_web/DSH, false like Discord/Feishu
}

func (p *exitPoolPlatform) setActive(n int) { p.mu.Lock(); p.active = n; p.mu.Unlock() }
func (p *exitPoolPlatform) TeamGuildChannels(_ context.Context, id string) (TeamChannel, []TeamChannel, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	all := []TeamChannel{{ID: "chatA", Name: "聊天A"}, {ID: "chatB", Name: "聊天B"}, {ID: "ws1", Name: "工作区1", Active: p.active, ActiveKnown: p.known}}
	for _, c := range all {
		if c.ID == id {
			return c, all, nil
		}
	}
	return TeamChannel{ID: id}, all, nil
}
func (p *exitPoolPlatform) CreateTeamWorkspaceChannel(context.Context, string, string) (TeamChannel, error) {
	return TeamChannel{}, nil
}

func exitPoolFixture(t *testing.T, known bool) (*Engine, *exitPoolPlatform) {
	t.Helper()
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &exitPoolPlatform{exitTestPlatform: &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}, known: known}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	return e, p
}

// A's task ends (the workspace has no tasks in progress; no idle reset, no /new), B hands off:
// the claim closes A's handoff, so B's plain report reaches B.
func TestWorkspaceClaimOnIdleWorkspaceClosesEarlierTasks(t *testing.T) {
	e, p := exitPoolFixture(t, true)
	if _, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.setActive(0) // A's work is done
	if _, err := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做好了")
	if got := p.sentTo("discord:chatB"); len(got) != 1 || !strings.Contains(got[0], "做好了") {
		t.Fatalf("chatB got %q", got)
	}
	if got := p.sentTo("discord:chatA"); len(got) != 0 {
		t.Fatalf("chatA got %q", got)
	}
}

// A's task is still in progress when B hands off: A's handoff stays open and a plain report
// is ambiguous (sent to neither chat).
func TestWorkspaceClaimOnBusyWorkspaceKeepsEarlierTasks(t *testing.T) {
	e, p := exitPoolFixture(t, true)
	if _, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.setActive(1) // A's work is in progress
	if _, err := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做好了")
	if a, b := p.sentTo("discord:chatA"), p.sentTo("discord:chatB"); len(a)+len(b) != 0 {
		t.Fatalf("guessed a chat: A=%q B=%q", a, b)
	}
}

// Discord/Feishu do not count tasks (Active is always 0, ActiveKnown false): a claim closes
// nothing, so A's still-running task keeps its handoff. A plain report is not sent to the last
// claimer B; the workspace is told to resend with a task id, and "[report] <id>" reaches the
// chat that handed off that task.
func TestWorkspaceClaimWithUnknownActiveKeepsEarlierTasks(t *testing.T) {
	e, p := exitPoolFixture(t, false)
	taskA, err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := e.ClaimTeamWorkspaceTask("discord:chatB", "ws1", "工作区1")
	if err != nil {
		t.Fatal(err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做好了")
	if a, b := p.sentTo("discord:chatA"), p.sentTo("discord:chatB"); len(a)+len(b) != 0 {
		t.Fatalf("guessed a chat: A=%q B=%q", a, b)
	}
	var note string
	for _, n := range p.sentTo(exitWSKey) {
		if strings.Contains(n, "没有转发") {
			note = n
		}
	}
	if !strings.Contains(note, taskA) || !strings.Contains(note, taskB) || !strings.Contains(note, "[report] task-") {
		t.Fatalf("ambiguity notice = %q", note)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report] "+taskA+"\nA 的活做完")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] "+taskB+"\nB 的活做完")
	if got := p.sentTo("discord:chatA"); len(got) != 1 || !strings.Contains(got[0], "A 的活做完") {
		t.Fatalf("chatA got %q", got)
	}
	if got := p.sentTo("discord:chatB"); len(got) != 1 || !strings.Contains(got[0], "B 的活做完") {
		t.Fatalf("chatB got %q", got)
	}
}
