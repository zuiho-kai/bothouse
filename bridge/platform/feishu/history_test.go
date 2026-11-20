package feishu

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"testing"
)

// listHistory answers「获取会话历史消息」the way the document describes it: newest first when
// asked, end_time in seconds, page_size per page, page_token = where the next page starts.
func (f *fakeFeishuIM) listHistory(q url.Values) map[string]any {
	f.listQueries = append(f.listQueries, q)
	all := f.history[q.Get("container_id")]
	var msgs []map[string]any // newest first
	for i := len(all) - 1; i >= 0; i-- {
		ms, _ := strconv.ParseInt(all[i]["create_time"].(string), 10, 64)
		if end := q.Get("end_time"); end != "" {
			if sec, _ := strconv.ParseInt(end, 10, 64); ms/1000 > sec {
				continue
			}
		}
		msgs = append(msgs, all[i])
	}
	start, _ := strconv.Atoi(q.Get("page_token"))
	size, _ := strconv.Atoi(q.Get("page_size"))
	end := min(start+size, len(msgs))
	data := map[string]any{"items": msgs[min(start, len(msgs)):end], "has_more": end < len(msgs)}
	if end < len(msgs) {
		data["page_token"] = strconv.Itoa(end)
	}
	return data
}

// historyItem is one message as the history API returns it. Message n is created n*400 ms after
// the first, so several share a second.
func historyItem(id string, n int, senderType, senderID, msgType, content string) map[string]any {
	return map[string]any{
		"message_id": id, "msg_type": msgType, "create_time": strconv.Itoa(1700000000000 + n*400),
		"sender": map[string]any{"id": senderID, "sender_type": senderType},
		"body":   map[string]any{"content": content},
	}
}

func textBody(s string) string { return fmt.Sprintf(`{"text":%q}`, s) }

func TestFeishuChannelHistoryPagesNewestFirstUpToLimit(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	// IDs fall as time rises: the order must come from create_time, not from the ID.
	var msgs []map[string]any
	for n := 0; n < 120; n++ {
		msgs = append(msgs, historyItem(fmt.Sprintf("om_%03d", 999-n), n, "user", "ou_u", "text", textBody(fmt.Sprintf("第%d条", n))))
	}
	f.history = map[string][]map[string]any{"oc_chat": msgs}

	got, err := p.ChannelHistory("oc_chat", "", 70)
	if err != nil {
		t.Fatalf("ChannelHistory: %v", err)
	}
	if len(got) != 70 || got[0].Content != "第50条" || got[69].Content != "第119条" {
		t.Fatalf("want the newest 70 oldest first, got %d: first %q last %q", len(got), got[0].Content, got[len(got)-1].Content)
	}
	for i := 1; i < len(got); i++ {
		if !got[i].Time.After(got[i-1].Time) {
			t.Fatalf("message %d is not after the one before it", i)
		}
	}
	if len(f.listQueries) != 2 {
		t.Fatalf("want 2 pages read, got %d", len(f.listQueries))
	}
	q1, q2 := f.listQueries[0], f.listQueries[1]
	if q1.Get("container_id_type") != "chat" || q1.Get("sort_type") != "ByCreateTimeDesc" || q1.Get("page_size") != "50" || q1.Get("page_token") != "" {
		t.Fatalf("first page query = %v", q1)
	}
	if q2.Get("page_size") != "20" || q2.Get("page_token") != "50" {
		t.Fatalf("second page query = %v", q2)
	}

	// Before message 100 (om_899): messages 95..99, though 100 and 101 share its second.
	f.listQueries = nil
	got, err = p.ChannelHistory("oc_chat", "om_899", 5)
	if err != nil {
		t.Fatalf("ChannelHistory before: %v", err)
	}
	if len(got) != 5 || got[0].Content != "第95条" || got[4].Content != "第99条" {
		t.Fatalf("want messages 95..99, got %d: %+v", len(got), got)
	}
	if f.listQueries[0].Get("end_time") == "" {
		t.Fatalf("before a message must set end_time: %v", f.listQueries[0])
	}

	if !p.MessageAfter("om_899", "om_900") || p.MessageAfter("om_900", "om_899") || p.MessageAfter("om_899", "om_899") {
		t.Fatal("MessageAfter must follow create_time: om_899 (message 100) is after om_900 (message 99)")
	}
}

func TestFeishuChannelHistoryBeforeUnseenMessageLooksItUp(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	f.history = map[string][]map[string]any{"oc_chat": {
		historyItem("om_a", 0, "user", "ou_u", "text", textBody("早")),
		historyItem("om_b", 10, "user", "ou_u", "text", textBody("晚")),
	}}
	got, err := p.ChannelHistory("oc_chat", "om_b", 50)
	if err != nil || len(got) != 1 || got[0].ID != "om_a" {
		t.Fatalf("want only om_a before om_b, got %+v, %v", got, err)
	}
	if _, err := p.ChannelHistory("oc_chat", "om_missing", 50); err == nil {
		t.Fatal("a message whose time cannot be read must fail the read, not return the whole chat")
	}
}

func TestFeishuChannelHistoryMarksAgentReplies(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	p.peerBots = map[string]string{"cli_peer": "龙娘"}
	p.loadTurnSent(map[string]any{"cc_data_dir": t.TempDir(), "cc_project": "maomao"})
	ctx := context.Background()

	var recorded []string
	rc := p.MarkSessionAgentReply(replyContext{chatID: "oc_chat"}, func(id string) { recorded = append(recorded, id) })
	if err := p.Send(ctx, rc, "side session 的定时输出"); err != nil { // not marked: a cron side session
		t.Fatalf("Send unmarked: %v", err)
	}
	if err := p.Send(ctx, p.MarkAgentReply(rc), "agent 自己的回答"); err != nil {
		t.Fatalf("Send marked: %v", err)
	}
	if len(f.creates) != 2 {
		t.Fatalf("want 2 messages sent, got %d", len(f.creates))
	}
	const plain, agent = "om_b", "om_c" // the fake's first two message ids
	if len(recorded) != 1 || recorded[0] != agent {
		t.Fatalf("session recorder got %v, want only %s", recorded, agent)
	}

	f.history = map[string][]map[string]any{"oc_chat": {
		historyItem("om_u", 0, "user", "ou_u", "text", textBody("@_user_1 看一下")),
		historyItem(plain, 1, "app", p.appID, "text", textBody("side session 的定时输出")),
		historyItem(agent, 2, "app", p.appID, "text", textBody("agent 自己的回答")),
		historyItem("om_p", 3, "app", "cli_peer", "interactive", `{"schema":"2.0","body":{"elements":[{"tag":"markdown","content":"龙娘的卡片回答"}]}}`),
		historyItem("om_s", 4, "", "", "system", `{"template":"{from_user} invited {to_chatters}"}`),
		historyItem("om_i", 5, "user", "ou_u", "image", `{"image_key":"img_1"}`),
	}}
	f.history["oc_chat"][0]["mentions"] = []map[string]any{{"key": "@_user_1", "id": "ou_bot", "name": "橘"}}
	f.history["oc_chat"] = append(f.history["oc_chat"], historyItem("om_d", 6, "user", "ou_u", "text", textBody("撤回的")))
	f.history["oc_chat"][6]["deleted"] = true

	got, err := p.ChannelHistory("oc_chat", "", 50)
	if err != nil {
		t.Fatalf("ChannelHistory: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("want 5 messages (system notice and recalled post left out), got %d: %+v", len(got), got)
	}
	user, own, mine, peer, img := got[0], got[1], got[2], got[3], got[4]
	if user.IsBot || user.IsSelf || user.FromTurn || user.Content != "@橘 看一下" || len(user.MentionIDs) != 1 || user.MentionIDs[0] != "ou_bot" || user.AuthorID != "ou_u" {
		t.Fatalf("user message = %+v", user)
	}
	if !own.IsSelf || !own.IsBot || own.FromTurn {
		t.Fatalf("this bot's unmarked post must be its own but not agent output: %+v", own)
	}
	if !mine.IsSelf || !mine.FromTurn {
		t.Fatalf("this bot's agent reply must be marked FromTurn: %+v", mine)
	}
	if !peer.IsBot || peer.IsSelf || peer.FromTurn || peer.Author != "龙娘" || peer.Content != "龙娘的卡片回答" {
		t.Fatalf("peer bot card = %+v", peer)
	}
	if img.Content != "[image]" {
		t.Fatalf("image message = %+v", img)
	}

	// The mark survives a restart: a new platform reads the same log.
	p2 := newFakeFeishuPlatform(t, f)
	p2.loadTurnSent(map[string]any{"cc_data_dir": filepath.Dir(p.turnSent.path), "cc_project": "maomao"})
	if !p2.turnSent.has(agent) || p2.turnSent.has(plain) {
		t.Fatal("agent-post log not read back after restart")
	}
}

func TestFeishuPreviewStartMarksAgentReply(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	p.useInteractiveCard = true
	h, err := p.SendPreviewStart(context.Background(), p.MarkAgentReply(replyContext{chatID: "oc_chat"}), "正在想")
	if err != nil {
		t.Fatalf("SendPreviewStart: %v", err)
	}
	if id := h.(*feishuPreviewHandle).messageID; !p.turnSent.has(id) {
		t.Fatalf("preview message %s carries agent text and must be marked", id)
	}
}

func TestFeishuChannelHistoryEmptyChat(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	got, err := p.ChannelHistory("oc_empty", "", 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("empty chat: got %+v, %v", got, err)
	}
	if len(f.listQueries) != 1 {
		t.Fatalf("want 1 request for an empty chat, got %d", len(f.listQueries))
	}
}
