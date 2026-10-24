package core

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// A workspace belongs to one chat channel at a time: B cannot take ws1 while A owns it, and
// ws1's [report] goes to A only.
func TestWorkspaceOwnedRefusesOtherChat(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatalf("the owner handing off again = %v", err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B = %v, want ErrTeamWorkspaceOwned", err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n做好了")
	if got := p.sentTo("discord:chatA"); len(got) != 1 || !strings.Contains(got[0], "做好了") {
		t.Fatalf("chatA got %q", got)
	}
	if got := p.sentTo("discord:chatB"); len(got) != 0 {
		t.Fatalf("chatB got %q", got)
	}
}

// The workspace lead's session is reset after its last task (/new, idle reset or
// `session new --after-turn`, all through startFreshSession): ws1 goes back to the pool, B
// takes it, and ws1's next [report] goes to B, not A.
func TestWorkspaceLeadResetReleasesForOtherChat(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.sessions.GetOrCreateActive(exitWSKey).SetAgentSessionID("a1", "test") // worked on A's task
	e.startFreshSession(e.sessions, exitWSKey, exitWSKey, "", "")
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned after its lead session was reset")
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\nB 的活做好了")
	if got := p.sentTo("discord:chatB"); len(got) != 1 || !strings.Contains(got[0], "B 的活做好了") {
		t.Fatalf("chatB got %q", got)
	}
	if got := p.sentTo("discord:chatA"); len(got) != 0 {
		t.Fatalf("chatA got %q", got)
	}
}

// A reset keeps the workspace owned when a handoff came after the session's last activity (not
// worked on yet), when messages move to the fresh session, and when it is not the lead's.
func TestWorkspaceResetKeepsOwnerWithPendingWork(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.releaseWorkspaceOnReset(exitWSKey, time.Now().Add(-time.Hour), false) // handoff after the last activity
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("new handoff released: parent %q,%v", p, ok)
	}
	e.releaseWorkspaceOnReset(exitWSKey, time.Now(), true) // queued messages move to the fresh session
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("queued work released: parent %q,%v", p, ok)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B = %v, want ErrTeamWorkspaceOwned", err)
	}

	// A teammate (not the lead) resetting its own session there does not end the lead's work.
	sub, _, _ := exitFixture(t, nil)
	sub.dataDir = e.dataDir
	sub.releaseWorkspaceOnReset(exitWSKey, time.Now(), false)
	if _, ok := e.WorkspaceParent("ws1"); !ok {
		t.Fatal("a teammate's reset released the lead's workspace")
	}
	e.releaseWorkspaceOnReset(exitWSKey, time.Now(), false)
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("the lead's reset after the last task kept ws1")
	}
}

// ownerPlatform lists ws1 with the owner it records itself (cloud_web/DSH, OwnerKnown) and
// records claims and releases.
type ownerPlatform struct {
	*exitTestPlatform
	mu       sync.Mutex
	owner    string
	claims   []string
	released chan string
}

func (p *ownerPlatform) TeamGuildChannels(_ context.Context, id string) (TeamChannel, []TeamChannel, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	all := []TeamChannel{{ID: "chatA", Name: "聊天A"}, {ID: "chatB", Name: "聊天B"},
		{ID: "ws1", Name: "工作区1", ActiveKnown: true, Owner: p.owner, OwnerKnown: true}}
	for _, c := range all {
		if c.ID == id {
			return c, all, nil
		}
	}
	return TeamChannel{ID: id}, all, nil
}
func (p *ownerPlatform) CreateTeamWorkspaceChannel(context.Context, string, string) (TeamChannel, error) {
	return TeamChannel{}, errors.New("no create")
}
func (p *ownerPlatform) ClaimTeamWorkspaceChannel(_ context.Context, chat, ws string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.claims = append(p.claims, chat+"→"+ws)
	p.owner = chat
	return nil
}
func (p *ownerPlatform) ReleaseTeamWorkspaceChannel(_ context.Context, ws string) error {
	p.mu.Lock()
	p.owner = ""
	p.mu.Unlock()
	p.released <- ws
	return nil
}

// cloud_web/DSH: the gateway's owner decides over the bridge's record, and a lead reset tells
// the gateway to release the workspace.
func TestWorkspaceOwnerFromPlatform(t *testing.T) {
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &ownerPlatform{exitTestPlatform: &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}, released: make(chan string, 4)}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetTeam(t.TempDir(), "橘", true)
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })

	// The gateway says A owns ws1, though the bridge has no record: B is refused.
	p.owner = "chatA"
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B = %v, want ErrTeamWorkspaceOwned", err)
	}
	if len(p.claims) != 0 {
		t.Fatalf("refused claim reached the gateway: %v", p.claims)
	}
	// The gateway freed ws1 (its tasks are done) while the bridge still records A: B gets it.
	p.owner = ""
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.owner = ""
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim of the gateway-freed ws1 = %v", err)
	}
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatB" {
		t.Fatalf("parent = %q,%v; want chatB", got, ok)
	}
	if len(e.TeamWorkspacesOf("chatA")) != 0 {
		t.Fatalf("stale A record kept: %+v", e.TeamWorkspacesOf("chatA"))
	}
	// B's workspace lead is reset after its last task: the gateway is told to release ws1.
	e.releaseWorkspaceOnReset(exitWSKey, time.Now(), false)
	select {
	case ws := <-p.released:
		if ws != "ws1" {
			t.Fatalf("released %q", ws)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("gateway not told to release ws1")
	}
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still recorded after release")
	}
}
