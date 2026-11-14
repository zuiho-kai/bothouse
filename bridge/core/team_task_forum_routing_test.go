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
	legacyCards int
	mentions    []string
	failSend    bool
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
func (p *forumRoutingPlatform) PublishTaskFact(context.Context, *Task, TaskEvent, Language) error {
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
func TestTaskForumExitRequiresDeliveredPost(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":783,"what":"任务并帖","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
	body := "📬 结果\n\n完整报告"
	text, rc := e.taskForumExitText(context.Background(), p, "discord:222", 783, body)
	if rc != "discord:th1" || !strings.Contains(text, "https://discord.com/channels/g1/th1/th1") || len(p.post("th1").nodes) != 1 || p.post("th1").nodes[0] != body {
		t.Fatalf("text=%s rc=%v post=%+v", text, rc, p.post("th1"))
	}
	p.failSend = true
	text, rc = e.taskForumExitText(context.Background(), p, "discord:222", 783, body)
	if rc != nil || text != body {
		t.Fatal("failed send hid the report behind a link")
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
			want := 0
			if dispatcher == "123" {
				want = 1
			}
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
	e, _, dir := forumRoutingEngine(t)
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
