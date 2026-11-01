# Workflow hooks across CLI backends

`bothouse setup hooks on --cli <cli> --work-dir <role>` installs the workflow
hooks for Claude Code, Codex, Gemini CLI, Grok and DSH. Installation does not
prove that a CLI has trusted the project or executed its hooks.

| Backend | Code map dispatch | Map completion | Long commands |
| --- | --- | --- | --- |
| Claude Code | `Agent` / `Task`, `updatedInput.prompt` | `SubagentStop` | Existing child timeout cap and `long-task` definition |
| Codex | `spawn_agent`, `updatedInput.message` | `SubagentStop`, converted child rollout | Use native shell sessions; the Bash hook contract only documents rewriting `command`, so this adapter does not claim a portable 290-second timeout cap |
| Gemini CLI | `invoke_agent`, `hookSpecificOutput.tool_input.prompt` | `AfterTool` for `invoke_agent` | Use native `is_background`; the shell tool does not expose Claude's per-call `timeout` or its custom-agent cache policy |
| Grok | `spawn_subagent`, `updatedInput.prompt` | `SubagentStop`, converted ACP transcript | Child `block_until_ms` is capped at 290000; `0` requests immediate background execution |
| DSH | `subagent` / `subagent_fork`; denial supplies rewritten retry arguments | `SubagentStop`, converted child session | Child `timeoutMs` is capped by denial plus retry; the native shell promotes on timeout when background support is enabled |

DSH's official Claude Code bridge explicitly ignores `updatedInput`. Returning
an allow with rewritten arguments would therefore silently lose the map and
timeout cap. The adapter instead rejects that call with the complete native
arguments to retry. A map path already present in the prompt prevents another
rewrite. This is a model retry, not an automatic in-place rewrite.

Only Claude Code gets the Claude-specific `long-task` definition. Other backends
get instructions to start long work in their native background, return its
task/session ID or log, and finish the turn. No model, cache lifetime or concurrency
setting is changed. Foreground polling loops are rejected by the shared shell
guard for all five backends.

Codex file patches are checked per file, including move destinations. Native
Codex rollouts and Grok ACP transcripts are normalized before checks that read
the latest user request, prior tool calls or completion claims.

## Protocol sources

- [Codex hooks](https://learn.chatgpt.com/docs/hooks): local function tools,
  `spawn_agent` alias, replacement arguments, Bash `command`, `SubagentStop`,
  and project/hook trust.
- [Gemini hook reference](https://geminicli.com/docs/hooks/reference):
  `BeforeTool` input rewriting and `AfterTool` result fields.
  The distributed Gemini CLI bundle's `packages/core/src/agents/agent-tool.ts`
  defines `invoke_agent` with `agent_name` and `prompt`;
  `packages/core/src/tools/shell.ts` defines `is_background`.
- Grok's distributed `docs/user-guide/10-hooks.md`: tool aliases, input rewriting,
  `subagentType`, `SubagentStop`, and ACP transcript format;
  `16-subagents.md`: `spawn_subagent.prompt`;
  `20-background-tasks.md`: `block_until_ms` and background task IDs.
- Official `@deepseek-ai/dsh-hooks-claude-code` 0.2.1-rc.2,
  `lib/index.js:109,195`: `updatedInput` is ignored.
  Official `@deepseek-ai/dsh-tool-bash`, `lib/index.js:182,233,506`:
  promotion on timeout and native `timeoutMs`.

## Verification boundaries

`test_workflow_clis.py` exercises the installed runner protocol and catches input
rewrite loss, wrong native argument names, retry behavior, patch handling,
transcript conversion and map completion. The Go
`TestWorkflowHooksInstalledAcrossTeamCLIs` checks installation for all five.
These are protocol/installation tests, not live-model acceptance.

For live acceptance, use isolated HOME/data/ports and the CLI's normal project
trust mechanism. Check the actual hook denial, the child receiving the map, and
the running command returning a background handle. Record these separately;
successful setup or a simulated hook payload cannot substitute for them.
