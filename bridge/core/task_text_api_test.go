package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskTextAPIAcceptanceIsNotDelivery(t *testing.T) {
	p, platform, req := newTextJournal(t)
	e := &Engine{publicProgress: p}
	s := &APIServer{engines: map[string]*Engine{"owner": e}}
	body, _ := json.Marshal(SendRequest{Project: "owner", SessionKey: req.SessionKey, Message: req.Text, TaskText: &req})
	w := httptest.NewRecorder()
	s.handleSend(w, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body)))
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), "pending") || len(platform.calls) != 0 {
		t.Fatal(w.Code, w.Body.String())
	}
	task, _ := p.Task(req.TaskID)
	encoded, _ := json.Marshal(task)
	if len(task.TextDeliveries) != 1 || strings.Contains(string(encoded), "secret") {
		t.Fatal("task query does not isolate body", string(encoded))
	}
	for _, mutate := range []func(*SendRequest){func(r *SendRequest) { r.DM = true }, func(r *SendRequest) { r.TTSText = "voice"; r.Message = "" }, func(r *SendRequest) { r.WorkDir = "/tmp" }} {
		r := SendRequest{Project: "owner", SessionKey: req.SessionKey, Message: req.Text, TaskText: &req}
		mutate(&r)
		body, _ = json.Marshal(r)
		w = httptest.NewRecorder()
		s.handleSend(w, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body)))
		if w.Code != http.StatusBadRequest {
			t.Fatal("mixed send accepted", w.Code)
		}
	}
}

func TestTaskTextQuestionSurvivesRestartButAnswerCancels(t *testing.T) {
	p, platform, req := newTextJournal(t)
	r, _ := p.taskTextRun(req.TaskID)
	r.record.Task.State = TaskStateWaitingUser
	req.Kind = "question"
	queueText(t, p, req)
	restarted, err := NewPublicProgress(p.dataDir, "owner", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restarted.FlushTaskText(t.Context())
	if textState(t, restarted, req.TaskID)[0].State != "sent" {
		t.Fatal("unanswered question dropped on restart")
	}
}

func TestTaskTextCancelInFlightKeepsPossibleSideEffect(t *testing.T) {
	p, platform, req := newTextJournal(t)
	queueText(t, p, req)
	platform.send = func(_, body string) (string, error) {
		if err := p.ResolveTaskText(req.TaskID, req.DeliveryID, "cancel", "operator cancelled"); err != nil {
			t.Fatal(err)
		}
		return "accepted-first", nil
	}
	p.FlushTaskText(t.Context())
	d := textState(t, p, req.TaskID)[0]
	if d.Parts[0].State != "sent" || d.Parts[1].State != "cancelled" || len(platform.calls) != 1 {
		t.Fatalf("cancel erased side effect: %+v", d)
	}
}
