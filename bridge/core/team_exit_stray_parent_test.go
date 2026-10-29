package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// The same state repaired once: an ownership key no handoff ever came from is dropped, so the
// forward cannot be routed by it before WorkspaceLastChat is even asked.
func TestMigrateStrayParentDropped(t *testing.T) {
	st := &teamWorkspaceState{
		Version: 2,
		Parents: map[string][]TeamWorkspace{
			"discord:stray-chat": {{Name: "工作区1", ID: "ws1"}, {Name: "工作区14", ID: "ws14"}},
			"discord:chat1":      {{Name: "工作区2", ID: "ws2"}},
		},
		Handoffs: map[string][]TeamHandoff{
			"discord:ws1":  {{Chat: "discord:chat1", At: time.Now()}},
			"discord:ws14": {{Chat: "discord:chat1", At: time.Now()}},
			"discord:ws2":  {{Chat: "discord:chat1", At: time.Now()}},
		},
	}
	if !teamWorkspaceMigrateOwners(st) {
		t.Fatal("migration reported no change")
	}
	if _, kept := st.Parents["discord:stray-chat"]; kept {
		t.Fatalf("stray ownership kept: %+v", st.Parents)
	}
	if len(st.Parents["discord:chat1"]) != 1 {
		t.Fatalf("a real ownership record was dropped: %+v", st.Parents)
	}
	if st.Version != teamWorkspaceStateVersion {
		t.Fatalf("version = %d", st.Version)
	}
}

// An empty handoff chat (left behind when a dirty record was cleared) must not cut the fallback
// to an earlier real handoff: the late [report] of a parked workspace still belongs to that chat.
func TestWorkspaceLastChatSkipsEmpty(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	st := &teamWorkspaceState{
		Version: teamWorkspaceStateVersion,
		Handoffs: map[string][]TeamHandoff{"discord:ws1": {
			{Chat: "discord:chat1", At: time.Now().Add(-2 * time.Hour)},
			{Chat: "", At: time.Now().Add(-time.Hour)},
		}},
	}
	writeTeamWorkspaces(t, e.dataDir, st)

	got, ok := e.WorkspaceLastChat("ws1")
	if !ok || got != "chat1" {
		t.Fatalf("WorkspaceLastChat = %q, %v", got, ok)
	}
}

// Nothing recorded at all: the answer stays in the workspace, and a warning says so. Before this
// the miss was completely silent, so a lost report could not be found in the log afterwards.
func TestForwardReportWithoutChatLogs(t *testing.T) {
	logs := captureLogs(t)
	e, _, p := exitFixture(t, nil)
	writeTeamWorkspaces(t, e.dataDir, &teamWorkspaceState{Version: teamWorkspaceStateVersion})

	if out := e.forwardWorkspaceExit(p, exitWSKey, "[report]\n没有归属"); out != "" {
		t.Fatalf("forward returned %q", out)
	}
	if !strings.Contains(logs.String(), "team exit: no chat channel for this workspace") {
		t.Fatalf("no warning logged: %s", logs.String())
	}
	if got := p.sentTo(exitWSKey); len(got) != 0 {
		t.Fatalf("the report was forwarded somewhere: %q", got)
	}
}

// A successful forward is logged, so the next investigation does not need the Discord API.
func TestForwardReportLogsSuccess(t *testing.T) {
	logs := captureLogs(t)
	e, _, p := exitFixture(t, nil)
	writeTeamWorkspaces(t, e.dataDir, &teamWorkspaceState{
		Version: teamWorkspaceStateVersion,
		Parents: map[string][]TeamWorkspace{"discord:chat1": {{Name: "工作区1", ID: "ws1"}}},
		Handoffs: map[string][]TeamHandoff{"discord:ws1": {
			{Chat: "discord:chat1", At: time.Now()},
		}},
	})

	exitBoardItem(t, e, 7, "活")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 好了")
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("chat1 got %q", got)
	}
	if !strings.Contains(logs.String(), "team exit: report posted") {
		t.Fatalf("no success line: %s", logs.String())
	}
}

// A marker that does not start the reply is not forwarded; the log says why, instead of dropping
// it silently.
func TestForwardReportMarkerNotFirstLineLogs(t *testing.T) {
	logs := captureLogs(t)
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	if out := e.forwardWorkspaceExit(p, exitWSKey, "先说一句\n[report]\n好了"); out != "" {
		t.Fatalf("forward returned %q", out)
	}
	if !strings.Contains(logs.String(), "marker is not on the first line") {
		t.Fatalf("no warning: %s", logs.String())
	}
}

func writeTeamWorkspaces(t *testing.T, dataDir string, st *teamWorkspaceState) {
	t.Helper()
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	teamWorkspaceStore.cache = nil
	teamWorkspaceStore.mu.Unlock()
	if err := os.WriteFile(filepath.Join(dataDir, teamWorkspaceFile), b, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		teamWorkspaceStore.mu.Lock()
		teamWorkspaceStore.cache = nil
		teamWorkspaceStore.mu.Unlock()
	})
}

var logCaptureMu sync.Mutex

// captureLogs routes slog output into a buffer for the duration of one test.
func captureLogs(t *testing.T) *strings.Builder {
	t.Helper()
	buf := &strings.Builder{}
	logCaptureMu.Lock()
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(prev)
		logCaptureMu.Unlock()
	})
	return buf
}

var _ = context.Background
