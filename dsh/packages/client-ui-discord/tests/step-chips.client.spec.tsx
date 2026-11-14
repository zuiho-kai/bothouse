// @vitest-environment jsdom
// #125: step chips under a run strip — one chip per kind of tool, click shows call/output, failed in red.
// #1616: a chip opens one line per call (the command cut to a line); a line opens its call and output, a long output folded.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { chipsOf, compactBrief, OUTPUT_LINES, StepChips, stepKind, stepLine } from '../src/client/StepChips.tsx'
import { readFileSync } from 'node:fs'
import css from '../src/client/ChannelsPage.module.css'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'
import { execFileSync } from 'node:child_process'

// Use Node for the producer: its filesystem-backed rules need native file URLs,
// whereas jsdom/Vite rewrites import.meta.url to an HTTP URL.
const progressCardOf = (payload: object): { text: string; card: string } => JSON.parse(execFileSync(process.execPath, [
  '--input-type=module', '-e',
  "import { progressCardOf } from './dsh/collab/cloudweb.mjs'; process.stdout.write(JSON.stringify(progressCardOf(JSON.parse(process.argv[1]))))",
  JSON.stringify(payload),
], { encoding: 'utf8' }))

// The 细节/简略 choice is remembered per room; start each case from the default.
afterEach(() => { cleanup(); globalThis.localStorage?.clear?.() })

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))
const chips = [
  { tool: 'bash', state: 'ok', input: 'go test ./...', output: 'ok' },
  { tool: 'edit', state: 'failed', input: 'a.go', output: 'permission denied' },
  { tool: 'read', state: 'running', input: 'b.go' },
]
const run = (over: Record<string, unknown> = {}): ChannelMessage => ({
  id: 5, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', created_at: 1, from_turn: null,
  text: '第 3 步 · 9秒\n🔧 bash — go test ./...\n• bash — ok',
  card: JSON.stringify({ title: '橘 · 处理中', state: 'running', steps: 3, brief: '第 3 步 · 9秒\n✅ bash · 成功\n❌ edit · 失败\n🔧 read · 进行中', chips, ...over }),
})
const base: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju', messages: [],
}
function props(state: ChannelSnapshot): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: tr,
  } as unknown as ChannelsPageProps
}
const group = () => screen.getByRole('group', { name: zh.stepChips })
const chip = (tool: string, st: keyof typeof zh) => within(group()).getByRole('button', { name: `${tool} · ${zh[st]}` })

const RUN = zh.toolRun, READ = zh.toolRead, EDIT = zh.toolEdit
/** The step list of the open chip. */
const list = (kind: string) => screen.getByRole('region', { name: tr('stepOutput', { tool: kind }) })

it.each([
  { states: ['ok', 'ok'], state: 'ok' },
  { states: ['ok', 'running'], state: 'running' },
  { states: ['unknown', 'ok'], state: 'unknown' },
  { states: ['failed', 'running', 'ok'], state: 'failed' },
] as const)('keeps existing mixed-outcome priority: $states -> $state', ({ states, state }) => {
  render(<StepChips chips={states.map(state => ({ tool: 'run_command', state, input: state }))} runState="running" t={tr} />)
  expect(within(group()).getAllByRole('button')).toHaveLength(1)
  expect(within(group()).getByRole('button').dataset.state).toBe(state)
})

it('compacts old run_command brief lines with the same status priority and preserves prose', () => {
  const brief = '第 4 步 · 9秒\n✅ run_command · 成功\n✅ read_file · 成功\n🔧 run_command · 进行中\n❌ run_command · 失败\n说明保持原样'
  expect(compactBrief(brief)).toBe('第 4 步 · 9秒\n❌ run_command ×3 · 失败\n✅ read_file · 成功\n说明保持原样')
})

it('names a step by its kind in the page language; a Codex title that is a command is a 运行 step with that command', () => {
  expect(stepKind({ tool: 'bash', state: 'ok', input: 'ls' }, tr)).toEqual({ kind: RUN, input: 'ls' })
  expect(stepKind({ tool: 'Read', state: 'ok' }, tr).kind).toBe(READ)
  expect(stepKind({ tool: 'Editing files', state: 'ok' }, tr).kind).toBe(EDIT)
  expect(stepKind({ tool: 'List files', state: 'ok' }, tr).kind).toBe(zh.toolList)
  expect(stepKind({ tool: "cat > add.py <<'PY' print(1 + 2) PY", state: 'ok' }, tr)).toEqual({ kind: RUN, input: "cat > add.py <<'PY' print(1 + 2) PY" })
  expect(stepKind({ tool: 'mcp__server__search', state: 'ok' }, tr).kind).toBe('search')
  expect(stepKind({ tool: 'Planning file inspection', state: 'ok' }, tr).kind).toBe('Planning file inspection')
})

it('cuts a call to one line: its first line, a heredoc body left out', () => {
  expect(stepLine("cat > fib.py <<'PY'\nprint(1)\nPY")).toBe("cat > fib.py <<'PY'")
  expect(stepLine("pwd; cat > /tmp/x.py <<'PY' from a import b try: pass PY")).toBe("pwd; cat > /tmp/x.py <<'PY' …")
  expect(stepLine('\n  go test ./...\n')).toBe('go test ./...')
  expect(stepLine(undefined)).toBe('')
})

it.each([['run_command', RUN], ['read_file', READ], ['mcp__server__search', 'search']])('groups every same-kind %s call in a turn without losing individual outcomes or counting snapshot updates', (tool, kind) => {
  const items = [
    { kind: 'tool_use', tool, text: 'first' },
    { kind: 'tool_result', tool, text: 'done', success: true },
    { kind: 'tool_use', tool: 'other', text: 'separate' },
    { kind: 'tool_result', tool: 'other', text: 'ok', success: true },
    { kind: 'tool_use', tool, text: 'second' },
    { kind: 'tool_result', tool, text: 'denied', success: false },
    { kind: 'tool_use', tool, text: 'third' },
  ]
  const make = () => ({ ...run(), ...progressCardOf({ agent: '大豆包', state: 'running', steps: 4, items }) })
  const view = render(<ChannelsPage {...props({ ...base, messages: [make()] })} />)
  expect(within(group()).getAllByRole('button').map(button => button.textContent)).toEqual([`${kind} ×3`, 'other'])
  fireEvent.click(chip(`${kind} ×3`, 'stepFailed'))
  // One line per call, in order, each with its own outcome.
  expect([...list(kind).querySelectorAll('[data-state]')].map(step => [step.textContent, step.getAttribute('data-state')]))
    .toEqual([['first', 'ok'], [`second${zh.stepFailed}`, 'failed'], ['third', 'running']])
  // A line opens its output.
  fireEvent.click(within(list(kind)).getByRole('button', { name: /second/ }))
  expect(list(kind).textContent).toContain('denied')
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make()] })} />)
  expect(chip(`${kind} ×3`, 'stepFailed')).toBeTruthy()
  items.push({ kind: 'tool_result', tool, text: 'last done', success: true })
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make()] })} />)
  expect(chip(`${kind} ×3`, 'stepFailed')).toBeTruthy()
  fireEvent.click(within(list(kind)).getByRole('button', { name: /third/ }))
  expect(list(kind).textContent).toContain('last done')
  // A second card is a separate turn, even for the same tool name.
  const next = { ...run(), id: 6, ...progressCardOf({ agent: '大豆包', state: 'running', steps: 1, items: [{ kind: 'tool_use', tool, text: 'new turn' }] }) }
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make(), next] })} />)
  const groups = screen.getAllByRole('group', { name: zh.stepChips })
  expect(within(groups[1]!).getByRole('button', { name: `${kind} · ${zh.stepRunning}` })).toBeTruthy()
})

it('reads chips from a card and ignores malformed or missing ones', () => {
  expect(chipsOf({ chips: [{ tool: 'x', state: 'ok' }, { tool: 1, state: 'ok' }, { tool: 'y', state: 'weird' }, null] })).toEqual([{ tool: 'x', state: 'ok' }])
  expect(chipsOf({})).toBeUndefined()
  expect(chipsOf({ chips: [] })).toBeUndefined()
})

it('shows one chip per kind with its outcome, failed marked as failed, and no 细节/简略 switch', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run()] })} />)
  expect(chip(RUN, 'stepOk').dataset.state).toBe('ok')
  expect(chip(EDIT, 'stepFailed').dataset.state).toBe('failed')
  expect(chip(READ, 'stepRunning').dataset.state).toBe('running')
  expect(screen.queryByText('✅ bash · 成功')).toBeNull()
  expect(screen.queryByRole('button', { name: zh.cardViewDetail })).toBeNull()
})

it('opens a one-step chip straight to its call and output, one chip at a time, and closes again', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run()] })} />)
  fireEvent.click(chip(EDIT, 'stepFailed'))
  const out = list(EDIT)
  expect(out.textContent).toContain('a.go')
  expect(out.textContent).toContain('permission denied')
  expect(out.dataset.state).toBe('failed')
  expect(chip(EDIT, 'stepFailed').getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(chip(RUN, 'stepOk'))
  expect(screen.queryByRole('region', { name: tr('stepOutput', { tool: EDIT }) })).toBeNull()
  expect(list(RUN).textContent).toContain('go test ./...')
  fireEvent.click(chip(RUN, 'stepOk'))
  expect(screen.queryByRole('region', { name: tr('stepOutput', { tool: RUN }) })).toBeNull()
})

it('keeps chips on a finished run and says how many steps failed', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run({ state: 'completed', title: '橘 · 已完成' })] })} />)
  expect(group()).toBeTruthy()
  const row = document.querySelector('[data-message-id="5"]')!
  expect(row.textContent).toContain(tr('runFailedSteps', { count: 1 }))
  // Under 橘's own name the strip says only 已完成.
  expect(row.textContent).not.toContain('橘 · 已完成')
  expect(row.textContent).toContain('已完成')
})

it('keeps the plain step lines and the 细节/简略 switch for older cards without chips', () => {
  const view = render(<ChannelsPage {...props({ ...base, messages: [run({ chips: undefined })] })} />)
  expect(screen.queryByRole('group', { name: zh.stepChips })).toBeNull()
  expect(view.container.querySelector('[data-message-id="5"]')?.textContent).toContain('✅ bash · 成功')
  expect(screen.getByRole('button', { name: zh.cardViewDetail })).toBeTruthy()
})

it('counts same-kind bash calls in first-seen order and lists every call including failures', () => {
  const calls = [
    { tool: 'bash', state: 'ok', input: 'first', output: 'done' },
    { tool: 'Bash', state: 'failed', input: 'second', output: 'denied' },
    { tool: 'read', state: 'ok', input: 'a.go' },
    { tool: 'bash', state: 'running', input: 'third' },
    { tool: 'bash', state: 'ok', input: 'fourth', output: 'ok' },
  ]
  render(<ChannelsPage {...props({ ...base, messages: [run({ steps: 5, chips: calls })] })} />)
  const buttons = within(group()).getAllByRole('button')
  expect(buttons.map(button => button.textContent)).toEqual([`${RUN} ×4`, READ])
  expect(buttons.map(button => button.dataset.state)).toEqual(['failed', 'ok'])
  fireEvent.click(buttons[0]!)
  const out = list(RUN)
  for (const text of ['first', 'second', 'third', 'fourth']) expect(out.textContent).toContain(text)
  expect(out.querySelector('[data-state="failed"]')?.textContent).toContain('second')
})

it('folds all same-name tool lines in old brief cards while keeping detail intact', () => {
  const brief = '第 5 步 · 9秒\n✅ bash · 成功\n❌ Bash · 失败\n✅ read · 成功\n🔧 bash · 进行中\n✅ bash · 成功'
  const text = '第 5 步 · 9秒\n🔧 bash — first\n🔧 Bash — second\n🔧 read — file\n🔧 bash — third\n🔧 bash — fourth'
  const view = render(<ChannelsPage {...props({ ...base, messages: [{ ...run({ steps: 5, chips: undefined, brief }), text }] })} />)
  const row = view.container.querySelector('[data-message-id="5"]')!
  expect(row.textContent).toContain('❌ bash ×4 · 失败')
  expect(row.textContent).toContain('✅ read · 成功')
  fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
  for (const call of ['first', 'second', 'file', 'third', 'fourth']) expect(row.textContent).toContain(call)
  expect(row.textContent).not.toContain('×4')
})

it('folds a long output to its first lines until 展开, and shows a long call whole when its line is opened', () => {
  const output = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
  const call = "cat > wordstat.py <<'PY'\nimport sys\nprint(len(sys.argv))\nPY"
  render(<ChannelsPage {...props({ ...base, messages: [run({ state: 'completed', chips: [{ tool: 'bash', state: 'ok', input: call, output }] })] })} />)
  fireEvent.click(chip(RUN, 'stepOk'))
  const out = list(RUN)
  expect(within(out).getByRole('button', { name: "cat > wordstat.py <<'PY'" })).toBeTruthy()
  expect(out.textContent).toContain('print(len(sys.argv))')
  expect(out.textContent).toContain(`line ${OUTPUT_LINES}`)
  expect(out.textContent).not.toContain(`line ${OUTPUT_LINES + 1}`)
  fireEvent.click(within(out).getByRole('button', { name: tr('stepOutputAll', { count: 30 - OUTPUT_LINES }) }))
  expect(out.textContent).toContain('line 30')
})

it('applies error color only to failed step output inside a mixed bash group', () => {
  const calls = [
    { tool: 'bash', state: 'ok', input: 'good-in', output: 'good-out' },
    { tool: 'bash', state: 'failed', input: 'bad-in', output: 'bad-out' },
    { tool: 'bash', state: 'running', input: 'pending-in' },
  ]
  render(<ChannelsPage {...props({ ...base, messages: [run({ chips: calls })] })} />)
  fireEvent.click(within(group()).getByRole('button'))
  for (const name of [/good-in/, /bad-in/]) fireEvent.click(within(list(RUN)).getByRole('button', { name }))
  // jsdom does not compute CSS variable colors; match the source error-color
  // selectors against the rendered DOM. Browser verification also checks computed colors.
  const styles = readFileSync('dsh/packages/client-ui-discord/src/client/ChannelsPage.module.css', 'utf8')
  const selectors = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , declarations]) => /(?:^|;)\s*color:\s*var\(--dsw-alias-state-error-primary\)/.test(declarations!))
    .map(([, selector]) => selector!.trim().replace(/\.(step\w+)/g, (_, name: string) => `.${(css as Record<string, string>)[name] ?? name}`))
  expect(selectors.length).toBeGreaterThan(0)
  const marked = [...list(RUN).querySelectorAll('pre')]
    .filter(pre => selectors.some(selector => { try { return pre.matches(selector) } catch { return false } }))
    .map(pre => pre.textContent)
  expect(marked).toEqual(['bad-out'])
})

it('shows an open step of a finished or cancelled run as having no result, not running', () => {
  for (const state of ['completed', 'cancelled', 'failed']) {
    render(<ChannelsPage {...props({ ...base, messages: [run({ state, title: `橘 · ${state}` })] })} />)
    expect(chip(READ, 'stepUnknown').dataset.state).toBe('unknown')
    expect(within(group()).queryByRole('button', { name: `${READ} · ${zh.stepRunning}` })).toBeNull()
    cleanup()
  }
})
