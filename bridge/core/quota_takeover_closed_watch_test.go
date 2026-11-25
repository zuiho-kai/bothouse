package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A watch that belongs to a finished board item is not work: the item left board.jsonl for
// board-done.jsonl. 2026-11-25: the lead cooled down and eight already-finished tasks were
// handed over again, each wake restarting a watch that had already been answered.
func TestQuotaTakeoverSkipsWatchOfFinishedBoardItem(t *testing.T) {
	dir := t.TempDir()
	p := newProgressPlatform()
	e := NewEngine("orange", &stubAgent{}, []Platform{p}, "", LangChinese)
	e.dataDir = dir
	e.team = &teamState{dir: filepath.Join(dir, "team"), name: "orange", seen: map[string]*teamSession{}}
	if err := os.MkdirAll(e.team.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	open := `{"id":10,"what":"还在做","status":"在做","who":"orange","ws":"discord:ws","sk":"discord:ws","chat":"discord:chat"}` + "\n"
	if err := os.WriteFile(filepath.Join(e.team.dir, "board.jsonl"), []byte(open), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	if err != nil {
		teamWorkspaceStore.mu.Unlock()
		t.Fatal(err)
	}
	st.Handoffs = map[string][]TeamHandoff{
		"discord:ws": {{Chat: "discord:chat", At: now, Owner: "orange", Title: "做完了", Board: 9}},
	}
	st.ScriptWatches = map[string][]TeamHandoff{
		"discord:ws": {{Chat: "discord:chat", At: now.Add(time.Second), Owner: "orange", Title: "做完了", Board: 9}},
	}
	err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	foundOpen := false
	for _, w := range e.quotaWorkItems() {
		if w.Title == "做完了" {
			t.Fatalf("watch of a finished board item was taken over: %+v", w)
		}
		if w.Board == 10 {
			foundOpen = true
		}
	}
	if !foundOpen {
		t.Fatal("open board item was not taken over")
	}
}
