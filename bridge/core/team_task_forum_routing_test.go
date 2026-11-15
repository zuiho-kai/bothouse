package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

type forumRoutingPlatform struct {
	*stubForumPlatform
	legacyCards  int
	mentions     []string
	failSend     bool
	forumFactErr error
	legacyFacts  []TaskEvent
	forumFacts   []TaskEvent
}

func (p *forumRoutingPlatform) TaskCardDestination(session string) (string, error) {
	return session, nil
}
func (p *forumRoutingPlatform) EnsureTaskCard(_ context.Context, task *Task, _ Language) error {
	if !task.ForumPost {
		p.legacyCards++
		task.ThreadID = "legacy"
		task.MessageID = "card"
	}
	return nil
}
func (p *forumRoutingPlatform) PublishTaskFact(_ context.Context, task *Task, ev TaskEvent, _ Language) error {
	if task.ForumPost {
		if p.forumFactErr != nil {
			return p.forumFactErr
		}
		p.forumFacts = append(p.forumFacts, ev)
	} else {
		p.legacyFacts = append(p.legacyFacts, ev)
	}
	return nil
}
func (p *forumRoutingPlatform) ReconstructReplyCtx(session string) (any, error) { return session, nil }
func (p *forumRoutingPlatform) PostTaskUserNode(ctx context.Context, id, text, user string) error {
	p.mentions = append(p.mentions, user)
	return p.PostTaskNode(ctx, id, text)
}
func (p *forumRoutingPlatform) PostTaskNode(ctx context.Context, id, text string) error {
	if p.failSend {
		return errors.New("missing send permission")
	}
	return p.stubForumPlatform.PostTaskNode(ctx, id, text)
}
func forumRoutingEngine(t *testing.T) (*Engine, *forumRoutingPlatform, string) {
	t.Helper()
	p := &forumRoutingPlatform{stubForumPlatform: newStubForumPlatform()}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true, inject: true}
	return e, p, dir
}
func TestTaskForumRoutingPersistsWithoutSecondThread(t *testing.T) {
	for _, mode := range []string{"forum", "off", "denied"} {
		t.Run(mode, func(t *testing.T) {
			e, plat, dir := forumRoutingEngine(t)
			writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
			if mode == "off" {
				e.SetTaskForum(false)
			}
			if mode == "denied" {
				plat.ensureErr = errors.New("permission denied")
			}
			progress, err := NewPublicProgress(t.TempDir(), e.name, []Platform{plat})
			if err != nil {
				t.Fatal(err)
			}
			progress.resolveThread = e.resolveTaskThread
			run := progress.begin(plat, "discord:222", LangChinese, nil)
			id, err := progress.Report(PublicProgressRequest{Project: e.name, SessionKey: "discord:222", Run: run, Seq: 1, Kind: "start", Title: "任务并帖", Summary: "已接手"})
			if err != nil {
				t.Fatal(err)
			}
			progress.Flush(context.Background())
			task, ok := progress.Task(id)
			if !ok {
				t.Fatal("task not found")
			}
			wantForum := mode == "forum"
			if task.ForumPost != wantForum || (wantForum && (plat.legacyCards != 0 || task.ThreadID != "th1")) || (!wantForum && plat.legacyCards != 1) {
				t.Fatalf("task=%+v legacy=%d", task, plat.legacyCards)
			}
			restored, err := NewPublicProgress(progress.dataDir, e.name, []Platform{plat})
			if err != nil {
				t.Fatal(err)
			}
			saved, _ := restored.Task(id)
			if saved.ForumPost != wantForum || saved.ThreadID != task.ThreadID {
				t.Fatalf("binding not durable: %+v", saved)
			}
			old := &Task{ThreadID: "old-running", SessionKey: "discord:222", CreatedAt: time.Now()}
			e.resolveTaskThread(context.Background(), old)
			if old.ThreadID != "old-running" || old.ForumPost {
				t.Fatal("old thread migrated")
			}
		})
	}
}
func TestTaskForumCachedPostPermissionLoss(t *testing.T) {
	for _, mode := range []string{"creator denied", "transient", "member denied"} {
		t.Run(mode, func(t *testing.T) {
			e, plat, dir := forumRoutingEngine(t)
			writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
			progress, err := NewPublicProgress(t.TempDir(), e.name, []Platform{plat})
			if err != nil {
				t.Fatal(err)
			}
			progress.resolveThread = e.resolveTaskThread
			run := progress.begin(plat, "discord:222", LangChinese, nil)
			id, err := progress.Report(PublicProgressRequest{Project: e.name, SessionKey: "discord:222", Run: run, Seq: 1, Kind: "start", Title: "任务并帖", Summary: "已接手"})
			if err != nil {
				t.Fatal(err)
			}
			progress.Flush(context.Background())
			before, _ := progress.Task(id)
			if !before.ForumPost || before.ThreadID != "th1" {
				t.Fatalf("initial binding: %+v", before)
			}
			permanent := errors.Join(ErrTaskFactUndeliverable, ErrDeliveryUnrecoverable)
			switch mode {
			case "creator denied":
				plat.forumFactErr = permanent
			case "transient":
				plat.forumFactErr = errors.New("temporary outage")
			case "member denied":
				member := &forumRoutingPlatform{forumFactErr: permanent}
				progress.resolveReporter = func(string, string, string) (TaskCardPublisher, error) { return member, nil }
			}
			if _, err := progress.Report(PublicProgressRequest{Project: e.name, SessionKey: "discord:222", Run: run, Seq: 2, Kind: "milestone", Summary: "必须保留的进度"}); err != nil {
				t.Fatal(err)
			}
			r := progress.records[id]
			if mode == "member denied" {
				r.record.Task.Events[len(r.record.Task.Events)-1].ReporterProject = "member"
			}
			progress.Flush(context.Background())
			got, _ := progress.Task(id)
			wantLegacy := mode == "creator denied"
			if got.ForumPost == wantLegacy || (plat.legacyCards != 0) != wantLegacy {
				t.Fatalf("mode=%s binding=%+v legacy=%d", mode, got, plat.legacyCards)
			}
			if wantLegacy && (len(plat.legacyFacts) != 1 || plat.legacyFacts[0].Summary != "必须保留的进度") {
				t.Fatalf("fact not preserved: %+v", plat.legacyFacts)
			}
			if mode != "transient" && r.record.FactSeq != got.Seq {
				t.Fatal("delivered fact not checkpointed")
			}
			if mode == "transient" && r.record.FactSeq >= got.Seq {
				t.Fatal("temporary failure dropped the pending fact")
			}
			restored, err := NewPublicProgress(progress.dataDir, e.name, []Platform{plat})
			if err != nil {
				t.Fatal(err)
			}
			saved, _ := restored.Task(id)
			if saved.ForumPost != got.ForumPost || saved.ThreadID != got.ThreadID {
				t.Fatal("fallback binding not durable")
			}
		})
	}
}

func TestTaskForumExitRequiresDeliveredPost(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
	headline, detail := "📬 结果", "完整报告"
	body := joinExitDetail(headline, detail)
	text, rc := e.taskForumExitText(context.Background(), p, "discord:222", 783, headline, detail)
	if rc != "discord:th1" || !strings.Contains(text, "https://discord.com/channels/g1/th1/th1") || len(p.post("th1").nodes) != 1 || p.post("th1").nodes[0] != body {
		t.Fatalf("text=%s rc=%v post=%+v", text, rc, p.post("th1"))
	}
	p.failSend = true
	text, rc = e.taskForumExitText(context.Background(), p, "discord:222", 783, headline, detail)
	if rc != nil || text != headline {
		t.Fatal("failed send hid the report behind a link")
	}
}

func TestTaskForumHeldLegacyReportKeepsThreadAfterSessionReset(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"旧任务","status":"在做","chat":"discord:111","ws":"discord:222","bound":"2026-11-14T00:00:00Z"}`+"\n")
	old := &Task{ID: "old", SessionKey: "discord:222", ThreadID: "legacy", CreatedAt: time.Now()}
	e.publicProgress = &PublicProgress{records: map[string]*publicRun{"old": {record: progressRecord{Task: old}}}}
	text, rc := e.taskForumExitText(context.Background(), p, "discord:222", 783, "原报告", "")
	if text != "原报告" || rc != nil || p.opens != 0 {
		t.Fatalf("old report migrated: %s %v %d", text, rc, p.opens)
	}
}
func TestTaskForumMentionOnlyOnWaitingTransition(t *testing.T) {
	for _, dispatcher := range []string{"123", "lead", "", "unknown"} {
		t.Run(dispatcher, func(t *testing.T) {
			e, p, dir := forumRoutingEngine(t)
			e.SetAdminFrom("123")
			board := func(paused bool) {
				extra := ""
				if paused {
					extra = `,"paused":"11-15 00:00","pause_why":"等待用户答复：请选 A 或 B"`
				}
				writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","dispatcher":"`+dispatcher+`"`+extra+"}\n")
			}
			board(false)
			e.syncTaskForum()
			board(true)
			e.syncTaskForum()
			e.syncTaskForum()
			// A bot (or unknown) dispatcher falls back to the owner: the user is who waits.
			want := 1
			if len(p.mentions) != want {
				t.Fatalf("mentions=%v", p.mentions)
			}
			board(false)
			e.syncTaskForum()
			board(true)
			e.syncTaskForum()
			if len(p.mentions) != want*2 {
				t.Fatalf("reentry mentions=%v", p.mentions)
			}
		})
	}
}
func TestTaskForumWaitingSummaryUsesExplicitBoardState(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	p.scopes = map[string]TaskForum{"other": {ID: "forum2", GuildID: "g1", CategoryID: "cat2"}}
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","paused":"11-15 00:00","pause_why":"等待用户答复：选择 A"}`+"\n")
	e.syncTaskForum()
	summary := e.taskForumWaitingSummary("discord:111", time.Now())
	if !strings.Contains(summary, "等你拍板 1 件") || !strings.Contains(summary, "https://discord.com/channels/g1/forum1") {
		t.Fatal(summary)
	}
	if e.taskForumWaitingSummary("discord:other", time.Now()) != "" {
		t.Fatal("unrelated forum counted")
	}
	e.SetTaskForum(false)
	if e.taskForumWaitingSummary("discord:111", time.Now()) != "" {
		t.Fatal("disabled summary")
	}
	e.SetTaskForum(true)
	writeTaskBoard(t, dir, team.TaskBoardFile, "")
	if e.taskForumWaitingSummary("discord:111", time.Now()) != "" {
		t.Fatal("zero summary")
	}
}

func TestTaskForumDisplayNamesAndWithdrawnTransport(t *testing.T) {
	e, _, _ := forumRoutingEngine(t)
	name := "G哥"
	e.displayName.Store(&name)
	it := e.taskForumDisplayItem(teamTaskBoardItem{Who: "工作区7lead", wsName: "工作区7", Reviewer: "lead"})
	card := taskForumCard(it, TaskForumTagReview, "待核对", 1900)
	if strings.Contains(card, "lead") || !strings.Contains(card, "工作区7G哥") || !strings.Contains(card, "等 G哥 核对") {
		t.Fatal(card)
	}
	progress := &PublicProgress{}
	task := &Task{ForumPost: true, ThreadID: "post", AuthorizationDecisionID: "withdrawn", Title: "private model content"}
	view := progress.authorizedTaskView(task, LangChinese)
	if !view.ForumPost || view.ThreadID != "post" || view.Title == task.Title {
		t.Fatalf("transport authorization view: %+v", view)
	}
	e.SetTaskForum(false)
	e.resolveTaskThread(context.Background(), view)
	if view.ForumPost || view.ThreadID != "" {
		t.Fatal("disabled forum binding survived")
	}
}

func TestTaskForumLeadSwitchAlsoStopsWorker(t *testing.T) {
	lead, p, dir := forumRoutingEngine(t)
	worker := NewEngine("worker", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(worker.cancel)
	worker.team = &teamState{dir: dir, board: true}
	rm := NewRelayManager("")
	lead.SetRelayManager(rm)
	worker.SetRelayManager(rm)
	rm.RegisterEngine(lead.name, lead)
	rm.RegisterEngine(worker.name, worker)
	if !worker.taskForumEnabled() {
		t.Fatal("default changed")
	}
	lead.SetTaskForum(false)
	if worker.taskForumEnabled() {
		t.Fatal("worker ignored team switch")
	}
}

func TestTaskForumCountAppendsToExistingRoundup(t *testing.T) {
	e, _, dir := forumRoutingEngine(t)
	now := time.Now()
	returned := now.Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"等待问题","status":"在做","chat":"discord:111","paused":"11-15 00:00","pause_why":"等待用户答复：选择 A"}`+"\n"+`{"id":784,"what":"保留原收口事项","status":"已交回待验收","chat":"discord:111","reviewer":"lead","returned_at":"`+returned+`"}`+"\n")
	e.syncTaskForum()
	at, _ := time.Parse(time.RFC3339Nano, returned)
	job := &TimerJob{SessionKey: "discord:111", TaskReview: &taskReviewRef{Stage: "roundup", Hour: now, Items: []taskReviewRef{{Board: 784, ReturnedAt: at}}}}
	prepared, err := e.prepareTaskReview(job, now)
	if err != nil || prepared == nil {
		t.Fatalf("prepare existing roundup: %v %v", prepared, err)
	}
	if !strings.Contains(prepared.Prompt, "保留原收口事项") || !strings.Contains(prepared.Prompt, "等你拍板 1 件") {
		t.Fatal(prepared.Prompt)
	}
}

func TestTaskForumInitiallyWaitingKeepsFullQuestion(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	question := strings.Repeat("选A还是B？", 500)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"目标保持完整","status":"在做","chat":"discord:111","paused":"11-15 00:00","pause_why":"等待用户答复：`+question+`"}`+"\n")
	e.syncTaskForum()
	e.syncTaskForum()
	post := p.post("th1")
	if !strings.Contains(post.card, "完整问题见下方最新回复") || len(post.nodes) != 1 || !strings.Contains(post.nodes[0], question) || len(p.mentions) != 0 {
		t.Fatalf("initial pending question missing or mentioned: nodes=%d mentions=%v", len(post.nodes), p.mentions)
	}
}
