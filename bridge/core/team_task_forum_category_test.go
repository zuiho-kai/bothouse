package core

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

func readForumTestState(t *testing.T, e *Engine) taskForumState {
	t.Helper()
	raw, err := os.ReadFile(e.taskForumPath())
	if err != nil {
		t.Fatal(err)
	}
	var state taskForumState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func categoryTestRows(chats ...string) string {
	rows := ""
	for i, chat := range chats {
		rows += `{"id":` + strconv.Itoa(i+1) + `,"what":"类别任务","status":"在做","chat":"discord:` + chat + `","paused":"11-15 00:00","pause_why":"等待用户：选 A 或 B"}` + "\n"
	}
	return rows
}

func TestTaskForumCategorySharingIsolationAndConcurrentRestart(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	p.scopes = map[string]TaskForum{
		"111": {ID: "forumA", GuildID: "g1", CategoryID: "A"},
		"112": {ID: "forumA", GuildID: "g1", CategoryID: "A"},
		"222": {ID: "forumB", GuildID: "g1", CategoryID: "B"},
	}
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("111", "112", "222"))
	var runs sync.WaitGroup
	for range []string{"first", "concurrent"} {
		runs.Add(1)
		go func() { defer runs.Done(); e.syncTaskForum() }()
	}
	runs.Wait()
	s := readForumTestState(t, e)
	if p.opens != 3 || p.ensures != 2 || len(s.Forums) != 2 {
		t.Fatalf("opens=%d ensures=%d forums=%+v", p.opens, p.ensures, s.Forums)
	}
	if s.Posts["1"].Forum != "forumA" || s.Posts["2"].Forum != "forumA" || s.Posts["3"].Forum != "forumB" {
		t.Fatalf("wrong placement: %+v", s.Posts)
	}
	for _, tc := range []struct{ chat, count, forum string }{{"111", "2", "forumA"}, {"112", "2", "forumA"}, {"222", "1", "forumB"}} {
		summary := e.taskForumWaitingSummary("discord:"+tc.chat, time.Now())
		if !strings.Contains(summary, "等你拍板 "+tc.count+" 件") || !strings.Contains(summary, "/g1/"+tc.forum) {
			t.Fatal(summary)
		}
	}
	for id, post := range s.Posts {
		r, known := e.ResolveTaskForumReply("discord", "g1", post.Forum, post.Thread)
		if !known || r == nil || strconv.Itoa(r.Board) != id || r.Chat != post.Chat {
			t.Fatalf("reply %s: %+v %v", id, r, known)
		}
		if _, known := e.ResolveTaskForumReply("discord", "g1", "unmanaged", post.Thread); known {
			t.Fatal("wrong parent accepted")
		}
	}
	// Restart the mapping runtime against the same persisted file. No new posts.
	taskForumRuntimes.Delete(dir)
	e.syncTaskForum()
	if p.opens != 3 {
		t.Fatalf("restart duplicated posts: %d", p.opens)
	}
}

func TestTaskForumUncategorizedNoticeAndRecovery(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	p.scopes = map[string]TaskForum{"111": {GuildID: "g1"}}
	rows := categoryTestRows("111", "111")
	writeTaskBoard(t, dir, team.TaskBoardFile, rows)
	e.syncTaskForum()
	e.syncTaskForum()
	if p.opens != 0 || p.ensures != 0 || len(p.getSent()) != 1 {
		t.Fatalf("uncategorized: opens=%d ensures=%d notices=%v", p.opens, p.ensures, p.getSent())
	}
	if !strings.Contains(p.getSent()[0], "先") && !strings.Contains(p.getSent()[0], "频道设置") {
		t.Fatal(p.getSent())
	}
	raw, _ := os.ReadFile(dir + "/" + team.TaskBoardFile)
	if string(raw) != rows {
		t.Fatal("uncategorized task board changed")
	}
	taskForumRuntimes.Delete(dir)
	e.syncTaskForum()
	if len(p.getSent()) != 1 {
		t.Fatal("restart repeated category notice")
	}
	p.scopes["111"] = TaskForum{ID: "forumA", GuildID: "g1", CategoryID: "A"}
	e.syncTaskForum()
	if p.opens != 2 || readForumTestState(t, e).CategoryNotices["discord:111"] {
		t.Fatal("classification did not resume pending posts")
	}
}

func TestTaskForumMovedChatPreservesOldPostAndSource(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	p.scopes = map[string]TaskForum{"111": {ID: "forumA", GuildID: "g1", CategoryID: "A"}, "112": {ID: "forumA", GuildID: "g1", CategoryID: "A"}}
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("111"))
	e.syncTaskForum()
	old := *readForumTestState(t, e).Posts["1"]
	p.scopes["111"] = TaskForum{ID: "forumB", GuildID: "g1", CategoryID: "B"}
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("111", "111"))
	e.syncTaskForum()
	s := readForumTestState(t, e)
	if s.Posts["1"].Thread != old.Thread || s.Posts["1"].Forum != "forumA" || s.Posts["2"].Forum != "forumB" || p.opens != 2 {
		t.Fatal("chat move relocated old task")
	}
	for _, chat := range []string{"111", "112"} {
		if summary := e.taskForumWaitingSummary("discord:"+chat, time.Now()); !strings.Contains(summary, "等你拍板 1 件") {
			t.Fatal(summary)
		}
	}
	// Released/relocated board placement must not replace the saved source chat.
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("changed", "111"))
	r, known := e.ResolveTaskForumReply("discord", "g1", "forumA", old.Thread)
	if !known || r == nil || r.Chat != "discord:111" {
		t.Fatalf("source drift: %+v", r)
	}
	msg := &Message{TaskForum: r, ReplyCtx: "forumA-receipt"}
	if !e.prepareTaskForumReply(p, msg) || msg.SessionKey != "discord:111" || msg.ReplyCtx != "forumA-receipt" {
		t.Fatalf("prepared route: %+v", msg)
	}
	// The stable saved source also survives a board row with no current placement.
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1,"what":"类别任务","status":"在做"}`+"\n")
	r, _ = e.ResolveTaskForumReply("discord", "g1", "forumA", old.Thread)
	msg = &Message{TaskForum: r, ReplyCtx: "forumA-receipt"}
	if r == nil || !e.prepareTaskForumReply(p, msg) || msg.SessionKey != "discord:111" {
		t.Fatalf("saved source rejected after placement cleared: %+v", msg)
	}
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("changed", "111"))
	// Removing the source category does not make the old post unusable.
	p.scopes["111"] = TaskForum{GuildID: "g1"}
	e.syncTaskForum()
	if p.opens != 2 || readForumTestState(t, e).Posts["1"].Forum != "forumA" {
		t.Fatal("old post lost after unclassification")
	}
}

func TestTaskForumDeletedPostParentAfterRestart(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("111"))
	e.syncTaskForum()
	old := readForumTestState(t, e).Posts["1"].Thread
	p.mu.Lock()
	delete(p.posts, old)
	p.mu.Unlock()
	taskForumRuntimes.Delete(dir)
	e.syncTaskForum()
	if readForumTestState(t, e).Posts["1"] != nil {
		t.Fatal("confirmed deletion left stale post identity after parent lookup")
	}
	e.syncTaskForum()
	if post := readForumTestState(t, e).Posts["1"]; post == nil || post.Thread == old || p.opens != 2 {
		t.Fatal("explicit-deletion recovery did not recreate on the next sync")
	}
}

func TestTaskForumLegacyMapKeepsOriginalForumAndArchive(t *testing.T) {
	e, p, dir := forumRoutingEngine(t)
	writeTaskBoard(t, dir, team.TaskBoardFile, categoryTestRows("111"))
	e.syncTaskForum()
	s := readForumTestState(t, e)
	post := s.Posts["1"]
	// Serialize the exact old format: server key, post without forum/source fields.
	f := s.Forums["discord:g1:cat1"]
	f.CategoryID = ""
	s.Forums = map[string]TaskForum{"discord:g1": f}
	s.Chats["discord:111"] = "discord:g1"
	post.Forum, post.Chat = "", ""
	raw, _ := json.Marshal(s)
	if err := os.WriteFile(e.taskForumPath(), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	taskForumRuntimes.Delete(dir)
	// Source now belongs elsewhere, but the old post stays in forum1.
	p.scopes = map[string]TaskForum{"111": {ID: "forumB", GuildID: "g1", CategoryID: "B"}}
	e.syncTaskForum()
	got := readForumTestState(t, e)
	if p.opens != 1 || got.Posts["1"].Forum != "forum1" || got.Posts["1"].Chat != "discord:111" || got.Forums["discord:g1"].ID != "forum1" {
		t.Fatalf("legacy mapping replaced: %+v", got)
	}
	r, known := e.ResolveTaskForumReply("discord", "g1", "forum1", post.Thread)
	if !known || r == nil || r.Chat != "discord:111" {
		t.Fatal("legacy post no longer replies")
	}
	rt := e.taskForumRT()
	rt.mu.Lock()
	state := e.taskForumLoadLocked()
	archived := e.taskForumArchiveLocked(state, teamTaskBoardItem{ID: 1}, state.Posts["1"], time.Now())
	rt.mu.Unlock()
	if !archived || !p.post(post.Thread).archived {
		t.Fatal("legacy post did not archive")
	}
}
