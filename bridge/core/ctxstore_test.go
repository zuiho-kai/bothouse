package core

import (
	"strings"
	"testing"
	"time"
)

func TestHandoffIndexKeepsUserWordsAndStopAndStoresFull(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 11, 4, 11, 0, 0, 0, time.Local)
	h := &SessionHandoff{Path: "/x.jsonl", CompactSummary: strings.Repeat("摘要", 500), Tail: []HistoryEntry{
		{Role: "user", Content: "先把注入改成目录", Timestamp: at},
		{Role: "assistant", Content: "好，我改了推送服务。\n细节很长" + strings.Repeat("长", 800), Timestamp: at},
	}}
	tasks := "#1008 注入目录化 · 总目标：首轮降到一千字 · 停点：进行中"
	full := formatHandoff("old", "x", h, tasks)
	cid := StashCtx(dir, full)
	got := formatHandoffIndex("old", "x", h, tasks, "", cid)
	for _, want := range []string{"先把注入改成目录", "好，我改了推送服务。", "#1008 注入目录化 · 停点：进行中", "[#" + cid + "]", handoffEnd} {
		if !strings.Contains(got, want) {
			t.Fatalf("index missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "摘要摘要") || strings.Contains(got, "总目标：首轮") || strings.Contains(got, "长长长") {
		t.Fatalf("index carries what the full handoff holds:\n%s", got)
	}
	if !strings.HasPrefix(got, handoffHead) {
		t.Fatal("index must start with handoffHead so stripStaleBlocks drops it later")
	}
	body, err := ReadCtx(dir, "[#"+cid+"]")
	if err != nil || body != full {
		t.Fatalf("ReadCtx = %v, full stored: %v", err, body == full)
	}
	if _, err := ReadCtx(dir, "zz"); err == nil {
		t.Fatal("bad id must fail")
	}
	if len([]rune(got)) > 1000 {
		t.Fatalf("index too long: %d", len([]rune(got)))
	}
}
