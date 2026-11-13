package dsh

// Steer self-heal (#1570). The bridge folds a message sent while a turn runs into that turn only
// when dsh-acp advertises "dsh/steer" (agent/acp/session_steer.go). Stock DSH does not; the patch
// lives in dsh/runtime-patches/dsh-acp-steer.patch and dsh/install.sh applies it, but any npm
// reinstall or upgrade of DSH drops it and nothing said so: 10-28 (new install path) and again
// 11-12 (agentm moved to hw190, DSH reinstalled), each time the busy bot only answered
// 「将在当前任务完成后处理」. Now every DSH session start checks the installed dsh-acp and puts the
// same three edits back when they are missing; when it cannot (unknown version, read-only
// install) it logs a warning that says busy messages will queue.

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

const steerHealMarker = `"dsh/steer"`

// steerEdit is one hunk of dsh-acp-steer.patch: anchor (found exactly once) is replaced by text,
// or, with before, text goes in front of it.
type steerEdit struct {
	anchor string
	text   string
	before bool
}

var steerEdits = []steerEdit{
	{
		anchor: "\t\tthis.assertActive();\n\t\tif (this.inflight !== void 0) throw invalidParams$1(\"a prompt is already in flight for this session\");",
		text: "\t\tthis.assertActive();\n" +
			"\t\t// [bothouse patch] Only a request that asks to steer (_meta \"dsh/steer\") joins a running prompt;\n" +
			"\t\t// any other busy prompt keeps the stock rejection.\n" +
			"\t\tif (params._meta?.[\"dsh/steer\"] === true) return this.steerPrompt(params, imageEnabled, requestSignal);\n" +
			"\t\tif (this.inflight !== void 0) throw invalidParams$1(\"a prompt is already in flight for this session\");",
	},
	{
		anchor: "\t/** Cancel the active prompt, or autonomous work when no ACP prompt exists. */\n\tcancel() {",
		text: "\t/**\n" +
			"\t* [bothouse patch] Busy-session prompt: hand the message to the running turn as\n" +
			"\t* agent.steer (consumed at the next model step, after the current tool call),\n" +
			"\t* and answer at once. Output keeps flowing through the in-flight prompt, which\n" +
			"\t* settles only after the steered work goes idle.\n" +
			"\t*/\n" +
			"\tasync steerPrompt(params, imageEnabled, requestSignal) {\n" +
			"\t\t// Steerable: a prompt whose own message is already queued and which is not being cancelled.\n" +
			"\t\t// Anything else is refused so the client queues the message; a steer never starts a turn.\n" +
			"\t\tconst steerable = () => {\n" +
			"\t\t\tconst inflight = this.inflight;\n" +
			"\t\t\treturn inflight !== void 0 && inflight.messageQueued && !inflight.admissionController.signal.aborted;\n" +
			"\t\t};\n" +
			"\t\tif (!steerable()) throw invalidParams$1(\"no running prompt to steer\");\n" +
			"\t\tconst controller = new AbortController();\n" +
			"\t\tconst onAbort = () => controller.abort(new Error(\"ACP steer request cancelled\"));\n" +
			"\t\trequestSignal?.addEventListener(\"abort\", onAbort, { once: true });\n" +
			"\t\ttry {\n" +
			"\t\t\tconst content = await admitAcpPrompt(this.ctx, this.modelControl.snapshot(), params.prompt, imageEnabled, controller.signal);\n" +
			"\t\t\tcontroller.signal.throwIfAborted();\n" +
			"\t\t\tif (!steerable()) throw invalidParams$1(\"no running prompt to steer\");\n" +
			"\t\t\tthis.agent.steer(createUserMessage({\n" +
			"\t\t\t\tcontent,\n" +
			"\t\t\t\tsource: { kind: \"user\" }\n" +
			"\t\t\t}));\n" +
			"\t\t\treturn {\n" +
			"\t\t\t\tstopReason: \"end_turn\",\n" +
			"\t\t\t\t_meta: { \"dsh/steered\": true }\n" +
			"\t\t\t};\n" +
			"\t\t} catch (error) {\n" +
			"\t\t\tif (error instanceof AcpContentError) throw error.kind === \"invalid\" ? invalidParams$1(error.message) : internalError$1(error.message);\n" +
			"\t\t\tif (error instanceof RequestError) throw error;\n" +
			"\t\t\tthrow internalError$1(`steer was not queued: ${error.message}`);\n" +
			"\t\t} finally {\n" +
			"\t\t\trequestSignal?.removeEventListener(\"abort\", onAbort);\n" +
			"\t\t}\n" +
			"\t}\n",
		before: true,
	},
	{
		anchor: "\t\t\t\t\t\tresume: {}\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\tauthMethods: []",
		text:   "\t\t\t\t\t\tresume: {}\n\t\t\t\t\t},\n\t\t\t\t\t_meta: { \"dsh/steer\": true }\n\t\t\t\t},\n\t\t\t\tauthMethods: []",
	},
}

// applySteerEdits returns src with the steer edits, or ok=false when any anchor is not found
// exactly once (a DSH version the patch was not written for).
func applySteerEdits(src string) (string, bool) {
	for _, ed := range steerEdits {
		if strings.Count(src, ed.anchor) != 1 {
			return src, false
		}
		repl := ed.text
		if ed.before {
			repl = ed.text + ed.anchor
		}
		src = strings.Replace(src, ed.anchor, repl, 1)
	}
	return src, true
}

// steerHealed remembers files already checked in this process, keyed by path and mtime.
var steerHealed sync.Map

// healSteer checks the dsh-acp the configured command runs and patches it when needed.
func healSteer(cmd string, args []string) {
	for _, js := range dshACPFiles(cmd, args) {
		fi, err := os.Stat(js)
		if err != nil {
			continue
		}
		key := js + "|" + fi.ModTime().String()
		if _, done := steerHealed.Load(key); done {
			return
		}
		steerHealed.Store(key, true)
		b, err := os.ReadFile(js)
		if err != nil {
			slog.Warn("dsh: cannot read dsh-acp; busy messages will queue instead of joining the turn", "file", js, "err", err)
			return
		}
		if strings.Contains(string(b), steerHealMarker) {
			return
		}
		out, ok := applySteerEdits(string(b))
		if !ok {
			slog.Warn("dsh: dsh-acp has no mid-turn input and the steer patch does not fit this DSH version; busy messages will queue", "file", js)
			return
		}
		if err := writeHealed(js, b, out, fi.Mode()); err != nil {
			slog.Warn("dsh: dsh-acp lost the steer patch (DSH reinstalled or upgraded) and the bridge cannot write it back; busy messages will queue. Rerun dsh/install.sh as the owner of the DSH install", "file", js, "err", err)
			return
		}
		steerHealed.Store(js+"|"+statTime(js), true)
		slog.Warn("dsh: dsh-acp had lost the steer patch (DSH reinstalled or upgraded); patched it back so busy messages join the running turn", "file", js, "backup", js+".bak-presteer")
		return
	}
}

func statTime(p string) string {
	if fi, err := os.Stat(p); err == nil {
		return fi.ModTime().String()
	}
	return ""
}

func writeHealed(js string, orig []byte, out string, mode os.FileMode) error {
	bak := js + ".bak-presteer"
	if _, err := os.Stat(bak); os.IsNotExist(err) {
		if err := os.WriteFile(bak, orig, mode.Perm()); err != nil {
			return err
		}
	}
	tmp := js + ".steer-tmp"
	if err := os.WriteFile(tmp, []byte(out), mode.Perm()); err != nil {
		return err
	}
	if err := os.Rename(tmp, js); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// dshACPFiles lists where the dsh-acp of the configured DSH may be: nested in the DSH package or
// hoisted next to it.
func dshACPFiles(cmd string, args []string) []string {
	pkg := dshPackageDir(cmd, args)
	if pkg == "" {
		return nil
	}
	return []string{
		filepath.Join(pkg, "node_modules", "@deepseek-ai", "dsh-acp", "lib", "index.js"),
		filepath.Join(filepath.Dir(pkg), "dsh-acp", "lib", "index.js"),
	}
}

// dshPackageDir finds the @deepseek-ai/dsh package directory from the command ("dsh" on PATH, a
// symlink to lib/bin.js) or, when the command is node, from its first .js argument.
func dshPackageDir(cmd string, args []string) string {
	var start string
	base := strings.ToLower(filepath.Base(cmd))
	if base == "node" || base == "node.exe" {
		for _, a := range args {
			if strings.HasSuffix(a, ".js") || strings.HasSuffix(a, ".mjs") {
				start = a
				break
			}
		}
	} else if cmd != "" {
		if p, err := exec.LookPath(cmd); err == nil {
			start = p
		}
	}
	if start == "" {
		return ""
	}
	if r, err := filepath.EvalSymlinks(start); err == nil {
		start = r
	}
	dir := filepath.Dir(start)
	for i := 0; i < 4 && dir != filepath.Dir(dir); i++ {
		if b, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil && strings.Contains(string(b), `"name": "@deepseek-ai/dsh"`) {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return ""
}

// StartSession checks the steer patch before each DSH session (cheap: one stat when unchanged).
func (a *Agent) StartSession(ctx context.Context, sessionID string) (core.AgentSession, error) {
	healSteer(a.cmd, a.args)
	return a.Agent.StartSession(ctx, sessionID)
}
