package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// #699 batch C: a workspace hands its task back, or reports it failed, only through this explicit
// command (ws-up --report → `bothouse workspace exit` → POST /team/workspace/exit). The bridge no
// longer reads a marker out of a turn's reply — not the first-line [report] either (design §7.2):
// reading the reply text was where handbacks were lost (10-28 on: 93 「marker is not on the first
// line」 on this machine, six fixes of the same symptom). The reply stays what the people in the
// workspace read; the command's text is what goes to the chat channel.
//
// Asking the user stays ws-up --ask (its own command, unchanged).

const exitKindFailed = "failed"

// ErrWorkspaceExitNoTask: the session is not a workspace with a task in work.
var ErrWorkspaceExitNoTask = errors.New("no task in work in this workspace")

// WorkspaceExitResult is the reply of POST /team/workspace/exit.
type WorkspaceExitResult struct {
	Workspace string `json:"workspace"`
	Board     int    `json:"board,omitempty"`
	State     string `json:"state,omitempty"` // the task's state after the command
	Posted    string `json:"posted,omitempty"`
}

// WorkspaceExit hands back the task of workspace sessionKey: kind report (done, for acceptance) or
// failed (handed back as failed; forwarded like a report). text is the report as the skeleton has
// it, its first line 「[report] #id 背景：…」 (the marker may be left out). The task's state moves to
// returned/failed; the report itself goes through the same checks and the lead's acceptance as
// before (forwardWorkspaceExitKind).
func (e *Engine) WorkspaceExit(ctx context.Context, sessionKey, kind, text string) (WorkspaceExitResult, error) {
	res := WorkspaceExitResult{Workspace: teamChatKey(sessionKey)}
	if e == nil || e.dataDir == "" {
		return res, errors.New("workspace exit: no data dir")
	}
	to := TeamTaskReturned
	switch kind {
	case exitKindReport:
	case exitKindFailed:
		to = TeamTaskFailed
	default:
		return res, fmt.Errorf("workspace exit: kind %q (want report or failed)", kind)
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return res, errors.New("workspace exit: empty report")
	}
	body := text
	if k, b, ok := parseExitKind(text); ok && k == exitKindReport {
		body = b // the command names the kind; a leading marker is only the skeleton's
	}
	plat, _, _ := strings.Cut(res.Workspace, ":")
	p := e.lookupReadyPlatform(plat)
	if p == nil {
		p = e.platformForName(plat)
	}
	if p == nil {
		return res, fmt.Errorf("workspace exit: platform %q not connected", plat)
	}
	_, okKey := e.workspaceParent(res.Workspace)
	_, okID := e.workspaceParent(sessionChannel(sessionKey))
	if !okKey && !okID {
		return res, fmt.Errorf("workspace exit: %s: %w", res.Workspace, ErrWorkspaceExitNoTask)
	}

	// The state first: once the command ran, the task is handed back whatever the chat post does
	// (a refused or failed post is logged and the lead's acceptance still finds it returned).
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err == nil {
		for id, t := range st.Tasks {
			if teamTaskInWork(t.State) && t.WS == res.Workspace && (res.Board == 0 || t.Since.After(st.Tasks[res.Board].Since)) {
				res.Board = id
			}
		}
		if res.Board > 0 {
			var t TeamTask
			t, err = transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: res.Board, To: to, By: "exit command"}, time.Now())
			res.State = string(t.State)
		}
	}
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		return res, fmt.Errorf("workspace exit: %w", err)
	}
	if res.Board == 0 {
		// Handed back already: a second command for the same task is the duplicate the state
		// refuses (the text dedup of team_exit_headline.go stays only for tasks without a record).
		switch st := e.workspaceTaskStateAt(res.Workspace); st {
		case TeamTaskReturned, TeamTaskFailed, TeamTaskClosed:
			return res, fmt.Errorf("workspace exit: the task here is already %s: %w", st, ErrTeamTaskTransition)
		}
	}
	// A proactive task's turn keeps its scopes: the command it runs posts only what the turn may
	// (message.send), as the turn's own reply did before (PR808 review).
	if ref := e.workspaceTurnAuthorization(sessionKey); ref != nil {
		tctx, terr := e.turnOutputContext(ref)
		if terr != nil {
			return res, fmt.Errorf("workspace exit: %w", terr)
		}
		ctx = tctx
	}
	if err := checkProactiveExecution(ctx, "message.send"); err != nil {
		slog.Warn("team exit: task authorization refused the send; nothing forwarded", "session", sessionKey, "error", err)
		return res, nil
	}
	out := &exitOutcome{}
	res.Posted = e.forwardWorkspaceExitKind(context.WithValue(ctx, exitOutcomeKey{}, out), p, sessionKey, exitKindReport, body)
	if res.Board > 0 && (out.bounced || out.dropped != "") {
		// #1492 常识：没交到的不算交回。A report sent back for a repair turn, or one that found no
		// chat to go to, did not hand the task back: the task stays in this workspace, so the
		// repaired report is accepted (it got 409 「already returned」) and the turn's end does not
		// free the workspace under the repair turn.
		why := "report bounced for repair"
		if out.dropped != "" {
			why = "report not delivered: " + out.dropped
		}
		teamWorkspaceStore.mu.Lock()
		t, terr := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: res.Board, To: TeamTaskDispatched, WS: res.Workspace, By: "exit command", Why: why}, time.Now())
		teamWorkspaceStore.mu.Unlock()
		if terr != nil {
			slog.Warn("team exit: could not put the task back in work", "board", res.Board, "error", terr)
		} else {
			res.State = string(t.State)
		}
		if out.dropped != "" {
			return res, fmt.Errorf("workspace exit: %s", out.dropped)
		}
	}
	if res.Board > 0 && !out.bounced && out.dropped == "" {
		// The handback is done: the turn's end must not ask for the report again, and the reset
		// ws-up queued may run (#1500: 11-12 工作区6 was nagged 13–30 s after each command).
		e.markWorkspaceReportDelivered(sessionKey)
	}
	slog.Info("team exit: handed back by command", "workspace", res.Workspace, "board", res.Board, "kind", kind, "state", res.State)
	return res, nil
}

// exitOutcome tells WorkspaceExit what forwardWorkspaceExitKind did with the report besides
// posting or holding it: sent back for a repair turn, or dropped with nowhere to go.
type exitOutcome struct {
	bounced bool
	dropped string
}

type exitOutcomeKey struct{}

func noteExitOutcome(ctx context.Context, f func(*exitOutcome)) {
	if o, ok := ctx.Value(exitOutcomeKey{}).(*exitOutcome); ok && o != nil {
		f(o)
	}
}

// handleTeamWorkspaceExit: POST /team/workspace/exit {session_key, project, kind, text}.
func (s *APIServer) handleTeamWorkspaceExit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		SessionKey string `json:"session_key"`
		Project    string `json:"project"`
		Kind       string `json:"kind"`
		Text       string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.SessionKey == "" {
		http.Error(w, "session_key is required (the workspace channel)", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	e := s.engines[req.Project]
	s.mu.RUnlock()
	if e == nil {
		e = s.teamWorkspaceEngine()
	}
	if e == nil {
		http.Error(w, "no engine for project "+req.Project, http.StatusNotFound)
		return
	}
	res, err := e.WorkspaceExit(e.ctx, req.SessionKey, req.Kind, req.Text)
	switch {
	case errors.Is(err, ErrWorkspaceExitNoTask):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, ErrTeamTaskTransition):
		http.Error(w, err.Error(), http.StatusConflict)
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		apiJSON(w, http.StatusOK, res)
	}
}

// workspaceTurnAuthorization: the authorization of the turn running (or last run) in sessionKey's
// interactive state; nil for an ordinary turn.
func (e *Engine) workspaceTurnAuthorization(sessionKey string) *AuthorizationTurn {
	e.interactiveMu.Lock()
	state := e.interactiveStates[e.interactiveKeyForSessionKey(sessionKey)]
	e.interactiveMu.Unlock()
	if state == nil {
		return nil
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.authorization
}
