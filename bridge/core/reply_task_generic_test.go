package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The reply background is core logic, not a Discord feature (user 10-30「我们这套应该通用化」).
// Most platforms give only the quoted message's id (and maybe its text), with no
// "[replying to …]" wrapper in the content; these tests run the whole path that way.

// sent → recorded → replied to → background, on a platform that is not Discord and gives only
// the quoted message's id and text (e.g. feishu).
func TestReplyTaskIDOnlyPlatformEndToEnd(t *testing.T) {
	const (
		wsKey   = "idonly:ws1:u1"
		chatKey = "idonly:chat1:u1"
	)
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &replyRecPlatform{exitTestPlatform: &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "idonly"}}}}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	team := t.TempDir()
	e.SetTeam(team, "橘", false)
	it := map[string]any{"id": 7, "what": "修登录掉线", "short": "修登录", "status": "改完待验", "who": "橘", "where": writeReplyTaskHandoff(t, team), "at": "10-29 10:00", "sk": "idonly:chat1", "ws": "idonly:ws1", "bound": "2026-10-29T02:00:00Z", "chat": "idonly:chat1"}
	b, _ := json.Marshal(it)
	writeTaskBoard(t, team, teamTaskBoardFile, string(b)+"\n")

	e.ReceiveMessage(p, &Message{SessionKey: wsKey, Platform: "idonly", ChannelID: "ws1", MessageID: "go", UserID: "human", UserName: "瑞凤", Content: "开工", Mentioned: true, ReplyCtx: wsKey})
	inputPrompt(t, ag)
	inputDone(ag, "[report] #7 背景：你让我做这件事。\n登录不再掉线了\n要你做的：没有。\n改了重连逻辑，已在本机验过")
	inputWait(t, func() bool { return len(p.sentTo("idonly:chat1")) == 1 })
	var postID, post string
	p.mu.Lock()
	for id, text := range p.ids {
		postID, post = id, text
	}
	p.mu.Unlock()
	if postID == "" || e.replyTaskBoard(postID) != 7 {
		t.Fatalf("report post %q not recorded under #7", postID)
	}

	e.ReceiveMessage(p, &Message{SessionKey: chatKey, Platform: "idonly", ChannelID: "chat1", MessageID: "r1", UserID: "human", UserName: "瑞凤", Content: "那顺便把注册也看看", Mentioned: true, ReplyCtx: chatKey,
		Reference: &MessageReference{ID: postID, Text: post}})
	got := inputPrompt(t, ag)
	inputDone(ag, "好")
	for _, want := range []string{"任务板 #7「修登录」", "总目标：\n- 登录不再掉线", "被回复的消息：", "改了重连逻辑", "那顺便把注册也看看"} {
		if !strings.Contains(got, want) {
			t.Fatalf("reply prompt missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, replyTaskQuoteNote) {
		t.Fatalf("no [replying to …] wrapper on this platform, the note must not point at one: %q", got)
	}
}

// A reply to a task card on Feishu: the card is found by Task.MessageID (EnsureTaskCard wrote
// it), with no extra recording; the platform fills only Reference.ID (parent_id).
func TestReplyToFeishuTaskCardBringsTask(t *testing.T) {
	e := &Engine{dataDir: t.TempDir()}
	dir := filepath.Join(e.dataDir, "public-progress", "p")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	rec := progressRecord{Platform: "feishu", Task: &Task{ID: "t-9", Title: "迁移报表", State: TaskStateInProgress, LatestProgress: "迁了两张表", MessageID: "om_card_1"}}
	raw, _ := json.Marshal(rec)
	if err := os.WriteFile(filepath.Join(dir, "t-9.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	msg := &Message{Platform: "feishu", SessionKey: "feishu:oc_1:u1", Content: "第三张也迁了吗", Reference: &MessageReference{ID: "om_card_1"}}
	e.noteReplyTaskOf(msg)
	if msg.Reference.task == nil || msg.Reference.task.card == nil || msg.Reference.task.card.ID != "t-9" {
		t.Fatal("feishu reply to a task card did not find the card by Task.MessageID")
	}
	s := &Session{}
	content := s.renderReference(msg.Content, msg.Reference)
	got := e.withTurnBlocksRef(s, msg.SessionKey, "", content, false, msg.Reference)
	for _, want := range []string{"任务卡 t-9「迁移报表」", "最近汇报：迁了两张表", "第三张也迁了吗"} {
		if !strings.Contains(got, want) {
			t.Fatalf("card reply missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, replyTaskQuoteNote) || strings.Contains(got, "被回复的消息") {
		t.Fatalf("id-only reference has no quote to point at: %q", got)
	}
}
