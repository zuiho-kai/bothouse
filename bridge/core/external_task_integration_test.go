package core

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

func externalEngineFixture(t *testing.T) (*APIServer, *Engine, *inputTestAgent, *Session, ExternalTaskEvent) {
	t.Helper()
	api, e, a, p, s := inputFixture(t)
	e.dataDir = t.TempDir()
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	run := e.publicProgress.begin(p, inputTestKey, LangEnglish, nil)
	id, err := e.publicProgress.Report(PublicProgressRequest{Project: e.name, SessionKey: inputTestKey, Run: run, Seq: 1, Kind: "start", Title: "Wait for external confirmation", Summary: "Waiting"})
	if err != nil {
		t.Fatal(err)
	}
	ev := eventFixture(1)
	ev.TaskID = id
	if err := e.publicProgress.externalInputs.Bind(ExternalEventSource{SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return api, e, a, s, ev
}

func TestExternalEventsEngineDeliversOnceAndFencesACK(t *testing.T) {
	api, e, a, s, ev := externalEngineFixture(t)
	for i := 0; i < 2; i++ {
		if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
			t.Fatal(err)
		}
	}
	e.flushExternalTaskEvents()
	prompt := inputPrompt(t, a)
	if !strings.Contains(prompt, ev.TaskID) || !strings.Contains(prompt, "not permission") {
		t.Fatalf("wrong context: %s", prompt)
	}
	inputWait(t, func() bool { return e.publicProgress.externalInputs.Inputs(ev.TaskID)[0].State == "delivered" })
	receipt := e.publicProgress.externalInputs.Inputs(ev.TaskID)[0]
	post := func(assignment string) int {
		b, _ := json.Marshal(ExternalTaskEventRequest{Project: e.name, SourceInstance: ev.SourceInstance, EventID: ev.EventID, Assignment: assignment})
		w := httptest.NewRecorder()
		api.handleTaskEvents(w, httptest.NewRequest("POST", "/task/events/ack", strings.NewReader(string(b))))
		return w.Code
	}
	if code := post("old-generation"); code != 409 {
		t.Fatalf("stale ack=%d", code)
	}
	if code := post(receipt.Assignment); code != 200 {
		t.Fatalf("current ack=%d", code)
	}
	inputDone(a, "External confirmation recorded; still not deployed.")
	inputWait(t, func() bool { return !s.Busy() })
	e.flushExternalTaskEvents()
	if a.session.normal.Load() != 1 {
		t.Fatalf("duplicate Send=%d", a.session.normal.Load())
	}
	if tasks := e.publicProgress.Tasks(inputTestKey, 10); len(tasks) != 1 || tasks[0].ID != ev.TaskID {
		t.Fatalf("created task: %+v", tasks)
	}
	if r := e.publicProgress.externalInputs.Inputs(ev.TaskID)[0]; r.State != "consumed" {
		t.Fatalf("receipt=%+v", r)
	}
}

func TestExternalEventsPausedRevokedAndPolicyBlocked(t *testing.T) {
	for _, block := range []string{"paused", "revoked", "policy"} {
		t.Run(block, func(t *testing.T) {
			_, e, a, _, ev := externalEngineFixture(t)
			if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
				t.Fatal(err)
			}
			switch block {
			case "paused":
				e.SetPaused(true)
			case "revoked":
				if err := e.publicProgress.externalInputs.Bind(ExternalEventSource{SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: ev.TaskID}); err != nil {
					t.Fatal(err)
				}
			case "policy":
				e.SetExternalTaskEventCheck(func(ExternalTaskEvent, *Task) error { return errors.New("withdrawn") })
			}
			e.flushExternalTaskEvents()
			if a.normalStarts.Load() != 0 {
				t.Fatal("blocked event started executor")
			}
			if r := e.publicProgress.externalInputs.Inputs(ev.TaskID)[0]; r.State != "pending_route" {
				t.Fatalf("missing reason: %+v", r)
			}
		})
	}
}

func TestExternalEventsPollWebhookShareIdentity(t *testing.T) {
	_, e, a, _, ev := externalEngineFixture(t)
	b, _ := json.Marshal(map[string]any{"task_events": []ExternalTaskEvent{ev}})
	job := &CronJob{ID: "fixture", Exec: "printf %s " + shellQuote(string(b)), Poll: true}
	if wake, err := e.pollCronJob(job); err != nil || wake != nil {
		t.Fatalf("poll wake=%+v err=%v", wake, err)
	}
	ws := NewWebhookServer(0, "test-token", "/hook")
	ws.RegisterEngine(e.name, e)
	post := func(body string, token string) int {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/hook", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		ws.handleHook(w, r)
		return w.Code
	}
	if code := post(string(b), "wrong"); code != 401 {
		t.Fatalf("auth=%d", code)
	}
	if code := post(string(b), "test-token"); code != 200 {
		t.Fatalf("replay=%d", code)
	}
	invalid, _ := json.Marshal(map[string]any{"task_events": nil, "prompt": "bypass", "session_key": "discord:other"})
	if code := post(string(invalid), "test-token"); code != 400 {
		t.Fatalf("null bypass=%d", code)
	}
	if got := e.publicProgress.externalInputs.Inputs(ev.TaskID); len(got) != 1 {
		t.Fatalf("duplicates: %+v", got)
	}
	if a.normalStarts.Load() != 0 {
		t.Fatal("intake executed tools")
	}
	ev.PayloadRef = "conflicting-content"
	b, _ = json.Marshal(map[string]any{"task_events": []ExternalTaskEvent{ev}})
	if code := post(string(b), "test-token"); code != 409 {
		t.Fatalf("conflict=%d", code)
	}
	if cursor := e.publicProgress.externalInputs.Cursor(ev.SourceInstance); cursor != 1 {
		t.Fatalf("cursor=%d", cursor)
	}
}

func TestExternalEventsRecoveryRequiresExplicitContinuation(t *testing.T) {
	_, e, a, s, ev := externalEngineFixture(t)
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
		t.Fatal(err)
	}
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	if a.normalStarts.Load() != 0 {
		t.Fatal("restart resurrected interrupted task")
	}
	r := e.publicProgress.externalInputs.Inputs(ev.TaskID)[0]
	if r.State != "pending_route" {
		t.Fatalf("lost pending input: %+v", r)
	}
	p := e.platforms[0]
	run := e.publicProgress.begin(p, inputTestKey, LangEnglish, nil)
	id, seq, ok := e.publicProgress.runStart(run)
	if !ok || id != ev.TaskID {
		t.Fatalf("resume %s %d %v", id, seq, ok)
	}
	if _, err := e.publicProgress.Report(PublicProgressRequest{Project: e.name, SessionKey: inputTestKey, Run: run, TaskID: id, Seq: seq, Kind: "update", Summary: "Explicitly continue the original task"}); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	inputPrompt(t, a)
	inputDone(a, "Condition received")
	inputWait(t, func() bool { return !s.Busy() })
	if a.session.normal.Load() != 1 {
		t.Fatal("pending input not recovered exactly once")
	}
}

func TestExternalEventsCrossPlatformSourcesAndPrivateLookup(t *testing.T) {
	api, e, _, _, base := externalEngineFixture(t)
	for _, platform := range []string{"discord", "feishu", "qq", "dsh", "cloud_web"} {
		ev := base
		ev.SourceInstance = platform + ":account-17"
		ev.ThreadRef = platform + ":room-42"
		ev.ActorKind = "human"
		ev.ActorID = "stable-user-9"
		binding := ExternalTaskEventRequest{Project: e.name, SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: ev.TaskID, Enabled: true}
		b, _ := json.Marshal(binding)
		w := httptest.NewRecorder()
		api.handleTaskEvents(w, httptest.NewRequest("POST", "/task/events/source", strings.NewReader(string(b))))
		if w.Code != 200 {
			t.Fatalf("bind %s: %s", platform, w.Body.String())
		}
		if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
			t.Fatal(err)
		}
		ev.ThreadRef = "unauthorized-thread"
		ev.EventID = "other"
		if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err == nil {
			t.Fatal("unbound thread accepted")
		}
	}
	w := httptest.NewRecorder()
	api.handleTaskEvents(w, httptest.NewRequest("GET", "/task/events?project=gge&task_id="+base.TaskID, nil))
	var result struct{ Inputs []ExternalEventReceipt }
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(result.Inputs) != 5 {
		t.Fatalf("private lookup: %d %s", w.Code, w.Body.String())
	}
	task, _ := e.publicProgress.Task(base.TaskID)
	if task.FactStage == FactStageVerified || task.FactStage == FactStageDeployed {
		t.Fatalf("fabricated status: %+v", task)
	}
	if len(e.publicProgress.Tasks(inputTestKey, 10)) != 1 {
		t.Fatal("cross-platform input created another task")
	}
}

func TestExternalEventsNonCodeWaitDoesNotWakeUntilSatisfied(t *testing.T) {
	_, e, a, s, ev := externalEngineFixture(t)
	for _, script := range []string{"true", "exit 1"} {
		wake, err := e.pollCronJob(&CronJob{ID: "wait", Exec: script, Poll: true})
		if wake != nil || (script == "exit 1" && err == nil) {
			t.Fatalf("wait=%+v err=%v", wake, err)
		}
		e.flushExternalTaskEvents()
	}
	if a.normalStarts.Load() != 0 {
		t.Fatal("unmet or failed wait woke executor")
	}
	ev.PayloadRef = "fixture:room-available"
	ev.ActorKind = "system"
	b, _ := json.Marshal(map[string]any{"task_events": []ExternalTaskEvent{ev}})
	if wake, err := e.pollCronJob(&CronJob{ID: "wait", Exec: "printf %s " + shellQuote(string(b)), Poll: true}); err != nil || wake != nil {
		t.Fatalf("%+v %v", wake, err)
	}
	e.flushExternalTaskEvents()
	inputPrompt(t, a)
	inputDone(a, "The original reservation task can continue")
	inputWait(t, func() bool { return !s.Busy() })
	if a.session.normal.Load() != 1 {
		t.Fatal("wait delivered more than once")
	}
}

func TestCUJ_ExternalEvents1_WaitReplayAndStop(t *testing.T) {
	_, e, a, s, ev := externalEngineFixture(t)
	p := e.platforms[0].(*inputTestPlatform)
	send := func(id, content string) {
		e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: content, Mentioned: true, ReplyCtx: "local"})
	}
	// A user asks to wait. The existing task receives the result of that turn.
	send("wait", "Keep this reservation task and wait for availability")
	inputPrompt(t, a)
	inputDone(a, "Waiting for the venue's availability")
	inputWait(t, func() bool { return !s.Busy() })
	// Finish the fixture's original progress run, as the CLI would do for this task.
	e.publicProgress.mu.Lock()
	r := e.publicProgress.records[ev.TaskID]
	token := ""
	for key, run := range e.publicProgress.runs {
		if run == r {
			token = key
			break
		}
	}
	e.publicProgress.mu.Unlock()
	e.publicProgress.finish(token, "result")
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	inputPrompt(t, a)
	inputDone(a, "Availability confirmed for the original reservation")
	inputWait(t, func() bool { return !s.Busy() })
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	send("history", "/history")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "Availability confirmed") })
	if a.session.normal.Load() != 2 {
		t.Fatalf("replayed work: %d", a.session.normal.Load())
	}
	ev.EventID = "later"
	ev.SourceSequence = 2
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	inputPrompt(t, a)
	send("stop", "/stop")
	inputWait(t, func() bool { return !s.Busy() })
	task, _ := e.publicProgress.Task(ev.TaskID)
	if task.State != TaskStateCancelled {
		t.Fatalf("stopped task still live: %s", task.State)
	}
	ev.EventID = "after-stop"
	ev.SourceSequence = 3
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{ev}); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	if a.session.normal.Load() != 3 {
		t.Fatal("stopped task woke again")
	}
	visible := strings.Join(p.getSent(), "\n")
	if !strings.Contains(visible, "Waiting for the venue") || !strings.Contains(visible, "Availability confirmed") {
		t.Fatalf("missing user-visible journey: %s", visible)
	}
}

func TestExternalEventsAdapterFixtures(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is required for adapter examples")
	}
	_, e, _, _, base := externalEngineFixture(t)
	for _, kind := range []string{"comment", "check", "pr"} {
		cmd := exec.Command(python, "../contrib/task-events/github_event.py", "github:fixture", base.TaskID, kind, "2026-11-01T00:00:00Z", "../contrib/task-events/github-"+kind+".json")
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		events, structured, err := structuredPollEvents(string(out))
		if err != nil || !structured || len(events) != 1 {
			t.Fatalf("%s: %s %v", kind, out, err)
		}
		ev := events[0]
		if err := e.publicProgress.externalInputs.Bind(ExternalEventSource{SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: ev.TaskID, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := e.AcceptExternalTaskEvents(events); err != nil {
			t.Fatal(err)
		}
	}
	task, _ := e.publicProgress.Task(base.TaskID)
	if task.FactStage == FactStageDeployed || task.FactStage == FactStageVerified {
		t.Fatal("GitHub success fabricated deployment")
	}
	cmd := exec.Command(python, "../contrib/task-events/wait_condition.py", "venue:fixture", base.TaskID, "../contrib/task-events/wait-satisfied.json")
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	events, structured, err := structuredPollEvents(string(out))
	if err != nil || !structured || len(events) != 1 {
		t.Fatalf("wait: %s %v", out, err)
	}
	if events[0].TaskID != base.TaskID || events[0].ActorKind != "system" {
		t.Fatalf("wait event: %+v", events)
	}
}
