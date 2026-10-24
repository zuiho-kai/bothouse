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
	if _, w, err := e.NewTeamWorkspace("discord:100:u1"); err != nil || w.Name != "工作区1" {
		t.Fatalf("first new in #100 = %+v %v", w, err)
	}
	// #200 has an unclaimed 工作区1 (201) in its category: the first new adopts it.
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.ID != "201" {
		t.Fatalf("first new in #200 = %+v %v, want adopted 201", w, err)
	}
	if got := g.createdNames(); len(got) != 1 || got[0] != "catA/工作区1" {
		t.Fatalf("created = %v, want [catA/工作区1]", got)
	}
	// After a restart the recorded 工作区1 is kept; the next new is 工作区2.
	e.cancel()
	forgetWorkspaceCache(dataDir)
	e2 := newWorkspaceLead(t, g, dataDir)
	e2.SetTeamWorkspaces(true)
	if _, w, err := e2.NewTeamWorkspace("discord:100"); err != nil || w.Name != "工作区2" {
		t.Fatalf("new after restart = %+v %v", w, err)
	}
}

func TestTeamWorkspacesNewNumbering(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.teamWS = newTeamWorkspaces() // on, without the backfill goroutine
	e.sessions.GetOrCreateActive("discord:100:u1")
	e.sessions.GetOrCreateActive("discord:200")

	// No 工作区1 yet: "new" makes 工作区1 first.
	parent, w1, err := e.NewTeamWorkspace("discord:100:u1")
	if err != nil || parent != "discord:100" || w1.Name != "工作区1" {
		t.Fatalf("first new = %q %+v %v", parent, w1, err)
	}
	if _, w2, err := e.NewTeamWorkspace("discord:100:u1"); err != nil || w2.Name != "工作区2" {
		t.Fatalf("second new = %+v %v", w2, err)
	}
	// Called from inside a workspace (a working role there): goes to its chat channel.
	parent, w3, err := e.NewTeamWorkspace("discord:" + w1.ID)
	if err != nil || parent != "discord:100" || w3.Name != "工作区3" {
		t.Fatalf("new from workspace = %q %+v %v", parent, w3, err)
	}
	// #200: the first new adopts the unclaimed 工作区1, the next numbers past 工作区5 already in its category.
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.ID != "201" {
		t.Fatalf("first new in #200 = %+v %v, want adopted 201", w, err)
	}
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.Name != "工作区6" {
		t.Fatalf("new in #200 = %+v %v", w, err)
	}
	if got := e.TeamWorkspacesOf("200"); len(got) != 2 || got[0].ID != "201" {
		t.Fatalf("#200 workspaces = %+v", got)
	}
	// A deleted workspace is dropped; the chat still has 工作区2/3, so ensure creates nothing.
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
	if !names["工作区2"] || !names["工作区3"] || len(names) != 2 {
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
		t.Fatal("only the team lead runs workspaces")
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
	// #300 hands off to 工作区1: asks and reports now go to #300 (last handoff wins).
	if err := e.ClaimTeamWorkspace("discord:300", "201", ""); err != nil {
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
	if err := e.ClaimTeamWorkspace("discord:200", "201", ""); err != nil {
		t.Fatal(err)
	}
	if p, ok := e.WorkspaceParent("201"); !ok || p != "200" {
		t.Fatalf("parent of 201 after re-handoff = %q,%v; want 200", p, ok)
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
	if w := e.TeamWorkspacesOf("200"); len(w) != 2 || w[1].Name != "工作区6" {
		t.Fatalf("after create = %+v", w)
	}
}

// Review of PR #139 item 2: one operation per chat at a time, and a permanent failure (Discord
// 403, Feishu without im:chat) is not retried until restart, so the platform's failure note
// in the chat (Feishu) goes out once.
func TestTeamWorkspacePermanentFailureOnce(t *testing.T) {
	g := newWorkspaceGuild()
	g.createErr = fmt.Errorf("%w: no im:chat", ErrTeamWorkspacePermanent)
	g.block, g.creating = make(chan struct{}), make(chan struct{})
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100:u1")
	first := make(chan error, 1)
	go func() { _, _, err := e.NewTeamWorkspace("discord:100:u1"); first <- err }()
	<-g.creating
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
	g.panicOnce = true
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100")
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
	if d, f := disc.createdNames(), fs.createdNames(); len(d) != 1 || d[0] != "catA/工作区1" || len(f) != 1 || f[0] != "/工作区1" {
		t.Fatalf("discord created %v, feishu created %v", d, f)
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
	if got := disc.createdNames(); len(got) != 1 {
		t.Fatalf("discord created after feishu new = %v", got)
	}
}
