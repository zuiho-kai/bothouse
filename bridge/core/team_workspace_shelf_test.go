package core

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// shelvingGuild is a guild whose platform keeps a category for idle workspaces (Discord
// 「空闲工作区」, TeamWorkspaceShelver). It is a Platform of its own (the wrapper, not the
// embedded fake), so core's type assertion sees the interface.
type shelvingGuild struct {
	*fakeWorkspaceGuild
	shelfID   string
	shelves   []string // workspace IDs asked to shelve, in order
	unshelves []string // "workspace→beside" per move, in order
	shelveErr error
}

func (g *shelvingGuild) parentOfLocked(id string) string {
	for _, c := range g.channels {
		if c.ID == id {
			return c.ParentID
		}
	}
	return ""
}

func (g *shelvingGuild) moveLocked(id, parent string) {
	for i, c := range g.channels {
		if c.ID == id {
			g.channels[i].ParentID, g.channels[i].Shelved = parent, parent == g.shelfID
		}
	}
}

func (g *shelvingGuild) ShelveTeamWorkspaceChannel(_ context.Context, id string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.shelves = append(g.shelves, id)
	if g.shelveErr != nil {
		return g.shelveErr
	}
	if g.parentOfLocked(id) != g.shelfID {
		g.moveLocked(id, g.shelfID)
	}
	return nil
}

func (g *shelvingGuild) UnshelveTeamWorkspaceChannel(_ context.Context, id, beside string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	parent := g.parentOfLocked(beside)
	if parent == "" || g.parentOfLocked(id) == parent {
		return nil // nothing to move (as the real one: already beside)
	}
	g.unshelves = append(g.unshelves, id+"→"+beside)
	g.moveLocked(id, parent)
	return nil
}

func (g *shelvingGuild) shelveCalls() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.shelves...)
}

func (g *shelvingGuild) unshelveCalls() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.unshelves...)
}

func (g *shelvingGuild) parentOf(id string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.parentOfLocked(id)
}

// newShelvingGuild is newWorkspaceGuild with the idle category 「空闲工作区」 (catShelf), empty.
func newShelvingGuild() *shelvingGuild {
	return &shelvingGuild{fakeWorkspaceGuild: newWorkspaceGuild(), shelfID: "catShelf"}
}

func newShelvingLead(t *testing.T, g *shelvingGuild, dataDir string) *Engine {
	t.Helper()
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	e.SetTeamWorkspaces(true)
	return e
}

// A workspace that goes back to the pool after its last task moves into the platform's idle
// category (user 2026-11-08 22:2x: 「工作区 用的工作区自动收起吧」), and stays a pool workspace
// there: free, listed, and lowest-numbered first.
func TestTeamWorkspaceReleaseShelves(t *testing.T) {
	g := newShelvingGuild()
	e := newShelvingLead(t, g, t.TempDir())
	if err := ensureWorkspace1(e, "discord:200"); err != nil { // adopts 工作区1 (201)
		t.Fatal(err)
	}
	if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
		t.Fatal("201 not released")
	}
	waitFor(t, "工作区1 shelved", func() bool { return len(g.shelveCalls()) == 1 })
	if got := g.shelveCalls(); got[0] != "201" {
		t.Fatalf("shelved = %v, want 201", got)
	}
	if got := g.parentOf("201"); got != "catShelf" {
		t.Fatalf("201 category = %q, want catShelf", got)
	}
	pool, err := e.TeamWorkspacePool("discord:200")
	if err != nil {
		t.Fatal(err)
	}
	if len(pool) < 2 || pool[0].ID != "201" || pool[0].Owner != "" {
		t.Fatalf("pool after shelving = %+v, want 工作区1 free and first", pool)
	}
}

// A workspace taken again is moved back beside the claiming chat channel, and a shelved one is
// adopted and numbered like any other free pool workspace.
func TestTeamWorkspaceClaimUnshelves(t *testing.T) {
	g := newShelvingGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	// 工作区5 waits in the idle category after an earlier task; 工作区1 is in the pool's own.
	g.channels[3] = TeamChannel{ID: "205", Name: "工作区5", ParentID: "catShelf", Shelved: true}
	e := newShelvingLead(t, g, t.TempDir())
	e.sessions.GetOrCreateActive("discord:300")

	// The pool starts with the lowest number, shelved or not: 工作区1 here.
	if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.ID != "201" {
		t.Fatalf("adopt = %+v %v, want 201", w, err)
	}
	// A claim moves the shelved workspace back beside its new chat channel.
	if err := e.ClaimTeamWorkspace("discord:300", "205", "工作区5"); err != nil {
		t.Fatal(err)
	}
	if got := g.unshelveCalls(); len(got) != 1 || got[0] != "205→300" {
		t.Fatalf("unshelved = %v, want 205→300", got)
	}
	if got := g.parentOf("205"); got != "catB" {
		t.Fatalf("205 category = %q, want catB (the chat channel's)", got)
	}
	// Numbering counts a shelved workspace: the next one is 工作区6, not 工作区5 again.
	if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.Name != "工作区6" {
		t.Fatalf("new = %+v %v, want 工作区6", w, err)
	}
}

// A platform without the interface (Feishu, cloud_web) behaves as before: no shelving, the pool
// is its category, and a release leaves the workspace where it is.
func TestTeamWorkspaceNoShelverUnchanged(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.SetTeamWorkspaces(true)
	if err := ensureWorkspace1(e, "discord:200"); err != nil {
		t.Fatal(err)
	}
	if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
		t.Fatal("201 not released")
	}
	pool, err := e.TeamWorkspacePool("discord:200")
	if err != nil || len(pool) < 2 || pool[0].ID != "201" || pool[0].Owner != "" {
		t.Fatalf("pool = %+v %v", pool, err)
	}
}

// A failing shelve only logs: the release still frees the workspace and the pool keeps it.
func TestTeamWorkspaceShelveFailureIgnored(t *testing.T) {
	g := newShelvingGuild()
	g.shelveErr = fmt.Errorf("discord: 50013 missing permission")
	e := newShelvingLead(t, g, t.TempDir())
	if err := ensureWorkspace1(e, "discord:200"); err != nil {
		t.Fatal(err)
	}
	if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
		t.Fatal("201 not released")
	}
	waitFor(t, "shelve attempted", func() bool { return len(g.shelveCalls()) == 1 })
	if got := g.parentOf("201"); got != "catB" {
		t.Fatalf("201 category = %q, want catB (left where it was)", got)
	}
	pool, err := e.TeamWorkspacePool("discord:200")
	if err != nil || len(pool) < 2 || pool[0].ID != "201" || pool[0].Owner != "" {
		t.Fatalf("pool after a failed shelve = %+v %v", pool, err)
	}
}
