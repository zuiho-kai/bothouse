package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// #699 D: board.py's done / reject / wait move the task's state through the bridge; a task the
// bridge never saw is left alone (known=false), a pause of a task still in its workspace is the
// park's (409).
func TestTeamTaskTransitionAPI(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.ensureTeamWS()
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#5", 5); err != nil {
		t.Fatal(err)
	}
	s := &APIServer{engines: map[string]*Engine{"lead": e}}
	call := func(body string) (int, TeamTaskTransitionResult) {
		rec := httptest.NewRecorder()
		s.handleTeamTaskTransition(rec, httptest.NewRequest(http.MethodPost, "/team/task/transition", strings.NewReader(body)))
		var r TeamTaskTransitionResult
		_ = json.Unmarshal(rec.Body.Bytes(), &r)
		return rec.Code, r
	}
	if code, r := call(`{"id":99,"to":"closed"}`); code != http.StatusOK || r.Known {
		t.Fatalf("unknown task = %d %+v, want 200 known=false", code, r)
	}
	if code, _ := call(`{"id":5,"to":"paused"}`); code != http.StatusConflict {
		t.Fatalf("pause of a task in its workspace = %d, want 409 (the park pauses it)", code)
	}
	if code, r := call(`{"id":5,"to":"closed","why":"done"}`); code != http.StatusOK || r.State != string(TeamTaskClosed) {
		t.Fatalf("done = %d %+v", code, r)
	}
	if code, r := call(`{"id":5,"to":"closed"}`); code != http.StatusOK || r.State != string(TeamTaskClosed) {
		t.Fatalf("repeated done = %d %+v, want 200 unchanged", code, r)
	}
	if code, _ := call(`{"id":5,"to":"dispatched"}`); code != http.StatusBadRequest {
		t.Fatalf("dispatched through the board = %d, want 400 (a claim dispatches)", code)
	}
}
