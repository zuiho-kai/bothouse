package core

import (
	"fmt"
	"os"
	"path/filepath"
)

// Pi (@earendil-works/pi-coding-agent) has no hook config file; it has extensions, and an extension's
// "tool_call" handler runs before every tool call and can return {block, reason}
// (earendil-works/pi@936e5f4 packages/coding-agent/docs/extensions.md:218,282-289,
// src/core/extensions/types.ts:1454-1457, src/core/agent-session.ts:663-680; a handler that throws also
// blocks the call, docs/extensions.md:375).
//
// Project extensions under .pi/extensions load only after project trust, and json/rpc mode (how bothouse runs
// pi) cannot ask, so with the default "ask" they are skipped (docs/security.md "Project trust without an
// interactive prompt"). Command-line extensions always load, so bothouse keeps the file outside .pi/extensions
// (a .pi dir holding other files needs no trust, docs/security.md "Resources protected by project trust") and
// the pi agent passes it with --extension (src/cli/args.ts:186-188) when it exists.

// PiHookExtensionPath is the bothouse hook extension inside the role's work_dir.
func PiHookExtensionPath(workDir string) string {
	return filepath.Join(workDir, ".pi", "bothouse-hooks.ts")
}

// PiHookExtensionTS runs the role's Claude Code PreToolUse hooks (the same .claude/settings.json the other
// CLIs use, so the enabled set and the on/off switch stay in one place) before each pi tool call.
//
// Pi side: tool names bash/read/write/edit, arguments command; path/content; path/edits[{oldText,newText}]
// (src/core/tools/bash.ts:40-42,418, write.ts:11-13,50, edit.ts:21-35,149, read.ts:14-15,94).
// Claude Code side: exit 2 blocks with stderr as the reason; exit 0 with hookSpecificOutput.permissionDecision
// "deny" blocks; anything else lets the call run (a broken hook must not block every call).
const PiHookExtensionTS = `// bothouse: runs this role's Claude Code PreToolUse hooks (.claude/settings.json) before pi tool calls.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WORK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SETTINGS = path.join(WORK_DIR, ".claude", "settings.json")

const CC_TOOL: Record<string, string> = { bash: "Bash", read: "Read", write: "Write", edit: "Edit" }

function preToolUse(): any[] {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, "utf-8"))
    return (s.hooks && s.hooks.PreToolUse) || []
  } catch (e) {
    return []
  }
}

function matches(matcher: string | undefined, names: string[]): boolean {
  if (!matcher || matcher === "*") return true
  return matcher.split("|").some((m) => names.includes(m))
}

function toolInput(tool: string, input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...input }
  if (typeof input.path === "string") out.file_path = input.path
  if (tool === "edit" && Array.isArray(input.edits)) {
    out.old_string = input.edits.map((e: any) => (e && e.oldText) || "").join("\n")
    out.new_string = input.edits.map((e: any) => (e && e.newText) || "").join("\n")
  }
  return out
}

export function runBothouseHooks(tool: string, input: Record<string, any>, sessionId: string): string | undefined {
  const ccTool = CC_TOOL[tool] || tool
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: sessionId || "",
    tool_name: ccTool,
    tool_input: toolInput(tool, input || {}),
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
      if (p.status === 2) return (p.stderr || "").trim() || "blocked"
      // Deliberately follows Claude Code: a hook that errors, times out or exits non-0/non-2 lets the call
      // through (fail-open). pi docs/extensions.md:218 suggests fail-closed for tool_call handlers; we keep
      // Claude Code semantics so the same hooks behave the same under every CLI.
      if (p.status !== 0) continue
      let res: any
      try {
        res = JSON.parse((p.stdout || "").trim())
      } catch (e) {
        continue
      }
      const hso = res && res.hookSpecificOutput
      if (hso && hso.permissionDecision === "deny") return hso.permissionDecisionReason || "blocked"
    }
  }
  return undefined
}

export default function (pi: any) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    let sid = ""
    try {
      sid = (ctx && ctx.sessionManager && ctx.sessionManager.getSessionId && ctx.sessionManager.getSessionId()) || ""
    } catch (e) {}
    const reason = runBothouseHooks(event.toolName, event.input, sid)
    if (reason) return { block: true, reason: "[bothouse hook blocked] " + reason }
    return undefined
  })
}
`

// EnsurePiHookExtension writes the extension into workDir/.pi.
func EnsurePiHookExtension(workDir string) (string, error) {
	p := PiHookExtensionPath(workDir)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", fmt.Errorf("create pi dir: %w", err)
	}
	if err := AtomicWriteFile(p, []byte(PiHookExtensionTS), 0o644); err != nil {
		return "", fmt.Errorf("write pi hook extension: %w", err)
	}
	return p, nil
}

// RemovePiHookExtension removes the extension file.
func RemovePiHookExtension(workDir string) error {
	if err := os.Remove(PiHookExtensionPath(workDir)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// PiHookExtensionArgs is the --extension argument for the role's hook extension, nil when it is not installed.
func PiHookExtensionArgs(workDir string) []string {
	p := PiHookExtensionPath(workDir)
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if _, err := os.Stat(p); err != nil {
		return nil
	}
	return []string{"--extension", p}
}
