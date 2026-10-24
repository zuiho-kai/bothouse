package core

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// Real DSH log lines (2026-10-24) with message content, stream and replay state
// removed; times moved to 2026-10-24 12:00 UTC so every time zone books them
// on that day.
const (
	dshSID    = "ea030bac-2161-40d5-8113-b7ab1647e456"
	dshSubSID = "08805b4f-d6a6-4653-9117-23549ae5dc28"
	dshHeader = `{"createdAt":1792843190000,"cwd":"/tmp/jingyu","delegationDepth":0,"id":"ea030bac-2161-40d5-8113-b7ab1647e456","isSeeded":false,"type":"session","version":4}`
	dshSubHdr = `{"createdAt":1792843190000,"cwd":"/tmp/jingyu","delegationDepth":1,"id":"08805b4f-d6a6-4653-9117-23549ae5dc28","isSeeded":false,"origin":"subagent","parentSession":"ea030bac-2161-40d5-8113-b7ab1647e456","type":"session","version":4}`
	dshUser   = `{"data":{"message":{"content":[],"role":"user"}},"seq":2,"time":1792843195000,"type":"user/message"}`
	dshMsg1   = `{"data":{"message":{"content":[],"id":"8ec8b9fb-cc9f-4c81-be60-1f17ba88c374","role":"assistant","source":{"kind":"model","model":"deepseek-v4.1-flash","provider":"deepseek-official"}},"step":1,"turn":1,"usage":{"cacheReadTokens":11520,"cacheWriteTokens":0,"inputTokens":3522,"outputTokens":387,"totalTokens":15429}},"seq":13,"surfaceOp":"append","time":1792843200000,"type":"assistant/message"}`
	dshMsg2   = `{"data":{"message":{"content":[],"id":"99e8a1c2-0000-4000-8000-000000000002","role":"assistant","source":{"kind":"model","model":"deepseek-v4.1-flash","provider":"deepseek-official"}},"step":2,"turn":1,"usage":{"cacheReadTokens":10496,"cacheWriteTokens":64,"inputTokens":7574,"outputTokens":124,"totalTokens":18194}},"seq":15,"surfaceOp":"append","time":1792843201000,"type":"assistant/message"}`
)

// appendFrame appends data as one zstd frame, as DSH does per append batch.
func appendFrame(t *testing.T, path string, data string) {
	t.Helper()
	enc, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	appendRaw(t, path, enc.EncodeAll([]byte(data), nil))
}

func appendRaw(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Write(b); err != nil {
		t.Fatal(err)
	}
}

func dshLog(home, sid string) string {
	return filepath.Join(home, "sessions", "--tmp-jingyu--", sid, "session.v4.jsonl.zstd")
}

func TestUsageImportDSHFramesIncrementalAndSubagent(t *testing.T) {
	dataDir, home := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "jingyu_5e6f7a8b.json", dshSID)
	log := dshLog(home, dshSID)
	appendFrame(t, log, dshHeader+"\n"+dshUser+"\n")
	appendFrame(t, log, dshMsg1+"\n")
	// A session the bridge does not own must not be booked.
	appendFrame(t, dshLog(home, "99999999-0000-0000-0000-000000000000"),
		`{"id":"99999999-0000-0000-0000-000000000000","type":"session","version":4}`+"\n"+dshMsg2+"\n")

	ledger := NewUsageLedger(dataDir, nil)
	src := &DSHUsageSource{Homes: []string{home}}
	im := NewUsageImporter(dataDir, ledger, src)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := usageRows(t, ledger, "roles")
	if len(rows) != 1 || rows[0].Role != "jingyu" || rows[0].Responses != 1 || rows[0].Input != 3522 ||
		rows[0].Output != 387 || rows[0].CacheRead != 11520 {
		t.Fatalf("first import: %+v", rows)
	}

	// Appended: a line split across two frames, then half of a frame that is
	// still being written. The split line counts once complete; the half
	// frame waits.
	appendFrame(t, log, dshMsg2[:50])
	appendFrame(t, log, dshMsg2[50:]+"\n")
	enc, _ := zstd.NewWriter(nil)
	tail := enc.EncodeAll([]byte(dshMsg1+"\n"), nil)
	appendRaw(t, log, tail[:len(tail)/2])
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows = usageRows(t, ledger, "models")
	if len(rows) != 1 || rows[0].Model != "deepseek-v4.1-flash" || rows[0].Responses != 2 ||
		rows[0].Input != 3522+7574 || rows[0].CacheWrite != 64 {
		t.Fatalf("incremental import: %+v", rows)
	}

	// The rest of the frame arrives (a repeat of msg1: no double count), and a
	// subagent session is booked to its parent's role.
	appendRaw(t, log, tail[len(tail)/2:])
	sub := dshLog(home, dshSubSID)
	appendFrame(t, sub, dshSubHdr+"\n"+dshMsg1+"\n")
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows = usageRows(t, ledger, "roles")
	// msg1 in the subagent is a different response (own session in the key).
	if len(rows) != 1 || rows[0].Role != "jingyu" || rows[0].Responses != 3 || rows[0].Output != 387*2+124 {
		t.Fatalf("subagent / repeat: %+v", rows)
	}
}

func TestUsageImportDSHRewrittenFileAndPlainLog(t *testing.T) {
	dataDir, home := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "jingyu_5e6f7a8b.json", dshSID)
	log := dshLog(home, dshSID)
	appendFrame(t, log, dshHeader+"\n")
	appendFrame(t, log, dshMsg1+"\n")
	ledger := NewUsageLedger(dataDir, nil)
	im := NewUsageImporter(dataDir, ledger, &DSHUsageSource{Homes: []string{home}})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	// Rewritten as one larger frame: the old offset lands mid-frame, so the
	// file is read again from the start without counting msg1 twice.
	if err := os.Remove(log); err != nil {
		t.Fatal(err)
	}
	appendFrame(t, log, dshHeader+"\n"+dshUser+"\n"+dshUser+"\n"+dshMsg1+"\n"+dshMsg2+"\n")
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if rows := usageRows(t, ledger, "roles"); len(rows) != 1 || rows[0].Responses != 2 {
		t.Fatalf("rewritten: %+v", rows)
	}

	// compression "none" writes plain session.v4.jsonl.
	dataDir2, home2 := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir2, "jingyu_5e6f7a8b.json", dshSID)
	writeLines(t, filepath.Join(home2, "sessions", "--tmp-jingyu--", dshSID, "session.v4.jsonl"), dshHeader, dshMsg1, dshMsg1)
	ledger2 := NewUsageLedger(dataDir2, nil)
	if err := NewUsageImporter(dataDir2, ledger2, &DSHUsageSource{Homes: []string{home2}}).Sync(); err != nil {
		t.Fatal(err)
	}
	if rows := usageRows(t, ledger2, "roles"); len(rows) != 1 || rows[0].Responses != 1 || rows[0].CacheRead != 11520 {
		t.Fatalf("plain: %+v", rows)
	}
}

func TestUsageDSHHomeFromOptions(t *testing.T) {
	if h := DSHHomeFromOptions(map[string]any{"env": map[string]any{"DSH_HOME": "/x/home"}}); h != "/x/home" {
		t.Fatal(h)
	}
	if h := DSHHomeFromOptions(map[string]any{}); h != "" {
		t.Fatal(h)
	}
}

func TestUsageDSHHomeFromLauncherScript(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "run-dsh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\n# DSH_HOME=/not/this\nexport DSH_HOME=/x/role-home   # role home\nexec dsh \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if h := DSHHomeFromOptions(map[string]any{"cmd": script}); h != "/x/role-home" {
		t.Fatalf("home = %q", h)
	}
	if h := DSHHomeFromOptions(map[string]any{"cmd": script, "env": map[string]any{"DSH_HOME": "/env/home"}}); h != "/env/home" {
		t.Fatalf("env should win, got %q", h)
	}
	if h := DSHHomeFromOptions(map[string]any{"cmd": "dsh"}); h != "" {
		t.Fatalf("bare command gave %q", h)
	}
}
