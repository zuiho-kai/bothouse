package core

import (
	"bytes"
	"encoding/json"
	"errors"
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

func TestTaskTextResolveAPIUsesWireFieldNames(t *testing.T) {
	p, platform, req := newTextJournal(t)
	queueText(t, p, req)
	platform.send = func(string, string) (string, error) { return "", errors.New("lost ack") }
	p.FlushTaskText(t.Context())
	s := &APIServer{engines: map[string]*Engine{"owner": {publicProgress: p, ctx: t.Context()}}}
	body, _ := json.Marshal(map[string]string{"project": "owner", "task_id": req.TaskID, "delivery_id": req.DeliveryID, "action": "sent", "evidence": "message-confirmed"})
	w := httptest.NewRecorder()
	s.handleTaskText(w, httptest.NewRequest(http.MethodPost, "/task-text", bytes.NewReader(body)))
	if w.Code != http.StatusOK || textState(t, p, req.TaskID)[0].Parts[0].State != "sent" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.handleTask(w, httptest.NewRequest(http.MethodGet, "/task?project=owner&id="+req.TaskID, nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "text_deliveries") || strings.Contains(w.Body.String(), "secret one") {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestTaskTextOldQuestionNotResurrected(t *testing.T) {
	for _, state := range []TaskState{TaskStateWaitingUser, TaskStateFailed} {
		t.Run(string(state), func(t *testing.T) {
			p, platform, req := newTextJournal(t)
			r, _ := p.taskTextRun(req.TaskID)
			r.record.Task.State = TaskStateWaitingUser
			req.Kind = "question"
			queueText(t, p, req)
			r.record.Task.Seq++
			r.record.Task.State = state
			p.FlushTaskText(t.Context())
			if len(platform.calls) != 0 || textState(t, p, req.TaskID)[0].State != "cancelled" {
				t.Fatal("obsolete question sent")
			}
		})
	}
}

func TestTaskTextSentCannotBeRecalledAndOwnershipChecked(t *testing.T) {
	p, _, req := newTextJournal(t)
	queueText(t, p, req)
	p.FlushTaskText(t.Context())
	if err := p.ResolveTaskText(req.TaskID, req.DeliveryID, "cancel", "requested"); err == nil {
		t.Fatal("claimed sent message cancelled")
	}
	r, _ := p.taskTextRun(req.TaskID)
	r.record.Task.AssignedProject = "other"
	req.DeliveryID = "new"
	if _, err := p.QueueTaskText(req); err == nil {
		t.Fatal("old owner admitted work")
	}
}

func TestTaskTextStoppedBeforeFlush(t *testing.T) {
	for _, stop := range []func(*publicRun){func(r *publicRun) { r.record.Accepted = true }, func(r *publicRun) { r.record.Task.State = TaskStateCompleted }, func(r *publicRun) { r.record.Task.AssignedProject = "other" }} {
		p, platform, req := newTextJournal(t)
		queueText(t, p, req)
		r, _ := p.taskTextRun(req.TaskID)
		stop(r)
		p.FlushTaskText(t.Context())
		if len(platform.calls) != 0 || textState(t, p, req.TaskID)[0].State != "cancelled" {
			t.Fatal("stopped task sent pending text")
		}
	}
}
