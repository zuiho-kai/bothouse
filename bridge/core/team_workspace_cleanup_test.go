package core

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// deletingGuild is a fake Discord guild that deletes workspace channels and hands out their
// history (#1788).
type deletingGuild struct {
	*fakeWorkspaceGuild
	msgs map[string][]TeamArchivedMessage
}

func (g *deletingGuild) DeleteTeamWorkspaceChannel(_ context.Context, id string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	for i, c := range g.channels {
		if c.ID == id {
			g.channels = append(g.channels[:i], g.channels[i+1:]...)
			return nil
		}
	}
	return nil
}

func (g *deletingGuild) TeamChannelMessages(_ context.Context, id string) ([]TeamArchivedMessage, error) {
	return g.msgs[id], nil
}

func (g *deletingGuild) TeamChannelGone(_ context.Context, id string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range g.channels {
		if c.ID == id {
			return false, nil
		}
	}
	return true, nil
}

// User 11-19「以后自动删空闲工作区，但是记录可以搞个日志系统压缩存起来」「工作区空闲问题还没解决」: the
// hourly sweep archives and deletes every quiet idle workspace, never touches one with a task in
// work or a recent pause, lets a pause quiet for a day go (#1793), lets an unbound paused task hold
// only the workspace it was last handed to, and drops the record of a channel deleted by hand.
func TestSweepIdleTeamWorkspacesArchivesThenDeletes(t *testing.T) {
	g := &deletingGuild{fakeWorkspaceGuild: newWorkspaceGuild()}
	g.channels = append(g.channels,
		TeamChannel{ID: "206", Name: "工作区6", ParentID: "catB"},
		TeamChannel{ID: "207", Name: "工作区7", ParentID: "catB"},
		TeamChannel{ID: "208", Name: "工作区8", ParentID: "catB"},
		TeamChannel{ID: "209", Name: "工作区9", ParentID: "catB"},
		TeamChannel{ID: "210", Name: "工作区10", ParentID: "catB"},
		TeamChannel{ID: "211", Name: "工作区11", ParentID: "catB"})
	handoffFile := filepath.Join(t.TempDir(), "handoffs", "handoff-x.md")
	if err := os.MkdirAll(filepath.Dir(handoffFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(handoffFile, []byte("交接全文 x"), 0o600); err != nil {
		t.Fatal(err)
	}
	g.msgs = map[string][]TeamArchivedMessage{"208": {{ID: "1", Author: "橘", Content: "工作区接手：交接 " + handoffFile}}}
	dataDir := t.TempDir()
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	e.SetTeamWorkspaces(true)
	e.sessions.GetOrCreateActive("discord:200")

	old := time.Now().Add(-5 * time.Hour)
	longAgo := time.Now().Add(-30 * time.Hour)
	path := teamWorkspacePath(dataDir)
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		t.Fatal(err)
	}
	// 201 has a task in work; 9999 is a 「工作区12」 whose channel was deleted by hand.
	st.Parents["discord:200"] = []TeamWorkspace{{ID: "201", Name: "工作区1"}, {ID: "9999", Name: "工作区12"}}
	st.Handoffs = map[string][]TeamHandoff{
		"discord:201": {{Chat: "discord:200", At: old}},
		"discord:205": {{Chat: "discord:200", At: old, Closed: old}},
		"discord:206": {{Chat: "discord:200", At: old, Closed: old}},
		"discord:207": {{Chat: "discord:200", At: old, Parked: old, Board: 7}},
		"discord:208": {{Chat: "discord:200", At: old, Closed: old, Name: "工作区8"}},
		"discord:209": {{Chat: "discord:200", At: longAgo, Parked: longAgo, Board: 9}},
		"discord:210": {{Chat: "discord:200", At: longAgo, Parked: longAgo, Board: 11}},
		"discord:211": {{Chat: "discord:200", At: old, Parked: old, Board: 11}},
	}
	st.Tasks = map[int]TeamTask{
		7:  {ID: 7, State: TeamTaskPaused, Chat: "discord:200", SessionWS: "discord:207", Since: old},
		9:  {ID: 9, State: TeamTaskPaused, Chat: "discord:200", SessionWS: "discord:209", Since: longAgo},
		11: {ID: 11, State: TeamTaskPaused, Chat: "discord:200", Since: old},
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Unlock()

	deleted := e.sweepIdleTeamWorkspaces(time.Now())
	sort.Strings(deleted)
	if strings.Join(deleted, ",") != "discord:205,discord:206,discord:208,discord:209,discord:210" {
		t.Fatalf("deleted = %v, want 205 206 208 (idle), 209 (paused 30h ago), 210 (#11 last handed to 211); 201 working, 207 and 211 paused", deleted)
	}
	if gone, _ := g.TeamChannelGone(context.Background(), "208"); !gone {
		t.Fatal("channel 208 not deleted")
	}
	for _, id := range []string{"201", "207", "211"} {
		if gone, _ := g.TeamChannelGone(context.Background(), id); gone {
			t.Fatalf("channel %s deleted", id)
		}
	}
	teamWorkspaceStore.mu.Lock()
	st, _ = loadTeamWorkspacesLocked(path)
	_, has208 := st.Handoffs["discord:208"]
	parents := st.Parents["discord:200"]
	teamWorkspaceStore.mu.Unlock()
	if has208 {
		t.Fatal("handoffs of the deleted workspace kept")
	}
	if len(parents) != 1 || parents[0].ID != "201" {
		t.Fatalf("parents = %+v, want only 201 (record of deleted channel 9999 dropped)", parents)
	}

	archives, _ := filepath.Glob(filepath.Join(dataDir, teamWorkspaceArchiveDir, "discord-208-工作区8-*.tar.gz"))
	if len(archives) != 1 {
		t.Fatalf("archives = %v", archives)
	}
	files := map[string]string{}
	f, err := os.Open(archives[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		files[h.Name] = string(b)
	}
	if !strings.Contains(files["messages.jsonl"], "工作区接手") {
		t.Fatalf("messages.jsonl = %q", files["messages.jsonl"])
	}
	if files["handoffs/handoff-x.md"] != "交接全文 x" {
		t.Fatalf("archive files = %v", keysOf(files))
	}
	if !strings.Contains(files["records.json"], "discord:208") {
		t.Fatalf("records.json = %q", files["records.json"])
	}
}

func keysOf(m map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
