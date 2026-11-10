package discord

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// Introduce the foreign category only after this bridge has created its own.
// Foreign channels outnumber the active pool, so filtering only Shelved would
// still let them win teamWorkspacePoolHome's category vote.
type ownershipREST struct {
	*shelfREST
	foreign      bool
	foreignMoves []string
}

func (r *ownershipREST) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method == http.MethodGet && strings.Contains(req.URL.Path, "outsider") {
		id := strings.TrimPrefix(req.URL.Path, "/api/v9/channels/")
		body, _ := json.Marshal(map[string]any{"id": id, "name": "工作区1", "type": 0, "guild_id": "g1", "parent_id": "foreign"})
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(strings.NewReader(string(body))), Request: req}, nil
	}
	if r.foreign && req.Method == http.MethodGet && req.URL.Path == "/api/v9/guilds/g1/channels" {
		channels := []map[string]any{
			{"id": "foreign", "name": workspaceCategoryName, "type": 4},
			{"id": "catS", "name": workspaceCategoryName, "type": 4},
			{"id": "catA", "name": "活动", "type": 4},
			{"id": "100", "name": "主频道", "type": 0, "parent_id": "catA"},
			{"id": "101", "name": "工作区5", "type": 0, "parent_id": r.workspace},
			{"id": "outsider1", "name": "工作区1", "type": 0, "parent_id": "foreign"},
			{"id": "outsider2", "name": "工作区2", "type": 0, "parent_id": "foreign"},
			{"id": "outsider3", "name": "工作区3", "type": 0, "parent_id": "catS"},
		}
		body, _ := json.Marshal(channels)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(strings.NewReader(string(body))), Request: req}, nil
	}
	if req.Method == http.MethodPatch && strings.Contains(req.URL.Path, "outsider") {
		r.foreignMoves = append(r.foreignMoves, req.URL.Path)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(strings.NewReader("{}")), Request: req}, nil
	}
	return r.shelfREST.RoundTrip(req)
}

func TestIdleCategoryOwnershipSurvivesReload(t *testing.T) {
	p, r := ownedShelfPlatform(t)
	dir := t.TempDir()
	p.workspaceShelves = workspaceShelfStoreFor(dir)
	// Re-register through the actual shelving path and the persistent store.
	r.foreign = false
	if err := p.ShelveTeamWorkspaceChannel(context.Background(), "101"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "discord_workspace_shelves.json")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("ownership file permissions: %v, %v", info, err)
	}
	workspaceShelfStores.Lock()
	delete(workspaceShelfStores.byPath, path) // simulate a fresh process, retain the file
	workspaceShelfStores.Unlock()
	p2 := shelfPlatform(t, r.shelfREST)
	p2.session.Client.Transport = r
	configured, err := New(map[string]any{"token": "test", "cc_data_dir": dir, "progress_style": "legacy"})
	if err != nil {
		t.Fatal(err)
	}
	p2.workspaceShelves = configured.(*Platform).workspaceShelves
	r.foreign = true
	_, all, err := p2.TeamGuildChannels(context.Background(), "100")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || all[1].ID != "101" || !all[1].Shelved {
		t.Fatalf("reloaded listing = %+v, want only chat and owned shelved workspace", all)
	}
	r.workspace = "catA"
	if err := p2.ShelveTeamWorkspaceChannel(context.Background(), "101"); err != nil || r.workspace != "catS" {
		t.Fatalf("reloaded destination = %q, %v; want catS", r.workspace, err)
	}
}

func TestShelveOwnershipSaveFailureLeavesWorkspaceActive(t *testing.T) {
	r := &shelfREST{workspace: "catA", hasShelf: true}
	p := shelfPlatform(t, r)
	p.workspaceShelves = &workspaceShelfStore{path: filepath.Join(t.TempDir(), "missing", "ownership.json")}
	err := p.ShelveTeamWorkspaceChannel(context.Background(), "101")
	if err == nil || !strings.Contains(err.Error(), "save workspace shelf ownership") {
		t.Fatalf("shelve = %v, want persistence error", err)
	}
	if len(r.patched) != 0 || r.workspace != "catA" {
		t.Fatalf("save failure moved the channel: %+v", r)
	}
	g, err := p.workspaceShelves.guild("g1")
	if err != nil || g.Channels["101"] {
		t.Fatalf("failed save became in-memory ownership evidence: %+v, %v", g, err)
	}
}

func TestIdleCategoryUnreadableOwnershipKeepsActivePoolUsable(t *testing.T) {
	p, r := ownedShelfPlatform(t)
	r.workspace = "catA"
	path := filepath.Join(t.TempDir(), "discord_workspace_shelves.json")
	if err := os.WriteFile(path, []byte("broken json"), 0o600); err != nil {
		t.Fatal(err)
	}
	p.workspaceShelves = workspaceShelfStoreFor(filepath.Dir(path))
	_, all, err := p.TeamGuildChannels(context.Background(), "100")
	if err != nil || len(all) != 2 || all[1].ID != "101" || all[1].Shelved {
		t.Fatalf("active listing with unreadable ownership = %+v, %v", all, err)
	}
	before := len(r.patched)
	err = p.ShelveTeamWorkspaceChannel(context.Background(), "101")
	var syntax *json.SyntaxError
	if !errors.As(err, &syntax) || len(r.patched) != before {
		t.Fatalf("unreadable ownership must prevent further moves: %v, %+v", err, r.patched)
	}
}

func ownedShelfPlatform(t *testing.T) (*Platform, *ownershipREST) {
	t.Helper()
	r := &ownershipREST{shelfREST: &shelfREST{workspace: "catA"}}
	p := shelfPlatform(t, r.shelfREST)
	p.session.Client.Transport = r
	if err := p.ShelveTeamWorkspaceChannel(context.Background(), "101"); err != nil {
		t.Fatal(err)
	}
	r.foreign = true
	return p, r
}

func TestIdleCategoryDuplicateNamesRecognizeOnlyOwnWorkspaces(t *testing.T) {
	p, r := ownedShelfPlatform(t)
	_, all, err := p.TeamGuildChannels(context.Background(), "100")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range all {
		if strings.HasPrefix(c.ID, "outsider") {
			t.Errorf("foreign channel entered pool listing: %+v", c)
		}
		if c.ID == "101" {
			found = c.Shelved
		}
	}
	if !found {
		t.Error("own workspace not recognized in second same-named category")
	}
	// A changed API ordering must not change the destination of the next release.
	r.workspace = "catA"
	if err := p.ShelveTeamWorkspaceChannel(context.Background(), "101"); err != nil {
		t.Fatal(err)
	}
	if r.workspace != "catS" {
		t.Errorf("shelved into %q, want remembered catS", r.workspace)
	}
}

func TestTeamWorkspaceForeignIdleChannelsNeverAdoptedOrMoved(t *testing.T) {
	p, r := ownedShelfPlatform(t)
	e := core.NewEngine("lead", noAgent{}, []core.Platform{p}, "", core.LangEnglish)
	defer e.Stop()
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	e.SetTeamWorkspaces(true)
	e.GetSessions().GetOrCreateActive("discord:100")
	_, w, err := e.NewTeamWorkspace("discord:100")
	if err != nil || w.ID != "101" {
		t.Errorf("adoption = %+v, %v; want own 101", w, err)
	}
	if len(r.foreignMoves) != 0 {
		t.Errorf("foreign channels received PATCH: %v", r.foreignMoves)
	}
	if r.workspace != "catS" {
		t.Errorf("own workspace left the 「工作区」 category on adoption: %q", r.workspace)
	}
	pool, err := e.TeamWorkspacePool("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range pool {
		if strings.HasPrefix(w.ID, "outsider") {
			t.Errorf("foreign workspace in shared pool: %+v", w)
		}
	}
}
