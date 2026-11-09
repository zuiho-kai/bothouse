package core

import (
	"strings"
	"testing"
)

// agentm #26 (11-09): a workspace ran `board pause` on its own task inside its own turn. board.py
// now only records pause_req there (no park, no reset); the turn must still owe a [report], and
// that report reaches the chat channel through the usual path.
func TestWorkspaceSelfPauseOwesReport(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	p.n = "discord"
	key, parent := "discord:ws1", "discord:chat1"
	dir := t.TempDir()
	e.SetTeam(dir, "橘", false)
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{
		Parents: map[string][]TeamWorkspace{parent: {{ID: "ws1", Name: "工作区1"}}},
		Version: teamWorkspaceStateVersion,
	})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	row := func(req string) string {
		return `{"id":666,"what":"deliver draft","who":"工作区1橘","sk":"` + key + `","status":"在做","pause_req":"` + req + `"}` + "\n"
	}
	writeTaskBoard(t, dir, teamTaskBoardFile, row(""))
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "discord", ChannelID: "ws1", UserID: "u", Content: "finish the draft", Mentioned: true, ReplyCtx: key})
	inputPrompt(t, a)
	old := e.sessions.ActiveSessionID(key)
	// inside the turn: board pause 666 → board.py self_pause writes pause_req
	writeTaskBoard(t, dir, teamTaskBoardFile, row("十分钟上限：传输没完成"))
	inputDone(a, "遵照十分钟边界，本轮停在这里。")
	prompt := inputPrompt(t, a)
	if !strings.Contains(prompt, "记了停手") || !strings.Contains(prompt, "[report] #666") {
		t.Fatalf("no self-pause recovery prompt: %s", prompt)
	}
	if got := e.sessions.ActiveSessionID(key); got != old {
		t.Fatalf("self-pause reset the session: %s -> %s", old, got)
	}
	if got := p.sentTo(parent); len(got) != 0 {
		t.Fatalf("unmarked reply was forwarded: %v", got)
	}
	inputDone(a, "[report] #666 背景：你让我做这件事。\n做到传输一半，卡在远端收包。\n要你做的：没有。\n我加的：无")
	inputWait(t, func() bool { return len(p.sentTo(parent)) == 1 })
}

func TestSelfPauseOf(t *testing.T) {
	id, why := selfPauseOf(map[int]string{3: "完成\n10-27", 9: selfPauseMark + "卡住", 5: selfPauseMark + "早的"})
	if id != 5 || why != "早的" {
		t.Fatalf("got %d %q", id, why)
	}
	if id, _ := selfPauseOf(map[int]string{3: "完成\n"}); id != 0 {
		t.Fatalf("got %d", id)
	}
}
