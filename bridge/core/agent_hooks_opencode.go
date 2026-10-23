package core

import (
	"fmt"
	"os"
	"path/filepath"
)

// OpenCode loads every .opencode/{plugin,plugins}/*.{ts,js} file of a project by itself
// (sst/opencode v1.19.4 packages/opencode/src/config/plugin.ts:21, called for .opencode dirs at
// config/config.ts:476-478), so the plugin needs no entry in opencode.json.

// OpenCodePluginPath is the bothouse hook plugin inside the role's work_dir.
func OpenCodePluginPath(workDir string) string {
	return filepath.Join(workDir, ".opencode", "plugins", "bothouse-hooks.js")
}

// OpenCodePluginScriptJS runs the role's Claude Code PreToolUse hooks (the same .claude/settings.json the other
// CLIs use, so the enabled set and the on/off switch stay in one place) before each OpenCode tool call.
//
// OpenCode side (sst/opencode v1.19.4):
//   - a legacy plugin is any exported function; each is called with the plugin input and returns hooks
//     (packages/opencode/src/plugin/index.ts:99-124); every export is taken as a plugin, so the module
//     exports BothouseHooks only (an exported helper is called as a plugin, returns undefined and breaks every hook);
//   - the hook key is the flat "tool.execute.before": (input {tool, sessionID, callID}, output {args})
//     (packages/plugin/src/index.ts:266-269), awaited before the tool runs (packages/opencode/src/session/tools.ts:105-111,
//     plugin/index.ts:290-294), so a thrown error stops the call;
//   - the shell tool's id is "bash" (packages/opencode/src/tool/shell/id.ts:14-16), argument command; edit/write
//     take filePath/oldString/newString/content (tool/edit.ts:47-50, tool/write.ts:20-22).
//   - for model ids containing "gpt-" (except oss/gpt-4) OpenCode offers apply_patch instead of edit/write
//     (packages/opencode/src/tool/registry.ts:297-300); its only argument is patchText in the
//     "*** Begin Patch / *** Add File: / *** Update File: / *** Delete File: / *** End Patch" format
//     (tool/apply_patch.ts:18-20, tool/apply_patch.txt), so each Add File becomes a Write {file_path, content}
//     and each Update File an Edit {file_path, old_string, new_string} (context and "-" lines vs context and
//     "+" lines), and the hooks run once per file. Delete File has no Claude Code counterpart and is not mapped.
//
// Claude Code side: exit 2 blocks with stderr as the reason; exit 0 with hookSpecificOutput.permissionDecision
// "deny" blocks; anything else lets the call run (a broken hook must not block every call), with one line on
// stderr so a broken hook is not silent.
const OpenCodePluginScriptJS = `// bothouse: runs this role's Claude Code PreToolUse hooks (.claude/settings.json) before OpenCode tool calls.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WORK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SETTINGS = path.join(WORK_DIR, ".claude", "settings.json")

const CC_TOOL = { bash: "Bash", read: "Read", write: "Write", edit: "Edit", task: "Agent", webfetch: "WebFetch" }
const CC_ARG = { filePath: "file_path", oldString: "old_string", newString: "new_string", replaceAll: "replace_all" }

function preToolUse() {
  let text
  try {
    text = fs.readFileSync(SETTINGS, "utf-8")
  } catch (e) {
    if (e && e.code !== "ENOENT") console.error("[bothouse hooks] cannot read " + SETTINGS + ": " + e.message)
    return []
  }
  try {
    const s = JSON.parse(text)
    return (s.hooks && s.hooks.PreToolUse) || []
  } catch (e) {
    console.error("[bothouse hooks] " + SETTINGS + " is not valid JSON, hooks skipped: " + e.message)
    return []
  }
}

// apply_patch (GPT models) -> one Claude Code Write/Edit call per file in the patch.
function patchCalls(patchText) {
  const calls = []
  let cur = null
  const flush = () => {
    if (!cur) return
    if (cur.kind === "add") {
      calls.push({ tool: "Write", input: { file_path: cur.path, content: cur.plus.join("\n") + (cur.plus.length ? "\n" : "") } })
    } else {
      calls.push({ tool: "Edit", input: { file_path: cur.path, old_string: cur.old.join("\n"), new_string: cur.new.join("\n") } })
    }
    cur = null
  }
  for (const line of String(patchText || "").replace(/\r\n?/g, "\n").split("\n")) {
    let m
    if ((m = line.match(/^\*\*\* Add File: (.+)$/))) {
      flush()
      cur = { kind: "add", path: path.resolve(WORK_DIR, m[1].trim()), plus: [] }
    } else if ((m = line.match(/^\*\*\* Update File: (.+)$/))) {
      flush()
      cur = { kind: "update", path: path.resolve(WORK_DIR, m[1].trim()), old: [], new: [] }
    } else if (/^\*\*\* (Delete File:|End Patch|Begin Patch)/.test(line)) {
      flush()
    } else if (!cur || /^\*\*\* (Move to:|End of File)/.test(line)) {
      continue
    } else if (cur.kind === "add") {
      if (line.startsWith("+")) cur.plus.push(line.slice(1))
    } else if (line.startsWith("@@")) {
      continue
    } else if (line.startsWith("-")) {
      cur.old.push(line.slice(1))
    } else if (line.startsWith("+")) {
      cur.new.push(line.slice(1))
    } else {
      const ctx = line.startsWith(" ") ? line.slice(1) : line
      cur.old.push(ctx)
      cur.new.push(ctx)
    }
  }
  flush()
  return calls
}

function matches(matcher, names) {
  if (!matcher || matcher === "*") return true
  return matcher.split("|").some((m) => names.includes(m))
}

async function runCall(tool, ccTool, toolInput, sessionID) {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: sessionID,
    tool_name: ccTool,
    tool_input: toolInput,
    cwd: WORK_DIR,
  })
  for (const group of preToolUse()) {
    if (!matches(group.matcher, [tool, ccTool])) continue
    for (const h of group.hooks || []) {
      if (h.type !== "command" || !h.command) continue
      const p = spawnSync(h.command, {
        shell: true,
        input: payload,
        encoding: "utf-8",
        cwd: WORK_DIR,
        timeout: (h.timeout || 60) * 1000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: WORK_DIR },
      })
      if (p.status === 2) {
        throw new Error("[bothouse hook blocked] " + ((p.stderr || "").trim() || "blocked"))
      }
      if (p.status !== 0) {
        const why = p.error ? p.error.message : p.signal ? "killed by " + p.signal : "exit " + p.status
        console.error("[bothouse hooks] " + h.command + " failed (" + why + "), " + ccTool + " call let through")
        continue
      }
      let res
      try {
        res = JSON.parse((p.stdout || "").trim())
      } catch (e) {
        continue
      }
      const hso = res && res.hookSpecificOutput
      if (hso && hso.permissionDecision === "deny") {
        throw new Error("[bothouse hook blocked] " + (hso.permissionDecisionReason || "blocked"))
      }
    }
  }
}

async function runBothouseHooks(input, output) {
  const tool = (input && input.tool) || ""
  const args = (output && output.args) || {}
  const sessionID = (input && input.sessionID) || ""
  if (tool === "apply_patch") {
    for (const c of patchCalls(args.patchText)) await runCall(tool, c.tool, c.input, sessionID)
    return
  }
  const toolInput = {}
  for (const [k, v] of Object.entries(args)) toolInput[CC_ARG[k] || k] = v
  await runCall(tool, CC_TOOL[tool] || tool, toolInput, sessionID)
}

export const BothouseHooks = async () => ({ "tool.execute.before": runBothouseHooks })
`

// EnsureOpenCodeHookPlugin writes the plugin into workDir/.opencode/plugins.
func EnsureOpenCodeHookPlugin(workDir string) (string, error) {
	p := OpenCodePluginPath(workDir)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", fmt.Errorf("create opencode plugins dir: %w", err)
	}
	if err := AtomicWriteFile(p, []byte(OpenCodePluginScriptJS), 0o644); err != nil {
		return "", fmt.Errorf("write opencode plugin: %w", err)
	}
	return p, nil
}

// RemoveOpenCodeHookPlugin removes the plugin file.
func RemoveOpenCodeHookPlugin(workDir string) error {
	if err := os.Remove(OpenCodePluginPath(workDir)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
