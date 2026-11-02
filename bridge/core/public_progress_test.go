package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

type progressTestPlatform struct {
	inputTestPlatform
	pm        sync.Mutex
	snapshots map[string]*Task
	facts     map[string]TaskEvent
	fail      bool
}

func newProgressPlatform() *progressTestPlatform {
	return &progressTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, snapshots: map[string]*Task{}, facts: map[string]TaskEvent{}}
}
func (p *progressTestPlatform) TaskCardDestination(session string) (string, error) {
	return session, nil
}
func (p *progressTestPlatform) EnsureTaskCard(_ context.Context, task *Task, _ Language) error {
	p.pm.Lock()
	defer p.pm.Unlock()
	if p.fail {
		return errors.New("offline")
	}
	task.MessageID = task.ID
	task.CardURL = "https://example.test/cards/" + task.ID
	task.ThreadID = "thread-" + task.ID
	p.snapshots[task.ID] = task.Clone()
	return nil
}
func (p *progressTestPlatform) PublishTaskFact(_ context.Context, _ *Task, ev TaskEvent, _ Language) error {
	p.pm.Lock()
	defer p.pm.Unlock()
	if p.fail {
		return errors.New("offline")
	}
	p.facts[ev.ID] = ev
	return nil
}
func (p *progressTestPlatform) task(id string) *Task {
	p.pm.Lock()
	defer p.pm.Unlock()
	return p.snapshots[id].Clone()
}

func TestPublicProgressDurabilityAndRunIsolation(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room:one", LangChinese, nil)
	req := PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 1, Kind: "start", Title: "检查绑定", Summary: "开始核对语音绑定"}
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate, err := p.Report(req); err != nil || duplicate != id {
		t.Fatal("duplicate not idempotent", err)
	}
	changed := req
	changed.Summary = "different"
	if _, err = p.Report(changed); err == nil {
		t.Fatal("sequence conflict accepted")
	}
	changed = req
	changed.SessionKey = "room:two"
	if _, err = p.Report(changed); err == nil {
		t.Fatal("cross-session report accepted")
	}
	changed = req
	changed.Seq = 3
	if _, err = p.Report(changed); err == nil {
		t.Fatal("out of order accepted")
	}
	platform.fail = true
	p.Flush(context.Background())
	path := filepath.Join(p.dir, id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), run) {
		t.Fatal("run token persisted")
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != 0600 {
		t.Fatal("journal permissions", st.Mode())
	}
	req.Seq = 2
	req.Kind = "update"
	req.Summary = "已发现配置差异"
	if _, err = p.Report(req); err != nil {
		t.Fatal(err)
	}
	req.Seq = 3
	req.Kind = "result"
	req.Summary = "绑定已修正，真人语音待验收"
	if _, err = p.Report(req); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	if _, err = p.Report(req); err == nil {
		t.Fatal("late report accepted")
	}
	platform.fail = false
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restored.Flush(context.Background())
	restored.Flush(context.Background())
	got := platform.task(id)
	if got == nil || got.State != TaskStateResultReady || got.FactStage != "" || got.ResultSummary != req.Summary {
		t.Fatalf("wrong result %+v", got)
	}
	if len(platform.facts) != 2 {
		t.Fatalf("ordinary update became history or duplicate key facts: %d", len(platform.facts))
	}
	if _, err = restored.Report(req); err == nil {
		t.Fatal("old run revived on restart")
	}
}

func TestPublicProgressCrashAndFailureOverride(t *testing.T) {
	for _, outcome := range []string{"crash", "failed", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			dir := t.TempDir()
			platform := newProgressPlatform()
			p, _ := NewPublicProgress(dir, "fish", []Platform{platform})
			run := p.begin(platform, "room", LangEnglish, nil)
			req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "start"}
			id, err := p.Report(req)
			if err != nil {
				t.Fatal(err)
			}
			req.Seq = 2
			req.Kind = "result"
			req.Summary = "done"
			_, err = p.Report(req)
			if err != nil {
				t.Fatal(err)
			}
			if outcome != "crash" {
				p.finish(run, outcome)
			}
			restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			restored.Flush(context.Background())
			want := TaskStateFailed
			if outcome == "cancelled" {
				want = TaskStateCancelled
			}
			if got := platform.task(id); got.State != want {
				t.Fatalf("false success: %+v", got)
			}
		})
	}
}

func TestPublicProgressAPIRejectsMalformedAndWrongProject(t *testing.T) {
	_, e, _, _, _ := inputFixture(t)
	p := newProgressPlatform()
	e.platforms = []Platform{p}
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	api := &APIServer{engines: map[string]*Engine{"gge": e}}
	run := e.publicProgress.begin(p, inputTestKey, LangEnglish, nil)
	req := PublicProgressRequest{Project: "gge", SessionKey: inputTestKey, Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "public"}
	b, _ := json.Marshal(req)
	for _, tc := range []struct {
		body string
		code int
	}{
		{string(b) + " {}", 400}, {strings.Replace(string(b), "gge", "wrong", 1), 409}, {string(b), 200}, {string(b), 200},
	} {
		w := httptest.NewRecorder()
		api.handlePublicProgress(w, httptest.NewRequest("POST", "/progress", strings.NewReader(tc.body)))
		if w.Code != tc.code {
			t.Fatalf("HTTP %d %s", w.Code, w.Body.String())
		}
	}
}

func progressToken(t *testing.T, prompt string) string {
	t.Helper()
	parts := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
	if len(parts) != 2 {
		t.Fatal("missing current run token")
	}
	return parts[1]
}

func TestPublicProgressVoiceKeepsOnlyExplicitReceipt(t *testing.T) {
	api, e, a, _, s := inputFixture(t)
	p := newProgressPlatform()
	e.platforms = []Platform{p}
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	req := inputBoundRequest(t, api, "voice-progress")
	req["text"] = "检查配置"
	code, _ := inputPost(api, req)
	if code != 202 {
		t.Fatal(code)
	}
	run := progressToken(t, inputPrompt(t, a))
	report := PublicProgressRequest{Project: "gge", SessionKey: inputTestKey, Run: run, Seq: 1, Kind: "start", Title: "检查配置", Summary: "正在检查"}
	if _, err := e.publicProgress.Report(report); err != nil {
		t.Fatal(err)
	}
	report.Seq = 2
	report.Kind = "result"
	report.Summary = "配置已修正，真人语音待验证。"
	if _, err := e.publicProgress.Report(report); err != nil {
		t.Fatal(err)
	}
	inputDone(a, "这是长篇最终答复，包含许多细节。")
	result := inputResult(t, api, "voice-progress", "completed")
	inputWait(t, func() bool { return !s.Busy() })
	e.publicProgress.Flush(context.Background())
	if result.Text != report.Summary {
		t.Fatalf("voice didn't use card facts: %s", result.Text)
	}
	if len(p.getSent()) != 0 {
		t.Fatal("voice transcript leaked to Discord")
	}
	if len(p.snapshots) != 1 {
		t.Fatal("voice task card missing")
	}
}

func TestPublicProgressPersistenceFailureCanRetry(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangEnglish, nil)
	req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "public"}
	dir := p.dir
	p.dir = filepath.Join(dir, "missing")
	if _, err := p.Report(req); err == nil {
		t.Fatal("ACK before durability")
	}
	p.dir = dir
	id, err := p.Report(req)
	if err != nil {
		t.Fatal("failed commit consumed sequence", err)
	}
	p.Flush(context.Background())
	if got := platform.task(id); got.Seq != 1 || len(got.Events) != 1 {
		t.Fatalf("duplicate event on retry %+v", got)
	}
}

func TestPublicProgressConcurrentRetryAndStop(t *testing.T) {
	platform := newProgressPlatform()
	p, _ := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	state := &interactiveState{}
	run := p.begin(platform, "room", LangEnglish, state.isStopped)
	req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "public"}
	var wg sync.WaitGroup
	for n := 0; n < 10; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.Report(req); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	p.Flush(context.Background())
	if len(platform.facts) != 1 {
		t.Fatal("concurrent retries duplicated history")
	}
	state.markStopped()
	req.Seq = 2
	req.Kind = "update"
	if _, err := p.Report(req); err == nil {
		t.Fatal("accepted report after stop signal")
	}
}

type slowProgressPlatform struct {
	*progressTestPlatform
	entered, release chan struct{}
	once             sync.Once
}

func (p *slowProgressPlatform) EnsureTaskCard(ctx context.Context, task *Task, lang Language) error {
	p.once.Do(func() {
		close(p.entered)
		select {
		case <-p.release:
		case <-ctx.Done():
		}
	})
	return p.progressTestPlatform.EnsureTaskCard(ctx, task, lang)
}

func TestPublicProgressSlowDeliveryDoesNotBlockOrOverwriteNewResult(t *testing.T) {
	platform := &slowProgressPlatform{progressTestPlatform: newProgressPlatform(), entered: make(chan struct{}), release: make(chan struct{})}
	p, _ := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	run := p.begin(platform, "room", LangEnglish, nil)
	req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "starting"}
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	flushed := make(chan struct{})
	go func() { p.Flush(context.Background()); close(flushed) }()
	<-platform.entered
	reported := make(chan error, 1)
	req.Seq = 2
	req.Kind = "result"
	req.Summary = "result is ready, not deployed"
	go func() { _, err := p.Report(req); p.finish(run, "result"); reported <- err }()
	select {
	case err := <-reported:
		if err != nil {
			t.Error(err)
		}
	case <-time.After(time.Second):
		t.Error("slow HTTP blocked report/final result")
	}
	close(platform.release)
	<-flushed
	p.Flush(context.Background())
	if got := platform.task(id); got.State != TaskStateResultReady || got.ResultSummary != req.Summary {
		t.Fatalf("stale delivery overwrote current result: %+v", got)
	}
}

func TestPublicProgressLongVoiceReceiptPreservesCaveat(t *testing.T) {
	_, e, _, _, _ := inputFixture(t)
	platform := newProgressPlatform()
	e.platforms = []Platform{platform}
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	state := &interactiveState{platform: platform}
	prompt := e.withPublicProgress("task", state, "room", false, true)
	run := progressToken(t, prompt)
	req := PublicProgressRequest{Project: "gge", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "start"}
	if _, err := e.publicProgress.Report(req); err != nil {
		t.Fatal(err)
	}
	req.Seq = 2
	req.Kind = "result"
	req.Summary = strings.Repeat("结果细节", 30) + "但尚未部署，也未验收。"
	if _, err := e.publicProgress.Report(req); err != nil {
		t.Fatal(err)
	}
	if got := e.publicVoiceReceipt(state, "long reply"); got != NewI18n(e.i18n.CurrentLang()).T(MsgPublicVoiceResult) {
		t.Fatalf("truncated caveat instead of referring to card: %s", got)
	}
	e.finishPublicProgress(state, "result")
}

func TestPublicProgressPromptResolvesDataDirBeforeAgentChangesDirectory(t *testing.T) {
	_, e, _, _, _ := inputFixture(t)
	platform := newProgressPlatform()
	e.platforms = []Platform{platform}
	absDir := filepath.Join(t.TempDir(), "RUN_TOKEN agent's data")
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relativeDir, err := filepath.Rel(cwd, absDir)
	if err != nil {
		t.Fatal(err)
	}
	e.SetDataDir(relativeDir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	state := &interactiveState{platform: platform}
	prompt := e.withPublicProgress("literal RUN_TOKEN COMMAND", state, "room", false, false)
	quotedDir := "'" + strings.ReplaceAll(absDir, "'", "'\"'\"'") + "'"
	if !strings.Contains(prompt, "--data-dir "+quotedDir) {
		t.Fatal("progress command must preserve the absolute bridge data directory")
	}
	progressToken(t, prompt)
	if !strings.HasSuffix(prompt, "literal RUN_TOKEN COMMAND") {
		t.Fatal("template replacement modified user content")
	}
	e.finishPublicProgress(state, "result")
}

// cronProgressPlatform can run cron jobs (reply-context reconstruction) and
// publish task cards, like the Discord adapter.
type cronProgressPlatform struct {
	stubCronReplyTargetPlatform
}

func (p *cronProgressPlatform) TaskCardDestination(session string) (string, error) {
	return session, nil
}
func (p *cronProgressPlatform) EnsureTaskCard(_ context.Context, task *Task, _ Language) error {
	task.MessageID = task.ID
	return nil
}
func (p *cronProgressPlatform) PublishTaskFact(context.Context, *Task, TaskEvent, Language) error {
	return nil
}

// TestPublicProgressCronTurnGetsRunToken verifies that the turn a cron job runs
// carries a current-run token, so the agent can open a task card from it.
func TestPublicProgressCronTurnGetsRunToken(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	platform := &cronProgressPlatform{stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	agentSession := newResultAgentSession("ok")
	e := NewEngine("test", &resultAgent{session: agentSession}, []Platform{platform}, "", LangEnglish)
	defer e.cancel()
	allChatsAreWorkspaces(e)
	e.SetDataDir(t.TempDir())
	allChatsAreWorkspaces(e)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	job := &CronJob{ID: "job-progress", SessionKey: "discord:channel-1:user-1", Prompt: "daily check"}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}
	if err := e.ExecuteCronJob(job); err != nil {
		t.Fatalf("ExecuteCronJob() error = %v", err)
	}
	if len(agentSession.sentPrompts) != 1 {
		t.Fatalf("sentPrompts = %d, want 1", len(agentSession.sentPrompts))
	}
	progressToken(t, agentSession.sentPrompts[0])
}
