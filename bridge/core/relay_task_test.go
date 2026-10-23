package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// An unknown task must never silently become a public relay.
func TestTaskRelayUnknownTaskNeverFallsBackToChannel(t *testing.T) {
	src := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	dst := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	se := NewEngine("source", &stubAgent{}, []Platform{src}, "", LangEnglish)
	session := newControllableSession("target")
	session.events <- Event{Type: EventResult, Content: "private result"}
	te := NewEngine("target", &controllableAgent{nextSession: session}, []Platform{dst}, "", LangEnglish)
	rm := NewRelayManager("")
	rm.RegisterEngine("source", se)
	rm.RegisterEngine("target", te)
	rm.Bind("discord", "room", map[string]string{"source": "Source", "target": "Target"})
	b, _ := json.Marshal(map[string]string{"from": "source", "to": "target", "session_key": "discord:room:user", "message": "private assignment", "task_id": "task-missing", "request_id": "one"})
	var req RelayRequest
	if err := json.Unmarshal(b, &req); err != nil {
		t.Fatal(err)
	}
	if _, err := rm.Send(context.Background(), req); err == nil {
		t.Error("unknown task was executed instead of rejected")
	}
	if len(src.getSent())+len(dst.getSent()) != 0 {
		t.Errorf("task body leaked to main channel: %v %v", src.getSent(), dst.getSent())
	}
	// A caller losing the task field must not turn its dispatch receipt into
	// a legacy public relay either (including direct HTTP callers).
	req.TaskID = ""
	if _, err := rm.Send(context.Background(), req); err == nil {
		t.Error("request_id without task_id was executed instead of rejected")
	}
	if len(src.getSent())+len(dst.getSent()) != 0 {
		t.Errorf("incomplete task scope leaked to main channel: %v %v", src.getSent(), dst.getSent())
	}
}

type taskRelaySession struct {
	*controllableAgentSession
	onSend func(string)
}

func (s *taskRelaySession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	if s.onSend != nil {
		s.onSend(prompt)
	}
	return nil
}

func taskRelayManager(t *testing.T, p *PublicProgress, platform *progressTestPlatform, send func(string), starts *atomic.Int32) (*RelayManager, *taskRelaySession) {
	t.Helper()
	session := &taskRelaySession{controllableAgentSession: newControllableSession("target"), onSend: send}
	a := &controllableAgent{startSessionFn: func(context.Context, string) (AgentSession, error) { starts.Add(1); return session, nil }}
	source := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	source.publicProgress = p
	dst := newProgressPlatform()
	target := NewEngine("target", a, []Platform{dst}, "", LangEnglish)
	rm := NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.RegisterEngine("target", target)
	p.resolveReporter = source.resolveTaskReporter
	source.SetRelayManager(rm)
	rm.Bind("discord", "room", map[string]string{"source": "Source", "target": "Target"})
	return rm, session
}

func taskRelayRequest(id string) RelayRequest {
	return RelayRequest{From: "source", To: "target", SessionKey: "discord:room:user", TaskID: id, RequestID: "dispatch-one", Message: "full assignment: investigate the private test fixture"}
}

func TestTaskRelayThreadProgressAndIdempotentExecution(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	var starts atomic.Int32
	var childToken string
	rm, s := taskRelayManager(t, p, platform, func(prompt string) {
		childToken = progressToken(t, prompt)
		if !strings.Contains(prompt, "--project 'source'") || !strings.Contains(prompt, "Do not send public channel messages") {
			t.Error("missing scoped reporting instructions")
		}
		req := PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: childToken, Seq: 1, Kind: "result", Summary: "full child result detail"}
		if got, err := p.Report(req); err != nil || got != id {
			t.Errorf("child report: %s %v", got, err)
		}
		if _, err := p.Report(req); err != nil {
			t.Error("identical child retry rejected", err)
		}
		req.Summary = "changed"
		if _, err := p.Report(req); err == nil {
			t.Error("changed child seq accepted")
		}
		req.Seq = 2
		req.Kind = "start"
		req.Title = "bad"
		if _, err := p.Report(req); err == nil {
			t.Error("child started another task")
		}
	}, &starts)
	s.events <- Event{Type: EventToolResult, Content: "raw tool transcript must not appear"}
	s.events <- Event{Type: EventResult, Content: "full final collaborator response"}
	req := taskRelayRequest(id)
	result, err := rm.Send(context.Background(), req)
	if err != nil || result.Response != "full final collaborator response" {
		t.Fatal(result, err)
	}
	task, found := p.Task(id)
	if !found || task.State != TaskStateInProgress || task.ResultSummary != "" {
		t.Fatalf("child changed parent state: %+v %v", task, found)
	}
	if strings.Contains(task.LatestProgress, "full final") {
		t.Fatal("full result on card")
	}
	// The source run still owns sequence 2; child reporting cannot consume it.
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: req.SessionKey, Run: run, Seq: 2, Kind: "update", Summary: "reviewing collaborator evidence"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: req.SessionKey, Run: childToken, Seq: 2, Kind: "update", Summary: "late"}); err == nil {
		t.Fatal("completed child token accepted")
	}
	platform.fail = true
	p.Flush(context.Background())
	platform.fail = false
	p.Flush(context.Background())
	p.Flush(context.Background())
	platform.pm.Lock()
	var details []string
	for _, ev := range platform.facts {
		details = append(details, ev.Detail)
	}
	platform.pm.Unlock()
	worker := rm.engines["target"].platforms[0].(*progressTestPlatform)
	worker.pm.Lock()
	for _, ev := range worker.facts {
		details = append(details, ev.Detail)
	}
	worker.pm.Unlock()
	joined := strings.Join(details, "\n")
	if strings.Contains(joined, req.Message) {
		t.Fatal("assignment text leaked to public facts")
	}
	for _, ev := range platform.facts {
		if ev.ReporterProject == "target" {
			t.Fatal("worker report posted by creator")
		}
	}
	for _, want := range []string{"full child result detail", result.Response} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing thread detail %q: %s", want, joined)
		}
	}
	if strings.Contains(joined, "raw tool transcript") {
		t.Fatal("raw tools published")
	}
	if len(platform.getSent()) != 0 {
		t.Fatal("ordinary channel message sent", platform.getSent())
	}
	for _, engine := range rm.engines {
		if other, ok := engine.platforms[0].(*relayVisibilityPlatform); ok && len(other.getSent()) != 0 {
			t.Fatal("target echoed full reply")
		}
	}
	if cached, err := rm.Send(context.Background(), req); err != nil || cached.Response != result.Response {
		t.Fatal("retry failed", cached, err)
	}
	req.Message = "changed assignment"
	if _, err := rm.Send(context.Background(), req); err == nil {
		t.Fatal("changed content accepted")
	}
	if starts.Load() != 1 {
		t.Fatal("dispatch/delivery retry repeated tools", starts.Load())
	}
	data, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), childToken) {
		t.Fatal("child token persisted")
	}
	// A replay after restart uses the durable result without re-running tools.
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	rm.engines["source"].publicProgress = restored
	req = taskRelayRequest(id)
	if cached, err := rm.Send(context.Background(), req); err != nil || cached.Response != result.Response {
		t.Fatal(cached, err)
	}
	if starts.Load() != 1 {
		t.Fatal("restart reran target")
	}
}

func TestTaskRelayRejectsWrongOwnershipAndMissingCapability(t *testing.T) {
	for _, kind := range []string{"task", "session", "source", "request", "closed", "disabled", "platform"} {
		t.Run(kind, func(t *testing.T) {
			p, platform, run, id := taskRelayFixture(t)
			var starts atomic.Int32
			rm, _ := taskRelayManager(t, p, platform, nil, &starts)
			req := taskRelayRequest(id)
			switch kind {
			case "task":
				req.TaskID = "missing"
			case "session":
				req.SessionKey = "discord:room:other"
			case "source":
				req.From = "other"
			case "request":
				req.RequestID = ""
			case "closed":
				p.finish(run, "cancelled")
			case "disabled":
				rm.engines["source"].publicProgress = nil
			case "platform":
				req.SessionKey = "other:room:user"
			}
			if _, err := rm.Send(context.Background(), req); err == nil {
				t.Fatal("invalid request accepted")
			}
			if starts.Load() != 0 || len(platform.getSent()) != 0 {
				t.Fatal("rejected dispatch executed or echoed")
			}
		})
	}
}

func TestTaskRelayRunningAndFailedReceiptNeverReexecutes(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(map[bool]string{false: "running", true: "restart"}[restart], func(t *testing.T) {
			p, platform, _, id := taskRelayFixture(t)
			req := taskRelayRequest(id)
			d, _, err := p.beginTaskRelay(req, "Target")
			if err != nil {
				t.Fatal(err)
			}
			if restart {
				p, err = NewPublicProgress(p.dataDir, "source", []Platform{platform})
				if err != nil {
					t.Fatal(err)
				}
			}
			var starts atomic.Int32
			rm, _ := taskRelayManager(t, p, platform, nil, &starts)
			if _, err := rm.Send(context.Background(), req); err == nil {
				t.Fatal("unresolved request executed again")
			}
			if !restart {
				if err := d.finish("partial", errors.New("uncertain")); err != nil {
					t.Fatal(err)
				}
				if _, err := rm.Send(context.Background(), req); err == nil {
					t.Fatal("failed request executed again")
				}
			}
			if starts.Load() != 0 {
				t.Fatal("replayed uncertain tools")
			}
		})
	}
}

func TestTaskRelayLateCompletionCannotReopenParent(t *testing.T) {
	p, _, run, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "cancelled")
	before, _ := p.Task(id)
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: d.req.SessionKey, Run: d.token, Seq: 1, Kind: "update", Summary: "late"}); err == nil {
		t.Fatal("late progress accepted")
	}
	if err := d.finish("late result", nil); err != nil {
		t.Fatal(err)
	}
	after, _ := p.Task(id)
	if after.State != before.State || after.LatestProgress != before.LatestProgress {
		t.Fatal("late child reopened parent", after)
	}
}

func TestTaskRelaySilentTimeoutReturnsUnconfirmedWithoutReplaying(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	tokens := make(chan string, 1)
	rm, s := taskRelayManager(t, p, platform, func(prompt string) {
		tokens <- progressToken(t, prompt)
	}, &starts)
	rm.SetTimeout(20 * time.Millisecond)
	s.events <- Event{Type: EventText, Content: "partial response"}
	done := make(chan error, 1)
	go func() { _, err := rm.Send(context.Background(), taskRelayRequest(id)); done <- err }()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("silent events ignored timeout")
	}
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: <-tokens, Seq: 1, Kind: "update", Summary: "still executing after caller timeout"}); err != nil {
		t.Fatal("timeout revoked a running worker's report grant", err)
	}
	s.events <- Event{Type: EventResult, Content: "late"}
	select {
	case <-s.closed:
	case <-time.After(time.Second):
		t.Fatal("drain did not close")
	}
	deadline := time.Now().Add(time.Second)
	for {
		task, _ := p.Task(id)
		if strings.Contains(task.Events[len(task.Events)-1].Detail, "late") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background completion not checkpointed")
		}
		time.Sleep(time.Millisecond)
	}
	cached, err := rm.Send(context.Background(), taskRelayRequest(id))
	if err != nil || cached.Response != "late" {
		t.Fatal("confirmed late result not cached", cached, err)
	}
	if starts.Load() != 1 {
		t.Fatal("timed out tools reran")
	}
}

func TestTaskRelayReservationMustBeDurableBeforeExecution(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	rm, _ := taskRelayManager(t, p, platform, nil, &starts)
	before, _ := p.Task(id)
	// A regular file cannot be used as a journal directory. No chmod changes.
	bad := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(bad, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	p.dir = bad
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil {
		t.Fatal("unpersisted reservation executed")
	}
	after, _ := p.Task(id)
	if starts.Load() != 0 || after.Seq != before.Seq {
		t.Fatal("failed reservation changed task or ran tools")
	}
}

func taskRelayFixture(t *testing.T) (*PublicProgress, *progressTestPlatform, string, string) {
	t.Helper()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		if project != "target" || platformName != "discord" || session != "discord:room:user" {
			return nil, errors.New("unbound test reporter")
		}
		return platform, nil
	}
	run := p.begin(platform, "discord:room:user", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: run, Seq: 1, Kind: "start", Title: "local task", Summary: "start"})
	if err != nil {
		t.Fatal(err)
	}
	return p, platform, run, id
}
