package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestOpenCodeHookPluginInstall: "setup hooks on --cli opencode" writes the plugin and "off" removes it.
func TestOpenCodeHookPluginInstall(t *testing.T) {
	useRepoHooks(t)
	data, wd := t.TempDir(), t.TempDir()
	res, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "opencode"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OpenCodePluginFile != OpenCodePluginPath(wd) {
		t.Fatalf("plugin file %q", res.OpenCodePluginFile)
	}
	if b, err := os.ReadFile(res.OpenCodePluginFile); err != nil || !strings.Contains(string(b), `"tool.execute.before"`) {
		t.Fatalf("plugin missing or without the flat hook key: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wd, "opencode.json")); !os.IsNotExist(err) {
		t.Fatalf("opencode.json written; OpenCode loads .opencode/plugins by itself")
	}
	if _, err := DisableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "opencode"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(res.OpenCodePluginFile); !os.IsNotExist(err) {
		t.Fatalf("plugin not removed: %v", err)
	}
}

// TestOpenCodePluginBlocksSleep loads the plugin as OpenCode does (import, call each exported plugin, take
// hooks["tool.execute.before"]) and calls it with OpenCode's arguments for the bash tool.
func TestOpenCodePluginBlocksSleep(t *testing.T) {
	useRepoHooks(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	data, wd := t.TempDir(), t.TempDir()
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "opencode", Only: []string{"bash-guard"}}); err != nil {
		t.Fatal(err)
	}
	runner := filepath.Join(t.TempDir(), "run.mjs")
	js := `const mod = await import(process.argv[2])
// OpenCode calls every export as a plugin (plugin/index.ts:99-124); each must return the hooks object
let before
for (const fn of Object.values(mod)) {
  if (typeof fn !== "function") throw new Error("export is not a function")
  const hooks = await fn({})
  if (!hooks || typeof hooks !== "object") throw new Error("export did not return hooks")
  before = before || hooks["tool.execute.before"]
}
await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "echo hello" } })
console.log("PASS_ECHO")
try {
  await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "sleep 120" } })
  console.log("NOT_BLOCKED")
} catch (e) { console.log("BLOCKED: " + e.message) }
await before({ tool: "edit", sessionID: "s", callID: "c" }, { args: { filePath: "/tmp/x", oldString: "a", newString: "b" } })
console.log("PASS_EDIT_NOT_ENABLED")
`
	if err := os.WriteFile(runner, []byte(js), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(node, runner, OpenCodePluginPath(wd)).CombinedOutput()
	s := string(out)
	if err != nil {
		t.Fatalf("node: %v\n%s", err, s)
	}
	if !strings.Contains(s, "PASS_ECHO") || !strings.Contains(s, "BLOCKED: [bothouse hook blocked]") || !strings.Contains(s, "PASS_EDIT_NOT_ENABLED") {
		t.Fatalf("unexpected output:\n%s", s)
	}
	t.Logf("%s", s)
}

// TestOpenCodePluginApplyPatch: GPT models get apply_patch instead of edit/write (opencode v1.19.4
// tool/registry.ts:297-300); the plugin checks each file of the patch as a Claude Code Write (Add File) or Edit
// (Update File), so Write|Edit hooks still fire. A hook that exits 1 lets the call through with a stderr line.
func TestOpenCodePluginApplyPatch(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	wd, err := filepath.EvalSymlinks(t.TempDir()) // the plugin resolves its dir through import.meta.url (macOS /private/var)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureOpenCodeHookPlugin(wd); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(t.TempDir(), "payloads.jsonl")
	hook := `cat >> "` + log + `"; echo >> "` + log + `"; tail -n 2 "` + log + `" | grep -q FORBIDDEN && { echo "no FORBIDDEN" >&2; exit 2; }; exit 0`
	settings := `{"hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":` + strconvQuote(hook) +
		`}]},{"matcher":"Edit","hooks":[{"type":"command","command":"exit 1"}]}]}}`
	if err := os.MkdirAll(filepath.Join(wd, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wd, ".claude", "settings.json"), []byte(settings), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := filepath.Join(t.TempDir(), "run.mjs")
	js := `const mod = await import(process.argv[2])
const before = (await mod.BothouseHooks({}))["tool.execute.before"]
const ok = "*** Begin Patch\n*** Add File: new.txt\n+hello\n+world\n*** Update File: src/a.py\n@@ def f():\n-    return 1\n+    return 2\n     pass\n*** Delete File: old.txt\n*** End Patch"
await before({ tool: "apply_patch", sessionID: "s", callID: "c" }, { args: { patchText: ok } })
console.log("PASS_OK_PATCH")
try {
  await before({ tool: "apply_patch", sessionID: "s", callID: "c" }, { args: { patchText: "*** Begin Patch\n*** Update File: b.go\n-x\n+FORBIDDEN\n*** End Patch" } })
  console.log("NOT_BLOCKED")
} catch (e) { console.log("BLOCKED: " + e.message) }
`
	if err := os.WriteFile(runner, []byte(js), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(node, runner, OpenCodePluginPath(wd)).CombinedOutput()
	s := string(out)
	if err != nil {
		t.Fatalf("node: %v\n%s", err, s)
	}
	if !strings.Contains(s, "PASS_OK_PATCH") || !strings.Contains(s, "BLOCKED: [bothouse hook blocked] no FORBIDDEN") {
		t.Fatalf("unexpected output:\n%s", s)
	}
	if !strings.Contains(s, "[bothouse hooks] exit 1 failed (exit 1), Edit call let through") {
		t.Fatalf("no stderr line for the failing hook:\n%s", s)
	}
	b, _ := os.ReadFile(log)
	var calls []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("payload %q: %v", line, err)
		}
		calls = append(calls, m)
	}
	if len(calls) != 3 {
		t.Fatalf("want 3 hook calls (Write new.txt, Edit a.py, Edit b.go), got %d:\n%s", len(calls), b)
	}
	in0, in1 := calls[0]["tool_input"].(map[string]any), calls[1]["tool_input"].(map[string]any)
	if calls[0]["tool_name"] != "Write" || in0["file_path"] != filepath.Join(wd, "new.txt") || in0["content"] != "hello\nworld\n" {
		t.Fatalf("add file not mapped to Write: %v", calls[0])
	}
	if calls[1]["tool_name"] != "Edit" || in1["file_path"] != filepath.Join(wd, "src", "a.py") ||
		in1["old_string"] != "    return 1\n    pass" || in1["new_string"] != "    return 2\n    pass" {
		t.Fatalf("update file not mapped to Edit: %v", calls[1])
	}
}

func strconvQuote(s string) string { b, _ := json.Marshal(s); return string(b) }
