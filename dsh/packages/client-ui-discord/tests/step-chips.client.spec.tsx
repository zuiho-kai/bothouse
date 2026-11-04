// @vitest-environment jsdom
// #125: step chips under a run strip — one chip per tool step, click shows call/output, failed in red.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { chipsOf } from '../src/client/StepChips.tsx'
import { readFileSync } from 'node:fs'
import css from '../src/client/ChannelsPage.module.css'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

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

it('counts consecutive bash calls, preserves tool order and exposes every call including failures', () => {
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
  expect(buttons.map(button => button.textContent)).toEqual(['bash ×2', 'read', 'bash ×2'])
  expect(buttons.map(button => button.dataset.state)).toEqual(['failed', 'ok', 'running'])
  fireEvent.click(buttons[0]!)
  const out = screen.getByRole('region', { name: tr('stepOutput', { tool: 'bash' }) })
  for (const text of ['first', 'done', 'second', 'denied']) expect(out.textContent).toContain(text)
  expect(out.querySelector('[data-state="failed"]')?.textContent).toContain('second')
  fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
  expect(screen.queryByRole('group', { name: zh.stepChips })).toBeNull()
  for (const call of calls) expect(view.container.querySelector('[data-message-id="5"]')?.textContent).toContain(call.input)
})

it('folds consecutive bash lines in old brief cards while keeping detail intact', () => {
  const brief = '第 5 步 · 9秒\n✅ bash · 成功\n❌ Bash · 失败\n✅ read · 成功\n🔧 bash · 进行中\n✅ bash · 成功'
  const text = '第 5 步 · 9秒\n🔧 bash — first\n🔧 Bash — second\n🔧 read — file\n🔧 bash — third\n🔧 bash — fourth'
  const view = render(<ChannelsPage {...props({ ...base, messages: [{ ...run({ steps: 5, chips: undefined, brief }), text }] })} />)
  const row = view.container.querySelector('[data-message-id="5"]')!
  expect(row.textContent).toContain('❌ bash ×2 · 失败')
  expect(row.textContent).toContain('✅ read · 成功')
  expect(row.textContent).toContain('🔧 bash ×2 · 进行中')
  fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
  for (const call of ['first', 'second', 'file', 'third', 'fourth']) expect(row.textContent).toContain(call)
  expect(row.textContent).not.toContain('×2')
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
