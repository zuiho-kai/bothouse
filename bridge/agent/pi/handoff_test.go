package pi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Fixture lines follow the official pi types (@earendil-works/pi-coding-agent
// 1.4.0 session-manager.d.ts, pi-ai types.d.ts): entry timestamp is an ISO
// string, message.timestamp is a number (ms), assistant content mixes
// thinking/toolCall/text blocks, and entries form a parentId tree whose leaf
// is the last entry in the file.
var piBranchedFixture = []string{
	`{"type":"session","version":3,"id":"sess-1","timestamp":"2026-10-23T01:00:00.000Z","cwd":"/w"}`,
	`{"type":"message","id":"m1","parentId":null,"timestamp":"2026-10-23T01:01:00.000Z","message":{"role":"user","content":"看一下代码架构","timestamp":1792803660000}}`,
	`{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-10-23T01:01:20.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"先列目录"},{"type":"toolCall","id":"tc1","name":"bash","arguments":{"command":"ls"}}],"api":"anthropic-messages","provider":"anthropic","model":"m","usage":{"input":100,"output":20,"cacheRead":1000,"cacheWrite":200,"totalTokens":1320,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"toolUse","timestamp":1792803680000}}`,
	`{"type":"message","id":"t1","parentId":"m2","timestamp":"2026-10-23T01:01:21.000Z","message":{"role":"toolResult","toolCallId":"tc1","toolName":"bash","content":[{"type":"text","text":"a.go b.go"}],"isError":false,"timestamp":1792803681000}}`,
	`{"type":"message","id":"m3","parentId":"t1","timestamp":"2026-10-23T01:01:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"两个文件"}],"api":"anthropic-messages","provider":"anthropic","model":"m","usage":{"input":10,"output":5,"cacheRead":1300,"cacheWrite":20,"totalTokens":1335,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1792803690000}}`,
	// abandoned branch from m3
	`{"type":"message","id":"x1","parentId":"m3","timestamp":"2026-10-23T01:02:00.000Z","message":{"role":"user","content":"废弃的问题","timestamp":1792803720000}}`,
	`{"type":"message","id":"x2","parentId":"x1","timestamp":"2026-10-23T01:02:10.000Z","message":{"role":"assistant","content":[{"type":"text","text":"废弃的回答"}],"api":"a","provider":"p","model":"m","usage":{"input":1,"output":1,"cacheRead":9000,"cacheWrite":0,"totalTokens":9002,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1792803730000}}`,
	// active branch, also from m3
	`{"type":"message","id":"m4","parentId":"m3","timestamp":"2026-10-23T01:03:00.000Z","message":{"role":"user","content":[{"type":"text","text":"重点看认证"},{"type":"image","data":"QUJD","mimeType":"image/png"}],"timestamp":1792803780000}}`,
	`{"type":"message","id":"m5","parentId":"m4","timestamp":"2026-10-23T01:03:30.500Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"看 jwt"},{"type":"text","text":"认证用 JWT"}],"api":"a","provider":"p","model":"m","usage":{"input":50,"output":30,"cacheRead":1400,"cacheWrite":100,"totalTokens":1580,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1792803810500}}`,
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

func TestPiHandoffBranchedSession(t *testing.T) {
	h, err := parsePiHandoff(strings.NewReader(strings.Join(piBranchedFixture, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	if h.CompactSummary != "" || !h.CompactedAt.IsZero() {
		t.Fatalf("unexpected compaction %q %v", h.CompactSummary, h.CompactedAt)
	}
	if want := mustTime(t, "2026-10-23T01:03:30.500Z"); !h.LastActivity.Equal(want) {
		t.Fatalf("LastActivity = %v, want %v", h.LastActivity, want)
	}
	if h.ContextTokens != 50+1400+100 {
		t.Fatalf("ContextTokens = %d, want 1550", h.ContextTokens)
	}
	if h.ImageBytes != 4 {
		t.Fatalf("ImageBytes = %d, want 4", h.ImageBytes)
	}
	want := []string{"user:看一下代码架构", "assistant:两个文件", "user:重点看认证", "assistant:认证用 JWT"}
	checkTail(t, h.Tail, want)
}

func TestPiHandoffToolCallOnlyReply(t *testing.T) {
	lines := append([]string{}, piBranchedFixture[:3]...)
	h, err := parsePiHandoff(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	if want := mustTime(t, "2026-10-23T01:01:20.000Z"); !h.LastActivity.Equal(want) {
		t.Fatalf("LastActivity = %v, want %v", h.LastActivity, want)
	}
	if h.ContextTokens != 100+1000+200 {
		t.Fatalf("ContextTokens = %d, want 1300", h.ContextTokens)
	}
	checkTail(t, h.Tail, []string{"user:看一下代码架构"})
}

func TestPiHandoffCompactionKeepsEntries(t *testing.T) {
	compaction := `{"type":"compaction","id":"c1","parentId":"m5","timestamp":"2026-10-23T01:10:00.000Z","summary":"用户在排查认证","firstKeptEntryId":"m4","tokensBefore":45000}`
	lines := append(append([]string{}, piBranchedFixture...), compaction)
	h, err := parsePiHandoff(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	if h.CompactSummary != "用户在排查认证" {
		t.Fatalf("summary = %q", h.CompactSummary)
	}
	if want := mustTime(t, "2026-10-23T01:10:00.000Z"); !h.CompactedAt.Equal(want) {
		t.Fatalf("CompactedAt = %v", h.CompactedAt)
	}
	if h.ContextTokens != 0 {
		t.Fatalf("ContextTokens after compaction = %d, want 0 until next reply", h.ContextTokens)
	}
	checkTail(t, h.Tail, []string{"user:重点看认证", "assistant:认证用 JWT"})
	if h.ImageBytes != 4 { // m4 is kept verbatim, its image is still sent
		t.Fatalf("ImageBytes = %d, want 4", h.ImageBytes)
	}

	lines = append(lines,
		`{"type":"message","id":"m6","parentId":"c1","timestamp":"2026-10-23T01:12:00.000Z","message":{"role":"user","content":"继续看权限","timestamp":1792804320000}}`,
		`{"type":"message","id":"m7","parentId":"m6","timestamp":"2026-10-23T01:12:30.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"tc2","name":"read","arguments":{"path":"rbac.go"}}],"api":"a","provider":"p","model":"m","usage":{"input":7,"output":3,"cacheRead":4000,"cacheWrite":300,"totalTokens":4310,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"toolUse","timestamp":1792804350000}}`,
	)
	h, err = parsePiHandoff(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	if h.ContextTokens != 7+4000+300 {
		t.Fatalf("ContextTokens = %d, want 4307", h.ContextTokens)
	}
	if want := mustTime(t, "2026-10-23T01:12:30.000Z"); !h.LastActivity.Equal(want) {
		t.Fatalf("LastActivity = %v, want %v", h.LastActivity, want)
	}
	checkTail(t, h.Tail, []string{"user:重点看认证", "assistant:认证用 JWT", "user:继续看权限"})
}

func TestPiHandoffLongLine(t *testing.T) {
	big := strings.Repeat("x", 11*1024*1024)
	lines := append(append([]string{}, piBranchedFixture[:3]...),
		`{"type":"message","id":"t1","parentId":"m2","timestamp":"2026-10-23T01:01:21.000Z","message":{"role":"toolResult","toolCallId":"tc1","toolName":"bash","content":[{"type":"text","text":"`+big+`"}],"isError":false,"timestamp":1792803681000}}`,
		piBranchedFixture[4])
	h, err := parsePiHandoff(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	checkTail(t, h.Tail, []string{"user:看一下代码架构", "assistant:两个文件"})
}

func checkTail(t *testing.T, tail []core.HistoryEntry, want []string) {
	t.Helper()
	var got []string
	for _, e := range tail {
		got = append(got, e.Role+":"+e.Content)
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("Tail = %q, want %q", got, want)
	}
}

func TestReadSessionHandoffFindsSession(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	workDir := filepath.Join(tempHome, "my-pi-project")
	sessDir := piSessionDir(workDir)
	if err := os.MkdirAll(sessDir, 0o755); err != nil {
		t.Fatal(err)
	}
	uuid := "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	filePath := filepath.Join(sessDir, "2026-10-23T01-00-00-000Z_"+uuid+".jsonl")
	if err := os.WriteFile(filePath, []byte(strings.Join(piBranchedFixture, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := &Agent{workDir: workDir}
	for _, id := range []string{uuid, filePath} {
		h, err := a.ReadSessionHandoff(id)
		if err != nil {
			t.Fatalf("ReadSessionHandoff(%q): %v", id, err)
		}
		if h.Path != filePath || h.ContextTokens != 1550 || len(h.Tail) != 4 {
			t.Fatalf("ReadSessionHandoff(%q) = path %q tokens %d tail %d", id, h.Path, h.ContextTokens, len(h.Tail))
		}
	}
	if _, err := a.ReadSessionHandoff("non-existent-session-id"); err == nil {
		t.Fatal("expected error for non-existent session")
	}
}
