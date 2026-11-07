package qq

import (
	"context"
	"strings"
	"testing"
)

// The original predates this bridge process: no quote cache is populated.
func TestQuoteCacheMissFetchesOriginal(t *testing.T) {
	for _, format := range []string{"array", "string", "raw_message"} {
		t.Run(format, func(t *testing.T) {
			f := newFakeOneBot(t)
			f.on("get_msg", func(params map[string]any) map[string]any {
				return map[string]any{"message_id": 4242, "message_type": "group", "group_id": 111, "sender": map[string]any{"user_id": 2003, "nickname": "原作者", "card": "群名片"}, "message": []any{textSegment("重启前的原文")}}
			})
			_, msgs := startTestPlatform(t, f)
			event := groupMessage(111, 2001, 102, replySegment("4242"), textSegment("看看这条"))
			if format == "string" {
				event["message"] = "[CQ:reply,id=4242]看看这条"
			}
			if format == "raw_message" {
				delete(event, "message")
				event["raw_message"] = "[CQ:reply,id=4242]看看这条"
			}
			f.push(event)
			m := awaitMessage(t, msgs)
			if !strings.Contains(m.ExtraContent, "群名片：重启前的原文") || m.Mentioned {
				t.Fatalf("quoted author and original must reach model context: Mentioned=%v ExtraContent=%q", m.Mentioned, m.ExtraContent)
			}
		})
	}
}

func TestQuoteOriginalFormatsAndScope(t *testing.T) {
	for _, tc := range []struct {
		name, kind, chat string
		message          any
		group, author    int64
		inbound, reject  bool
	}{
		{"group array", "group", "g:111", []any{textSegment("原文 &amp;")}, 111, 2003, false, false},
		{"group CQ", "group", "g:111", "原文 &amp;[CQ:image,file=x]", 111, 2003, false, false},
		{"private", "private", "u:2003", "原文", 0, 2003, false, false},
		{"other group", "group", "g:111", "原文", 222, 2003, false, true},
		{"other private peer", "private", "u:2001", "原文", 0, 2003, false, true},
		{"wrong conversation kind", "private", "g:111", "原文", 0, 2003, true, true},
		{"outbound missing group", "group", "g:111", "原文", 0, 2003, false, true},
		{"inbound standard OneBot", "group", "g:111", "原文", 0, 2003, true, false},
		{"outbound self without peer", "private", "u:2003", "原文", 0, botUserID, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeOneBot(t)
			f.on("get_msg", func(map[string]any) map[string]any {
				return map[string]any{"message_id": 4242, "message_type": tc.kind, "group_id": tc.group, "sender": map[string]any{"user_id": tc.author, "nickname": "原作者"}, "message": tc.message}
			})
			p, _ := startTestPlatform(t, f)
			entry, err := p.resolveQuote(context.Background(), "4242", tc.chat, tc.inbound)
			if (err != nil) != tc.reject {
				t.Fatalf("entry=%+v error=%v reject=%v", entry, err, tc.reject)
			}
			if err == nil && (entry.name != "原作者" || !strings.HasPrefix(entry.content, "原文") || entry.chat != tc.chat) {
				t.Fatalf("entry=%+v", entry)
			}
		})
	}
}

func TestQuoteCacheHitDoesNotFetchAndRejectsOtherChat(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	p.storeQuote("4242", "旧原文", "原作者", false, "g:111")
	if _, err := p.resolveQuote(context.Background(), "4242", "g:111", false); err != nil {
		t.Fatal(err)
	}
	if _, err := p.resolveQuote(context.Background(), "4242", "g:222", false); err == nil {
		t.Fatal("cached message from another chat was accepted")
	}
	if calls := f.record()["get_msg"]; len(calls) != 0 {
		t.Fatalf("known cache scope should avoid get_msg, calls=%v", calls)
	}
}

func TestQuoteOnlyOldBotMessageCallsBot(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("get_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 4242, "message_type": "group", "group_id": 111, "sender": map[string]any{"user_id": botUserID, "nickname": "机器人"}, "raw_message": "重启前回复"}
	})
	_, msgs := startTestPlatform(t, f)
	f.push(groupMessage(111, 2001, 103, replySegment("4242")))
	m := awaitMessage(t, msgs)
	if !m.Mentioned || m.Content == "" || m.Reference == nil || m.Reference.ID != "4242" || !strings.Contains(m.ExtraContent, "机器人：重启前回复") {
		t.Fatalf("old bot quote not preserved: %+v", m)
	}
}

func TestQuoteInvalidIDDoesNotFetch(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	for _, id := range []string{"", "0", "invented"} {
		if _, err := p.resolveQuote(context.Background(), id, "g:111", false); err == nil {
			t.Fatalf("accepted invalid ID %q", id)
		}
	}
	if len(f.record()["get_msg"]) != 0 {
		t.Fatal("invalid ID triggered a network lookup")
	}
}

func TestQuoteUnavailableIsExplicit(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("get_msg", func(map[string]any) map[string]any { return map[string]any{"retcode": 100} })
	_, msgs := startTestPlatform(t, f)
	f.push(privateMessage(2001, 103, replySegment("4242"), textSegment("看看这条")))
	m := awaitMessage(t, msgs)
	if !strings.Contains(m.ExtraContent, "4242") || !strings.Contains(m.ExtraContent, "无法获取") {
		t.Fatalf("missing original must be explicit, ExtraContent=%q", m.ExtraContent)
	}
}
