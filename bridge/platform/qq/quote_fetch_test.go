package qq

import (
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
