//go:build !no_codex

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestModelCommandLocalSessionWhenSocketUnavailable(t *testing.T) {
	if query := os.Getenv("CONEST_LOCAL_MODEL_HELPER"); query != "" {
		os.Args = append([]string{"bothouse", "model"}, strings.Fields(os.Getenv("CONEST_LOCAL_MODEL_ACTION"))...)
		os.Args = append(os.Args, "--json", "--project", query, "--session-key", os.Getenv("CONEST_LOCAL_MODEL_CHANNEL"))
		if dir := os.Getenv("CONEST_LOCAL_MODEL_DATA_DIR"); dir != "" {
			os.Args = append(os.Args, "--data-dir", dir)
		}
		main()
		os.Exit(0)
	}
	home := t.TempDir()
	dir := filepath.Join(home, "sessions", "2026", "10", "23")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	id := "00000000-0000-0000-0000-000000000002"
	data := `{"type":"session_meta","payload":{"id":"` + id + `"}}` + "\n" + `{"type":"turn_context","payload":{"model":"runtime-model"}}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "rollout-"+id+".jsonl"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		project, channel, thread, agent string
		action, dataDir                 string
		want                            bool
	}{
		{"current-project", "current-channel", id, "codex", "list", "", true},
		{"current-project", "current-channel", id, "codex", "info", "", true},
		{"current-project", "current-channel", id, "codex", "status", "", true},
		{"other-project", "current-channel", id, "codex", "list", "", false},
		{"current-project", "other-channel", id, "codex", "list", "", false},
		{"current-project", "current-channel", "", "codex", "list", "", false},
		{"current-project", "current-channel", id, "other-agent", "list", "", false},
		{"current-project", "current-channel", id, "codex", "list", t.TempDir(), false},
		{"current-project", "current-channel", id, "codex", "set next-model", "", false},
		{"current-project", "current-channel", id, "codex", "effort high", "", false},
		{"current-project", "current-channel", id, "codex", "auto", "", false},
	} {
		cmd := exec.Command(os.Args[0], "-test.run=^TestModelCommandLocalSessionWhenSocketUnavailable$")
		cmd.Env = append(os.Environ(), "CONEST_LOCAL_MODEL_HELPER="+tc.project, "CONEST_LOCAL_MODEL_CHANNEL="+tc.channel, "CODEX_HOME="+home, "CODEX_THREAD_ID="+tc.thread, "CC_AGENT="+tc.agent, "CC_PROJECT=current-project", "CC_SESSION_KEY=current-channel", "CC_DATA_DIR="+t.TempDir())
		cmd.Env = append(cmd.Env, "CONEST_LOCAL_MODEL_ACTION="+tc.action, "CONEST_LOCAL_MODEL_DATA_DIR="+tc.dataDir)
		out, err := cmd.CombinedOutput()
		if !tc.want {
			if err == nil || strings.Contains(string(out), "runtime-model") {
				t.Fatalf("fallback without matching current session: %+v %v %s", tc, err, out)
			}
			continue
		}
		var status core.ModelStatus
		if err != nil || json.Unmarshal(out, &status) != nil || status.Model != "runtime-model" || status.Source != "local_session" {
			t.Fatalf("read-only local model query: %v %s", err, out)
		}
	}
}
