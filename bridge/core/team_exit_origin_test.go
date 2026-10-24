package core

import (
	"strings"
	"testing"
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
	notes := p.sentTo(exitWSKey)
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
