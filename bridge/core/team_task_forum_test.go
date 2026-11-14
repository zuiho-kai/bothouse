package core

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeForumPost struct {
	title, card, tag string
	archived         bool
	nodes            []string
}

type stubForumPlatform struct {
	stubPlatformEngine
	mu        sync.Mutex
	ensures   int
	opens     int
	posts     map[string]*fakeForumPost
	ensureErr error
	sendCtx   []string // permission notices posted (Send)
}

func newStubForumPlatform() *stubForumPlatform {
	return &stubForumPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, posts: map[string]*fakeForumPost{}}
}

func (p *stubForumPlatform) EnsureTaskForum(_ context.Context, chat, remembered string, tags []string) (TaskForum, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ensures++
	if p.ensureErr != nil {
		return TaskForum{}, p.ensureErr
	}
	ids := map[string]string{}
	for i, t := range tags {
		ids[t] = fmt.Sprintf("tag%d", i)
	}
	return TaskForum{ID: "forum1", GuildID: "g1", Tags: ids}, nil
}

func (p *stubForumPlatform) OpenTaskPost(_ context.Context, f TaskForum, post TaskForumPost) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.opens++
	id := fmt.Sprintf("th%d", p.opens)
	p.posts[id] = &fakeForumPost{title: post.Title, card: post.Card, tag: post.Tag}
	return id, nil
}

func (p *stubForumPlatform) UpdateTaskPost(_ context.Context, f TaskForum, id string, post TaskForumPost) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	fp := p.posts[id]
	if fp == nil {
		return errForumGone
	}
	fp.title, fp.card, fp.tag, fp.archived = post.Title, post.Card, post.Tag, post.Archived
	return nil
}

func (p *stubForumPlatform) PostTaskNode(_ context.Context, id, text string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if fp := p.posts[id]; fp != nil {
		fp.nodes = append(fp.nodes, text)
	}
	return nil
}

var errForumGone = fmt.Errorf("gone")

func (p *stubForumPlatform) TaskPostGone(err error) bool { return err == errForumGone }

func (p *stubForumPlatform) post(id string) fakeForumPost {
	p.mu.Lock()
	defer p.mu.Unlock()
	if fp := p.posts[id]; fp != nil {
		return *fp
	}
	return fakeForumPost{}
}

func forumTestEngine(t *testing.T) (*Engine, *stubForumPlatform, string) {
	t.Helper()
	p := newStubForumPlatform()
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true, inject: true}
	return e, p, dir
}

func TestTaskForumFollowsBoard(t *testing.T) {
	e, p, dir := forumTestEngine(t)
	notes := dir + "/h.handoff.md"
	writeTaskBoard(t, dir, "h.handoff.md", "# x\n\n## 用户原话\n- 「帖子功能，派了老忘」\n\n## 总目标\n派出去的活不再被忘\n\n## 范围\n- 改：a\n")
	item := func(extra string) string {
		return `{"id":768,"what":"Discord 任务帖子区：一件活一个帖子","short":"任务帖子区","where":"` + notes + `","status":"在做","who":"C酱","at":"11-14 15:19","sk":"discord:111","chat":"discord:111"` + extra + "}\n"
	}
	writeTaskBoard(t, dir, teamTaskBoardFile, item(""))
	e.syncTaskForum()
	if p.opens != 1 {
		t.Fatalf("opens = %d, want 1", p.opens)
	}
	fp := p.post("th1")
	if fp.title != "#768 任务帖子区" || fp.tag != TaskForumTagRunning {
		t.Fatalf("post = %+v", fp)
	}
	for _, want := range []string{"**在做**", "**要你做的**：没有", "派出去的活不再被忘", "> - 「帖子功能，派了老忘」", "来源 <#111>", "任务板 #768", "更新于"} {
		if !strings.Contains(fp.card, want) {
			t.Fatalf("card lacks %q:\n%s", want, fp.card)
		}
	}
	if len(fp.nodes) != 0 {
		t.Fatalf("opening posted nodes: %v", fp.nodes)
	}

	// Nothing changed: no edit (the card keeps its update time), no second post.
	before := fp.card
	e.syncTaskForum()
	if p.opens != 1 || p.post("th1").card != before {
		t.Fatalf("unchanged board edited/opened again: opens=%d", p.opens)
	}

	// [ask] pauses it waiting on the user: tag 等你拍板, the whole question in 要你做的, no node
	// (the [ask] text itself is posted where it is delivered).
	writeTaskBoard(t, dir, teamTaskBoardFile, item(`,"paused":"11-14 16:00","pause_why":"等待用户答复：帖子区放在哪个分类，A 工作区 B 新建"`))
	e.syncTaskForum()
	fp = p.post("th1")
	if fp.tag != TaskForumTagWaiting || !strings.Contains(fp.card, "**要你做的**：帖子区放在哪个分类，A 工作区 B 新建") || len(fp.nodes) != 0 {
		t.Fatalf("waiting post = %+v", fp)
	}

	// Resumed in a workspace: tag back to 在做 with one key-move line.
	writeTaskBoard(t, dir, teamTaskBoardFile, item(`,"ws":"discord:222"`))
	e.syncTaskForum()
	fp = p.post("th1")
	if fp.tag != TaskForumTagRunning || len(fp.nodes) != 1 || !strings.Contains(fp.nodes[0], "继续做") || !strings.Contains(fp.nodes[0], "<#222>") {
		t.Fatalf("resumed post = %+v", fp)
	}

	// Returned: 待验收, no extra node.
	writeTaskBoard(t, dir, teamTaskBoardFile, item(`,"status":"已交回待验收","returned_at":"2026-11-14T08:00:00Z","reviewer":"cjiang"`))
	e.syncTaskForum()
	fp = p.post("th1")
	if fp.tag != TaskForumTagReview || len(fp.nodes) != 1 {
		t.Fatalf("returned post = %+v", fp)
	}

	// Rejected: paused with the reason, one 退回 node.
	writeTaskBoard(t, dir, teamTaskBoardFile, item(`,"paused":"11-14 17:00","pause_why":"验收退回：截图缺换标签","review_rejected":"截图缺换标签"`))
	e.syncTaskForum()
	fp = p.post("th1")
	if fp.tag != TaskForumTagPaused || len(fp.nodes) != 2 || !strings.Contains(fp.nodes[1], "验收退回返工：截图缺换标签") {
		t.Fatalf("rejected post = %+v", fp)
	}

	// Done: off the board into board-done.jsonl → 完成, one node, not archived before the wait.
	writeTaskBoard(t, dir, teamTaskBoardFile, "")
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, item(`,"done_at":"11-14 18:00"`))
	e.syncTaskForum()
	fp = p.post("th1")
	if fp.tag != TaskForumTagDone || fp.archived || len(fp.nodes) != 3 || fp.nodes[2] != "✅ 已完成" {
		t.Fatalf("done post = %+v", fp)
	}
	// After the task-thread archive wait it is archived, once.
	e.taskForum.mu.Lock()
	e.taskForum.state.Posts["768"].DoneAt = time.Now().Add(-e.taskForumArchiveAfter() - time.Minute)
	e.taskForum.mu.Unlock()
	e.syncTaskForum()
	if fp = p.post("th1"); !fp.archived || fp.tag != TaskForumTagDone {
		t.Fatalf("archived post = %+v", fp)
	}

	// A new engine reads the state back: no second post for the same item.
	e2 := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e2.team = &teamState{dir: dir, board: true, inject: true}
	e2.syncTaskForum()
	if p.opens != 1 {
		t.Fatalf("restart opened again: opens=%d", p.opens)
	}
}

func TestTaskForumReportNodeAndSkips(t *testing.T) {
	e, p, dir := forumTestEngine(t)
	writeTaskBoard(t, dir, teamTaskBoardFile,
		`{"id":5,"what":"修登录","status":"在做","who":"G哥","at":"11-14 10:00","sk":"discord:111"}`+"\n"+
			`{"id":6,"what":"测试：探针","status":"在做","who":"G哥","at":"11-14 10:00","sk":"discord:111"}`+"\n"+
			`{"id":7,"what":"飞书的活","status":"在做","who":"G哥","at":"11-14 10:00","sk":"feishu:abc"}`+"\n")
	// A [report] delivered before the board pass opened the post opens it first, then posts.
	e.postTaskForumNode(5, "📬 修登录：已修好")
	if p.opens != 1 || len(p.post("th1").nodes) != 1 || p.post("th1").nodes[0] != "📬 修登录：已修好" {
		t.Fatalf("report node: opens=%d post=%+v", p.opens, p.post("th1"))
	}
	e.syncTaskForum()
	if p.opens != 1 {
		t.Fatalf("test work or a non-Discord item got a post: opens=%d", p.opens)
	}
}

func TestTaskForumMissingPermissionDoesNotBlock(t *testing.T) {
	e, p, dir := forumTestEngine(t)
	p.ensureErr = &MissingPermissionError{Perm: PermManageChannels, Hint: "缺管理频道", Err: fmt.Errorf("50013")}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":5,"what":"修登录","status":"在做","who":"G哥","at":"11-14 10:00","sk":"discord:111"}`+"\n")
	e.syncTaskForum()
	e.syncTaskForum()
	if p.opens != 0 || len(e.taskForum.state.Posts) != 0 {
		t.Fatalf("posted without permission: opens=%d", p.opens)
	}
	// once permission is there, the next pass opens the post
	p.ensureErr = nil
	e.syncTaskForum()
	if p.opens != 1 {
		t.Fatalf("permission granted, opens=%d", p.opens)
	}
}

func TestTaskForumTagOf(t *testing.T) {
	now := time.Now()
	cases := []struct {
		it   teamTaskBoardItem
		want string
	}{
		{teamTaskBoardItem{Status: "在做"}, TaskForumTagRunning},
		{teamTaskBoardItem{Status: "在做", Paused: "x", PauseWhy: "等待用户答复：选哪个"}, TaskForumTagWaiting},
		{teamTaskBoardItem{Status: "在做", Paused: "x", PauseWhy: "腾工作区"}, TaskForumTagPaused},
		{teamTaskBoardItem{Status: "已交回待验收", ReturnedAt: now}, TaskForumTagReview},
		{teamTaskBoardItem{Status: "等发布：#1771"}, TaskForumTagRelease},
		{teamTaskBoardItem{Status: "在做", Backlog: "x"}, TaskForumTagPaused},
		{teamTaskBoardItem{Status: "已完成"}, TaskForumTagDone},
	}
	for _, c := range cases {
		if got, _ := taskForumTagOf(c.it, now); got != c.want {
			t.Errorf("%+v: tag %q, want %q", c.it, got, c.want)
		}
	}
}
