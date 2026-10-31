package core

import (
	"os"
	"strings"
	"testing"
)

func TestTakeQueuedBatchLocked(t *testing.T) {
	st := &interactiveState{pendingMessages: []queuedMessage{
		{userID: "u1", msgSessionKey: "d:1", content: "一", messageID: "m1", userMessageTimeMs: 1793460000000},
		{userID: "u1", msgSessionKey: "d:1", content: "二", messageID: "m2", images: []ImageAttachment{{}}},
		{userID: "u1", msgSessionKey: "d:1", content: "三", messageID: "m3"},
		{userID: "u2", msgSessionKey: "d:1", content: "别人", messageID: "m4"},
		{userID: "cron", msgSessionKey: "d:1", content: "定时", messageID: "m5"},
	}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "m3" || len(q.images) != 1 || !strings.Contains(q.content, "连发了 3 条") ||
		strings.Index(q.content, "一") > strings.Index(q.content, "二") || strings.Index(q.content, "二") > strings.Index(q.content, "三") {
		t.Fatalf("batch = %+v", q)
	}
	t.Logf("merged turn:\n%s", q.content)
	if q = takeQueuedBatchLocked(st); q.messageID != "m4" || q.content != "别人" {
		t.Fatalf("other sender = %+v", q)
	}
	if q = takeQueuedBatchLocked(st); q.messageID != "m5" || len(st.pendingMessages) != 0 {
		t.Fatalf("cron = %+v", q)
	}
}

func TestTruncateRelayMore(t *testing.T) {
	dir := t.TempDir()
	long := strings.Repeat("字", 2500)
	out := truncateRelayMore(dir, "relay-task/x", long, 2000)
	i := strings.Index(out, "全文：")
	if i < 0 {
		t.Fatalf("no pointer: %s", out[len(out)-120:])
	}
	path := strings.Fields(out[i+len("全文："):])[0]
	b, err := os.ReadFile(path)
	if err != nil || string(b) != long {
		t.Fatalf("full text at %s: %v", path, err)
	}
	t.Logf("tail: %s", out[len(out)-160:])
	if truncateRelayMore(dir, "k", "短", 2000) != "短" {
		t.Fatal("short text changed")
	}
}
