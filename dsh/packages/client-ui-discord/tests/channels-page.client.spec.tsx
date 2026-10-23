// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ready: ChannelSnapshot = {
  phase: 'ready', error: undefined,
  rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: { 1: ['ju'] },
  messages: [{ id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '<script>alert(1)</script>', created_at: 1, card: null, from_turn: null }],
}

function props(state: ChannelSnapshot, send: ChannelsPageProps['send'] = async () => {}): ChannelsPageProps {
  // This panel consumes only its private injected seats; unused main-panel
  // framework seats are deliberately absent so an accidental new read fails.
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send,
    createRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
  } as unknown as ChannelsPageProps
}

describe('channels page', () => {
  it('renders a room with a message and a configure-model card without throwing', () => {
    // Regression: the message list once referenced a prop the page never destructured,
    // so any room with a message threw and blanked the whole main panel.
    const card = JSON.stringify({ title: 'model', state: 'error', action: 'configure-model' })
    const withCard: ChannelSnapshot = { ...ready, messages: [...ready.messages, { ...ready.messages[0], id: 2, text: 'need model', card }] }
    expect(() => render(<ChannelsPage {...props(withCard)} />)).not.toThrow()
    expect(screen.getByText('need model')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.configureModel })).toBeTruthy()
  })

  it('renders configured rooms, members, working state and message text without interpreting HTML', () => {
    const view = render(<ChannelsPage {...props(ready)} />)
    expect(screen.getByRole('button', { name: 'general' })).toBeTruthy()
    expect(screen.getByText('橘 正在输入…')).toBeTruthy()
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(view.container.querySelector('script')).toBeNull()
    view.rerender(<ChannelsPage {...props({ ...ready, phase: 'unavailable' })} />)
    expect(screen.getByRole('status').textContent).toBe(zh.unavailable)
  })

  it('keeps the draft until acknowledgement, blocks duplicate sends and respects IME and Shift+Enter', async () => {
    let finish!: () => void
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<ChannelsPage {...props(ready, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '@橘 你好' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledExactlyOnceWith('@橘 你好')
    expect(input.value).toBe('@橘 你好')
    expect(input.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    expect(input.value).toBe('')
    expect(input.disabled).toBe(false)
  })

  it('keeps a failed draft and its error in the room where it was sent', async () => {
    let reject!: (reason: Error) => void
    const send = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    const view = render(<ChannelsPage {...props(ready, send)} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'room one draft' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    view.rerender(<ChannelsPage {...props({ ...ready, roomId: 2 }, send)} />)
    await act(async () => { reject(new Error('offline')) })
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    view.rerender(<ChannelsPage {...props(ready, send)} />)
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('room one draft')
    expect(screen.getByRole('alert').textContent).toContain('offline')
  })

  it('autocompletes @ like Discord: filter, arrow keys, Enter inserts, Esc closes, button and member list insert', () => {
    const many: ChannelSnapshot = {
      ...ready,
      thinking: {},
      members: [
        { id: 'owner', name: '我', kind: 'human', online: true },
        { id: 'ju', name: '橘', kind: 'bot', online: true },
        { id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true },
      ],
    }
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props(many, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    const type = (value: string) => {
      fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
    }

    type('@')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      expect.stringContaining('DeepSeek'), expect.stringContaining('橘'), expect.stringContaining('我'),
    ])

    type('@d')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('@DeepSeek ')
    expect(send).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()

    type('@DeepSeek 叫 @')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input.value).toBe('@DeepSeek 叫 @橘 ')

    type('@DeepSeek 叫 @橘 和 @')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledExactlyOnceWith('@DeepSeek 叫 @橘 和 @')
  })

  it('opens the picker from the @ button and inserts a member clicked in the member list', () => {
    render(<ChannelsPage {...props({ ...ready, thinking: {} })} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '看看', selectionStart: 2, selectionEnd: 2 } })
    fireEvent.click(screen.getByRole('button', { name: zh.mentionButton }))
    expect(input.value).toBe('看看 @')
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(screen.getByRole('option'))
    expect(input.value).toBe('看看 @橘 ')
    fireEvent.click(screen.getByTitle('在输入框里 @橘'))
    expect(input.value).toBe('看看 @橘 @橘 ')
  })

  it('creates a channel from the + button', async () => {
    const p = props({ ...ready, thinking: {} })
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.newRoom }))
    const input = screen.getByRole('textbox', { name: zh.newRoom })
    fireEvent.change(input, { target: { value: 'design' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(p.createRoom).toHaveBeenCalledExactlyOnceWith('design')
  })

  it('adds a member through the dialog and keeps the form on a refusal', async () => {
    const p = props({ ...ready, thinking: {} })
    ;(p.listModels as ReturnType<typeof vi.fn>).mockResolvedValue([
      { provider: 'relay', name: '中转站', models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }] },
      { provider: 'broken', name: 'Broken', models: [], error: 'no key' },
    ])
    ;(p.addMember as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('name Coder is already used by Coder'))
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '+ ' + zh.addMember }))
    const dialog = await screen.findByRole('dialog')
    await act(async () => {})
    fireEvent.change(screen.getByLabelText(zh.memberName), { target: { value: 'Coder' } })
    fireEvent.change(screen.getByLabelText(zh.memberModel), { target: { value: 'relay\u0000deepseek-v4.1-flash' } })
    fireEvent.change(screen.getByLabelText(zh.memberPersona), { target: { value: '写代码' } })
    expect(dialog.querySelectorAll('[role="radiogroup"][aria-labelledby="member-avatar-label"] [role="radio"]')).toHaveLength(6)
    fireEvent.click(dialog.querySelector('[role="radio"][title="whale"]') as Element)
    expect(dialog.querySelector('[role="radio"][title="whale"] img')?.getAttribute('src')).toBe('collab/avatars/whale.png')
    expect(dialog.querySelector('optgroup[label="Broken（读取失败：no key）"]')).toBeTruthy()
    await act(async () => { fireEvent.submit(dialog) })
    expect(p.addMember).toHaveBeenCalledWith({ name: 'Coder', persona: '写代码', avatar: 'whale', model: { provider: 'relay', model: 'deepseek-v4.1-flash' } })
    expect(screen.getByRole('alert').textContent).toContain('already used')
    expect((screen.getByLabelText(zh.memberName) as HTMLInputElement).value).toBe('Coder')
    await act(async () => { fireEvent.submit(dialog) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers edit and remove only for members created in the UI', async () => {
    const state: ChannelSnapshot = {
      ...ready, thinking: {},
      members: [
        { id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true, model: null, persona: '', editable: false },
        { id: 'coder', name: 'Coder', kind: 'dsh', online: true, model: { provider: 'relay', model: 'm1' }, persona: '写代码', editable: true },
      ],
    }
    const p = props(state)
    render(<ChannelsPage {...p} />)
    expect(screen.getAllByRole('button', { name: zh.editMember })).toHaveLength(1)
    expect(screen.getByText('relay/m1')).toBeTruthy()
    expect(screen.getByText(zh.defaultModel)).toBeTruthy()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.removeMember })) })
    expect(p.removeMember).toHaveBeenCalledExactlyOnceWith('coder')
    confirm.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: zh.editMember }))
    expect((screen.getByLabelText(zh.memberPersona) as HTMLTextAreaElement).value).toBe('写代码')
  })

  it('shows member portraits in the list and on messages, and falls back to the initial when the image fails', () => {
    const state: ChannelSnapshot = {
      ...ready, thinking: {},
      members: [
        { id: 'ju', name: '橘', kind: 'bot', online: true, avatar: 'orange' },
        { id: 'far', name: 'Far', kind: 'bot', online: true, avatar: 'http://127.0.0.1:9820/api/v1/library/avatar-image/senpai' },
      ],
    }
    const { container } = render(<ChannelsPage {...props(state)} />)
    const srcs = [...container.querySelectorAll('img')].map(i => i.getAttribute('src'))
    expect(srcs.filter(s => s === 'collab/avatars/orange.png').length).toBeGreaterThanOrEqual(2)
    expect(srcs).toContain('http://127.0.0.1:9820/api/v1/library/avatar-image/senpai')
    const img = container.querySelector('img[src="collab/avatars/orange.png"]') as HTMLImageElement
    fireEvent.error(img)
    expect(img.isConnected).toBe(false)
  })

  it('editing a CLI member keeps its CLI and sends the new avatar', async () => {
    const state: ChannelSnapshot = {
      ...ready, thinking: {},
      members: [{ id: 'cc', name: 'CC', kind: 'dsh', online: true, cli: 'claude', persona: '本地', editable: true, avatar: 'dragon' }],
    }
    const p = props(state)
    ;(p as unknown as { listClis: unknown }).listClis = vi.fn(async () => [{ cli: 'claude', path: '/bin/claude' }])
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.editMember }))
    const dialog = await screen.findByRole('dialog')
    await act(async () => {})
    expect(dialog.querySelector('[role="radio"][title="dragon"]')?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(dialog.querySelector('[role="radio"][title="lanxi"]') as Element)
    await act(async () => { fireEvent.submit(dialog) })
    expect(p.updateMember).toHaveBeenCalledWith('cc', { name: 'CC', persona: '本地', avatar: 'lanxi', cli: 'claude' })
  })
  it('guides to add a member when the channel has no role members', async () => {
    const p = props({ ...ready, members: [{ id: 'owner', name: '我', kind: 'human', online: true }], messages: [], thinking: {} })
    render(<ChannelsPage {...p} />)
    expect(screen.getByText(zh.guideNoMembers)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.addMember }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('hides the add-member guide once a role member exists', () => {
    render(<ChannelsPage {...props(ready)} />)
    expect(screen.queryByText(zh.guideNoMembers)).toBeNull()
  })
  it('collapses and restores each side column independently without losing room, draft or messages (#124)', () => {
    const selectRoom = vi.fn()
    const view = render(<ChannelsPage {...props(ready)} selectRoom={selectRoom} />)
    const page = view.container.firstElementChild as HTMLElement
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '草稿' } })
    const baseline = page.className
    fireEvent.click(screen.getByRole('button', { name: zh.collapseRooms }))
    const roomsOnly = page.className
    expect(screen.getByRole('button', { name: zh.expandRooms }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: zh.collapseMembers }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: zh.collapseMembers }))
    const both = page.className
    expect(new Set([baseline, roomsOnly, both]).size).toBe(3)
    // Both restore buttons stay in the chat header, so the columns can always come back.
    expect(screen.getByRole('button', { name: zh.expandRooms })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.expandMembers })).toBeTruthy()
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('草稿')
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.expandRooms }))
    fireEvent.click(screen.getByRole('button', { name: zh.expandMembers }))
    expect(page.className).toBe(baseline)
    expect(screen.getByRole('button', { name: 'general' }).getAttribute('aria-current')).toBe('true')
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('草稿')
    expect(selectRoom).not.toHaveBeenCalled()
  })
})
