package qq

import (
	"strings"
	"testing"
)

// QQ confirms a mid-turn insert with a face on the person's message instead of
// the "↪ 已插入" line (user 2026-11-05「点表情可以考虑加上 回头可以加」). NapCat 4.18.42
// (实测 2026-11-06) takes set_msg_emoji_like in group chats and refuses it in
// private chats with result 65011 while still answering retcode 0 — so the
// private case must return an error (core then keeps the chat silent) and the
// group case must read the business result, not only the retcode.

func reactionGroupCtx(inMessageID string) any {
	return &replyContext{messageType: "group", groupID: 795722872, userID: 42, sessionKey: "qq:g:795722872", inMessageID: inMessageID}
}

func TestReactInsertReceiptCallsNapCatOnTheInboundMessage(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("set_msg_emoji_like", func(map[string]any) map[string]any {
		return map[string]any{"result": float64(0), "errMsg": ""}
	})
	p, _ := startTestPlatform(t, f)

	if err := p.ReactInsertReceipt(reactionGroupCtx("1619028717")); err != nil {
		t.Fatalf("ReactInsertReceipt: %v", err)
	}
	params := f.paramsOf("set_msg_emoji_like", 0)
	if got, _ := params["message_id"].(string); got != "1619028717" {
		t.Errorf("message_id = %q, want the inserted message's id", got)
	}
	if got, _ := params["emoji_id"].(string); got != insertReceiptEmoji {
		t.Errorf("emoji_id = %q, want %q", got, insertReceiptEmoji)
	}
	if _, ok := params["set"]; ok {
		t.Error("set must not be sent: NapCat defaults to adding the reaction")
	}
}

func TestReactInsertReceiptPrivateChatNotAttempted(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	rc := &replyContext{messageType: "private", userID: 42, sessionKey: "qq:42", inMessageID: "530169481"}

	err := p.ReactInsertReceipt(rc)
	if err == nil {
		t.Fatal("private chat must report a failure so core falls back to its silent rule")
	}
	if calls := f.record()["set_msg_emoji_like"]; len(calls) != 0 {
		t.Fatalf("private chat still called set_msg_emoji_like %d time(s)", len(calls))
	}
}

// NapCat answers retcode 0 and puts the real outcome in data: result 65011 means
// "操作失败，请稍后再试哦" (private chats, 实测 2026-11-06). A nil error here would
// silently drop the acknowledgement.
func TestReactInsertReceiptBusinessFailureIsAnError(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("set_msg_emoji_like", func(map[string]any) map[string]any {
		return map[string]any{"result": float64(65011), "errMsg": "操作失败，请稍后再试哦"}
	})
	p, _ := startTestPlatform(t, f)

	err := p.ReactInsertReceipt(reactionGroupCtx("1619028717"))
	if err == nil {
		t.Fatal("result 65011 must be a failure, not a delivered reaction")
	}
	if !strings.Contains(err.Error(), "65011") || !strings.Contains(err.Error(), "操作失败") {
		t.Fatalf("error = %q, want the upstream result and wording", err)
	}
}

func TestReactInsertReceiptWithoutInboundMessageID(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	rc := &replyContext{messageType: "group", groupID: 795722872, sessionKey: "qq:g:795722872"}

	if err := p.ReactInsertReceipt(rc); err == nil {
		t.Fatal("a proactive send has nothing to react to")
	}
	if calls := f.record()["set_msg_emoji_like"]; len(calls) != 0 {
		t.Fatalf("reacted without an inbound id %d time(s)", len(calls))
	}
	if err := p.ReactInsertReceipt("not a qq reply ctx"); err == nil {
		t.Fatal("foreign reply context must fail rather than react somewhere")
	}
}
