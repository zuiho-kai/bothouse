package zulu

import (
	"slices"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestParseZuluStreamLine(t *testing.T) {
	var streamed int

	evts, cid, done := parseZuluStreamLine(`{"cid":"cid-1","kind":"element-add","element":{"type":"TEXT","content":"Hel"}}`, &streamed)
	if done || cid != "cid-1" || len(evts) != 1 || evts[0].Type != core.EventText || evts[0].Content != "Hel" {
		t.Fatalf("unexpected element-add parse: evts=%+v cid=%q done=%v", evts, cid, done)
	}

	evts, cid, done = parseZuluStreamLine(`{"kind":"delta-batch","cid":"cid-1","chunks":[{"kind":"text-delta","delta":"lo"},{"kind":"thinking-delta","delta":"hmm"}]}`, &streamed)
	if done || cid != "cid-1" || len(evts) != 2 || evts[0].Content != "lo" || evts[1].Type != core.EventThinking {
		t.Fatalf("unexpected delta-batch parse: evts=%+v cid=%q done=%v", evts, cid, done)
	}
	if streamed != 5 {
		t.Fatalf("expected streamed=5, got %d", streamed)
	}

	evts, cid, done = parseZuluStreamLine(`{"kind":"completed","cid":"cid-1","status":"ok","content":"Hello"}`, &streamed)
	if !done || cid != "cid-1" || len(evts) != 1 || evts[0].Type != core.EventResult || evts[0].StreamedContentBytes != 5 {
		t.Fatalf("unexpected completed parse: evts=%+v cid=%q done=%v", evts, cid, done)
	}
}

func TestBuildSSHExecArgs(t *testing.T) {
	args := buildSSHExecArgs("dev-linux", []string{"-o", "BatchMode=yes"}, "zulu", []string{"run", "-q", "it's ok"})
	if len(args) != 5 || args[0] != "-o" || args[2] != "-T" || args[3] != "dev-linux" {
		t.Fatalf("unexpected ssh args prefix: %+v", args)
	}
	if got := args[4]; got == "" || got[0] != 'Z' {
		t.Fatalf("expected auto-discovery remote script, got %q", got)
	}
}

func TestZuluUsesSharedRemoteSSHArgs(t *testing.T) {
	args := []string{"-o", "ConnectTimeout=5"}
	a, err := New(map[string]any{
		"remote_host": "njjs", "relay_host": "relay", "work_dir": "/linux/repo", "ssh_args": args,
	})
	if err != nil {
		t.Fatal(err)
	}
	got := a.(*Agent)
	if got.GetRemoteHost() != "njjs" || got.GetRelayHost() != "relay" ||
		got.GetWorkDir() != "/linux/repo" || !slices.Equal(got.GetSSHArgs(), args) {
		t.Fatal("the Zulu agent did not keep the shared SSH settings")
	}
}

func TestZuluBuildArgsMatchesIDevCLI(t *testing.T) {
	s := newZuluSession(
		"zulu", nil, "/work", "", "", nil,
		"testuser", "", "", "Claude Sonnet 5", "yolo", "Agent", "true", "high", "extra system prompt", "cid-123", nil,
	)
	args := s.buildArgs("hello", []string{"/work/img.png"}, []string{"/work/doc.txt"})

	if slices.Contains(args, "--force") {
		t.Fatalf("yolo mode must not pass --force (which kills queued runs): %v", args)
	}
	wantPairs := [][2]string{
		{"--display", "delta-stream"},
		{"--cwd", "/work"},
		{"-q", "hello"},
		{"--username", "testuser"},
		{"-c", "cid-123"},
		{"-m", "Claude Sonnet 5"},
		{"--mode", "Agent"},
		{"--thinking", "true"},
		{"--effort", "high"},
		{"--append-system-prompt", "extra system prompt"},
		{"--on-requires-action", "auto-approve"},
		{"--attach-image", "/work/img.png"},
		{"--attach-file", "/work/doc.txt"},
	}
	for _, pair := range wantPairs {
		idx := slices.Index(args, pair[0])
		if idx < 0 || idx+1 >= len(args) || args[idx+1] != pair[1] {
			t.Fatalf("expected %s %q in args, got %v", pair[0], pair[1], args)
		}
	}
}

func TestZuluProviderAndOneAPITokenEnv(t *testing.T) {
	a, err := New(map[string]any{
		"remote_host": "dev-box",
		"work_dir":    "/linux/repo",
		"effort":      "medium",
		"zulu_mode":   "Bot",
	})
	if err != nil {
		t.Fatal(err)
	}
	za := a.(*Agent)
	za.SetProviders([]core.ProviderConfig{
		{
			Name:   "idev-oneapi-anthropic",
			APIKey: "sk-test-token",
			Env:    map[string]string{"DODO_ZULU_BILLING_TOKEN": "bill-1"},
		},
	})
	if !za.SetActiveProvider("idev-oneapi-anthropic") {
		t.Fatal("expected SetActiveProvider to succeed")
	}
	env := za.resolveEnvLocked()
	if !slices.Contains(env, "COMATE_AGENT_EXECUTION_ACCESS_TOKEN=sk-test-token") {
		t.Fatalf("expected COMATE_AGENT_EXECUTION_ACCESS_TOKEN in env, got %v", env)
	}
	if !slices.Contains(env, "DODO_ZULU_BILLING_TOKEN=bill-1") {
		t.Fatalf("expected DODO_ZULU_BILLING_TOKEN in env, got %v", env)
	}

	script := core.BuildRemoteZuluScriptWithEnv("zulu", []string{"run", "-q", "hi"}, "testuser", append(env, "CC_BIN=/Users/local/bothouse", "CC_DATA_DIR=/Users/local/data"))
	if !strings.Contains(script, "export 'COMATE_AGENT_EXECUTION_ACCESS_TOKEN=sk-test-token'") {
		t.Fatalf("expected remote script to export COMATE_AGENT_EXECUTION_ACCESS_TOKEN, got:\n%s", script)
	}
	if strings.Contains(script, "CC_BIN=") || strings.Contains(script, "CC_DATA_DIR=") {
		t.Fatalf("remote script must not export macOS local CC_BIN/CC_DATA_DIR:\n%s", script)
	}
}
