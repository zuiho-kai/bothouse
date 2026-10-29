package core

import (
	"context"
	"errors"
	"os"
	"strconv"
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
	exitBoardItem(t, e, 7, "活")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 做好了")
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
	exitBoardItem(t, e, 7, "B 的活")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 B 的活做好了")
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
	seq      int // the gateway's claim id (rooms.claim_seq), bumped by every claim
	claims   []string
	released chan string
	// releaseErr: the gateway's answer to a release (e.g. busy); nil = released.
	releaseErr error
	releases   []string // "ws@claim" of every release request
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
func (p *ownerPlatform) ClaimTeamWorkspaceChannel(_ context.Context, chat, ws string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.claims = append(p.claims, chat+"→"+ws)
	p.owner = chat
	p.seq++
	return strconv.Itoa(p.seq), nil
}
func (p *ownerPlatform) ReleaseTeamWorkspaceChannel(_ context.Context, ws, claim string) error {
	p.mu.Lock()
	p.releases = append(p.releases, ws+"@"+claim)
	err := p.releaseErr
	if err == nil && claim != "" && claim != strconv.Itoa(p.seq) {
		err = ErrTeamWorkspaceStaleClaim
	}
	if err == nil {
		p.owner = ""
	}
	p.mu.Unlock()
	if err == nil {
		p.released <- ws
	}
	return err
}

func newOwnerFixture(t *testing.T) (*Engine, *ownerPlatform) {
	t.Helper()
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &ownerPlatform{exitTestPlatform: &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}, released: make(chan string, 4)}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetTeam(t.TempDir(), "橘", true)
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	return e, p
}

// waitWorkspaceParent waits for the async platform release to settle the record of ws1.
func waitWorkspaceParent(t *testing.T, e *Engine, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		got, ok := e.WorkspaceParent("ws1")
		if !ok {
			got = ""
		}
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ws1 parent = %q, want %q", got, want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// cloud_web/DSH: the gateway's owner decides over the bridge's record, and a lead reset tells
// the gateway to release the workspace.
func TestWorkspaceOwnerFromPlatform(t *testing.T) {
	e, p := newOwnerFixture(t)

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
	waitWorkspaceParent(t, e, "")
}

// cloud_web: the gateway answers busy (or is unreachable) to the release after a lead reset.
// The bridge keeps A's record, so ws1's [report] still goes to A, and retries before the next
// claim: once the gateway agrees, B gets ws1.
func TestWorkspaceReleaseBusyKeepsOwnerAndRetries(t *testing.T) {
	e, p := newOwnerFixture(t)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	p.releaseErr = errors.New("cloud_web: team_workspace release: busy")
	p.mu.Unlock()
	e.releaseWorkspaceOnReset(exitWSKey, time.Now(), false)
	deadline := time.Now().Add(2 * time.Second)
	for {
		p.mu.Lock()
		n := len(p.releases)
		p.mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("gateway not asked to release ws1")
		}
		time.Sleep(10 * time.Millisecond)
	}
	teamWorkspaceOpMu.Lock() // the release goroutine is done with its try
	teamWorkspaceOpMu.Unlock()
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatA" {
		t.Fatalf("busy release dropped A's record: parent %q,%v", got, ok)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B while the gateway is busy = %v, want ErrTeamWorkspaceOwned", err)
	}
	p.mu.Lock()
	p.releaseErr = nil
	p.mu.Unlock()
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim by B after the gateway freed ws1 = %v", err)
	}
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatB" {
		t.Fatalf("parent = %q,%v; want chatB", got, ok)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, r := range p.releases {
		if r != "ws1@1" {
			t.Fatalf("release %q does not name A's claim 1", r)
		}
	}
}

// A release names the claim it ends: a release for A's earlier claim that reaches the gateway
// after A claimed ws1 again is refused (stale-claim) and does not free the new claim.
func TestWorkspaceLateReleaseKeepsNewClaim(t *testing.T) {
	e, p := newOwnerFixture(t)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := p.ReleaseTeamWorkspaceChannel(context.Background(), "ws1", "1"); !errors.Is(err, ErrTeamWorkspaceStaleClaim) {
		t.Fatalf("late release = %v, want ErrTeamWorkspaceStaleClaim", err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B after a late release = %v, want ErrTeamWorkspaceOwned", err)
	}
	// The bridge's own release names the current claim.
	e.releaseWorkspaceOnReset(exitWSKey, time.Now(), false)
	waitWorkspaceParent(t, e, "")
	p.mu.Lock()
	defer p.mu.Unlock()
	if got := p.releases[len(p.releases)-1]; got != "ws1@2" {
		t.Fatalf("bridge release = %q, want ws1@2", got)
	}
}

// A state written before single owner: Parents named the last chat that handed off and was
// never cleared. A record with no open handoff is finished work: another chat claims it.
func TestWorkspaceUpgradeFreesOldRecords(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	old := `{"parents":{"discord:chatA":[{"name":"工作区1","id":"ws1"},{"name":"工作区2","id":"ws2"}]},
		"handoffs":{"discord:ws2":[{"chat":"discord:chatA","at":"2026-10-23T10:00:00Z"}]}}`
	if err := os.WriteFile(teamWorkspacePath(e.dataDir), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim of an old finished workspace by B = %v", err)
	}
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatB" {
		t.Fatalf("ws1 parent = %q,%v; want chatB", got, ok)
	}
	// ws2 has an open handoff (work not finished at upgrade): still A's.
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws2", "工作区2"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim of A's unfinished ws2 = %v, want ErrTeamWorkspaceOwned", err)
	}
}

// #597 G36: after the workspace's last task it is released (its chat no longer owns it), and the
// chat still names it 「工作区1」, not the internal id (v0.1.24 web check: 「room-2·工作区1ayi：…」).
// Done rows left the board in #610; the name lookup they used (placer) is checked directly.
func TestTaskBoardNamesReleasedWorkspace(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.sessions.GetOrCreateActive(exitWSKey).SetAgentSessionID("a1", "test")
	e.startFreshSession(e.sessions, exitWSKey, exitWSKey, "", "")
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned after its lead session was reset")
	}
	items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), []teamTaskBoardItem{{ID: 1, What: "写脚本", Who: "工作区1橘",
		Status: "已完成", WS: "discord:ws1", SK: "discord:ws1", Chat: "discord:chatA"}})
	if got := items[0].wsName; got != "工作区1" {
		t.Fatalf("released workspace name = %q, want 工作区1", got)
	}
	if got := whoInWorkspace(items[0]); got != "橘" {
		t.Fatalf("who = %q", got)
	}
	if n := e.TeamWorkspaceName("discord:nope"); n != "" {
		t.Fatalf("unknown workspace name = %q", n)
	}
}
