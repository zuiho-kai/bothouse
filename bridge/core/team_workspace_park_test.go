package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// handoffsOf returns a copy of the recorded handoffs to workspace key.
func handoffsOf(e *Engine, key string) []TeamHandoff {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	return append([]TeamHandoff(nil), loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]...)
}

// Discord/Feishu (the bridge records the owner): parking the only task frees the workspace at
// once, keeps the handoff (Parked, not Closed) and resets the lead's session there, so another
// chat channel takes it with a clean context.
func TestWorkspaceParkFreesAndResetsSession(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	old := e.sessions.GetOrCreateActive(exitWSKey)
	old.SetAgentSessionID("a1", "test")
	old.AddHistory("user", "旧活的上下文")
	oldID := old.ID

	freed, err := e.ParkTeamWorkspace(exitWSKey)
	if err != nil || !freed {
		t.Fatalf("park = %v, %v; want freed", freed, err)
	}
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned after its only task was parked")
	}
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 1 || hs[0].Parked.IsZero() || !hs[0].Closed.IsZero() {
		t.Fatalf("handoffs = %+v, want one parked, not closed", hs)
	}
	fresh := e.sessions.GetOrCreateActive(exitWSKey)
	if fresh.ID == oldID || fresh.GetAgentSessionID() != "" || len(fresh.GetHistory(0)) != 0 {
		t.Fatalf("session not reset: id %s (old %s), agent %q, history %d", fresh.ID, oldID, fresh.GetAgentSessionID(), len(fresh.GetHistory(0)))
	}
	if from, _ := fresh.TakeHandoffFrom(); from != "" {
		t.Fatalf("fresh session inherits the paused task's transcript %q", from)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim by B after park = %v", err)
	}
	if _, err := e.ParkTeamWorkspace("discord:ws9"); !errors.Is(err, ErrTeamWorkspaceNotOwned) {
		t.Fatalf("park of an unowned workspace = %v, want ErrTeamWorkspaceNotOwned", err)
	}
}

// Two tasks in one workspace: parking one keeps it owned (the other is in work); parking the
// second frees it. A later reset does not close the parked handoffs.
func TestWorkspaceParkKeepsWhileOtherTaskInWork(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	for range 2 {
		if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
			t.Fatal(err)
		}
	}
	if freed, err := e.ParkTeamWorkspace("discord:ws1"); err != nil || freed {
		t.Fatalf("park first = %v, %v; want kept", freed, err)
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("parent after parking one of two = %q,%v", p, ok)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B = %v, want ErrTeamWorkspaceOwned", err)
	}
	if freed, err := e.ParkTeamWorkspace("discord:ws1"); err != nil || !freed {
		t.Fatalf("park second = %v, %v; want freed", freed, err)
	}
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned after both tasks were parked")
	}
	for _, h := range handoffsOf(e, "discord:ws1") {
		if h.Parked.IsZero() || !h.Closed.IsZero() {
			t.Fatalf("handoff %+v: want parked, not closed", h)
		}
	}
}

// A paused task resumes through claim (no separate command): the owner comes back and the new
// handoff is appended next to the parked one. Once another chat channel took the workspace,
// the claim is refused (ErrTeamWorkspaceOwned) and the caller takes a free one or a new one.
func TestWorkspaceParkResumeByClaim(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ParkTeamWorkspace("discord:ws1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatalf("resume by claim = %v", err)
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("parent after resume = %q,%v", p, ok)
	}
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 2 || hs[0].Parked.IsZero() || !teamHandoffOpen(hs[1]) {
		t.Fatalf("handoffs = %+v, want the parked one and a new open one", hs)
	}
	if _, err := e.ParkTeamWorkspace("discord:ws1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("resume after B took ws1 = %v, want ErrTeamWorkspaceOwned", err)
	}
}

// parkingPlatform is a cloud_web-like platform that also takes park requests
// (TeamWorkspaceParker); parkErr answers them (e.g. an older gateway's busy).
type parkingPlatform struct {
	*ownerPlatform
	parkMu  sync.Mutex
	parkErr error
	parks   []string // "ws@claim"
}

func (p *parkingPlatform) ParkTeamWorkspaceChannel(_ context.Context, ws, claim string) error {
	p.parkMu.Lock()
	p.parks = append(p.parks, ws+"@"+claim)
	err := p.parkErr
	p.parkMu.Unlock()
	if err != nil {
		return err
	}
	p.mu.Lock()
	p.owner = ""
	p.mu.Unlock()
	p.released <- ws
	return nil
}

// cloud_web/DSH: park asks the gateway to pause and release (naming the claim); the record
// stays pending until it agrees. A busy answer (older gateway without park) keeps it and the
// park is retried before the next claim.
func TestWorkspaceParkOnPlatformRetries(t *testing.T) {
	e, op := newOwnerFixture(t)
	p := &parkingPlatform{ownerPlatform: op, parkErr: errors.New("cloud_web: team_workspace release: busy")}
	e.platforms = []Platform{p}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if freed, err := e.ParkTeamWorkspace("discord:ws1"); err != nil || !freed {
		t.Fatalf("park = %v, %v", freed, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		p.parkMu.Lock()
		n := len(p.parks)
		p.parkMu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("gateway not asked to park ws1")
		}
		time.Sleep(10 * time.Millisecond)
	}
	teamWorkspaceOpMu.Lock()
	teamWorkspaceOpMu.Unlock()
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatA" {
		t.Fatalf("busy park dropped A's record: %q,%v", got, ok)
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by B while the gateway is busy = %v", err)
	}
	p.parkMu.Lock()
	p.parkErr = nil
	p.parkMu.Unlock()
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim by B after the gateway parked ws1 = %v", err)
	}
	p.parkMu.Lock()
	defer p.parkMu.Unlock()
	for _, x := range p.parks {
		if x != "ws1@1" {
			t.Fatalf("park %q does not name A's claim 1", x)
		}
	}
	op.mu.Lock()
	defer op.mu.Unlock()
	if len(op.releases) != 0 {
		t.Fatalf("plain release sent for a park: %v", op.releases)
	}
}

// Discord/Feishu do not count tasks (ActiveKnown false): a free workspace with 3 tasks in work
// on the bridge's record is busy and skipped; parked ones do not count.
func TestWorkspacePlanSkipsBusyByOwnCount(t *testing.T) {
	path := teamWorkspacePath(t.TempDir())
	self := TeamChannel{ID: "100", Name: "聊天", ParentID: "cat"}
	guild := []TeamChannel{self, {ID: "201", Name: "工作区1", ParentID: "cat"}, {ID: "202", Name: "工作区2", ParentID: "cat"}}
	now := time.Now()
	set := func(open, parked int) {
		var hs []TeamHandoff
		for range open {
			hs = append(hs, TeamHandoff{Chat: "discord:999", At: now})
		}
		for range parked {
			hs = append(hs, TeamHandoff{Chat: "discord:999", At: now, Parked: now})
		}
		teamWorkspaceStore.mu.Lock()
		st := loadTeamWorkspacesLocked(path)
		st.Parents = map[string][]TeamWorkspace{}
		st.Handoffs = map[string][]TeamHandoff{"discord:201": hs}
		teamWorkspaceStore.mu.Unlock()
	}
	for _, c := range []struct {
		open, parked int
		want         string
	}{{1, 0, "202"}, {0, 0, "201"}, {0, 5, "201"}} {
		set(c.open, c.parked)
		_, _, _, adopted, err := teamWorkspacePlan(path, "discord:100", self, guild, true)
		if err != nil || adopted != c.want {
			t.Fatalf("open %d parked %d: adopted %q, %v; want %s", c.open, c.parked, adopted, err, c.want)
		}
	}
}

// A state file from before park (no "parked") reads as before; an old record whose only handoff
// was parked is free after the upgrade like a finished one.
func TestWorkspaceParkStateCompatible(t *testing.T) {
	dir := t.TempDir()
	at := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	raw := `{"parents":{"discord:chatA":[{"name":"工作区1","id":"ws1"}],"discord:chatB":[{"name":"工作区2","id":"ws2"}]},
"handoffs":{"discord:ws1":[{"chat":"discord:chatA","at":"` + at + `"}],"discord:ws2":[{"chat":"discord:chatB","at":"` + at + `","parked":"` + at + `"}]}}`
	if err := os.WriteFile(teamWorkspacePath(dir), []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	forgetWorkspaceCache(dir)
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	_, ws1 := teamWorkspaceOwnerLocked(st, "discord", "ws1")
	owner2, _ := teamWorkspaceOwnerLocked(st, "discord", "ws2")
	open, parked := teamWorkspaceCountsLocked(st, "discord:ws1")
	teamWorkspaceStore.mu.Unlock()
	if ws1.ID != "ws1" || open != 1 || parked != 0 {
		t.Fatalf("old open handoff: record %+v open %d parked %d", ws1, open, parked)
	}
	if owner2 != "" {
		t.Fatalf("old record with only a parked handoff still owned by %q", owner2)
	}
	b, _ := json.Marshal(TeamHandoff{Chat: "discord:x"})
	if string(b) != `{"chat":"discord:x"}` {
		t.Fatalf("unparked handoff writes %s", b)
	}
}

// POST /team/workspace/park: 400 without session_key, 404 for a workspace nobody owns; the
// last task in work frees it and resets the teammates' sessions there too; with another task in
// work it answers freed=false and keeps their sessions.
func TestTeamWorkspaceParkAPI(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.teamWS = newTeamWorkspaces()
	sub := NewEngine("sub", &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(sub.cancel)
	s := &APIServer{engines: map[string]*Engine{"lead": e, "sub": sub}}
	park := func(body string) (*httptest.ResponseRecorder, TeamWorkspaceParkResult) {
		rec := httptest.NewRecorder()
		s.handleTeamWorkspacePark(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/park", strings.NewReader(body)))
		var r TeamWorkspaceParkResult
		_ = json.Unmarshal(rec.Body.Bytes(), &r)
		return rec, r
	}
	if rec, _ := park(`{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("no session_key: %d", rec.Code)
	}
	if rec, _ := park(`{"session_key":"discord:ws1"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unowned: %d %s", rec.Code, rec.Body.String())
	}
	for i := 0; i < 2; i++ {
		if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
			t.Fatal(err)
		}
	}
	subOld := sub.sessions.GetOrCreateActive("discord:ws1:u2")
	subOld.AddHistory("user", "队友在旧活里的上下文")
	if rec, _ := park(`{"session_key":"discord:ws1","chat":"discord:chatB"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("park for a chat that does not own ws1: %d %s", rec.Code, rec.Body.String())
	}
	if rec, _ := park(`{"session_key":"discord:ws1","chat":"discord:chatA","before":"yesterday"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad before: %d %s", rec.Code, rec.Body.String())
	}
	if rec, r := park(`{"session_key":"discord:chatA:u1","workspace_id":"ws1"}`); rec.Code != http.StatusOK || r.Freed || r.Workspace != "discord:ws1" {
		t.Fatalf("park 1 of 2: %d %s", rec.Code, rec.Body.String())
	}
	if got := sub.sessions.GetOrCreateActive("discord:ws1:u2"); got.ID != subOld.ID {
		t.Fatal("teammate session reset while another task is in work")
	}
	if rec, r := park(`{"session_key":"discord:ws1:u1"}`); rec.Code != http.StatusOK || !r.Freed {
		t.Fatalf("park 2 of 2: %d %s", rec.Code, rec.Body.String())
	}
	if got := sub.sessions.GetOrCreateActive("discord:ws1:u2"); got.ID == subOld.ID || len(got.GetHistory(0)) != 0 {
		t.Fatal("teammate session not reset when the workspace was freed")
	}
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 still owned")
	}
}

// Pausing chat A's task must not touch the workspace once it is someone else's task's: A's task
// finished (the workspace was released after it) and chat B claimed the workspace, or A itself
// claimed it again for a later task. The board names the chat and when it bound the task; park
// then refuses (not owned) and B's task stays in work, B keeps the workspace and its session.
func TestWorkspaceParkOnlyTheChatsOwnTask(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	boundA := time.Now()
	time.Sleep(2 * time.Millisecond)
	if !e.releaseTeamWorkspace(exitWSKey, time.Now(), false) { // A's task done: back to the pool
		t.Fatal("ws1 not released after its task")
	}
	if err := e.ClaimTeamWorkspace("discord:chatB", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	s := e.sessions.GetOrCreateActive(exitWSKey)
	s.AddHistory("user", "B 的活")
	sid := s.ID

	if _, err := e.ParkTeamWorkspaceFor("discord:ws1", "discord:chatA", boundA); !errors.Is(err, ErrTeamWorkspaceNotOwned) {
		t.Fatalf("A pausing its old task in B's workspace = %v, want ErrTeamWorkspaceNotOwned", err)
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatB" {
		t.Fatalf("parent after A's park = %q,%v; want chatB", p, ok)
	}
	hs := handoffsOf(e, "discord:ws1")
	if last := hs[len(hs)-1]; last.Chat != "discord:chatB" || !teamHandoffOpen(last) {
		t.Fatalf("B's handoff = %+v, want in work", last)
	}
	if got := e.sessions.GetOrCreateActive(exitWSKey); got.ID != sid || len(got.GetHistory(0)) == 0 {
		t.Fatal("B's session was reset by A's park")
	}

	// B's task done; A claims ws1 again for a later task D. Pausing the old task still parks nothing.
	if !e.releaseTeamWorkspace(exitWSKey, time.Now(), false) {
		t.Fatal("ws1 not released after B's task")
	}
	time.Sleep(2 * time.Millisecond)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	boundD := time.Now()
	if _, err := e.ParkTeamWorkspaceFor("discord:ws1", "discord:chatA", boundA); !errors.Is(err, ErrTeamWorkspaceNotOwned) {
		t.Fatalf("A pausing its old task while ws1 works on D = %v, want ErrTeamWorkspaceNotOwned", err)
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("parent = %q,%v; want chatA (D in work)", p, ok)
	}
	// Pausing D itself (bound after its claim) parks it and frees the workspace.
	if freed, err := e.ParkTeamWorkspaceFor("discord:ws1", "discord:chatA", boundD); err != nil || !freed {
		t.Fatalf("A pausing D = %v, %v; want freed", freed, err)
	}
}
