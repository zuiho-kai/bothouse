package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A user's reply in a chat channel to a report of work still running in a workspace is handed to
// that workspace at once, marked as an interrupt (user 10-30 复盘: a changed acceptance criterion
// stayed in the chat channel and the workspace built the old version).
func TestReplyToRunningWorkHandedToWorkspace(t *testing.T) {
	p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e := NewEngine("orange", &inputTestAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
	team := t.TempDir()
	e.SetTeam(team, "橘", true)
	where := writeReplyTaskHandoff(t, team)
	writeReplyTaskBoard(t, team, where, "discord:ws1")
	st := map[string]any{"version": teamWorkspaceStateVersion, "parents": map[string]any{}, "handoffs": map[string]any{"discord:ws1": []map[string]any{{"chat": "discord:chat1", "at": time.Now().Add(-time.Hour)}}}}
	b, _ := json.Marshal(st)
	if err := os.WriteFile(teamWorkspacePath(e.dataDir), b, 0o600); err != nil {
		t.Fatal(err)
	}
	lead := filepath.Join(e.dataDir, "collaboration", "lead")
	if err := os.MkdirAll(lead, 0o700); err != nil {
		t.Fatal(err)
	}
	args := filepath.Join(t.TempDir(), "args")
	script := "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\" >> " + args + "; done\n"
	if err := os.WriteFile(filepath.Join(lead, "ws-forward"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	full := "[replying to 橘: 📬 #7「修登录」：改完待验]\n"
	msg := func(ch string) *Message {
		return &Message{Platform: "discord", ChannelID: ch, UserName: "瑞凤", Content: full + "验收改成：选免费模型就不显示按钮",
			Reference: &MessageReference{ID: "sent-1", Full: full, task: &replyTask{board: 7}}}
	}
	m := msg("chat1")
	e.forwardReplyToWorkspace(p, m)
	raw, _ := os.ReadFile(args)
	got := strings.Split(strings.TrimSpace(string(raw)), "\n")
	want := []string{"--interrupt", "--notes", where, replyForwardPrefix + "验收改成：选免费模型就不显示按钮"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("ws-forward args = %q, want %q", got, want)
	}
	if !m.Reference.task.forwarded {
		t.Fatal("reply not marked as handed over")
	}
	if text := e.replyTaskText(m.Reference.task, ""); !strings.Contains(text, "已由系统原样转过去") || strings.Contains(text, "追加要求用 ws-forward") {
		t.Fatalf("lead background = %q", text)
	}

	// A reply made inside the workspace itself is not forwarded again.
	_ = os.Remove(args)
	e.forwardReplyToWorkspace(p, msg("ws1"))
	if _, err := os.Stat(args); err == nil {
		t.Fatal("reply in the workspace was forwarded")
	}
}

// The user messages of the lead turn that handed work to a workspace belong to that work: a later
// reply to one of them (user 10-30 11:05 replied to their own request) finds the task.
func TestHandoffTurnMessagesBelongToTask(t *testing.T) {
	team := t.TempDir()
	e := &Engine{dataDir: t.TempDir(), team: &teamState{dir: team, inject: true}}
	start := time.Now().Add(-time.Minute)
	it := map[string]any{"id": 7, "what": "修登录", "who": "橘", "where": "/n/a.md", "at": time.Now().Format("01-02 15:04"),
		"sk": "discord:ws1", "ws": "discord:ws1", "bound": time.Now().UTC().Format(time.RFC3339), "chat": "discord:chat1"}
	old := map[string]any{"id": 6, "what": "旧活", "who": "橘", "where": "/n/b.md", "at": time.Now().Add(-2 * time.Hour).Format("01-02 15:04"),
		"sk": "discord:ws2", "ws": "discord:ws2", "bound": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339), "chat": "discord:chat1"}
	a, _ := json.Marshal(old)
	b, _ := json.Marshal(it)
	writeTaskBoard(t, team, teamTaskBoardFile, string(a)+"\n"+string(b)+"\n")
	e.noteTurnHandoffs("discord:chat1:u1", []string{"m-request", "m-followup"}, start)
	for _, id := range []string{"m-request", "m-followup"} {
		if got := e.replyTaskBoard(id); got != 7 {
			t.Fatalf("%s → board %d, want 7", id, got)
		}
	}
	e.noteTurnHandoffs("discord:chat9:u1", []string{"m-other"}, start)
	if got := e.replyTaskBoard("m-other"); got != 0 {
		t.Fatalf("message of another chat tied to board %d", got)
	}
}
