package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentHookCursor(t *testing.T) {
	useRepoHooks(t)
	wd, data := t.TempDir(), t.TempDir()
	o := AgentHookOptions{CLI: "cursor", WorkDir: wd, DataDir: data, Lang: "en"}

	path := AgentHookSettingsPath("cursor", wd)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Prepopulate user settings with custom fields and other hooks
	userExisting := map[string]any{
		"version":    1,
		"custom_key": "user_preserved_val",
		"hooks": map[string]any{
			"afterShellExecution": []any{
				map[string]any{"command": "echo user_post_hook"},
			},
		},
	}
	rawExisting, _ := json.MarshalIndent(userExisting, "", "  ")
	if err := os.WriteFile(path, rawExisting, 0o644); err != nil {
		t.Fatal(err)
	}

	// 2. Enable hooks (idempotent 2 runs)
	for i := 0; i < 2; i++ {
		if _, err := EnableAgentHooks(o); err != nil {
			t.Fatal(err)
		}
	}

	// Verify user custom fields and other hooks are preserved
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var checkCfg map[string]any
	if err := json.Unmarshal(content, &checkCfg); err != nil {
		t.Fatal(err)
	}
	if checkCfg["custom_key"] != "user_preserved_val" {
		t.Fatalf("custom_key lost or altered: %#v", checkCfg)
	}
	hooksMap, _ := checkCfg["hooks"].(map[string]any)
	if hooksMap == nil {
		t.Fatalf("hooks map missing: %#v", checkCfg)
	}
	afterList, _ := hooksMap["afterShellExecution"].([]any)
	if len(afterList) != 1 {
		t.Fatalf("afterShellExecution altered: %#v", hooksMap)
	}

	// Verify bash-guard is enabled
	on, err := AgentHooksEnabled("cursor", wd)
	if err != nil || len(on) != 1 || on[0] != "bash-guard" {
		t.Fatalf("status=%v err=%v", on, err)
	}

	// Extract installed bash-guard command
	beforeList, _ := hooksMap["beforeShellExecution"].([]any)
	if len(beforeList) != 1 {
		t.Fatalf("beforeShellExecution wanted 1 item, got %d: %#v", len(beforeList), beforeList)
	}
	firstItem, _ := beforeList[0].(map[string]any)
	command, _ := firstItem["command"].(string)
	if command == "" || ourHook(command) != "bash-guard" {
		t.Fatalf("unexpected command: %q", command)
	}

	// 3. Deny test: run sleep 120 -> exit code 2
	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = wd
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"beforeShellExecution","command":"sleep 120"}`)
	out, err := cmd.CombinedOutput()
	exit, ok := err.(*exec.ExitError)
	if !ok || exit.ExitCode() != 2 || !strings.Contains(string(out), "sleep 120") {
		t.Fatalf("wanted deny exit 2 with sleep 120, got exit=%v, err=%v, out=%s", exit, err, out)
	}
	t.Logf("deny output: %s", out)

	// 4. Allow test: run pwd -> exit code 0, allow
	cmd = exec.Command("sh", "-c", command)
	cmd.Dir = wd
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"beforeShellExecution","command":"pwd"}`)
	out, err = cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), `"allow"`) {
		t.Fatalf("wanted allow exit 0, got err=%v out=%s", err, out)
	}

	// 5. Disable hooks
	if _, err := DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}

	// Check bash-guard is gone, but custom_key and afterShellExecution remain
	content, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var afterDisable map[string]any
	if err := json.Unmarshal(content, &afterDisable); err != nil {
		t.Fatal(err)
	}
	if afterDisable["custom_key"] != "user_preserved_val" {
		t.Fatalf("custom_key lost after disable: %#v", afterDisable)
	}
	hDisable, _ := afterDisable["hooks"].(map[string]any)
	if list, ok := hDisable["beforeShellExecution"].([]any); ok && len(list) != 0 {
		t.Fatalf("beforeShellExecution not cleaned: %#v", hDisable)
	}

	on, err = AgentHooksEnabled("cursor", wd)
	if err != nil || len(on) != 0 {
		t.Fatalf("hooks still enabled after disable: %v", on)
	}
}
