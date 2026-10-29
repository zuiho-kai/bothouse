package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeWorkspaceGuild is an in-memory Discord guild; no network.
type fakeWorkspaceGuild struct {
	stubPlatformEngine
	mu          sync.Mutex
	channels    []TeamChannel
	nonText     map[string]bool // DMs, threads
	offline     bool
	created     []TeamChannel
	nextID      int
	listCalls   int
	createCalls int
	createErr   error         // returned by every create when set
	block       chan struct{} // create waits for it when set
	creating    chan struct{} // closed when a create starts waiting on block
	panicOnce   bool          // next create panics (platform bug), then clears
	renameErr   error         // returned by every rename when set
	renames     []string      // "id=name" per successful rename
}

func (g *fakeWorkspaceGuild) RenameTeamWorkspaceChannel(_ context.Context, id, name string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.renameErr != nil {
		return g.renameErr
	}
	for i, c := range g.channels {
		if c.ID == id {
			g.channels[i].Name = name
			g.renames = append(g.renames, id+"="+name)
			return nil
		}
	}
	return fmt.Errorf("unknown channel %s", id)
}

// claimingGuild is a guild whose server records each workspace's chat channel itself, like
// the cloud_web gateway (TeamWorkspaceClaimer).
type claimingGuild struct {
	*fakeWorkspaceGuild
	claims   []string // "chat→workspace"
	claimErr error
}

func (g *claimingGuild) ClaimTeamWorkspaceChannel(_ context.Context, chat, ws string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.claimErr != nil {
		return "", g.claimErr
	}
	g.claims = append(g.claims, chat+"→"+ws)
	return strconv.Itoa(len(g.claims)), nil
}

func (g *fakeWorkspaceGuild) TeamGuildChannels(_ context.Context, id string) (TeamChannel, []TeamChannel, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.listCalls++
	if g.offline {
		return TeamChannel{}, nil, fmt.Errorf("discord: workspace: not connected")
	}
	if g.nonText[id] {
		return TeamChannel{}, nil, fmt.Errorf("discord: channel %s: %w", id, ErrNotTeamChannel)
	}
	for _, c := range g.channels {
		if c.ID == id {
			return c, append([]TeamChannel(nil), g.channels...), nil
		}
	}
	return TeamChannel{}, nil, fmt.Errorf("unknown channel %s", id)
}

func (g *fakeWorkspaceGuild) CreateTeamWorkspaceChannel(_ context.Context, beside, name string) (TeamChannel, error) {
	g.mu.Lock()
	p := g.panicOnce
	g.panicOnce = false
	g.mu.Unlock()
	if p {
		panic("platform bug")
	}
	if g.block != nil {
		close(g.creating)
		<-g.block
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.createCalls++
	if g.createErr != nil {
		return TeamChannel{}, g.createErr
	}
	var parent string
	for _, c := range g.channels {
		if c.ID == beside {
			parent = c.ParentID
		}
	}
	g.nextID++
	c := TeamChannel{ID: "9" + strconv.Itoa(1000+g.nextID), Name: name, ParentID: parent}
	g.channels = append(g.channels, c)
	g.created = append(g.created, c)
	return c, nil
}

func (g *fakeWorkspaceGuild) createdNames() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	var out []string
	for _, c := range g.created {
		out = append(out, c.ParentID+"/"+c.Name)
	}
	return out
}

func newWorkspaceGuild() *fakeWorkspaceGuild {
	return &fakeWorkspaceGuild{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
		channels: []TeamChannel{
			{ID: "100", Name: "主频道", ParentID: "catA"},
			{ID: "200", Name: "量化", ParentID: "catB"},
			{ID: "201", Name: "工作区1", ParentID: "catB"}, // made earlier by the ws-handoff script
			{ID: "205", Name: "工作区5", ParentID: "catB"},
		},
		nonText: map[string]bool{"900": true},
	}
}

// newEmptyPoolGuild is newWorkspaceGuild without the shared pool (201/205): every chat shares one
// 「工作区n」 pool (d1c05bbe), so a test of the create path needs a guild with nothing to adopt.
func newEmptyPoolGuild() *fakeWorkspaceGuild {
	g := newWorkspaceGuild()
	var keep []TeamChannel
	for _, c := range g.channels {
		if teamWorkspaceNum(c.Name) <= 0 {
			keep = append(keep, c)
		}
	}
	g.channels = keep
	return g
}

// adoptWorkspacePool has key's chat adopt the free pool workspaces 201 and 205 (lowest first),
// so the next "new" goes to the platform.
func adoptWorkspacePool(t *testing.T, e *Engine, key string) {
	t.Helper()
	for _, id := range []string{"201", "205"} {
		if _, w, err := e.NewTeamWorkspace(key); err != nil || w.ID != id {
			t.Fatalf("new in %s = %+v %v, want adopted %s", key, w, err, id)
		}
	}
}

func newWorkspaceLead(t *testing.T, g *fakeWorkspaceGuild, dataDir string) *Engine {
	t.Helper()
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	return e
}

// ensureWorkspace1 reconciles chat and creates or adopts its 「工作区1」 if missing (the
// planning step of the first "new"), for tests that set up a chat with one workspace.
func ensureWorkspace1(e *Engine, chat string) error {
	_, _, err := e.teamWorkspaceOp(chat, false)
	return err
}

// forgetWorkspaceCache makes the next read come from disk, as after a restart.
func forgetWorkspaceCache(dataDir string) {
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(dataDir))
	teamWorkspaceStore.mu.Unlock()
}

// User 2026-10-24「先不用，干活了再建」: turning workspaces on and the lead seeing a channel
// create nothing; the first "new" (the first hand-off) makes 「工作区1」 or adopts an unclaimed one.
func TestTeamWorkspacesOnlyOnFirstNew(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	for _, k := range []string{"discord:100:u1", "discord:200", "discord:900"} {
		e.sessions.GetOrCreateActive(k)
	}
	e.SetTeamWorkspaces(true)
	e.teamNoteTurn(&Message{SessionKey: "discord:100:u1", Content: "hi"}, nil)
	time.Sleep(20 * time.Millisecond)
	g.mu.Lock()
	calls := g.listCalls
	g.mu.Unlock()
	if calls != 0 || len(g.createdNames()) != 0 || len(e.TeamWorkspacesOf("100")) != 0 {
		t.Fatalf("before any new: %d platform calls, created %v", calls, g.createdNames())
	}
	// All chats share one pool (in catB): #100 adopts the free 工作区1 (201), #200 the free 工作区5.
	if _, w, err := e.NewTeamWorkspace("discord:100:u1"); err != nil || w.ID != "201" {
		t.Fatalf("first new in #100 = %+v %v, want adopted 201", w, err)
	}
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.ID != "205" {
		t.Fatalf("first new in #200 = %+v %v, want adopted 205", w, err)
	}
	if got := g.createdNames(); len(got) != 0 {
		t.Fatalf("created = %v, want none (both adopted)", got)
	}
	// After a restart the recorded workspaces are kept; the next new numbers past 工作区5 in the pool's category.
	e.cancel()
	forgetWorkspaceCache(dataDir)
	e2 := newWorkspaceLead(t, g, dataDir)
	e2.SetTeamWorkspaces(true)
	if _, w, err := e2.NewTeamWorkspace("discord:100"); err != nil || w.Name != "工作区6" {
		t.Fatalf("new after restart = %+v %v", w, err)
	}
	if got := g.createdNames(); len(got) != 1 || got[0] != "catB/工作区6" {
		t.Fatalf("created = %v, want [catB/工作区6]", got)
	}
}

func TestTeamWorkspacesNewNumbering(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.teamWS = newTeamWorkspaces() // on, without the backfill goroutine
	e.sessions.GetOrCreateActive("discord:100:u1")
	e.sessions.GetOrCreateActive("discord:200")

	// One shared pool: #100 adopts the free 工作区1, then the free 工作区5, lowest first; only then
	// does it number past 工作区5 in the pool's category.
	adoptWorkspacePool(t, e, "discord:100:u1")
	parent, w1, err := e.NewTeamWorkspace("discord:100:u1")
	if err != nil || parent != "discord:100" || w1.Name != "工作区6" {
		t.Fatalf("third new = %q %+v %v", parent, w1, err)
	}
	// Called from inside a workspace (a working role there): goes to its chat channel.
	parent, w7, err := e.NewTeamWorkspace("discord:" + w1.ID)
	if err != nil || parent != "discord:100" || w7.Name != "工作区7" {
		t.Fatalf("new from workspace = %q %+v %v", parent, w7, err)
	}
	// #200 shares the pool: nothing left to adopt, so it numbers on (工作区8), not a second 工作区1.
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.Name != "工作区8" {
		t.Fatalf("new in #200 = %+v %v", w, err)
	}
	if got := g.createdNames(); strings.Join(got, ",") != "catB/工作区6,catB/工作区7,catB/工作区8" {
		t.Fatalf("created = %v", got)
	}
	// A deleted workspace is dropped; the chat still has others, so ensure creates nothing.
	g.mu.Lock()
	for i, c := range g.channels {
		if c.ID == w1.ID {
			g.channels = append(g.channels[:i], g.channels[i+1:]...)
			break
		}
	}
	g.mu.Unlock()
	if err := ensureWorkspace1(e, "discord:100"); err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, w := range e.TeamWorkspacesOf("100") {
		names[w.Name] = true
	}
	if !names["工作区1"] || !names["工作区5"] || !names["工作区7"] || len(names) != 3 {
		t.Fatalf("after delete+ensure = %v", names)
	}
}

func TestWorkspaceParentPersisted(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100")
	_, w, err := e.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	forgetWorkspaceCache(dataDir)
	// Any project of the process (here a sub without team mode) answers from the state file.
	sub := NewEngine("sub", &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(sub.cancel)
	sub.SetDataDir(dataDir)
	if p, ok := sub.WorkspaceParent(w.ID); !ok || p != "100" {
		t.Fatalf("WorkspaceParent(bare) = %q %v", p, ok)
	}
	if p, ok := sub.WorkspaceParent("discord:" + w.ID + ":u9"); !ok || p != "discord:100" {
		t.Fatalf("WorkspaceParent(key) = %q %v", p, ok)
	}
	for _, id := range []string{"100", "200", "telegram:" + w.ID, ""} {
		if p, ok := sub.WorkspaceParent(id); ok {
			t.Fatalf("WorkspaceParent(%q) = %q, want not a workspace", id, p)
		}
	}
	if _, err := os.Stat(filepath.Join(dataDir, "team_workspaces.json")); err != nil {
		t.Fatalf("state not under data_dir: %v", err)
	}
}

func TestTeamWorkspacesLeadOnlyAndNewChannel(t *testing.T) {
	g := newWorkspaceGuild()
	sub := NewEngine("sub", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(sub.cancel)
	sub.SetDataDir(t.TempDir())
	sub.SetTeam(t.TempDir(), "龙娘", false)
	sub.SetTeamWorkspaces(true)
	if sub.teamWS != nil {
		t.Fatal("only the primary role runs workspaces")
	}
	if _, _, err := sub.NewTeamWorkspace("discord:100"); err == nil {
		t.Fatal("NewTeamWorkspace must fail when off")
	}

	// The lead seeing a channel creates nothing (user「先不用，干活了再建」).
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.teamNoteTurn(&Message{SessionKey: "discord:100:u1", Content: "hi"}, nil)
	time.Sleep(20 * time.Millisecond)
	if got := g.createdNames(); len(got) != 0 {
		t.Fatalf("created = %v, want none", got)
	}
}

func TestTeamWorkspaceAPI(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100:u1")
	sub := NewEngine("sub", &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(sub.cancel)
	s := &APIServer{engines: map[string]*Engine{"lead": e, "sub": sub}}

	rec := httptest.NewRecorder()
	s.handleTeamWorkspaceNew(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/new", strings.NewReader(`{"session_key":"discord:100:u1"}`)))
	var r TeamWorkspaceNewResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &r) != nil || r.Workspace.Name != "工作区1" || r.Parent != "discord:100" {
		t.Fatalf("new: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.handleTeamWorkspaceList(rec, httptest.NewRequest(http.MethodGet, "/team/workspace/list?session_key=discord:"+r.Workspace.ID, nil))
	var l TeamWorkspaceListResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &l) != nil || l.Parent != "discord:100" || len(l.Workspaces) != 1 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	// Not a channel of the lead (no session, no record) or not Discord: refused.
	for _, key := range []string{"discord:200", "telegram:100"} {
		rec = httptest.NewRecorder()
		s.handleTeamWorkspaceNew(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/new", strings.NewReader(`{"session_key":"`+key+`"}`)))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: %d %s, want 403", key, rec.Code, rec.Body.String())
		}
	}
	off := &APIServer{engines: map[string]*Engine{"sub": sub}}
	rec = httptest.NewRecorder()
	off.handleTeamWorkspaceNew(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/new", strings.NewReader(`{"session_key":"discord:100"}`)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", rec.Code)
	}
}

// A second chat channel in a category whose plain 工作区n belong to another chat channel gets
// 「<name>-工作区n」 (PM decision item 4), and its n+1 keeps that prefix.
func TestTeamWorkspacesSharedPoolInCategory(t *testing.T) {
	g := newWorkspaceGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	e := newWorkspaceLead(t, g, t.TempDir())
	e.SetTeamWorkspaces(true)

	// #200 adopts the lowest unclaimed 工作区1; #300 then adopts the next unclaimed 工作区5.
	if err := ensureWorkspace1(e, "discord:200"); err != nil {
		t.Fatal(err)
	}
	if err := ensureWorkspace1(e, "discord:300"); err != nil {
		t.Fatal(err)
	}
	if w := e.TeamWorkspacesOf("300"); len(w) != 1 || w[0].Name != "工作区5" {
		t.Fatalf("300 workspaces = %+v, want [工作区5]", w)
	}
	// One pool, unique numbers: no chat-name prefix, max+1 over the whole category.
	if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.Name != "工作区6" {
		t.Fatalf("300 new = %+v, %v; want 工作区6", w, err)
	}
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.Name != "工作区7" {
		t.Fatalf("200 new = %+v, %v; want 工作区7", w, err)
	}
	ws := e.TeamWorkspacesOf("300")
	if parent, w, err := e.NewTeamWorkspace("discord:" + ws[1].ID); err != nil || parent != "discord:300" || w.Name != "工作区8" {
		t.Fatalf("new from workspace = %s %+v %v", parent, w, err)
	}
	// The pool lists every 工作区n of the category, lowest first, whoever owns it.
	pool, err := e.TeamWorkspacePool("discord:300")
	if err != nil || len(pool) != 5 || pool[0].Name != "工作区1" || pool[4].Name != "工作区8" {
		t.Fatalf("pool = %+v %v", pool, err)
	}
	if pool[0].Owner != "discord:200" || pool[1].Owner != "discord:300" {
		t.Fatalf("pool owners = %+v", pool)
	}
	// One owner at a time: #300 cannot take 工作区1 while #200 owns it; its replies stay with #200.
	if err := e.ClaimTeamWorkspace("discord:300", "201", ""); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim of #200's workspace by #300 = %v, want ErrTeamWorkspaceOwned", err)
	}
	if p, ok := e.WorkspaceParent("201"); !ok || p != "200" {
		t.Fatalf("parent of 201 = %q,%v; want 200", p, ok)
	}
	// The owner handing off again is fine.
	if err := e.ClaimTeamWorkspace("discord:200", "201", ""); err != nil {
		t.Fatal(err)
	}
	// 工作区1 finishes its last task (its lead session is reset): free for any chat channel.
	if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
		t.Fatal("201 not released")
	}
	if pool, _ := e.TeamWorkspacePool("discord:300"); pool[0].Owner != "" {
		t.Fatalf("released 201 still owned: %+v", pool[0])
	}
	if err := e.ClaimTeamWorkspace("discord:300", "201", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if p, ok := e.WorkspaceParent("201"); !ok || p != "300" {
		t.Fatalf("parent of 201 = %q,%v; want 300", p, ok)
	}
	for _, w := range e.TeamWorkspacesOf("200") {
		if w.ID == "201" {
			t.Fatalf("201 still recorded under #200: %+v", e.TeamWorkspacesOf("200"))
		}
	}
	if err := e.ClaimTeamWorkspace("discord:200", "201", ""); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim back by #200 = %v, want ErrTeamWorkspaceOwned", err)
	}
}

// Review item 1: the Discord create runs without the store lock, so WorkspaceParent (reply
// path) answers while a create is stuck on the network.
func TestWorkspaceParentNotBlockedByCreate(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200")
	if err := ensureWorkspace1(e, "discord:200"); err != nil { // adopts 201, no create
		t.Fatal(err)
	}
	if _, _, err := e.NewTeamWorkspace("discord:200"); err != nil { // adopts the free 205, no create
		t.Fatal(err)
	}
	g.block, g.creating = make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() { _, _, err := e.NewTeamWorkspace("discord:200"); done <- err }()
	<-g.creating
	got := make(chan string, 1)
	go func() { p, _ := e.WorkspaceParent("201"); got <- p }()
	select {
	case p := <-got:
		if p != "200" {
			t.Fatalf("WorkspaceParent(201) = %q, want 200", p)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("WorkspaceParent blocked by an in-flight create")
	}
	close(g.block)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if w := e.TeamWorkspacesOf("200"); len(w) != 3 || w[2].Name != "工作区6" {
		t.Fatalf("after create = %+v", w)
	}
}

// Review of PR #139 item 2: one operation per chat at a time, and a permanent failure (Discord
// 403, Feishu without im:chat) is not retried until restart, so the platform's failure note
// in the chat (Feishu) goes out once.
func TestTeamWorkspacePermanentFailureOnce(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100:u1")
	// The shared pool's free workspaces are adopted without a platform call; only then does
	// "new" create, and that create is the one that fails for good.
	adoptWorkspacePool(t, e, "discord:100:u1")
	g.mu.Lock()
	g.createErr = fmt.Errorf("%w: no im:chat", ErrTeamWorkspacePermanent)
	g.block, g.creating = make(chan struct{}), make(chan struct{})
	g.mu.Unlock()
	first := make(chan error, 1)
	go func() { _, _, err := e.NewTeamWorkspace("discord:100:u1"); first <- err }()
	select {
	case <-g.creating:
	case err := <-first:
		t.Fatalf("new returned %v without reaching create", err)
	case <-time.After(5 * time.Second):
		t.Fatal("new never reached create (adopted instead?)")
	}
	if _, _, err := e.NewTeamWorkspace("discord:100:u2"); !errors.Is(err, ErrTeamWorkspaceBusy) {
		t.Fatalf("concurrent new = %v, want ErrTeamWorkspaceBusy", err)
	}
	close(g.block)
	if err := <-first; !errors.Is(err, ErrTeamWorkspacePermanent) {
		t.Fatalf("first new = %v, want permanent", err)
	}
	g.mu.Lock()
	g.block = nil
	g.mu.Unlock()
	for i := 0; i < 3; i++ {
		if _, _, err := e.NewTeamWorkspace("discord:100"); !errors.Is(err, ErrTeamWorkspacePermanent) {
			t.Fatalf("new after permanent = %v", err)
		}
	}
	g.mu.Lock()
	creates := g.createCalls
	g.mu.Unlock()
	if creates != 1 {
		t.Fatalf("create calls = %d, want 1 (one failure note)", creates)
	}
	// A retryable error (not connected yet) is not remembered.
	g.mu.Lock()
	g.offline, g.createErr = true, nil
	g.mu.Unlock()
	e.sessions.GetOrCreateActive("discord:200")
	if _, _, err := e.NewTeamWorkspace("discord:200"); err == nil {
		t.Fatal("offline must fail")
	}
	g.mu.Lock()
	g.offline = false
	g.mu.Unlock()
	if _, _, err := e.NewTeamWorkspace("discord:200"); err != nil {
		t.Fatalf("after reconnect: %v", err)
	}
}

// Review round 2 of PR #139: a panic in platform code (net/http recovers it) must not leave
// the chat in-flight, or every later "new" returns ErrTeamWorkspaceBusy until restart.
func TestTeamWorkspacePanicClearsInflight(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100")
	adoptWorkspacePool(t, e, "discord:100") // adoption makes no platform call; the next new creates
	g.mu.Lock()
	g.panicOnce = true
	g.mu.Unlock()
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("platform panic did not propagate")
			}
		}()
		e.NewTeamWorkspace("discord:100")
	}()
	if _, _, err := e.NewTeamWorkspace("discord:100"); err != nil {
		t.Fatalf("new after panic = %v, want success (not busy)", err)
	}
}

// Review item 3: "new" only for Discord chat channels of the lead.
func TestNewTeamWorkspaceOnlyLeadDiscordChats(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("telegram:100")
	for _, key := range []string{"telegram:100", "100", "discord:100"} {
		if _, _, err := e.NewTeamWorkspace(key); !errors.Is(err, ErrTeamWorkspaceNotLeadChat) {
			t.Fatalf("%s: %v, want ErrTeamWorkspaceNotLeadChat", key, err)
		}
	}
	if got := g.createdNames(); len(got) != 0 {
		t.Fatalf("created = %v, want none", got)
	}
	e.sessions.GetOrCreateActive("discord:100:u1")
	if _, w, err := e.NewTeamWorkspace("discord:100"); err != nil || w.Name != "工作区1" {
		t.Fatalf("lead chat: %+v %v", w, err)
	}
}

// Team mode E: the platform of a chat comes from its session key; each platform's chats get
// their own 「工作区1」 from that platform, and the same channel ID on two platforms is two chats.
func TestTeamWorkspacesPerPlatform(t *testing.T) {
	disc := newWorkspaceGuild()
	fs := &fakeWorkspaceGuild{
		stubPlatformEngine: stubPlatformEngine{n: "feishu"},
		channels:           []TeamChannel{{ID: "100", Name: "飞书群"}},
		nonText:            map[string]bool{"oc_p2p": true},
	}
	dataDir := t.TempDir()
	e := NewEngine("lead", &stubAgent{}, []Platform{disc, fs}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	e.teamWS = newTeamWorkspaces()
	for _, k := range []string{"discord:100:u1", "feishu:100:ou_1", "feishu:oc_p2p:ou_1", "telegram:5:u"} {
		e.sessions.GetOrCreateActive(k)
	}
	got := e.teamLeadChats()
	if strings.Join(got, ",") == "" || len(got) != 3 {
		t.Fatalf("lead chats = %v, want discord:100, feishu:100, feishu:oc_p2p", got)
	}
	for _, c := range got {
		if err := ensureWorkspace1(e, c); err != nil && !errors.Is(err, ErrNotTeamChannel) {
			t.Fatalf("ensure %s: %v", c, err)
		}
	}
	// Discord adopts the free 工作区1 (201) from the shared pool; feishu has none and creates one.
	if d, f := disc.createdNames(), fs.createdNames(); len(d) != 0 || len(f) != 1 || f[0] != "/工作区1" {
		t.Fatalf("discord created %v, feishu created %v", d, f)
	}
	if dw := e.TeamWorkspacesOf("discord:100"); len(dw) != 1 || dw[0].ID != "201" {
		t.Fatalf("discord workspaces = %+v, want adopted 201", dw)
	}
	fw := e.TeamWorkspacesOf("feishu:100")
	if len(fw) != 1 {
		t.Fatalf("feishu workspaces = %+v", fw)
	}
	if p, ok := e.WorkspaceParent("feishu:" + fw[0].ID); !ok || p != "feishu:100" {
		t.Fatalf("feishu parent = %q %v", p, ok)
	}
	if _, w, err := e.NewTeamWorkspace("feishu:100:ou_1"); err != nil || w.Name != "工作区2" {
		t.Fatalf("feishu new: %+v %v", w, err)
	}
	if _, _, err := e.NewTeamWorkspace("telegram:5:u"); !errors.Is(err, ErrTeamWorkspaceNotLeadChat) {
		t.Fatalf("telegram new: %v", err)
	}
	if got := disc.createdNames(); len(got) != 0 {
		t.Fatalf("discord created after feishu new = %v", got)
	}
}

// Review of PR #178 item 4: a claim takes teamWorkspaceOpMu, so it never lands between a
// create's guild listing and its save (which would leave the workspace under two chats).
func TestTeamWorkspaceClaimWaitsForCreate(t *testing.T) {
	g := newWorkspaceGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200")
	if err := ensureWorkspace1(e, "discord:200"); err != nil { // #200 adopts 201
		t.Fatal(err)
	}
	if _, _, err := e.NewTeamWorkspace("discord:200"); err != nil { // adopts the free 205; the next one is created
		t.Fatal(err)
	}
	g.block, g.creating = make(chan struct{}), make(chan struct{})
	created := make(chan error, 1)
	go func() { _, _, err := e.NewTeamWorkspace("discord:200"); created <- err }()
	<-g.creating // the create holds a listing in which 201 belongs to #200 (and 205 too)
	claimed := make(chan error, 1)
	go func() { claimed <- e.ClaimTeamWorkspace("discord:300", "201", "") }()
	select {
	case err := <-claimed:
		t.Fatalf("claim finished while a create was in flight (err %v); it must wait for teamWorkspaceOpMu", err)
	case <-time.After(150 * time.Millisecond):
	}
	close(g.block)
	if err := <-created; err != nil {
		t.Fatal(err)
	}
	if err := <-claimed; !errors.Is(err, ErrTeamWorkspaceOwned) { // 201 is #200's
		t.Fatalf("claim = %v, want ErrTeamWorkspaceOwned", err)
	}
	owners := 0
	for _, chat := range []string{"200", "300"} {
		for _, w := range e.TeamWorkspacesOf(chat) {
			if w.ID == "201" {
				owners++
			}
		}
	}
	if p, ok := e.WorkspaceParent("201"); owners != 1 || !ok || p != "200" {
		t.Fatalf("201 owners = %d, parent = %q,%v; want only #200 (still its owner)", owners, p, ok)
	}
}

// Many claims and creates at once keep every workspace under exactly one chat channel.
func TestTeamWorkspaceClaimConcurrent(t *testing.T) {
	g := newWorkspaceGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200")
	e.sessions.GetOrCreateActive("discord:300")
	if err := ensureWorkspace1(e, "discord:200"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		chat := []string{"discord:200", "discord:300"}[i%2]
		go func() { defer wg.Done(); _ = e.ClaimTeamWorkspace(chat, "201", "") }()
		go func() { defer wg.Done(); _, _, _ = e.NewTeamWorkspace(chat) }()
	}
	wg.Wait()
	seen := map[string]string{}
	for _, chat := range []string{"200", "300"} {
		for _, w := range e.TeamWorkspacesOf(chat) {
			if prev, dup := seen[w.ID]; dup {
				t.Fatalf("workspace %s under both #%s and #%s", w.ID, prev, chat)
			}
			seen[w.ID] = chat
		}
	}
	if seen["201"] == "" {
		t.Fatalf("201 lost: %v", seen)
	}
}

// Review of PR #178 item 5: recorded old 「<chat>-工作区n」 workspaces are renamed into the pool
// as 工作区(max+1) through the platform; when the rename fails they stay recognised and pooled.
func TestTeamWorkspaceLegacyNamesMigrated(t *testing.T) {
	setup := func(t *testing.T) (*fakeWorkspaceGuild, *Engine) {
		g := newWorkspaceGuild()
		g.channels = append(g.channels,
			TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"},
			TeamChannel{ID: "302", Name: "闲聊-工作区2", ParentID: "catB"},
			TeamChannel{ID: "301", Name: "闲聊-工作区1", ParentID: "catB"},
			TeamChannel{ID: "309", Name: "别人-工作区1", ParentID: "catB"}, // not ours (no record): untouched
		)
		dataDir := t.TempDir()
		raw, _ := json.Marshal(teamWorkspaceState{Parents: map[string][]TeamWorkspace{
			"discord:300": {{ID: "301", Name: "闲聊-工作区1"}, {ID: "302", Name: "闲聊-工作区2"}},
		}, Version: teamWorkspaceStateVersion}) // records of workspaces #300 owns now
		if err := os.WriteFile(teamWorkspacePath(dataDir), raw, 0o600); err != nil {
			t.Fatal(err)
		}
		forgetWorkspaceCache(dataDir)
		e := newWorkspaceLead(t, g, dataDir)
		e.teamWS = newTeamWorkspaces()
		return g, e
	}
	names := func(ws []TeamWorkspace) string {
		var out []string
		for _, w := range ws {
			out = append(out, w.ID+"="+w.Name)
		}
		return strings.Join(out, ",")
	}

	t.Run("renamed", func(t *testing.T) {
		g, e := setup(t)
		pool, err := e.TeamWorkspacePool("discord:300")
		if err != nil {
			t.Fatal(err)
		}
		if got := names(pool); got != "201=工作区1,205=工作区5,301=工作区6,302=工作区7,309=别人-工作区1" {
			t.Fatalf("pool = %s", got)
		}
		if got := strings.Join(g.renames, ","); got != "301=工作区6,302=工作区7" {
			t.Fatalf("renames = %s", got)
		}
		if got := names(e.TeamWorkspacesOf("300")); got != "301=工作区6,302=工作区7" {
			t.Fatalf("records = %s", got)
		}
		if p, ok := e.WorkspaceParent("301"); !ok || p != "300" {
			t.Fatalf("parent of 301 = %q,%v", p, ok)
		}
		// Idempotent, and the next 「工作区n」 continues after the renamed ones once the free
		// 工作区1 and 工作区5 are taken.
		if _, err := e.TeamWorkspacePool("discord:300"); err != nil || len(g.renames) != 2 {
			t.Fatalf("second pool: %v renames %v", err, g.renames)
		}
		for _, id := range []string{"201", "205"} {
			if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.ID != id {
				t.Fatalf("new = %+v %v, want the free %s", w, err, id)
			}
		}
		if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.Name != "工作区8" {
			t.Fatalf("new = %+v %v, want 工作区8", w, err)
		}
	})

	t.Run("rename fails", func(t *testing.T) {
		g, e := setup(t)
		g.renameErr = fmt.Errorf("%w: missing permissions", ErrTeamWorkspacePermanent)
		pool, err := e.TeamWorkspacePool("discord:300")
		if err != nil {
			t.Fatal(err)
		}
		if got := names(pool); got != "201=工作区1,205=工作区5,302=闲聊-工作区2,301=闲聊-工作区1,309=别人-工作区1" {
			t.Fatalf("pool = %s", got)
		}
		// Still recognised: a legacy-named workspace resolves to its chat and can be claimed.
		if p, ok := e.WorkspaceParent("302"); !ok || p != "300" {
			t.Fatalf("parent of 302 = %q,%v", p, ok)
		}
		if err := e.ClaimTeamWorkspace("discord:300", "302", ""); err != nil {
			t.Fatal(err)
		}
		if err := e.ClaimTeamWorkspace("discord:200", "302", ""); !errors.Is(err, ErrTeamWorkspaceOwned) {
			t.Fatalf("claim of #300's 302 by #200 = %v, want ErrTeamWorkspaceOwned", err)
		}
		if p, _ := e.WorkspaceParent("302"); p != "300" {
			t.Fatalf("parent of 302 after refused claim = %q", p)
		}
		// A legacy-named channel is a workspace, never a chat channel of its own.
		if _, _, err := e.teamWorkspaceOp("discord:309", true); !errors.Is(err, errTeamIsWorkspace) {
			t.Fatalf("op on 309 = %v, want errTeamIsWorkspace", err)
		}
	})
}

// Adopting a pool workspace and claiming one both tell a platform that records the parent
// itself (cloud_web/DSH: rooms.parent_id), so its unified exit follows the owner; a claim of a
// workspace another chat owns is refused before the platform is asked.
func TestTeamWorkspaceClaimTellsPlatform(t *testing.T) {
	g := &claimingGuild{fakeWorkspaceGuild: newWorkspaceGuild()}
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "橘", true)
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200")
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.ID != "201" {
		t.Fatalf("adopt = %+v %v", w, err)
	}
	if err := e.ClaimTeamWorkspace("discord:300", "201", ""); !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("claim by #300 = %v, want ErrTeamWorkspaceOwned", err)
	}
	if err := e.ClaimTeamWorkspace("discord:200", "201", ""); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(g.claims, ","); got != "200→201,200→201" {
		t.Fatalf("claims = %s", got)
	}
	// A refused platform claim leaves the record where it was.
	e.releaseTeamWorkspace("discord:201", time.Now(), false)
	g.claimErr = errors.New("gateway: room-missing")
	if err := e.ClaimTeamWorkspace("discord:300", "201", ""); err == nil {
		t.Fatal("claim must fail when the platform refuses")
	}
	if _, ok := e.WorkspaceParent("201"); ok {
		t.Fatal("201 recorded after a refused platform claim")
	}
}

// Review of PR #178 item 6: POST /team/workspace/claim and the pool in /team/workspace/list.
func TestTeamWorkspaceClaimAPI(t *testing.T) {
	g := newWorkspaceGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"},
		TeamChannel{ID: "206", Name: "公告", ParentID: "catB"})
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200")
	if err := ensureWorkspace1(e, "discord:200"); err != nil { // #200 adopts 201
		t.Fatal(err)
	}
	sub := NewEngine("sub", &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(sub.cancel)
	s := &APIServer{engines: map[string]*Engine{"lead": e, "sub": sub}}
	claim := func(srv *APIServer, method, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		srv.handleTeamWorkspaceClaim(rec, httptest.NewRequest(method, "/team/workspace/claim", strings.NewReader(body)))
		return rec
	}

	rec := claim(s, http.MethodPost, `{"session_key":"discord:300:u1","workspace_id":"205"}`)
	var r TeamWorkspaceListResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &r) != nil || r.Parent != "discord:300" ||
		len(r.Workspaces) != 1 || r.Workspaces[0].ID != "205" || r.Workspaces[0].Name != "工作区5" {
		t.Fatalf("claim 205: %d %s", rec.Code, rec.Body.String())
	}
	// 201 is #200's: refused with 409 until its last task is done.
	if rec = claim(s, http.MethodPost, `{"session_key":"discord:300","workspace_id":"201"}`); rec.Code != http.StatusConflict {
		t.Fatalf("claim of #200's 201: %d %s, want 409", rec.Code, rec.Body.String())
	}
	e.releaseTeamWorkspace("discord:201", time.Now(), false)
	// Released, 201 moves from #200 to #300; the name comes from the record.
	rec = claim(s, http.MethodPost, `{"session_key":"discord:300","workspace_id":"201"}`)
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &r) != nil || len(r.Workspaces) != 2 {
		t.Fatalf("claim 201: %d %s", rec.Code, rec.Body.String())
	}
	if p, _ := e.WorkspaceParent("201"); p != "300" || len(e.TeamWorkspacesOf("200")) != 0 {
		t.Fatalf("parent of 201 = %q, #200 = %+v", p, e.TeamWorkspacesOf("200"))
	}
	// A workspace cannot claim on behalf of its chat channel (#534).
	if rec = claim(s, http.MethodPost, `{"session_key":"discord:201","workspace_id":"205"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("claim from workspace: %d %s", rec.Code, rec.Body.String())
	}

	for _, c := range []struct {
		method, body string
		code         int
	}{
		{http.MethodGet, ``, http.StatusMethodNotAllowed},
		{http.MethodPost, `{`, http.StatusBadRequest},
		{http.MethodPost, `{"session_key":"discord:300"}`, http.StatusBadRequest},
		{http.MethodPost, `{"session_key":"discord:300","workspace_id":"206"}`, http.StatusBadRequest}, // 公告 is no workspace
		{http.MethodPost, `{"session_key":"discord:300","workspace_id":"300"}`, http.StatusBadRequest}, // itself
	} {
		if rec := claim(s, c.method, c.body); rec.Code != c.code {
			t.Fatalf("%s %s: %d %s, want %d", c.method, c.body, rec.Code, rec.Body.String(), c.code)
		}
	}
	off := &APIServer{engines: map[string]*Engine{"sub": sub}}
	if rec := claim(off, http.MethodPost, `{"session_key":"discord:300","workspace_id":"201"}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", rec.Code)
	}

	// list carries the whole category pool, lowest number first.
	rec = httptest.NewRecorder()
	s.handleTeamWorkspaceList(rec, httptest.NewRequest(http.MethodGet, "/team/workspace/list?session_key=discord:200", nil))
	var l TeamWorkspaceListResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &l) != nil || len(l.Pool) != 2 ||
		l.Pool[0].ID != "201" || l.Pool[1].ID != "205" || len(l.Workspaces) != 0 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
}

// cloud_web/DSH: the bridge's record does not know that chat A (#200) is using 工作区1 (the
// gateway does: 2 tasks in progress). Chat B (#300) must not adopt it; it takes the idle
// 工作区5 and claims it.
func TestTeamWorkspaceAdoptSkipsBusy(t *testing.T) {
	g := &claimingGuild{fakeWorkspaceGuild: newWorkspaceGuild()}
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	g.channels[2].Active = 2 // 201 工作区1, parent #200 on the gateway
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "橘", true)
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:300")
	if err := ensureWorkspace1(e, "discord:300"); err != nil {
		t.Fatal(err)
	}
	if w := e.TeamWorkspacesOf("300"); len(w) != 1 || w[0].ID != "205" {
		t.Fatalf("300 workspaces = %+v, want the idle 205, not the busy 201", w)
	}
	if got := strings.Join(g.claims, ","); got != "300→205" {
		t.Fatalf("claims = %s, want 300→205", got)
	}
	if p, _ := e.WorkspaceParent("201"); p != "" {
		t.Fatalf("busy 201 got parent %q", p)
	}
}
