// @vitest-environment jsdom
// #1798 (user 11-19「默认头像就是对应软件的图标」): the members a plugin-only install seeds (DSH, Claude Code,
// Codex; no avatar picked) show their software's icon, matched on the member's cli/model, not a letter badge.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { memberLook } from '../src/client/Avatar.tsx'
import type { ChannelMember, ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))

it('memberLook reads the cli, the model (string or DSH route pair), and DSH for a CLI-less channel-host member', () => {
  expect(memberLook({ kind: 'dsh', cli: 'claude' })).toEqual({ cli: 'claude' })
  expect(memberLook({ kind: 'dsh', model: { provider: 'deepseek-official', model: 'deepseek-v4' } })).toEqual({ cli: 'dsh', model: 'deepseek-v4' })
  expect(memberLook({ kind: 'dsh', cli: 'codex', model: 'gpt-6' })).toEqual({ cli: 'codex', model: 'gpt-6' })
  expect(memberLook({ kind: 'bot' })).toEqual({})
  expect(memberLook(undefined)).toEqual({})
})

it('seeded members show their software icons in the title bar', () => {
  const members: ChannelMember[] = [
    { id: 'dsh', name: 'DSH', kind: 'dsh', online: true, model: null },
    { id: 'claude-code', name: 'Claude Code', kind: 'dsh', online: true, cli: 'claude', model: null },
    { id: 'codex', name: 'Codex', kind: 'dsh', online: true, cli: 'codex' },
    { id: 'me', name: '我', kind: 'human', online: true },
  ]
  const state: ChannelSnapshot = {
    phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }], roomId: 1,
    members, thinking: {}, leadId: 'dsh', effectiveLeadId: 'dsh', messages: [], tasks: [],
  } as unknown as ChannelSnapshot
  const props = {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: tr,
  } as unknown as ChannelsPageProps
  render(<ChannelsPage {...props} />)
  const team = screen.getByRole('group', { name: zh.headTeam })
  const src = (name: string) => within(team).getByRole('button', { name: new RegExp(`^${name}`) }).querySelector('img')?.getAttribute('src')
  expect(src('Claude Code')).toBe('collab/avatars/brand-claude.png')
  expect(src('Codex')).toBe('collab/avatars/brand-openai.png')
})
