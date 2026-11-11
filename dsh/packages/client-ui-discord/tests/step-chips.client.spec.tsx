// @vitest-environment jsdom
// #125: step chips under a run strip — one chip per tool step, click shows call/output, failed in red.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { chipsOf, compactBrief, StepChips } from '../src/client/StepChips.tsx'
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
afterEach(() => { cleanup(); localStorage.clear() })

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

it.each(['run_command', 'read_file', 'mcp__server__search'])('groups every same-name %s call in a turn without losing individual outcomes or counting snapshot updates', tool => {
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
  expect(within(group()).getAllByRole('button').map(button => button.textContent)).toEqual([`${tool} ×3`, 'other'])
  fireEvent.click(chip(`${tool} ×3`, 'stepFailed'))
  const out = screen.getByRole('region', { name: tr('stepOutput', { tool }) })
  for (const text of ['first', 'done', 'second', 'denied', 'third']) expect(out.textContent).toContain(text)
  expect([...out.querySelectorAll('[data-state]')].map(step => step.getAttribute('data-state'))).toEqual(['ok', 'failed', 'running'])
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make()] })} />)
  expect(chip(`${tool} ×3`, 'stepFailed')).toBeTruthy()
  items.push({ kind: 'tool_result', tool, text: 'last done', success: true })
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make()] })} />)
  expect(chip(`${tool} ×3`, 'stepFailed')).toBeTruthy()
  expect(out.textContent).toContain('last done')
  // A second card is a separate turn, even for the same tool name.
  const next = { ...run(), id: 6, ...progressCardOf({ agent: '大豆包', state: 'running', steps: 1, items: [{ kind: 'tool_use', tool, text: 'new turn' }] }) }
  view.rerender(<ChannelsPage {...props({ ...base, messages: [make(), next] })} />)
  const groups = screen.getAllByRole('group', { name: zh.stepChips })
  expect(within(groups[1]!).getByRole('button', { name: `${tool} · ${zh.stepRunning}` })).toBeTruthy()
})

it('reads chips from a card and ignores malformed or missing ones', () => {
  expect(chipsOf({ chips: [{ tool: 'x', state: 'ok' }, { tool: 1, state: 'ok' }, { tool: 'y', state: 'weird' }, null] })).toEqual([{ tool: 'x', state: 'ok' }])
  expect(chipsOf({})).toBeUndefined()
  expect(chipsOf({ chips: [] })).toBeUndefined()
})

it('shows one chip per step with its outcome, failed marked as failed', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run()] })} />)
  expect(chip('bash', 'stepOk').dataset.state).toBe('ok')
  expect(chip('edit', 'stepFailed').dataset.state).toBe('failed')
  expect(chip('read', 'stepRunning').dataset.state).toBe('running')
  expect(screen.queryByText('✅ bash · 成功')).toBeNull()
})

it('opens a step call and output on click, one at a time, and closes again', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run()] })} />)
  fireEvent.click(chip('edit', 'stepFailed'))
  const out = screen.getByRole('region', { name: tr('stepOutput', { tool: 'edit' }) })
  expect(out.textContent).toContain('a.go')
  expect(out.textContent).toContain('permission denied')
  expect(out.dataset.state).toBe('failed')
  expect(chip('edit', 'stepFailed').getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(chip('bash', 'stepOk'))
  expect(screen.queryByRole('region', { name: tr('stepOutput', { tool: 'edit' }) })).toBeNull()
  expect(screen.getByRole('region', { name: tr('stepOutput', { tool: 'bash' }) }).textContent).toContain('go test ./...')
  fireEvent.click(chip('bash', 'stepOk'))
  expect(screen.queryByRole('region', { name: tr('stepOutput', { tool: 'bash' }) })).toBeNull()
})

it('keeps chips on a finished run in the brief view and the full lines in the detail view', () => {
  render(<ChannelsPage {...props({ ...base, messages: [run({ state: 'completed', title: '橘 · 已完成' })] })} />)
  expect(group()).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
  expect(screen.queryByRole('group', { name: zh.stepChips })).toBeNull()
  expect(screen.getByText(/bash — go test/)).toBeTruthy()
})

it('keeps the plain step lines for older cards without chips', () => {
  const view = render(<ChannelsPage {...props({ ...base, messages: [run({ chips: undefined })] })} />)
  expect(screen.queryByRole('group', { name: zh.stepChips })).toBeNull()
  expect(view.container.querySelector('[data-message-id="5"]')?.textContent).toContain('✅ bash · 成功')
})

it('counts same-name bash calls in first-seen order and exposes every call including failures', () => {
  const calls = [
    { tool: 'bash', state: 'ok', input: 'first', output: 'done' },
    { tool: 'Bash', state: 'failed', input: 'second', output: 'denied' },
    { tool: 'read', state: 'ok', input: 'a.go' },
    { tool: 'bash', state: 'running', input: 'third' },
    { tool: 'bash', state: 'ok', input: 'fourth', output: 'ok' },
  ]
  const text = ['第 5 步 · 9秒', ...calls.map(call => `🔧 ${call.tool} — ${call.input}`)].join('\n')
  const view = render(<ChannelsPage {...props({ ...base, messages: [{ ...run({ steps: 5, chips: calls }), text }] })} />)
  const buttons = within(group()).getAllByRole('button')
  expect(buttons.map(button => button.textContent)).toEqual(['bash ×4', 'read'])
  expect(buttons.map(button => button.dataset.state)).toEqual(['failed', 'ok'])
  fireEvent.click(buttons[0]!)
  const out = screen.getByRole('region', { name: tr('stepOutput', { tool: 'bash' }) })
  for (const text of ['first', 'done', 'second', 'denied']) expect(out.textContent).toContain(text)
  expect(out.querySelector('[data-state="failed"]')?.textContent).toContain('second')
  fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
  expect(screen.queryByRole('group', { name: zh.stepChips })).toBeNull()
  for (const call of calls) expect(view.container.querySelector('[data-message-id="5"]')?.textContent).toContain(call.input)
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

it('applies error color only to failed step output inside a mixed bash group', () => {
  const calls = [
    { tool: 'bash', state: 'ok', input: 'good-in', output: 'good-out' },
    { tool: 'bash', state: 'failed', input: 'bad-in', output: 'bad-out' },
    { tool: 'bash', state: 'running', input: 'pending-in' },
  ]
  render(<ChannelsPage {...props({ ...base, messages: [run({ chips: calls })] })} />)
  fireEvent.click(within(group()).getByRole('button'))
  // jsdom does not compute CSS variable colors; match the source error-color
  // selectors against the rendered DOM. Browser verification also checks computed colors.
  const styles = readFileSync('dsh/packages/client-ui-discord/src/client/ChannelsPage.module.css', 'utf8')
  const selectors = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , declarations]) => /(?:^|;)\s*color:\s*var\(--dsw-alias-state-error-primary\)/.test(declarations!))
    .map(([, selector]) => selector!.trim().replaceAll('.stepOut', `.${css.stepOut}`))
  expect(selectors.length).toBeGreaterThan(0)
  const out = screen.getByRole('region', { name: tr('stepOutput', { tool: 'bash' }) })
  const marked = [...out.querySelectorAll('code')]
    .filter(code => selectors.some(selector => code.matches(selector)))
    .map(code => code.textContent)
  expect(marked).toEqual(['bad-out'])
})

it('shows an open step of a finished or cancelled run as having no result, not running', () => {
  for (const state of ['completed', 'cancelled', 'failed']) {
    render(<ChannelsPage {...props({ ...base, messages: [run({ state, title: `橘 · ${state}` })] })} />)
    expect(chip('read', 'stepUnknown').dataset.state).toBe('unknown')
    expect(within(group()).queryByRole('button', { name: `read · ${zh.stepRunning}` })).toBeNull()
    cleanup()
  }
})
