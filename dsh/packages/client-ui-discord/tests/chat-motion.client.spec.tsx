// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
import { createLiveTracker, lastOwnEditable, trackLive, unreadCount, WITHDRAW_UNDO_MS } from '../src/client/chat-motion.ts'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/ChannelsPage.module.css'

afterEach(() => { cleanup(); vi.useRealTimers() })

const msg = (id: number, author_kind: ChannelMessage['author_kind'] = 'role', text = `m${id}`): ChannelMessage =>
  ({ id, room_id: 1, author_kind, author: author_kind === 'user' ? 'me' : 'ju', name: author_kind === 'user' ? '我' : '橘', text, created_at: id, card: null, from_turn: null })

const base: ChannelSnapshot = {
  phase: 'ready', error: undefined,
  rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {},
  leadId: 'ju', effectiveLeadId: 'ju', hasMoreOlder: false, outbox: [],
  messages: [msg(1), msg(2, 'user', 'hello')],
} as unknown as ChannelSnapshot

function props(get: () => ChannelSnapshot, extra: Partial<Record<string, unknown>> = {}): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(get()),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false,
    editMessage: vi.fn(async () => {}), withdrawMessage: vi.fn(async () => ({ stopped: [], stillRunning: [] })),
    loadOlder: vi.fn(async () => 0),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
    ...extra,
  } as unknown as ChannelsPageProps
}

describe('chat motion helpers', () => {
  it('animates only rows that arrive live, never the first fill, a room switch or an older page', () => {
    const tr = createLiveTracker()
    expect(trackLive(tr, 1, [msg(5), msg(6)]).size).toBe(0)
    expect([...trackLive(tr, 1, [msg(5), msg(6), msg(7), msg(8)]).entries()]).toEqual([[7, 0], [8, 1]])
    // An older page prepends lower ids: nothing new animates.
    expect([...trackLive(tr, 1, [msg(3), msg(4), msg(5), msg(6), msg(7), msg(8)]).keys()]).toEqual([7, 8])
    expect(trackLive(tr, 2, [msg(20)]).size).toBe(0)
  })

  it('caps the stagger slot so a burst does not trail on', () => {
    const tr = createLiveTracker()
    trackLive(tr, 1, [msg(1)])
    const fresh = trackLive(tr, 1, [msg(1), ...Array.from({ length: 9 }, (_, i) => msg(i + 2))])
    expect(Math.max(...fresh.values())).toBe(5)
  })

  it('counts unread rows written by others and finds your last editable message', () => {
    const rows = [msg(1), msg(2, 'user'), msg(3), msg(4, 'system')]
    expect(unreadCount(rows, 2)).toBe(2)
    expect(lastOwnEditable(rows, undefined)?.id).toBe(2)
    expect(lastOwnEditable(rows, 2)).toBeUndefined()
  })
})

describe('channels page interactions (#115)', () => {
  it('withdraws without a confirm dialog and can be undone within the window', async () => {
    vi.useFakeTimers()
    const confirm = vi.spyOn(window, 'confirm')
    const p = props(() => base)
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.messageWithdraw }))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByText(zh.withdrawPending)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.withdrawUndo }))
    expect(screen.queryByText(zh.withdrawPending)).toBeNull()
    await act(async () => { vi.advanceTimersByTime(WITHDRAW_UNDO_MS + 100) })
    expect(p.withdrawMessage).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('sends the withdrawal once the undo window has passed', async () => {
    vi.useFakeTimers()
    const p = props(() => base)
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.messageWithdraw }))
    await act(async () => { vi.advanceTimersByTime(WITHDRAW_UNDO_MS - 1) })
    expect(p.withdrawMessage).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(2) })
    expect(p.withdrawMessage).toHaveBeenCalledExactlyOnceWith(2)
    expect(screen.queryByRole('button', { name: zh.withdrawUndo })).toBeNull()
  })

  it('carries out a pending withdrawal when the page goes away', () => {
    vi.useFakeTimers()
    const p = props(() => base)
    const { unmount } = render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.messageWithdraw }))
    unmount()
    expect(p.withdrawMessage).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('↑ in an empty composer edits your last message; Esc returns to the composer', () => {
    render(<ChannelsPage {...props(() => base)} />)
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const editor = screen.getByLabelText(zh.messageEdit) as HTMLTextAreaElement
    expect(editor.value).toBe('hello')
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.queryByLabelText(zh.messageEdit)).toBeNull()
  })

  it('↑ with a draft keeps moving the caret instead of editing', () => {
    render(<ChannelsPage {...props(() => base)} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'draft' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.queryByLabelText(zh.messageEdit)).toBeNull()
  })

  it('a live row animates in once, history does not; scrolled up it shows the divider and the jump pill', () => {
    let state = base
    const p = props(() => state)
    const { container, rerender } = render(<ChannelsPage {...p} />)
    expect(container.querySelector(`.${css.enter}`)).toBeNull()
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    log.scrollTop = 200
    fireEvent.scroll(log)
    expect(screen.getByRole('button', { name: new RegExp(zh.jumpLatest) })).toBeTruthy()
    state = { ...base, messages: [...base.messages, msg(3), msg(4)] }
    rerender(<ChannelsPage {...p} />)
    expect(container.querySelector(`[data-message-id="3"]`)?.classList.contains(css.enter)).toBe(true)
    expect(container.querySelector(`[data-message-id="1"]`)?.classList.contains(css.enter)).toBe(false)
    expect(screen.getByText(zh.newMessagesDivider).getAttribute('role')).toBe('separator')
    expect(screen.getByRole('button', { name: new RegExp(zh.jumpLatest) }).textContent).toContain(zh.jumpLatestCount.replace('{count}', '2'))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh.jumpLatest) }))
    expect(screen.queryByRole('button', { name: new RegExp(zh.jumpLatest) })).toBeNull()
  })

  it('pages further back near the top while older rows remain', async () => {
    const p = props(() => ({ ...base, hasMoreOlder: true }) as ChannelSnapshot)
    render(<ChannelsPage {...p} />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    log.scrollTop = 10
    await act(async () => { fireEvent.scroll(log) })
    expect(p.loadOlder).toHaveBeenCalledTimes(1)
  })
})
