package core

import (
	"context"
	"encoding/json"
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
	mu        sync.Mutex
	channels  []TeamChannel
	nonText   map[string]bool // DMs, threads
	offline   bool
	created   []TeamChannel
	nextID    int
	listCalls int
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
	defer g.mu.Unlock()
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

func fastWorkspaceRetry(t *testing.T) {
	t.Helper()
	tries, every := teamWorkspaceStartTries, teamWorkspaceStartEvery
	teamWorkspaceStartTries, teamWorkspaceStartEvery = 50, 5*time.Millisecond
	t.Cleanup(func() { teamWorkspaceStartTries, teamWorkspaceStartEvery = tries, every })
}

// forgetWorkspaceCache makes the next read come from disk, as after a restart.
func forgetWorkspaceCache(dataDir string) {
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(dataDir))
	teamWorkspaceStore.mu.Unlock()
}

func TestTeamWorkspacesBackfillAtStart(t *testing.T) {
	fastWorkspaceRetry(t)
	g := newWorkspaceGuild()
	g.offline = true // platform still connecting when the backfill starts
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	for _, k := range []string{"discord:100:u1", "discord:100:u2", "discord:200", "discord:201", "discord:900", "telegram:5"} {
		e.sessions.GetOrCreateActive(k)
	}
	e.SetTeamWorkspaces(true)
	time.Sleep(20 * time.Millisecond)
	g.mu.Lock()
	g.offline = false
	g.mu.Unlock()
	waitFor(t, "工作区1 of 100", func() bool { return len(e.TeamWorkspacesOf("100")) == 1 })
	waitFor(t, "adopted 工作区1 of 200", func() bool { return len(e.TeamWorkspacesOf("200")) == 1 })

	// Only #100 lacked one; #200's existing 工作区1 is adopted, the workspace itself and the DM get none.
	if got := g.createdNames(); len(got) != 1 || got[0] != "catA/工作区1" {
		t.Fatalf("created = %v, want [catA/工作区1]", got)
	}
	if w := e.TeamWorkspacesOf("discord:200"); w[0].ID != "201" {
		t.Fatalf("200 workspaces = %+v, want adopted 201", w)
	}
	if w := e.TeamWorkspacesOf("201"); len(w) != 0 {
		t.Fatalf("a workspace must not get its own workspace: %+v", w)
	}
}

func TestTeamWorkspacesExistingSkippedAfterRestart(t *testing.T) {
	fastWorkspaceRetry(t)
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.sessions.GetOrCreateActive("discord:100:u1")
	e.SetTeamWorkspaces(true)
	waitFor(t, "first backfill", func() bool { return len(e.TeamWorkspacesOf("100")) == 1 })
	e.cancel()

	forgetWorkspaceCache(dataDir)
	e2 := newWorkspaceLead(t, g, dataDir)
	e2.sessions.GetOrCreateActive("discord:100:u1")
	e2.SetTeamWorkspaces(true)
	waitFor(t, "second backfill", func() bool {
		e2.teamWS.mu.Lock()
		defer e2.teamWS.mu.Unlock()
		return e2.teamWS.seen["discord:100"]
	})
	if got := g.createdNames(); len(got) != 1 {
		t.Fatalf("restart must not create again, created = %v", got)
	}
}

func TestTeamWorkspacesNewNumbering(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.teamWS = &teamWorkspaces{seen: map[string]bool{}} // on, without the backfill goroutine

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
	// #200 adopts 工作区1 and numbers past 工作区5 already in its category.
	if _, w, err := e.NewTeamWorkspace("discord:200"); err != nil || w.Name != "工作区6" {
		t.Fatalf("new in #200 = %+v %v", w, err)
	}
	if got := e.TeamWorkspacesOf("200"); len(got) != 2 || got[0].ID != "201" {
		t.Fatalf("#200 workspaces = %+v", got)
	}
	// A deleted workspace is dropped; 工作区1 gone means ensure recreates it.
	g.mu.Lock()
	for i, c := range g.channels {
		if c.ID == w1.ID {
			g.channels = append(g.channels[:i], g.channels[i+1:]...)
			break
		}
	}
	g.mu.Unlock()
	if err := e.ensureTeamWorkspace("discord:100"); err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, w := range e.TeamWorkspacesOf("100") {
		names[w.Name] = true
	}
	if !names["工作区1"] || !names["工作区2"] || !names["工作区3"] || len(names) != 3 {
		t.Fatalf("after delete+ensure = %v", names)
	}
}

func TestWorkspaceParentPersisted(t *testing.T) {
	g := newWorkspaceGuild()
	dataDir := t.TempDir()
	e := newWorkspaceLead(t, g, dataDir)
	e.teamWS = &teamWorkspaces{seen: map[string]bool{}}
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

	// The lead sees a channel for the first time: 工作区1 is made for it.
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = &teamWorkspaces{seen: map[string]bool{}}
	e.teamNoteTurn(&Message{SessionKey: "discord:100:u1", Content: "hi"}, nil)
	waitFor(t, "工作区1 for a new channel", func() bool { return len(e.TeamWorkspacesOf("100")) == 1 })
	e.teamNoteTurn(&Message{SessionKey: "discord:100:u2", Content: "again"}, nil)
	time.Sleep(20 * time.Millisecond)
	if got := g.createdNames(); len(got) != 1 {
		t.Fatalf("created = %v", got)
	}
}

func TestTeamWorkspaceAPI(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = &teamWorkspaces{seen: map[string]bool{}}
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
	off := &APIServer{engines: map[string]*Engine{"sub": sub}}
	rec = httptest.NewRecorder()
	off.handleTeamWorkspaceNew(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/new", strings.NewReader(`{"session_key":"discord:100"}`)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", rec.Code)
	}
}
