package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestManagementActivityTracksRunningSessions(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	dsh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(dsh.Close)
	writeDSHLocalOwner(t, dsh.URL, "activity-dsh-test-token", os.Getpid())

	m := NewManagementServer(0, "activity-test-token", nil)
	engine := newTestEngine()
	engine.SetTeam("", "Review team", false)
	m.RegisterEngine("test", engine)
	idle := newTestEngine()
	m.RegisterEngine("idle", idle)
	idle.sessions.NewSession("discord:idle", "Idle project")

	key := "discord:chat"
	ordinary := engine.sessions.NewSession(key, "default")
	ordinary.AddHistory("user", "private conversation body")
	engine.sessions.UpdateUserMeta(key, "A user", "Review channel")
	side := engine.sessions.NewSideSession(key, "Scheduled review")
	engine.sessions.NewSession(key, "Saved conversation")

	engine.workspacePool = newWorkspacePool(0)
	ws := engine.workspacePool.GetOrCreate(t.TempDir())
	ws.sessions = NewSessionManager("")
	workspace := ws.sessions.NewSession("discord:workspace", "Workspace review")
	if !ordinary.TryLock() || !side.TryLock() || !workspace.TryLock() {
		t.Fatal("could not start fixture turns")
	}
	_, finishRelay := engine.teamBeginRelay(key)
	t.Cleanup(func() { finishRelay(teamWorkUnconfirmed) })

	handler := m.buildHandler(http.NewServeMux())
	get := func(token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/activity", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	read := func() activitySnapshot {
		t.Helper()
		rec := get("activity-test-token")
		if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("activity response: %d, %v", rec.Code, rec.Header())
		}
		if body := rec.Body.String(); strings.Contains(body, "private conversation body") ||
			strings.Contains(body, "activity-dsh-test-token") {
			t.Fatal("activity included conversation history or the DSH credential")
		}
		var envelope struct{ Data activitySnapshot }
		if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Data.DSH.Status != "error" || len(envelope.Data.DSHChannels) != 0 {
			t.Fatalf("failed DSH read: status = %+v, channels = %+v", envelope.Data.DSH, envelope.Data.DSHChannels)
		}
		return envelope.Data
	}

	if status := get("").Code; status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated activity status = %d", status)
	}
	out := read()
	if len(out.Projects) != 1 || out.Projects[0].DisplayName != "Review team" {
		t.Fatalf("projects = %+v", out.Projects)
	}
	sessions := out.Projects[0].Sessions
	if len(sessions) != 4 || !sessions[0].Relay || sessions[1].Name != "Review channel" || sessions[1].SessionID != ordinary.ID ||
		sessions[2].SessionID != side.ID || sessions[3].Name != "Workspace review" || sessions[3].SessionID != "" {
		t.Fatalf("sessions = %+v", sessions)
	}

	ordinary.Unlock()
	side.Unlock()
	workspace.Unlock()
	finishRelay(teamWorkCompleted)
	if out := read(); len(out.Projects) != 0 {
		t.Fatalf("completed work remained in tracker: %+v", out.Projects)
	}

	teamKey, finishStandalone := idle.teamBeginRelay(key)
	t.Cleanup(func() { finishStandalone(teamWorkUnconfirmed) })
	if teamKey != "" {
		t.Fatalf("relay registered a team event without team mode: %q", teamKey)
	}
	out = read()
	if len(out.Projects) != 1 || out.Projects[0].Name != "idle" || len(out.Projects[0].Sessions) != 1 ||
		!out.Projects[0].Sessions[0].Relay {
		t.Fatalf("relay without team mode missing from activity: %+v", out.Projects)
	}
	finishStandalone(teamWorkCompleted)
	if out := read(); len(out.Projects) != 0 {
		t.Fatalf("finished relay without team mode remained in activity: %+v", out.Projects)
	}
}

func TestDSHActivityUsesRunningMembersByRoom(t *testing.T) {
	st := dshStateFromJSON(t, `{
		"rooms": [{"id":1,"name":"general"},{"id":2,"name":"review"},{"id":3,"name":"idle"}],
		"members": [
			{"id":"native","name":"Reviewer","kind":"dsh","online":true},
			{"id":"local","name":"Local bridge","kind":"bot","online":true},
			{"id":"remote","name":"Remote bridge","kind":"bot","online":true},
			{"id":"offline","name":"Offline","kind":"dsh","online":false}
		],
		"thinking": {"1":["native","local"],"2":["native","remote"],"3":["offline"],"4":["native"]}
	}`)
	rows := dshWorkingChannels(&st, map[string]*Engine{"local": {}})
	if len(rows) != 2 || rows[0].Name != "general" || rows[1].Name != "review" ||
		strings.Join(rows[0].Members, ",") != "Reviewer" || strings.Join(rows[1].Members, ",") != "Remote bridge,Reviewer" {
		t.Fatalf("active DSH channels = %+v", rows)
	}
}
