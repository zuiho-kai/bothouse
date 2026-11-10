package core

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// shelvingGuild is a guild whose platform keeps all workspaces in one category of its own
// (Discord 「工作区」, TeamWorkspaceShelver). It is a Platform of its own (the wrapper, not the
// embedded fake), so core's type assertion sees the interface.
type shelvingGuild struct {
	*fakeWorkspaceGuild
	shelfID   string
	shelves   []string // workspace IDs asked to move, in order
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

func (g *shelvingGuild) ShelveTeamWorkspaceChannel(_ context.Context, id string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.shelves = append(g.shelves, id)
	if g.shelveErr != nil {
		return g.shelveErr
	}
	for i, c := range g.channels {
		if c.ID == id {
			g.channels[i].ParentID, g.channels[i].Shelved = g.shelfID, true
		}
	}
	return nil
}

func (g *shelvingGuild) shelveCalls() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.shelves...)
}

func (g *shelvingGuild) parentOf(id string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.parentOfLocked(id)
}

// newShelvingGuild is newWorkspaceGuild with the workspace category 「工作区」 (catShelf), empty.
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

// All workspaces sit in the one 「工作区」 category, free or in use (user 2026-11-10: 「他不应该
// 专门划分空闲跟繁忙直接就工作区类别」): the first operation moves the ones still beside the chat
// channels there, and they stay pool workspaces: free, listed, lowest-numbered first.
func TestTeamWorkspacesGatheredIntoOneCategory(t *testing.T) {
	g := newShelvingGuild()
	e := newShelvingLead(t, g, t.TempDir())
	if err := ensureWorkspace1(e, "discord:200"); err != nil { // adopts 工作区1 (201)
		t.Fatal(err)
	}
	if got := g.shelveCalls(); len(got) != 2 || got[0] != "201" || got[1] != "205" {
		t.Fatalf("moved = %v, want 201 and 205", got)
	}
	for _, id := range []string{"201", "205"} {
		if got := g.parentOf(id); got != "catShelf" {
			t.Fatalf("%s category = %q, want catShelf", id, got)
		}
	}
	if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
		t.Fatal("201 not released")
	}
	waitFor(t, "release asked once more", func() bool { return len(g.shelveCalls()) == 3 })
	if got := g.parentOf("201"); got != "catShelf" {
		t.Fatalf("201 category after release = %q, want catShelf", got)
	}
	pool, err := e.TeamWorkspacePool("discord:200")
	if err != nil {
		t.Fatal(err)
	}
	if len(pool) < 2 || pool[0].ID != "201" || pool[0].Owner != "" {
		t.Fatalf("pool = %+v, want 工作区1 free and first", pool)
	}
	if got := g.shelveCalls(); len(got) != 3 {
		t.Fatalf("listing the pool moved again: %v", got)
	}
}

// A claim leaves the workspace in the category (nothing is moved back beside the chat channel),
// and numbering counts the workspaces there: the next one is 工作区6, not 工作区5 again.
func TestTeamWorkspaceClaimStaysInCategory(t *testing.T) {
	g := newShelvingGuild()
	g.channels = append(g.channels, TeamChannel{ID: "300", Name: "闲聊", ParentID: "catB"})
	g.channels[3] = TeamChannel{ID: "205", Name: "工作区5", ParentID: "catShelf", Shelved: true}
	e := newShelvingLead(t, g, t.TempDir())
	e.sessions.GetOrCreateActive("discord:300")

	if _, w, err := e.NewTeamWorkspace("discord:300"); err != nil || w.ID != "201" {
		t.Fatalf("adopt = %+v %v, want 201", w, err)
	}
	if err := e.ClaimTeamWorkspace("discord:300", "205", "工作区5"); err != nil {
		t.Fatal(err)
	}
	if got := g.parentOf("205"); got != "catShelf" {
		t.Fatalf("205 category = %q, want catShelf (stays in 工作区)", got)
	}
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
	// Gathering tried 201 and 205 once; the release tries 201 again; the pool listing skips both.
	waitFor(t, "shelve attempted", func() bool { return len(g.shelveCalls()) == 3 })
	if got := g.parentOf("201"); got != "catB" {
		t.Fatalf("201 category = %q, want catB (left where it was)", got)
	}
	pool, err := e.TeamWorkspacePool("discord:200")
	if err != nil || len(pool) < 2 || pool[0].ID != "201" || pool[0].Owner != "" {
		t.Fatalf("pool after a failed shelve = %+v %v", pool, err)
	}
	if got := g.shelveCalls(); len(got) != 3 {
		t.Fatalf("a failed move was retried in the same run: %v", got)
	}
}
