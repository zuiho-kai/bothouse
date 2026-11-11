package core

import (
	"testing"
	"time"
)

// 2026-11-11 (agent processes not released): a teammate's live agent process in a workspace that went back to the pool is closed,
// its saved agent session ID kept for resume; a busy one and one in an owned workspace are not.
func TestCloseIdleTeamWorkspaceAgentsAfterRelease(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	lead := newWorkspaceLead(t, g, dataDir)
	lead.teamWS = newTeamWorkspaces()
	lead.sessions.GetOrCreateActive("discord:100")
	_, w, err := lead.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	wsKey := "discord:" + w.ID
	if err := lead.ClaimTeamWorkspace("discord:100", w.ID, ""); err != nil { // a handoff: a recorded workspace
		t.Fatal(err)
	}

	backend := strictTurnLifetimeAgent{&turnLifetimeAgent{}}
	fish := NewEngine("fish", backend, nil, "", LangEnglish)
	t.Cleanup(fish.cancel)
	fish.SetDataDir(dataDir)
	s := fish.sessions.GetOrCreateActive(wsKey)
	s.SetAgentSessionID("dsh-session-1", "acp")
	agent := newControllableSession("dsh-session-1")
	state := &interactiveState{agent: backend, agentSession: agent}
	fish.interactiveMu.Lock()
	fish.interactiveStates[wsKey] = state
	fish.interactiveMu.Unlock()

	// The release scan only visits free workspaces. Normal turn-end closing is
	// independent of workspace ownership and covered by the turn-lifetime tests.
	if fish.teamWorkspaceFree(wsKey) {
		t.Fatal("owned workspace reported free")
	}
	if n := fish.CloseIdleTeamWorkspaceAgents(wsKey); n != 0 {
		t.Fatalf("closed %d in an owned workspace... want 0", n)
	}
	select {
	case <-agent.closed:
		t.Fatal("process closed while its workspace is owned")
	case <-time.After(50 * time.Millisecond):
	}

	if !lead.releaseTeamWorkspace(wsKey, time.Now(), false) {
		t.Fatal("workspace not released")
	}
	if !fish.teamWorkspaceFree(wsKey) || fish.teamWorkspaceFree("discord:100") || fish.teamWorkspaceFree("discord:999") {
		t.Fatal("teamWorkspaceFree: want true only for the released workspace")
	}

	// A turn running: left alone.
	if !s.TryLock() {
		t.Fatal("lock")
	}
	if n := fish.CloseIdleTeamWorkspaceAgents(wsKey); n != 0 {
		t.Fatalf("closed %d while a turn runs, want 0", n)
	}
	s.Unlock()

	if n := fish.CloseIdleTeamWorkspaceAgents(wsKey); n != 1 {
		t.Fatalf("closed %d, want 1", n)
	}
	select {
	case <-agent.closed:
	case <-time.After(time.Second):
		t.Fatal("agent process not closed")
	}
	waitForInteractiveStateRemoved(t, fish, wsKey)
	if got := fish.sessions.GetOrCreateActive(wsKey).GetAgentSessionID(); got != "dsh-session-1" {
		t.Fatalf("saved agent session ID = %q; the conversation must stay resumable", got)
	}
}

// 2026-11-11 (agent processes not released): a turn that ends in a free workspace (late re-delivery) closes the process right away,
// even with the idle timeout off; background tasks in the agent keep it.
func TestTurnEndInFreeWorkspaceClosesProcess(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	lead := newWorkspaceLead(t, g, dataDir)
	lead.teamWS = newTeamWorkspaces()
	lead.sessions.GetOrCreateActive("discord:100")
	_, w, err := lead.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	wsKey := "discord:" + w.ID
	if err := lead.ClaimTeamWorkspace("discord:100", w.ID, ""); err != nil { // a handoff: a recorded workspace
		t.Fatal(err)
	}
	if !lead.releaseTeamWorkspace(wsKey, time.Now(), false) {
		t.Fatal("workspace not released")
	}

	backend := strictTurnLifetimeAgent{&turnLifetimeAgent{}}
	fish := NewEngine("fish", backend, nil, "", LangEnglish)
	t.Cleanup(fish.cancel)
	fish.SetDataDir(dataDir)

	bg := &bgTaskSession{controllableAgentSession: newControllableSession("b")}
	bg.running = 1
	bgState := &interactiveState{agent: backend, agentSession: bg}
	fish.interactiveMu.Lock()
	fish.interactiveStates[wsKey] = bgState
	fish.interactiveMu.Unlock()
	fish.scheduleAgentSessionIdleClose(wsKey, bgState)
	select {
	case <-bg.closed:
		t.Fatal("closed while a background task runs")
	case <-time.After(50 * time.Millisecond):
	}
	fish.cleanupInteractiveState(wsKey)

	agent := newControllableSession("a")
	state := &interactiveState{agent: backend, agentSession: agent}
	fish.interactiveMu.Lock()
	fish.interactiveStates[wsKey] = state
	fish.interactiveMu.Unlock()
	fish.scheduleAgentSessionIdleClose(wsKey, state)
	select {
	case <-agent.closed:
	case <-time.After(time.Second):
		t.Fatal("turn end in a free workspace did not close the process")
	}
	waitForInteractiveStateRemoved(t, fish, wsKey)
}
