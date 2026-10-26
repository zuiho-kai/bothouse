package dsh

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
	"github.com/klauspost/compress/zstd"
)

// Lines trimmed from real jingyu DSH logs (session.v4, 2026-10), texts shortened.
var handoffFixture = []string{
	`{"type":"session","version":4,"id":"s1","createdAt":1792926432591,"cwd":"/w/jingyu","isSeeded":false,"delegationDepth":0}`,
	`{"type":"turn/start","seq":1,"time":1792926433107,"data":{"turn":1}}`,
	`{"type":"user/message","seq":4,"time":1792926433123,"data":{"content":[{"type":"text","text":"<system-reminder>\nInstructions from: AGENTS.md"}],"source":{"kind":"agent-instructions"}}}`,
	`{"type":"user/message","seq":5,"time":1792926433123,"data":{"content":[{"type":"text","text":"（最新，回这条）\n很早的话"}],"source":{"kind":"user"}}}`,
	`{"type":"assistant/message","seq":13,"time":1792926438106,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"reasoning","text":"Let me fetch it."},{"type":"tool-call","id":"c1","name":"web_fetch","arguments":"{}"}]},"usage":{"inputTokens":10766,"outputTokens":134,"cacheReadTokens":11136,"cacheWriteTokens":0,"totalTokens":22036}}}`,
	`{"type":"assistant/message","seq":30,"time":1792926497000,"data":{"turn":1,"step":2,"message":{"role":"assistant","content":[{"type":"text","text":"很早的回答"}]},"usage":{"inputTokens":200,"outputTokens":50,"cacheReadTokens":22000}}}`,
	`{"type":"turn/end","seq":31,"time":1792926497131,"data":{"turn":1,"reason":{"kind":"completed"}}}`,
	`{"type":"turn/start","seq":40,"time":1792927000000,"data":{"turn":2}}`,
	`{"type":"compaction/start","seq":41,"time":1792927000100,"data":{"compactionId":"k1","turn":2}}`,
	`{"type":"compaction/summary","seq":42,"time":1792927000200,"data":{"compactionId":"k1","summary":[{"type":"text","text":"## Primary Request and Intent\n- 在修卡片"}]}}`,
	`{"type":"user/message","seq":43,"time":1792927000201,"data":{"content":[{"type":"text","text":"This is an automatically generated checkpoint\n\n<compacted-summary>"},{"type":"text","text":"## Primary Request"}],"source":{"kind":"compact-checkpoint","compactionId":"k1"}}}`,
	`{"type":"compaction/end","seq":44,"time":1792927000300,"data":{"compactionId":"k1","turn":2}}`,
	`{"type":"user/message","seq":45,"time":1792927000400,"data":{"content":[{"type":"text","text":"Time sampled while preparing turn 2"}],"source":{"kind":"time-context","form":"snapshot"}}}`,
	`{"type":"user/message","seq":46,"time":1792927000500,"data":{"content":[{"type":"text","text":"（最新，回这条）\n你看看"}],"source":{"kind":"user"}}}`,
	`{"type":"assistant/message","seq":50,"time":1792927010000,"data":{"turn":2,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"我先查一下"},{"type":"tool-call","id":"c2","name":"bash","arguments":"{}"}]},"usage":{"inputTokens":1475,"outputTokens":10,"cacheReadTokens":30000}}}`,
	`{"type":"tool/result","seq":51,"time":1792927011000,"data":{"turn":2,"step":1,"message":{"role":"tool","content":[{"type":"text","text":"ok"}]}}}`,
	`{"type":"user/message","seq":52,"time":1792927012000,"data":{"content":[{"type":"text","text":"【橘】别自己干"}],"source":{"kind":"user"}}}`,
	`{"type":"assistant/message","seq":60,"time":1792927020000,"data":{"turn":2,"step":2,"message":{"role":"assistant","content":[{"type":"reasoning","text":"..."},{"type":"text","text":"查到了"}]},"usage":{"inputTokens":533,"outputTokens":1900,"cacheReadTokens":40000}}}`,
	`{"type":"assistant/message","seq":61,"time":1792927021000,"data":{"turn":2,"step":3,"message":{"role":"assistant","content":[{"type":"text","text":"结论在上面"}]},"usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":40500}}}`,
	`{"type":"assistant/attempt","seq":70,"time":1792927030000,"data":{"turn":2,"step":4,"stream":[{"type":"chunk","chunk":{"type":"usage","usage":{"inputTokens":999999}}}]}}`,
	`{"type":"turn/start","seq":80,"time":1792927100000,"data":{"turn":3}}`,
	`{"type":"user/message","seq":81,"time":1792927100100,"data":{"content":[{"type":"text","text":"后宅·想不想说"}],"source":{"kind":"user"}}}`,
	`{"type":"assistant/message","seq":82,"time":1792927105000,"data":{"turn":3,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"NO_REPLY"}]},"usage":{"inputTokens":300,"outputTokens":2,"cacheReadTokens":40600}}}`,
}

func TestParseHandoff(t *testing.T) {
	h, err := parseHandoff(strings.NewReader(strings.Join(handoffFixture, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	if h.CompactSummary != "## Primary Request and Intent\n- 在修卡片" || h.CompactedAt.UnixMilli() != 1792927000200 {
		t.Fatalf("summary = %q at %v", h.CompactSummary, h.CompactedAt)
	}
	// the last assistant/message with usage: inputTokens + cacheReadTokens
	if h.ContextTokens != 300+40600 || h.LastActivity.UnixMilli() != 1792927105000 {
		t.Fatalf("usage = %d at %v", h.ContextTokens, h.LastActivity)
	}
	var got []string
	for _, e := range h.Tail {
		got = append(got, e.Role+":"+e.Content)
	}
	want := []string{
		"user:（最新，回这条）\n你看看",
		"assistant:我先查一下", // the steered message splits the turn
		"user:【橘】别自己干",
		"assistant:结论在上面",
		"user:后宅·想不想说",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("tail = %q", got)
	}
}

func TestParseHandoffCompactionWithoutReply(t *testing.T) {
	h, _ := parseHandoff(strings.NewReader(strings.Join(handoffFixture[:10], "\n")))
	if h.ContextTokens != 0 || h.LastActivity.UnixMilli() != 1792926497000 {
		t.Fatalf("after compaction = %d at %v", h.ContextTokens, h.LastActivity)
	}
}

// writeZstdLog writes lines the way DSH does: the header line in its own
// frame, later lines in one frame per batch, plus a torn frame still being written.
func writeZstdLog(t *testing.T, path string, lines []string) {
	t.Helper()
	enc, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	var b []byte
	b = enc.EncodeAll([]byte(lines[0]+"\n"), b)
	mid := 1 + (len(lines)-1)/2
	b = enc.EncodeAll([]byte(strings.Join(lines[1:mid], "\n")+"\n"), b)
	b = enc.EncodeAll([]byte(strings.Join(lines[mid:], "\n")+"\n"), b)
	torn := enc.EncodeAll([]byte(`{"type":"assistant/message","time":1792999999999,"data":{"usage":{"inputTokens":1,"cacheReadTokens":999999}}}`+"\n"), nil)
	b = append(b, torn[:len(torn)/2]...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// A `type = "acp"` role whose cmd is a DSH launcher exporting DSH_HOME (jingyu's
// ~/im-bridge/jingyu-dsh/jingyu-dsh) reads its session logs; Name() stays "acp".
func TestACPWithDSHLauncherReadsHandoff(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	launcher := filepath.Join(dir, "jingyu-dsh")
	script := "#!/bin/sh\nexport DSH_HOME=" + home + "\nexec node dsh/lib/bin.js --profile acp \"$@\"\n"
	if err := os.WriteFile(launcher, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	id := "ef37ea70-2dda-4d91-a0a3-e618a5fd5959"
	log := filepath.Join(home, "sessions", "--w-jingyu--", id, "session.v4.jsonl.zstd")
	writeZstdLog(t, log, handoffFixture)

	a, err := core.CreateAgent("acp", map[string]any{"cmd": launcher, "work_dir": dir})
	if err != nil {
		t.Fatal(err)
	}
	if a.Name() != "acp" {
		t.Fatalf("Name() = %q, want acp (session keys and logs keep it)", a.Name())
	}
	r, ok := a.(core.SessionHandoffReader)
	if !ok {
		t.Fatalf("%T does not read handoffs", a)
	}
	h, err := r.ReadSessionHandoff(id)
	if err != nil {
		t.Fatal(err)
	}
	if h.Path != log || h.ContextTokens != 40900 || h.LastActivity.UnixMilli() != 1792927105000 || len(h.Tail) != 5 {
		t.Fatalf("handoff = %s %d %v tail %d", h.Path, h.ContextTokens, h.LastActivity, len(h.Tail))
	}
	if _, err := r.ReadSessionHandoff("missing"); err == nil {
		t.Fatal("missing session: want error")
	}
}

// Any other ACP agent stays the plain one: no DSH log to read.
func TestACPWithoutDSHIsUnchanged(t *testing.T) {
	dir := t.TempDir()
	cmd := filepath.Join(dir, "cursor-agent")
	if err := os.WriteFile(cmd, []byte("#!/bin/sh\nexec cursor acp\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	a, err := core.CreateAgent("acp", map[string]any{"cmd": cmd})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := a.(core.SessionHandoffReader); ok {
		t.Fatalf("%T: a non-DSH ACP agent must not claim a log reader", a)
	}
}

func TestDSHTypeReadsHandoff(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	id := "d958579c-d339-463d-80c4-927e788e50dd"
	log := filepath.Join(home, "sessions", "--w--", id, "session.v4.jsonl")
	if err := os.MkdirAll(filepath.Dir(log), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(log, []byte(strings.Join(handoffFixture, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := filepath.Join(dir, "dsh")
	if err := os.WriteFile(cmd, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	a, err := New(map[string]any{"cmd": cmd, "env": map[string]any{"DSH_HOME": home}})
	if err != nil {
		t.Fatal(err)
	}
	h, err := a.(core.SessionHandoffReader).ReadSessionHandoff(id)
	if err != nil {
		t.Fatal(err)
	}
	if h.ContextTokens != 40900 || h.CompactSummary == "" {
		t.Fatalf("handoff = %+v", h)
	}
}
