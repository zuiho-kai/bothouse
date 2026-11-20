package feishu

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// fakeFeishuGroups: four named groups (two share a name) and oc_p2p, a chat without a name that
// GET im/v1/chats/oc_p2p reports as a private chat.
func fakeFeishuGroups() *fakeFeishuIM {
	f := newFakeFeishuIM()
	f.chatPages = [][]map[string]any{
		{{"chat_id": "oc_chat", "name": "量化群"}, {"chat_id": "oc_talk", "name": "闲聊"}},
		{{"chat_id": "oc_dup1", "name": "周报"}, {"chat_id": "oc_dup2", "name": "周报"}, {"chat_id": "oc_p2p", "chat_mode": "p2p"}},
	}
	return f
}

// `bothouse send --channel <名字>` on Feishu, through the core flow the send API uses.
func TestFeishuSendChannelByName(t *testing.T) {
	p := newFakeFeishuPlatform(t, fakeFeishuGroups())
	e := core.NewEngine("test", nil, []core.Platform{p}, "", core.LangEnglish)

	// One group with that name, on the second page, asked from a private chat: its session key.
	key, ch, err := e.ChannelSessionByName("feishu:oc_p2p:ou_user", "#闲聊")
	if err != nil || key != "feishu:oc_talk" || ch.ID != "oc_talk" || ch.Name != "闲聊" {
		t.Fatalf("unique name = %q, %+v, %v", key, ch, err)
	}
	if rc, err := p.ReconstructReplyCtx(key); err != nil || rc.(replyContext).chatID != "oc_talk" {
		t.Fatalf("session key %q does not reconstruct: %+v, %v", key, rc, err)
	}

	// Two groups with that name: nothing is picked, both are listed.
	_, _, err = e.ChannelSessionByName("feishu:oc_chat:ou_user", "周报")
	if err == nil || !strings.Contains(err.Error(), "oc_dup1") || !strings.Contains(err.Error(), "oc_dup2") {
		t.Fatalf("duplicate name error = %v", err)
	}

	// No such group: an error with the near names, or none at all.
	_, _, err = e.ChannelSessionByName("feishu:oc_chat:ou_user", "量化")
	if err == nil || !strings.Contains(err.Error(), "没有叫「量化」的频道") || !strings.Contains(err.Error(), "oc_chat") {
		t.Fatalf("near name error = %v", err)
	}
	_, _, err = e.ChannelSessionByName("feishu:oc_chat:ou_user", "不存在")
	if err == nil || !strings.Contains(err.Error(), "没有叫「不存在」的频道") || strings.Contains(err.Error(), "oc_") || strings.Contains(err.Error(), "本服务器") {
		t.Fatalf("missing name error = %v", err)
	}
}

func TestFeishuResolveChannelName(t *testing.T) {
	p := newFakeFeishuPlatform(t, fakeFeishuGroups())
	if name, err := p.ResolveChannelName("oc_talk"); err != nil || name != "闲聊" {
		t.Fatalf("group name = %q, %v", name, err)
	}
	// A private chat has no name: the ID comes back, and the send echo then says nothing.
	if name, err := p.ResolveChannelName("oc_p2p"); err != nil || name != "oc_p2p" {
		t.Fatalf("private chat name = %q, %v", name, err)
	}
	// The channel key core has for a topic of a group names the group.
	if name, err := p.ResolveChannelName("oc_chat:topic:om_root"); err != nil || name != "量化群" {
		t.Fatalf("topic channel key name = %q, %v", name, err)
	}
	if name := p.resolveChatName("oc_talk"); name != "闲聊" {
		t.Fatalf("inbound chat name after caching = %q", name)
	}
}

func TestFeishuCronReplyTargetOpensTopicPerRun(t *testing.T) {
	f := fakeFeishuGroups()
	p := newFakeFeishuPlatform(t, f)

	// thread_isolation off: core replies in the job's own session.
	if _, _, err := p.ResolveCronReplyTarget("feishu:oc_chat:ou_user", "日报"); !errors.Is(err, core.ErrNotSupported) {
		t.Fatalf("thread_isolation off: err = %v", err)
	}
	p.threadIsolation = true
	// A private chat is never isolated by topic.
	if _, _, err := p.ResolveCronReplyTarget("feishu:oc_p2p:ou_user", "日报"); !errors.Is(err, core.ErrNotSupported) {
		t.Fatalf("private chat: err = %v", err)
	}
	if len(f.creates) != 0 {
		t.Fatalf("messages posted without a topic to open: %v", f.creates)
	}

	// A job made inside a topic: the run title goes to the group as a new message, and the run
	// answers in that message's topic.
	key, rctx, err := p.ResolveCronReplyTarget("feishu:oc_chat:root:om_old", "每天 9 点\n发日报")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.creates) != 1 || f.creates[0]["receive_id"] != "oc_chat" || f.creates[0]["content"] != `{"text":"每天 9 点 发日报"}` {
		t.Fatalf("root message = %v", f.creates)
	}
	rootID := f.byUUID[f.creates[0]["uuid"].(string)]
	rc := rctx.(replyContext)
	if key != "feishu:oc_chat:root:"+rootID || rc.chatID != "oc_chat" || rc.messageID != rootID || rc.sessionKey != key {
		t.Fatalf("target = %q, %+v (root %s)", key, rc, rootID)
	}
	if err := p.Send(context.Background(), rctx, "日报正文"); err != nil {
		t.Fatal(err)
	}
	if len(f.replies) != 1 || f.replies[0]["root"] != rootID || f.replies[0]["reply_in_thread"] != true {
		t.Fatalf("run output = %v", f.replies)
	}

	// The next run gets a topic of its own.
	key2, _, err := p.ResolveCronReplyTarget("feishu:oc_chat:root:om_old", "每天 9 点\n发日报")
	if err != nil || key2 == key || len(f.creates) != 2 {
		t.Fatalf("second run = %q, %v, %d root messages", key2, err, len(f.creates))
	}
}
