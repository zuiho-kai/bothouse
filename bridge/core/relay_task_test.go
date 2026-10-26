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
	// A running dispatch still reports (the watch renews on it) but the
	// ended card keeps its state and summary.
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: d.req.SessionKey, Run: d.token, Seq: 1, Kind: "update", Summary: "late"}); err != nil {
		t.Fatal(err)
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

// A card released at the end of one turn belongs to that turn. The next turn
// of the same session may dispatch to it again without a manual re-claim.
func TestTaskRelayReclaimsClosedCardInNextTurn(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")

	next := p.begin(platform, "discord:room:user", LangChinese, nil)
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	session.events <- Event{Type: EventResult, Content: "new result"}
	result, err := rm.Send(context.Background(), taskRelayRequest(id))
	if err != nil || result.Response != "new result" {
		t.Fatalf("reclaimed dispatch = %+v, %v", result, err)
	}
	if starts.Load() != 1 {
		t.Fatalf("starts = %d, want 1", starts.Load())
	}
	// The reclaimed card is bound to this turn: ending the turn closes it again
	// instead of leaving a permanently active card.
	p.finish(next, "result")
	r := p.records[id]
	r.mu.Lock()
	closed := r.record.Closed
	r.mu.Unlock()
	if !closed {
		t.Fatal("reclaimed card stayed open after its new turn ended")
	}
}

// No live turn means there is no --run to suggest; the error must say what to
// do instead of handing the caller an impossible command.
func TestTaskRelayClosedCardNoLiveTurnDoesNotSuggestRun(t *testing.T) {
	p, _, run, id := taskRelayFixture(t)
	p.finish(run, "result")

	_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err == nil {
		t.Fatal("closed card accepted without a live turn")
	}
	msg := err.Error()
	for _, want := range []string{id, "earlier turn", "no live main-bot turn", "Start a new turn"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q missing %q", msg, want)
		}
	}
	if strings.Contains(msg, "task assign") || strings.Contains(msg, "--run") {
		t.Errorf("no-live error suggests an unusable dispatch: %q", msg)
	}
}

// When automatic re-claim is ambiguous because more than one live turn exists,
// the explicit command must carry the real CLI context so it can actually run.
func TestTaskRelayClosedCardReclaimCommandIncludesCLIContext(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")
	_ = p.begin(platform, "discord:room:user", LangChinese, nil)
	_ = p.begin(platform, "discord:room:user", LangChinese, nil)

	_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err == nil {
		t.Fatal("closed card accepted with an ambiguous turn")
	}
	msg := err.Error()
	for _, want := range []string{
		"more than one main-bot turn",
		"task assign --project 'source'",
		"--session 'discord:room:user'",
		"--data-dir '" + p.dataDir + "'",
		"--id '" + id + "'",
		"--run <current-run>",
		"--ref",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q missing %q", msg, want)
		}
	}
}

// A closed, resumable card is reclaimed only by the single live lead turn of
// its own session; ended cards stay ended and concurrent turns are ambiguous.
func TestTaskRelayReclaimSafetyBoundaries(t *testing.T) {
	t.Run("cancelled", func(t *testing.T) {
		p, platform, run, id := taskRelayFixture(t)
		p.finish(run, "cancelled")
		_ = p.begin(platform, "discord:room:user", LangChinese, nil)
		_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
		if err == nil || !strings.Contains(err.Error(), "cancelled") {
			t.Fatalf("cancelled card error = %v", err)
		}
	})

	t.Run("accepted", func(t *testing.T) {
		p, platform, run, id := taskRelayFixture(t)
		if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: run, Seq: 2, Kind: "result", Summary: "done"}); err != nil {
			t.Fatal(err)
		}
		p.finish(run, "result")
		if _, err := p.Accept(id, "owner"); err != nil {
			t.Fatal(err)
		}
		_ = p.begin(platform, "discord:room:user", LangChinese, nil)
		_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
		if err == nil || !strings.Contains(err.Error(), "accepted") {
			t.Fatalf("accepted card error = %v", err)
		}
	})

	t.Run("ambiguous turns", func(t *testing.T) {
		p, platform, run, id := taskRelayFixture(t)
		p.finish(run, "result")
		_ = p.begin(platform, "discord:room:user", LangChinese, nil)
		_ = p.begin(platform, "discord:room:user", LangChinese, nil)
		_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
		if err == nil || !strings.Contains(err.Error(), "more than one") {
			t.Fatalf("ambiguous turn error = %v", err)
		}
	})

	t.Run("resume window", func(t *testing.T) {
		p, platform, run, id := taskRelayFixture(t)
		p.finish(run, "result")
		r := p.records[id]
		r.mu.Lock()
		r.record.Task.UpdatedAt = time.Now().Add(-cardResumeWindow - time.Hour)
		r.mu.Unlock()
		_ = p.begin(platform, "discord:room:user", LangChinese, nil)
		_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
		if err == nil || !strings.Contains(err.Error(), "resume window") {
			t.Fatalf("expired card error = %v", err)
		}
	})
}

// A dispatch that fails validation after re-attaching the card must leave it
// closed and unbound, not permanently active for the turn.
func TestTaskRelayReclaimRollsBackOnReporterFailure(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")
	next := p.begin(platform, "discord:room:user", LangChinese, nil)
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return nil, errors.New("unbound test reporter")
	}

	if _, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target"); err == nil {
		t.Fatal("dispatch with unbound reporter accepted")
	}
	r := p.records[id]
	r.mu.Lock()
	closed := r.record.Closed
	r.mu.Unlock()
	if !closed {
		t.Fatal("failed dispatch left the reclaimed card open")
	}
	p.mu.Lock()
	_, bound := p.delegations[next]["task:"+id]
	p.mu.Unlock()
	if bound {
		t.Fatal("failed dispatch left the reclaimed card bound to the turn")
	}
}

// Automatic cards are not offered for continuation by runStart, but an
// explicit relay dispatch to one must still re-claim it for the new turn.
func TestTaskRelayReclaimsFinishedAutomaticCard(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		if project != "target" || platformName != "discord" || session != "room:one" {
			return nil, errors.New("unbound test reporter")
		}
		return platform, nil
	}
	run := autoRun(p, platform, "room:one", "跑一个长任务")
	p.noteTool(run, "ls")
	p.noteTool(run, "go test")
	rec := runRecord(p, run)
	if !rec.Auto || rec.Task.ID == "" {
		t.Fatal("automatic card not opened")
	}
	id := rec.Task.ID
	p.finish(run, "result")

	next := p.begin(platform, "room:one", LangChinese, nil)
	req := RelayRequest{From: "fish", To: "target", SessionKey: "room:one", TaskID: id, RequestID: "auto-reclaim", Message: "assignment"}
	if _, _, err := p.beginTaskRelay(req, "Target"); err != nil {
		t.Fatalf("automatic card not re-claimed: %v", err)
	}
	p.finish(next, "result")
	r := p.records[id]
	r.mu.Lock()
	closed := r.record.Closed
	r.mu.Unlock()
	if !closed {
		t.Fatal("reclaimed automatic card stayed open after its new turn ended")
	}
}

// The resume note is generated before the dispatch. If the agent follows it
// after the card was auto-reclaimed, the advertised command must carry the
// explicit task id so progress goes to the reclaimed card, not the run's
// empty record.
func TestTaskRelayResumeNoteAdvertisesExplicitTaskForReclaimedCard(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")
	next := p.begin(platform, "discord:room:user", LangChinese, nil)
	_, resumeSeq, _, _, ok := p.resumeHint(next)
	if !ok {
		t.Fatal("resume hint missing for the closed card")
	}
	var starts atomic.Int32
	rm, _ := taskRelayManager(t, p, platform, nil, &starts)
	instructions := rm.engines["source"].publicProgressInstructions(next, "discord:room:user")
	taskArg := ""
	fields := strings.Fields(instructions)
	for i := 0; i+1 < len(fields); i++ {
		if fields[i] == "--task" && fields[i+1] == id {
			taskArg = id
			break
		}
	}
	if taskArg == "" {
		t.Fatalf("resume note must advertise --task %s: %s", id, instructions)
	}
	noteStart := strings.Index(instructions, "A card from earlier in this session")
	if noteStart < 0 {
		t.Fatalf("resume note missing from instructions: %s", instructions)
	}
	noteEnd := strings.Index(instructions[noteStart:], "; when the human asked for something else")
	if noteEnd < 0 {
		t.Fatalf("resume note end missing from instructions: %s", instructions)
	}
	note := instructions[noteStart : noteStart+noteEnd]
	if !strings.Contains(note, "--run "+next) {
		t.Fatalf("resume note must include --run %s: %s", next, note)
	}

	if _, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(PublicProgressRequest{
		Project:    "source",
		SessionKey: "discord:room:user",
		Run:        next,
		TaskID:     taskArg,
		Seq:        resumeSeq,
		Kind:       "update",
		Summary:    "continuing the earlier card",
	}); err != nil {
		t.Fatalf("advertised progress command failed: %v", err)
	}
	p.finish(next, "result")
}

// After an automatic re-claim, the card must be bound to the current run for
// the whole turn: the first report may use --task, but the next ordinary
// report (no --task) must resolve to the same card instead of the empty run.
func TestTaskRelayReclaimedCardContinuesWithoutTaskID(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")
	next := p.begin(platform, "discord:room:user", LangChinese, nil)
	_, resumeSeq, _, _, ok := p.resumeHint(next)
	if !ok {
		t.Fatal("resume hint missing for the closed card")
	}
	if _, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(PublicProgressRequest{
		Project:    "source",
		SessionKey: "discord:room:user",
		Run:        next,
		TaskID:     id,
		Seq:        resumeSeq,
		Kind:       "update",
		Summary:    "first with task",
	}); err != nil {
		t.Fatalf("first report: %v", err)
	}
	if _, err := p.Report(PublicProgressRequest{
		Project:    "source",
		SessionKey: "discord:room:user",
		Run:        next,
		Seq:        resumeSeq + 1,
		Kind:       "update",
		Summary:    "second without task",
	}); err != nil {
		t.Fatalf("ordinary progress after re-claim: %v", err)
	}
	task, found := p.Task(id)
	if !found || task.LatestProgress != "second without task" {
		t.Fatalf("second report did not reach the reclaimed card: %+v %v", task, found)
	}
	p.finish(next, "result")
}

// If the current turn is already stopping, automatic re-claim must say so and
// must not suggest an explicit task assign with that dead run token.
func TestTaskRelayReclaimStoppedTurnWaitsForNextTurn(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	p.finish(run, "result")
	_ = p.begin(platform, "discord:room:user", LangChinese, func() bool { return true })

	_, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err == nil {
		t.Fatal("closed card accepted while the current turn was stopping")
	}
	msg := err.Error()
	if !strings.Contains(msg, "stopping") {
		t.Errorf("error %q does not name the stopping turn", msg)
	}
	if strings.Contains(msg, "task assign") {
		t.Errorf("error %q suggests a task assign that cannot work", msg)
	}
}

// A card released at the end of a turn can still have a relay receipt in
// flight. Re-claiming it and dispatching again would run two assignments on
// one card; the second dispatch must be refused until the first finishes.
func TestTaskRelayReclaimRefusesRunningReceipt(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	first, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	next := p.begin(platform, "discord:room:user", LangChinese, nil)

	secondReq := taskRelayRequest(id)
	secondReq.RequestID = "dispatch-two"
	if _, _, err := p.beginTaskRelay(secondReq, "Target"); err == nil || !strings.Contains(err.Error(), "running") {
		t.Fatalf("running receipt was not refused: %v", err)
	}
	r := p.records[id]
	r.mu.Lock()
	_, secondWritten := r.record.Relays[secondReq.RequestID]
	r.mu.Unlock()
	if secondWritten {
		t.Fatal("refused dispatch wrote a second receipt")
	}

	if err := first.finish("old result", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.beginTaskRelay(secondReq, "Target"); err != nil {
		t.Fatalf("re-claim after the running receipt finished: %v", err)
	}
	p.finish(next, "result")
}

// A bot dispatched twice on one card: the row it finished for the first
// dispatch must not swallow the second dispatch's reply.
func TestMemberReportedOnlyCountsThisDispatch(t *testing.T) {
	first := time.Now().UTC().Add(-time.Hour)
	second := first.Add(30 * time.Minute)
	task := &Task{Members: []TaskMember{{ReporterProject: "gjiang", ID: "m1", Status: "completed", EndedAt: first.Add(time.Minute)}}}
	if !memberReported(task, "gjiang", first) {
		t.Fatal("row finished during the first dispatch not recognized")
	}
	if memberReported(task, "gjiang", second) {
		t.Fatal("row from the earlier dispatch counted as this dispatch's report")
	}
	task.Members = append(task.Members, TaskMember{ReporterProject: "gjiang", ID: "m2", Status: "completed", EndedAt: second.Add(time.Minute)})
	if !memberReported(task, "gjiang", second) {
		t.Fatal("row finished during the second dispatch not recognized")
	}
}
