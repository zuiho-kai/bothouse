package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func ownerTestEngine(t *testing.T, board string) *Engine {
	t.Helper()
	dir := t.TempDir()
	e := NewEngine("orange", &stubAgent{}, nil, "", LangChinese)
	e.dataDir = dir
	e.team = &teamState{dir: filepath.Join(dir, "team"), name: "orange", seen: map[string]*teamSession{}}
	if err := os.MkdirAll(e.team.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.team.dir, "board.jsonl"), []byte(board), 0o600); err != nil {
		t.Fatal(err)
	}
	return e
}

// 11-25 #2010: the owner of a task is its board item's chat and nothing else; no answer is an
// answer callers stop on.
func TestTaskOwnerChatOnlyTheItemChat(t *testing.T) {
	e := ownerTestEngine(t, "")
	writeTeamWorkspaces(t, e.dataDir, &teamWorkspaceState{Version: 1,
		Handoffs: map[string][]TeamHandoff{"discord:ws1": {{Chat: "discord:chatA", At: time.Now()}}}})
	cases := []struct {
		name string
		it   *teamTaskBoardItem
		want string
	}{
		{"chat recorded", &teamTaskBoardItem{ID: 1, Chat: "discord:chatB", SK: "discord:chatA"}, "discord:chatB"},
		{"bare discord id", &teamTaskBoardItem{ID: 2, Chat: "chatB"}, "discord:chatB"},
		{"no chat: no fallback to sk, ch or ws", &teamTaskBoardItem{ID: 3, SK: "discord:chatA", Ch: "chatA", WS: "discord:ws1"}, ""},
		{"chat is a workspace", &teamTaskBoardItem{ID: 4, Chat: "discord:ws1"}, ""},
		{"no item", nil, ""},
	}
	for _, c := range cases {
		got, err := e.taskOwnerChat(c.it)
		if got != c.want || (c.want == "") != (err != nil) {
			t.Errorf("%s: got %q, %v; want %q", c.name, got, err, c.want)
		}
	}
	if got := taskForumChat(teamTaskBoardItem{ID: 5, SK: "discord:chatA", Ch: "chatA"}); got != "" {
		t.Errorf("forum thread of an item without owner chat: got %q, want none", got)
	}
}

// The bridge decides where a task's message goes: the owner chat, its forum thread or a workspace;
// another chat is refused unless the sender says so (--cross-channel).
func TestSendTaskTargetProblem(t *testing.T) {
	e := ownerTestEngine(t, `{"id":1148,"what":"成片","chat":"discord:promo","post":"https://discord.com/channels/g/th1148/th1148"}`+"\n"+
		`{"id":1152,"what":"自测","sk":"discord:test"}`+"\n")
	h := TeamHandoff{Chat: "discord:promo", At: time.Unix(100, 0), Board: 1148}
	writeTeamWorkspaces(t, e.dataDir, &teamWorkspaceState{Version: 1,
		Handoffs: map[string][]TeamHandoff{"discord:ws2": {h}}})
	for _, c := range []struct {
		name   string
		id     int
		target string
		cross  bool
		bad    bool
	}{
		{"owner chat", 1148, "discord:promo", false, false},
		{"owner chat per-user key", 1148, "discord:promo:u1", false, false},
		{"forum thread", 1148, "discord:th1148", false, false},
		{"workspace", 1148, "discord:ws2", false, false},
		{"another chat", 1148, "discord:test", false, true},
		{"another chat on purpose", 1148, "discord:test", true, false},
		{"no owner on the board", 1152, "discord:test", false, true},
		{"no task named", 0, "discord:test", false, false},
	} {
		why := e.sendTaskTargetProblem(c.id, c.target, c.cross)
		if (why != "") != c.bad {
			t.Errorf("%s: problem %q, want refused=%v", c.name, why, c.bad)
		}
	}
	if why := e.sendTaskTargetProblem(1148, "discord:test", false); !strings.Contains(why, "discord:promo") || !strings.Contains(why, "--cross-channel") {
		t.Errorf("refusal should name the owner and the way out: %q", why)
	}
	// a workspace process names its task by CC_HANDOFF
	if id := e.sendTaskOf(0, 0, 0, "discord:ws2", "discord:test", teamHandoffID(h)); id != 1148 {
		t.Errorf("task of the workspace handoff: got %d, want 1148", id)
	}
	if id := e.sendTaskOf(7, 1148, 0, "", "", ""); id != 7 {
		t.Errorf("--for wins: got %d", id)
	}
}
