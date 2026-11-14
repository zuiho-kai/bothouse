/**
 * Step chips under a run strip: one chip per kind of tool (运行 ×3, 读文件) with its outcome;
 * a click lists that kind's calls one line each — the command cut to one line, like the Claude
 * Code / Codex step list — and a click on a line opens its full call and output, a long output
 * folded to its first lines (#1616, user 11-14「命令行省略没省略，一坨屎」). Data comes from the
 * progress card's `chips` (dsh/collab/cloudweb.mjs stepChips); older cards without it keep the
 * plain step lines.
 */
import { useState } from 'react'
import type { T } from './task-board.ts'
import css from './ChannelsPage.module.css'

export interface StepChip { readonly tool: string; readonly state: 'ok' | 'failed' | 'running' | 'unknown'; readonly input?: string; readonly output?: string }

const STATES = new Set(['ok', 'failed', 'running', 'unknown'])
/** The chips of a parsed card, or undefined when the card carries none (older cards). */
export function chipsOf(card: { chips?: unknown } | undefined): StepChip[] | undefined {
  if (!Array.isArray(card?.chips) || card.chips.length === 0) return undefined
  const chips = card.chips.filter((c): c is StepChip => c !== null && typeof c === 'object' && typeof c.tool === 'string' && STATES.has(c.state))
  return chips.length > 0 ? chips : undefined
}

const LABEL = { ok: 'stepOk', failed: 'stepFailed', running: 'stepRunning', unknown: 'stepUnknown' } as const

/**
 * #1616: the kind of a tool call, named in the page's language. Codex titles a shell call with the
 * command itself (「cat > add.py <<'PY' …」), so a title that reads as a command is a 运行 step and
 * the command is its input; DSH's own tools (bash, read, grep …) and the common Codex titles
 * (List files, Editing files) map to the same few words. Anything else keeps its own name
 * (an MCP tool shows its last segment).
 */
type KindKey = 'toolRun' | 'toolRead' | 'toolEdit' | 'toolWrite' | 'toolSearch' | 'toolList' | 'toolWeb' | 'toolPlan'
const KINDS: ReadonlyArray<readonly [RegExp, KindKey]> = [
  [/^(bash|shell|sh|zsh|run_?command|run_?shell|exec(ute)?(_command)?|terminal|command)$/i, 'toolRun'],
  [/^(read(_?file)?|view(_?file)?|open(_?file)?|read files?|reading files?)$/i, 'toolRead'],
  [/^(edit(_?file)?|editing files?|edit files?|apply_?patch|str_replace(_editor)?|multi_?edit|patch)$/i, 'toolEdit'],
  [/^(write(_?file)?|create(_?file)?|writing files?)$/i, 'toolWrite'],
  [/^(grep|search(_?files?)?|searching( files)?|codebase_search)$/i, 'toolSearch'],
  [/^(glob|list(_?dir(ectory)?)?|list files|listing files)$/i, 'toolList'],
  [/^(web_?fetch|fetch|web_?search|browse)$/i, 'toolWeb'],
  [/^(todo_?write|update_?plan|plan)$/i, 'toolPlan'],
]
/** A title that is a shell command, not a tool name: shell punctuation or a path, not a short English phrase. */
const looksLikeCommand = (title: string): boolean => /[\s;|&<>$`=/]/.test(title) && !/^[A-Z][a-z]+( [a-z]+)*$/.test(title)

export function stepKind(chip: StepChip, t: T): { kind: string; input: string | undefined } {
  const name = chip.tool.trim()
  for (const [re, key] of KINDS) if (re.test(name)) return { kind: t(key), input: chip.input }
  if (name === '' || looksLikeCommand(name)) {
    // Codex: the title is the command; the input repeats it (or is a JSON of it): keep the longer.
    const input = chip.input !== undefined && chip.input.length >= name.length ? chip.input : name
    return { kind: t('toolRun'), input: input === '' ? undefined : input }
  }
  const mcp = /^mcp__.+?__(.+)$/.exec(name)
  return { kind: mcp ? mcp[1]! : name, input: chip.input }
}

/** One line of a call for the step list: its first non-empty line, a heredoc body left out. */
export function stepLine(input: string | undefined): string {
  if (input === undefined) return ''
  const first = input.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  // Older cards squashed the call onto one line: cut it at the heredoc marker too.
  const heredoc = /^(.*?<<-?\s*['"]?\w+['"]?)\s+\S/.exec(first)
  return heredoc ? `${heredoc[1]} …` : first
}

export const OUTPUT_LINES = 4 // 来源：交接参照「像 Claude Code、Codex 的进度卡，长输出默认折叠」，Claude Code 只露输出开头几行再写「+N 行」

interface StepGroup { kind: string; state: StepChip['state']; steps: Array<StepChip & { line: string; call: string | undefined }> }

/** 用户 2026-11-11：同一轮所有同名工具显示 ×N；沿用失败 > 在途 > 未知 > 成功。 */
function groupTools(chips: readonly StepChip[], t: T): StepGroup[] {
  const groups: StepGroup[] = []
  const byKind = new Map<string, StepGroup>()
  for (const chip of chips) {
    const { kind, input } = stepKind(chip, t)
    const step = { ...chip, call: input, line: stepLine(input) }
    const key = kind.toLowerCase()
    const previous = byKind.get(key)
    if (previous) {
      previous.steps.push(step)
      const states = [previous.state, chip.state]
      previous.state = states.includes('failed') ? 'failed' : states.includes('running') ? 'running' : states.includes('unknown') ? 'unknown' : 'ok'
    } else {
      const group = { kind, state: chip.state, steps: [step] }
      groups.push(group)
      byKind.set(key, group)
    }
  }
  return groups
}

/** Older cards have only brief text; recognize the producer's tool lines, leave other prose intact. */
export function compactBrief(brief: string): string {
  const lines = brief.split('\n').map(line => {
    const match = /^(✅|❌|🔧) (.+?)(?: · (成功|失败|进行中))?$/.exec(line)
    const state: StepChip['state'] = match?.[1] === '❌' ? 'failed' : match?.[1] === '✅' ? 'ok' : match?.[3] === '进行中' ? 'running' : 'unknown'
    return { tool: match?.[2] ?? '', state, output: line }
  })
  const groups: Array<{ tool: string; state: StepChip['state']; steps: typeof lines }> = []
  const byTool = new Map<string, (typeof groups)[number]>()
  for (const line of lines) {
    const key = line.tool.toLowerCase()
    const previous = key ? byTool.get(key) : undefined
    if (previous) {
      previous.steps.push(line)
      const states = [previous.state, line.state]
      previous.state = states.includes('failed') ? 'failed' : states.includes('running') ? 'running' : states.includes('unknown') ? 'unknown' : 'ok'
    } else {
      const group = { tool: line.tool, state: line.state, steps: [line] }
      groups.push(group)
      // Empty names represent non-tool lines in older brief cards.
      if (key) byTool.set(key, group)
    }
  }
  return groups.map(group => {
    if (group.steps.length === 1) return group.steps[0]!.output
    const status = { failed: '❌', ok: '✅', running: '🔧', unknown: '🔧' }[group.state]
    const suffix = { failed: ' · 失败', ok: ' · 成功', running: ' · 进行中', unknown: '' }[group.state]
    return `${status} ${group.tool} ×${group.steps.length}${suffix}`
  }).join('\n')
}

export const CHAT_RUN_STEPS = 3 // 沿用已有配置：#1588 聊天频道里在跑的活只显示最近几步

/**
 * #1616 返工（用户 11-14「一长串 ### 被右边切掉…输出里还空了一行再出现 [...]」）：工具自己在中间砍掉的
 * 一段（空行、[...]、空行）合成一行省略号；结尾空行不算行。
 */
export function outputLines(text: string): string[] {
  const lines = text.replace(/\n*^[ \t]*\[\.\.\.\][ \t]*$\n*/gm, '\n…\n').split('\n')
  while (lines.length > 1 && lines[lines.length - 1]!.trim() === '') lines.pop()
  while (lines.length > 1 && lines[0]!.trim() === '') lines.shift()
  return lines
}

/**
 * A step's output, its first OUTPUT_LINES lines until 「展开全部」. Folded, each line is one row cut
 * with an ellipsis; opened, long lines wrap — nothing runs off the right edge.
 */
function StepOutput({ text, t }: { text: string; t: T }) {
  const [all, setAll] = useState(false)
  const lines = outputLines(text)
  const long = lines.length > OUTPUT_LINES
  return (
    <div className={css.stepField}>
      <span>{t('stepResult')}</span>
      {long && !all
        ? <div className={`${css.stepPre} ${css.stepPreFolded}`}>{lines.slice(0, OUTPUT_LINES).map((line, i) => <div key={i} title={line}>{line === '' ? '\u00a0' : line}</div>)}</div>
        : <pre className={css.stepPre}>{lines.join('\n')}</pre>}
      {long && (
        <button type="button" className={css.stepMore} onClick={() => { setAll(!all) }}>
          {all ? t('stepOutputLess') : t('stepOutputAll', { count: String(lines.length - OUTPUT_LINES) })}
        </button>
      )}
    </div>
  )
}

export function StepChips({ chips: given, runState, t, latest }: { chips: readonly StepChip[]; runState?: string; t: T; latest?: number }) {
  const [open, setOpen] = useState<number>()
  const [line, setLine] = useState<number>()
  // A step can only still run while its run does: once the card is done, failed or cancelled,
  // an open step has no reported outcome.
  const chips = runState === 'running' ? given : given.map(c => c.state === 'running' ? { ...c, state: 'unknown' as const } : c)
  const all = groupTools(chips, t)
  const groups = latest !== undefined && all.length > latest ? all.slice(-latest) : all
  const hidden = all.length - groups.length
  const shown = open === undefined ? undefined : groups[open]
  return (
    <div className={css.stepChips} role="group" aria-label={t('stepChips')}>
      {hidden > 0 && <span className={css.stepChip} data-state="unknown" data-steps-folded>{t('stepsFolded', { total: String(chips.length) })}</span>}
      {groups.map((chip, i) => {
        const detail = chip.steps.some(step => step.call !== undefined || step.output !== undefined)
        const name = `${chip.kind}${chip.steps.length > 1 ? ` ×${chip.steps.length}` : ''}`
        const label = `${name} · ${t(LABEL[chip.state])}`
        return (
          <button key={i} type="button" className={css.stepChip} data-state={chip.state} aria-expanded={detail ? open === i : undefined}
            disabled={!detail} title={label} aria-label={label} onClick={() => { setOpen(open === i ? undefined : i); setLine(undefined) }}>
            <span className={css.stepMark} aria-hidden />
            <b>{name}</b>
          </button>
        )
      })}
      {shown !== undefined && (
        <div className={css.stepOut} data-state={shown.state} role="region" aria-label={t('stepOutput', { tool: shown.kind })}>
          {shown.steps.map((step, i) => {
            const single = shown.steps.length === 1
            const opened = single || line === i
            return (
              <div key={i} className={css.stepRow} data-state={step.state}>
                <button type="button" className={css.stepLine} aria-expanded={single ? undefined : opened} disabled={single}
                  title={step.line} onClick={() => { setLine(line === i ? undefined : i) }}>
                  <span className={css.stepMark} aria-hidden />
                  <code>{step.line || shown.kind}</code>
                  {step.state === 'failed' && <em>{t('stepFailed')}</em>}
                </button>
                {opened && (step.call !== undefined && step.call !== step.line || step.output !== undefined) && (
                  <div className={css.stepDetail}>
                    {step.call !== undefined && step.call !== step.line && <div className={css.stepField}><span>{t('stepInput')}</span><pre className={css.stepPre}>{step.call}</pre></div>}
                    {step.output !== undefined && <StepOutput text={step.output} t={t} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
