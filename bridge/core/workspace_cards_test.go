package core

import (
	"testing"
	"time"
)

// recordWorkspaces writes team_workspaces.json: chat owns the workspaces ws (Parents), and
// released lists workspaces that were handed a task before but are back in the pool (Handoffs).
func recordWorkspaces(t *testing.T, e *Engine, chat string, ws []string, released ...string) {
	t.Helper()
	if e.dataDir == "" {
		e.SetDataDir(t.TempDir())
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	path := teamWorkspacePath(e.dataDir)
	st := loadTeamWorkspacesLocked(path)
	for _, id := range ws {
		st.Parents[chat] = append(st.Parents[chat], TeamWorkspace{Name: "工作区-" + id, ID: id})
	}
	if st.Handoffs == nil {
		st.Handoffs = map[string][]TeamHandoff{}
	}
	plat := chat[:len(chat)-len(teamChannelID(chat))-1]
	for _, id := range released {
		st.Handoffs[plat+":"+id] = append(st.Handoffs[plat+":"+id], TeamHandoff{Chat: chat, At: time.Now().Add(-time.Hour), Closed: time.Now()})
	}
	st.Version = teamWorkspaceStateVersion
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
}

func TestIsTeamWorkspaceChat(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"}, "ws2")
	for in, want := range map[string]bool{
		"discord:ws1": true, "discord:ws1:user": true, "ws1": true, // owned now
		"discord:ws2": true, // released, handed a task before
		"discord:chat": false, "discord:other": false, "": false,
	} {
		if got := e.isTeamWorkspaceChat(in); got != want {
			t.Errorf("isTeamWorkspaceChat(%q) = %v, want %v", in, got, want)
		}
	}
}

// User 2026-10-26 10:43: the who-is-doing-what board only in workspace channels; a chat
// channel (e.g. 创业) gets none, and a board it got before is deleted.
func TestTeamBoardOnlyInWorkspaceChannels(t *testing.T) {
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	now := time.Now()
	files := []teamFile{{Project: "a", Name: "龙娘", Updated: now, Sessions: []teamEntry{
		{Key: "discord:ws1:u", Chat: "工作区1", Task: "改桥", Busy: true, Worked: true, Since: now},
		{Key: "discord:startup:u", Chat: "创业", Task: "写文案", Worked: true, Since: now, DoneAt: now},
	}}}
	boards := map[string]*boardChat{"discord:chat": {SessionKey: "discord:chat", MessageID: "old-chat-board", Content: "old"}}
	if !e.updateTeamBoards(files, boards) {
		t.Fatal("no change")
	}
	if _, ok := p.content["discord:ws1:u"]; !ok {
		t.Fatalf("workspace got no board: %v", p.content)
	}
	if _, ok := p.content["discord:startup:u"]; ok || boards["discord:startup"] != nil {
		t.Fatalf("non-workspace channel got a board: %v", p.content)
	}
	if boards["discord:chat"] != nil || len(p.removed) != 1 || p.removed[0] != "old-chat-board" {
		t.Fatalf("old chat board not removed: removed=%v boards=%v", p.removed, boards)
	}
}

// A temporary delete failure keeps the old board for the next pass.
func TestTeamBoardOutsideWorkspaceRemoveRetried(t *testing.T) {
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, failFor: "m1"}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	boards := map[string]*boardChat{"discord:chat": {SessionKey: "discord:chat", MessageID: "m1"}}
	e.updateTeamBoards(nil, boards)
	if boards["discord:chat"] == nil {
		t.Fatal("board forgotten after a temporary failure")
	}
	p.failFor = ""
	e.updateTeamBoards(nil, boards)
	if boards["discord:chat"] != nil {
		t.Fatal("board not removed on retry")
	}
}
