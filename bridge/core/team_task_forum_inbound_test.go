package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func writeForumReplyItem(t *testing.T, dir, file string, item teamTaskBoardItem) {
	t.Helper()
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	writeTaskBoard(t, dir, file, string(raw)+"\n")
}

func TestTaskForumReplyLookup(t *testing.T) {
	e, _, dir := forumTestEngine(t)
	state := taskForumState{Forums: map[string]TaskForum{"discord:g": {ID: "forum", GuildID: "g"}}, Posts: map[string]*taskForumPostState{"779": {Platform: "discord", Guild: "g", Thread: "post"}}}
	raw, _ := json.Marshal(state)
	if err := os.WriteFile(filepath.Join(dir, taskForumFile), raw, 0600); err != nil {
		t.Fatal(err)
	}
	writeForumReplyItem(t, dir, teamTaskBoardFile, teamTaskBoardItem{ID: 779, Chat: "discord:source"})
	for _, tc := range []struct {
		name, guild, parent, thread string
		known                       bool
	}{
		{"mapped", "g", "forum", "post", true},
		{"wrong parent", "g", "other", "post", false},
		{"wrong guild", "other", "forum", "post", false},
		{"unmapped title", "g", "forum", "#779 reply", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, known := e.ResolveTaskForumReply("discord", tc.guild, tc.parent, tc.thread)
			if known != tc.known {
				t.Fatalf("known=%v", known)
			}
			if known && (r == nil || r.Board != 779 || r.Chat != "discord:source") {
				t.Fatalf("route=%+v", r)
			}
		})
	}
	e.team.inject = false
	if r, known := e.ResolveTaskForumReply("discord", "g", "forum", "post"); !known || r != nil {
		t.Fatalf("secondary must consume without replying: %+v %v", r, known)
	}
	writeTaskBoard(t, dir, teamTaskBoardFile, "")
	writeForumReplyItem(t, dir, teamTaskBoardDoneFile, teamTaskBoardItem{ID: 779, Chat: "discord:source", DoneAt: "11-14 23:00"})
	e.team.inject = true
	if r, _ := e.ResolveTaskForumReply("discord", "g", "forum", "post"); r == nil || r.Chat != "discord:source" {
		t.Fatalf("completed route=%+v", r)
	}
}

type forumReplySink struct {
	*inputTestPlatform
	mu      sync.Mutex
	targets []any
}

func (p *forumReplySink) Reply(ctx context.Context, rc any, text string) error {
	return p.Send(ctx, rc, text)
}
func (p *forumReplySink) Send(ctx context.Context, rc any, text string) error {
	p.mu.Lock()
	p.targets = append(p.targets, rc)
	p.mu.Unlock()
	return p.inputTestPlatform.Send(ctx, rc, text)
}

// This journey proves transport, conversation continuity and visible receipts.
// Command understanding remains the real model's responsibility.
func TestCUJ_TaskForum1_ReplyUsesSourceConversationAndPostReceipt(t *testing.T) {
	_, e, a, base, session := inputFixture(t)
	p := &forumReplySink{inputTestPlatform: base}
	dir := t.TempDir()
	e.team = &teamState{dir: dir, inject: true}
	e.SetGateLocal(true)
	cases := []struct {
		name, text, want string
		item             teamTaskBoardItem
	}{
		{"waiting answer", "选A继续", "等待用户确认：选择方案A还是B", teamTaskBoardItem{Paused: "yes", PauseWhy: "等待用户确认：选择方案A还是B"}},
		{"running supplement", "加上失败回执", "ws-forward --id 779", teamTaskBoardItem{WS: "discord:workspace"}},
		{"pause resume close", "暂停", "board pause 779 / board resume 779 / board done 779", teamTaskBoardItem{WS: "discord:workspace"}},
		{"completed rework", "这里再改一下", "返工", teamTaskBoardItem{DoneAt: "11-14 23:00"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			it := tc.item
			it.ID, it.What, it.Who, it.Chat, it.Status = 779, "任务帖对接", "worker", inputTestKey, "在做"
			file := teamTaskBoardFile
			if it.DoneAt != "" {
				file = teamTaskBoardDoneFile
				writeTaskBoard(t, dir, teamTaskBoardFile, "")
			}
			writeForumReplyItem(t, dir, file, it)
			msg := &Message{SessionKey: "discord:post", ChannelID: "post", Platform: "discord", UserID: "human", Content: tc.text, ReplyCtx: "post-delivery", TaskForum: &TaskForumReply{Board: 779, Thread: "post"}}
			e.ReceiveMessage(p, msg)
			prompt := inputPrompt(t, a)
			for _, want := range []string{tc.text, tc.want, "这是任务帖 #779", "命令失败说清原始原因"} {
				if !strings.Contains(prompt, want) {
					t.Fatalf("missing %q in prompt %s", want, prompt)
				}
			}
			if msg.SessionKey != inputTestKey || msg.ChannelKey != "voice-channel" || msg.ReplyCtx != "post-delivery" {
				t.Fatalf("bad route: %+v", msg)
			}
			inputDone(a, "receipt-"+tc.name)
			inputWait(t, func() bool { return !session.Busy() })
		})
	}
	visible := strings.Join(p.getSent(), "\n")
	for _, tc := range cases {
		if !strings.Contains(visible, "receipt-"+tc.name) {
			t.Fatalf("missing receipt %s: %s", tc.name, visible)
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, target := range p.targets {
		if target != "post-delivery" {
			t.Fatalf("receipt escaped post: %v", target)
		}
	}
}

func TestTaskForumReplyFactsQuestionAndReentry(t *testing.T) {
	e, p, dir := forumTestEngine(t)
	writeForumReplyItem(t, dir, teamTaskBoardFile, teamTaskBoardItem{ID: 779, Chat: "discord:source", Paused: "yes", PauseWhy: "等待用户：choose"})
	e.teamExit.asks = map[string]*teamAsk{"ask": {Board: 779, At: time.Now(), Forwarded: []string{"原始完整问题", "两个选项"}}}
	e.teamExit.loaded = true
	msg := &Message{TaskForum: &TaskForumReply{Board: 779, Thread: "post"}, ReplyCtx: "post"}
	if !e.prepareTaskForumReply(p, msg) {
		t.Fatal("not prepared")
	}
	before := msg.ExtraContent
	if !strings.Contains(before, "原始完整问题\n两个选项") {
		t.Fatal(before)
	}
	if !e.prepareTaskForumReply(p, msg) || before != msg.ExtraContent {
		t.Fatal("queue reentry duplicated task facts")
	}
	msg.FromBot = true
	if e.prepareTaskForumReply(p, msg) {
		t.Fatal("bot accepted")
	}
}
