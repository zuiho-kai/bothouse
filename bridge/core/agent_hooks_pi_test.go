package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestPiHookExtensionInstall: "setup hooks on --cli pi" writes the extension, PiHookExtensionArgs passes it,
// and "off" removes it.
func TestPiHookExtensionInstall(t *testing.T) {
	useRepoHooks(t)
	data, wd := t.TempDir(), t.TempDir()
	if got := PiHookExtensionArgs(wd); got != nil {
		t.Fatalf("args before install: %v", got)
	}
	res, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "pi"})
	if err != nil {
		t.Fatal(err)
	}
	if res.PiExtension != PiHookExtensionPath(wd) {
		t.Fatalf("extension file %q", res.PiExtension)
	}
	if b, err := os.ReadFile(res.PiExtension); err != nil || !strings.Contains(string(b), `pi.on("tool_call"`) {
		t.Fatalf("extension missing or without tool_call: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wd, ".pi", "extensions")); !os.IsNotExist(err) {
		t.Fatalf(".pi/extensions created; it needs project trust, which json/rpc mode skips")
	}
	if got := PiHookExtensionArgs(wd); len(got) != 2 || got[0] != "--extension" || !filepath.IsAbs(got[1]) {
		t.Fatalf("args after install: %v", got)
	}
	if _, err := DisableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "pi"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(res.PiExtension); !os.IsNotExist(err) {
		t.Fatalf("extension not removed: %v", err)
	}
}

// TestPiExtensionBlocksSleep loads the extension as pi does (call the default factory with an API whose on()
// records handlers) and calls the tool_call handler with pi's event for the bash tool. Node strips the
// TypeScript types (node >= 22.18 / 23.6 does it by default).
func TestPiExtensionBlocksSleep(t *testing.T) {
	useRepoHooks(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	data, wd := t.TempDir(), t.TempDir()
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "pi", Only: []string{"bash-guard"}}); err != nil {
		t.Fatal(err)
	}
	runner := filepath.Join(t.TempDir(), "run.mjs")
	js := `const mod = await import(process.argv[2])
const handlers = {}
await mod.default({ on: (ev, fn) => { handlers[ev] = fn } })
const call = handlers["tool_call"]
if (!call) throw new Error("no tool_call handler")
const ok = await call({ type: "tool_call", toolName: "bash", toolCallId: "c", input: { command: "echo hello" } }, {})
console.log(ok === undefined ? "PASS_ECHO" : "ECHO_BLOCKED " + JSON.stringify(ok))
const r = await call({ type: "tool_call", toolName: "bash", toolCallId: "c", input: { command: "sleep 120" } }, {})
console.log(r && r.block ? "BLOCKED: " + r.reason : "NOT_BLOCKED")
const e = await call({ type: "tool_call", toolName: "edit", toolCallId: "c", input: { path: "/tmp/x", edits: [{ oldText: "a", newText: "b" }] } }, {})
console.log(e === undefined ? "PASS_EDIT_NOT_ENABLED" : "EDIT_BLOCKED")
`
	if err := os.WriteFile(runner, []byte(js), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(node, runner, PiHookExtensionPath(wd)).CombinedOutput()
	s := string(out)
	if err != nil {
		if strings.Contains(s, "ERR_UNKNOWN_FILE_EXTENSION") {
			t.Skip("this node cannot strip TypeScript types")
		}
		t.Fatalf("node: %v\n%s", err, s)
	}
	if !strings.Contains(s, "PASS_ECHO") || !strings.Contains(s, "BLOCKED: [bothouse hook blocked]") || !strings.Contains(s, "PASS_EDIT_NOT_ENABLED") {
		t.Fatalf("unexpected output:\n%s", s)
	}
	t.Logf("%s", s)
}
