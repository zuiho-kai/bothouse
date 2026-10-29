package core

import (
	"os"
	"strings"
	"testing"
)

func loadDirtyState(t *testing.T, e *Engine, raw string) {
	t.Helper()
	if err := os.WriteFile(teamWorkspacePath(e.dataDir), []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
}

// A handoff recorded from another workspace channel (#534 was fixed for new claims in PR #541,
// but the state file kept old records): the workspace's [report] went into that workspace, where
// the chat channel never sees it (10-27 工作区1 的 #678/#680 收口结果转进了工作区2). The record is
// repaired to the chat channel that owns the workspace now.
func TestWorkspaceDirtyChatRepairedToOwner(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	loadDirtyState(t, e, `{"version":1,
		"parents":{"discord:chatA":[{"name":"工作区2","id":"ws2"}]},
		"handoffs":{
			"discord:ws2":[{"chat":"discord:chatA","at":"2026-10-26T02:41:17Z"}],
			"discord:ws1":[{"chat":"discord:ws2","at":"2026-10-26T02:41:17Z"}]}}`)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatA" {
		t.Fatalf("ws1 parent = %q,%v; want chatA", got, ok)
	}
	exitBoardItem(t, e, 7, "收口")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 收口结果")
	if got := p.sentTo("discord:chatA"); len(got) != 1 || !strings.Contains(got[0], "收口结果") {
		t.Fatalf("chatA got %q", got)
	}
	for _, ch := range []string{"discord:ws2", "discord:ws1"} {
		if got := p.sentTo(ch); len(got) != 0 {
			t.Fatalf("%s got %q", ch, got)
		}
	}
}

// A workspace that is free has no chat channel to send a late [report] to: the route is cleared
// (the task record stays, so the pool still counts it) instead of pointing at another workspace.
func TestWorkspaceDirtyChatDroppedWhenFree(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	loadDirtyState(t, e, `{"version":1,
		"parents":{"discord:chatA":[{"name":"工作区2","id":"ws2"}]},
		"handoffs":{
			"discord:ws2":[{"chat":"discord:chatA","at":"2026-10-26T02:41:17Z"}],
			"discord:ws1":[{"chat":"discord:ws2","at":"2026-10-26T02:41:17Z","closed":"2026-10-26T03:00:00Z"}]}}`)
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned")
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n没人要的结果")
	for _, ch := range []string{"discord:chatA", "discord:ws1", "discord:ws2"} {
		if got := p.sentTo(ch); len(got) != 0 {
			t.Fatalf("%s got %q", ch, got)
		}
	}
}

// No path may treat a workspace channel as a chat channel that owns workspaces: the ownership
// record itself is dropped, and a report from a workspace never routes to another workspace.
func TestWorkspaceNeverOwnsAnotherWorkspace(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	loadDirtyState(t, e, `{"version":1,
		"handoffs":{
			"discord:ws1":[{"chat":"discord:chatA","at":"2026-10-26T02:41:17Z","closed":"2026-10-26T03:00:00Z"}],
			"discord:ws2":[{"chat":"discord:ws1","at":"2026-10-26T02:41:17Z"}]},
		"parents":{"discord:ws1":[{"name":"工作区2","id":"ws2"}]}}`)
	if got, ok := e.WorkspaceParent("ws2"); ok {
		t.Fatalf("ws2 parent = %q, want none", got)
	}
	if _, ok := e.WorkspaceLastChat("ws2"); ok {
		t.Fatal("ws2 last chat answered a workspace")
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n不该转")
	if got := p.sentTo("discord:ws1"); len(got) != 0 {
		t.Fatalf("ws1 got %q", got)
	}
}
