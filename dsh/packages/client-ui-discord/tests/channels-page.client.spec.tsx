// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ready: ChannelSnapshot = {
  phase: 'ready', error: undefined,
  rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: { 1: ['ju'] },
  leadId: 'ju', effectiveLeadId: 'ju',
  messages: [{ id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '<script>alert(1)</script>', created_at: 1, card: null, from_turn: null }],
}

function props(state: ChannelSnapshot, send: ChannelsPageProps['send'] = async () => {}): ChannelsPageProps {
  // This panel consumes only its private injected seats; unused main-panel
  // framework seats are deliberately absent so an accidental new read fails.
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send, openModelSettings: () => false,
    createRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
    setLead: vi.fn(async () => {}), setDispatchMode: vi.fn(async () => {}),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
  } as unknown as ChannelsPageProps
}

describe('channels page', () => {
  it('shows only six existing capabilities for a slash draft, with usage and no side effects', () => {
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props(ready, send)} />)
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.capabilities })).toBeNull()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'ordinary message' } })
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
    fireEvent.change(input, { target: { value: '/' } })
    const help = within(screen.getByRole('region', { name: zh.capabilities }))
    expect(help.getAllByRole('button')).toHaveLength(8) // seven capabilities and close
    for (const [name, usage] of [
      [zh.capabilityTaskBoard, zh.capabilityTaskBoardHelp],
      [zh.capabilityLater, zh.capabilityLaterHelp],
      [zh.capabilityReminder, zh.capabilityReminderHelp],
      [zh.capabilityWorkspace, zh.capabilityWorkspaceHelp],
      [zh.capabilityLead, zh.capabilityLeadHelp],
      [zh.capabilityDm, zh.capabilityDmHelp],
    ]) {
      fireEvent.click(help.getByRole('button', { name }))
      expect(help.getByRole('status').textContent).toBe(usage)
    }
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    expect((input as HTMLTextAreaElement).value).toBe('/')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '/' } })
    expect(screen.getByRole('region', { name: zh.capabilities })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: zh.capabilities })).getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
    fireEvent.change(input, { target: { value: '/ordinary' } })
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
  })
  it('closes the capability list on an outside press and preserves the slash draft', () => {
    render(<ChannelsPage {...props(ready)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '/' } })
    expect(screen.getByRole('region', { name: zh.capabilities })).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('log').parentElement as HTMLElement)
    expect(screen.queryByRole('region', { name: zh.capabilities })).toBeNull()
    expect(input.value).toBe('/')
  })
  it('sends the slash draft with Enter after the capability list is dismissed', async () => {
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props(ready, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '/' } })
    fireEvent.click(within(screen.getByRole('region', { name: zh.capabilities })).getByRole('button', { name: zh.close }))
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(send).toHaveBeenCalledExactlyOnceWith('/')
  })
  it('selects dispatch mode and reports a failed save', async () => {
    const save = vi.fn(async () => { throw Error('save failed') })
    render(<ChannelsPage {...props(ready)} setDispatchMode={save} />)
    const selector = screen.getByRole('radio', { name: zh.dispatchMixed })
    expect((selector as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(zh.dispatchSolo)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: zh.dispatchTeam })) })
    expect(save).toHaveBeenCalledWith(1, 'team')
    expect(screen.getByRole('alert').textContent).toBe('save failed')
    expect((selector as HTMLInputElement).checked).toBe(true)
  })

  it('keeps task owners working in the member list without claiming they are typing', () => {
    const state: ChannelSnapshot = { ...ready, thinking: {}, tasks: [{
      id: 1, room_id: 1, title: 'task', owner: 'ju', owner_name: '橘', status: 'assigned',
      created_by: 'owner', created_by_name: '我', created_at: 1, updated_at: 1,
      parent_task: null, next_check_at: null, assign_msg_id: null, result_msg_id: null, note: null, returned_at: null,
    }] }
    const view = render(<ChannelsPage {...props(state)} />)
    expect(screen.queryByText('橘 正在输入…')).toBeNull()
    expect(screen.getAllByText(zh.working).length).toBeGreaterThan(0)
    view.rerender(<ChannelsPage {...props({ ...state, thinking: { 1: ['ju'] } })} />)
    expect(screen.getByText('橘 正在输入…')).toBeTruthy()
    view.rerender(<ChannelsPage {...props({ ...state, thinking: { 2: ['ju'] } })} />)
    expect(screen.queryByText('橘 正在输入…')).toBeNull()
    expect(screen.getAllByText(zh.working).length).toBeGreaterThan(0)
  })

  it('shows the primary-role selector and saves a changed member', async () => {
    const setLead = vi.fn(async () => {})
    const state: ChannelSnapshot = { ...ready, members: [
      { id: 'ju', name: '橘', kind: 'bot', online: true },
      { id: 'ds', name: '鲸鱼娘', kind: 'dsh', online: true },
    ] }
    render(<ChannelsPage {...props(state)} setLead={setLead} />)
    const trigger = screen.getByRole('button', { name: zh.lead })
    expect(trigger.textContent).toContain('橘')
    fireEvent.click(trigger)
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: '鲸鱼娘' })) })
    expect(setLead).toHaveBeenCalledExactlyOnceWith('ds')
  })

  it('allows making the configured effective role explicit', async () => {
    const setLead = vi.fn(async () => {})
    const state: ChannelSnapshot = { ...ready, leadId: null, effectiveLeadId: 'ju' }
    render(<ChannelsPage {...props(state)} setLead={setLead} />)
    fireEvent.click(screen.getByRole('button', { name: zh.lead }))
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: '橘' })) })
    expect(setLead).toHaveBeenCalledExactlyOnceWith('ju')
  })

  it('renders a room with a message and a configure-model card without throwing', () => {
    // Regression: the message list once referenced a prop the page never destructured,
    // so any room with a message threw and blanked the whole main panel.
    const card = JSON.stringify({ title: 'model', state: 'error', action: 'configure-model' })
    const withCard: ChannelSnapshot = { ...ready, messages: [...ready.messages, { ...ready.messages[0], id: 2, text: 'need model', card }] }
    expect(() => render(<ChannelsPage {...props(withCard)} />)).not.toThrow()
    expect(screen.getByText('need model')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.configureModel })).toBeTruthy()
  })

  it.each([true, false])('routes model configuration with shell available=%s', (available) => {
    const card = JSON.stringify({ title: 'model', state: 'error', action: 'configure-model' })
    const state = { ...ready, messages: [{ ...ready.messages[0], card }] }
    const openModelSettings = vi.fn(() => available)
    render(<ChannelsPage {...props(state)} openModelSettings={openModelSettings} />)
    fireEvent.click(screen.getByRole('button', { name: zh.configureModel }))
    expect(openModelSettings).toHaveBeenCalledOnce()
    if (available) expect(screen.queryByText(zh.configureModelHint)).toBeNull()
    else {
      expect(screen.getByText(zh.configureModelHint)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: zh.close }))
      expect(screen.queryByText(zh.configureModelHint)).toBeNull()
    }
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

  it('opens a member menu from a message avatar and inserts @ at the caret, keeping the draft (#123)', () => {
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props({ ...ready, thinking: {} }, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '你好世界', selectionStart: 2, selectionEnd: 2 } })
    const avatar = screen.getByRole('button', { name: '橘 的成员操作' })

    // Outside press closes the menu; draft untouched, nothing sent.
    fireEvent.click(avatar)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('log'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(input.value).toBe('你好世界')

    // Esc closes it too.
    fireEvent.click(avatar)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    // Pressing inside keeps it open; "@" inserts at the caret and closes the menu.
    fireEvent.click(avatar)
    const item = screen.getByRole('menuitem', { name: zh.avatarMention })
    fireEvent.mouseDown(item)
    fireEvent.click(item)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(input.value).toBe('你好 @橘 世界')
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps system messages and departed authors as plain avatars', () => {
    const messages = [
      { ...ready.messages[0], id: 2, author_kind: 'system' as const },
      { ...ready.messages[0], id: 3, author: 'gone', name: '走了' },
    ]
    render(<ChannelsPage {...props({ ...ready, messages, thinking: {} })} />)
    expect(screen.queryByRole('button', { name: /的成员操作/ })).toBeNull()
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

  it('sends from the send button through the same path as Enter, multi-line drafts included', async () => {
    const send = vi.fn(() => Promise.resolve())
    render(<ChannelsPage {...props(ready, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    const button = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(input.getAttribute('enterkeyhint')).toBe('send')
    expect(button.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '第一行\n第二行' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(send).toHaveBeenCalledExactlyOnceWith('第一行\n第二行')
    await act(async () => {})
    expect(input.value).toBe('')
  })

  it('does not send on the Enter that confirms an iOS/Safari IME composition (keyCode 229)', () => {
    const send = vi.fn(() => Promise.resolve())
    render(<ChannelsPage {...props(ready, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'ni hao' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledExactlyOnceWith('ni hao')
  })

  it('does not save a message edit on the IME-confirming Enter (keyCode 229)', async () => {
    const mine: ChannelSnapshot = {
      ...ready,
      messages: [{ id: 9, room_id: 1, author_kind: 'user', author: 'owner', name: '我', text: '旧', created_at: 1, card: null, from_turn: null }],
    }
    const editMessage = vi.fn(async () => {})
    render(<ChannelsPage {...props(mine)} editMessage={editMessage} withdrawMessage={vi.fn(async () => {})} />)
    fireEvent.click(screen.getByRole('button', { name: zh.messageEdit }))
    const box = screen.getByRole('textbox', { name: zh.messageEdit })
    fireEvent.change(box, { target: { value: 'xin' } })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(editMessage).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(editMessage).toHaveBeenCalledExactlyOnceWith(9, 'xin')
  })

  it('does not pick an @ candidate on the IME-confirming Enter (keyCode 229)', () => {
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props(ready, send)} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(input.value).toBe('@')
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the short placeholder on touch or narrow screens', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      render(<ChannelsPage {...props(ready)} />)
      expect(screen.getByRole('combobox').getAttribute('placeholder')).toBe('发消息到 #general')
    } finally { window.matchMedia = original }
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

  it('closes the @ picker on an outside press without touching the draft, and reopens (#125)', () => {
    render(<ChannelsPage {...props({ ...ready, thinking: {} })} />)
    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '看看', selectionStart: 2, selectionEnd: 2 } })
    const button = screen.getByRole('button', { name: zh.mentionButton })

    fireEvent.click(button)
    expect(screen.getByRole('listbox')).toBeTruthy()
    // Pressing an option or the textarea is inside the composer: stays open, choice still lands.
    fireEvent.mouseDown(input)
    fireEvent.mouseDown(screen.getByRole('option'))
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(screen.getByRole('option'))
    expect(input.value).toBe('看看 @橘 ')

    fireEvent.click(button)
    expect(input.value).toBe('看看 @橘 @')
    fireEvent.mouseDown(screen.getByRole('log').parentElement as HTMLElement)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('看看 @橘 @')

    // Reopen with the button, then Esc closes while focus stays in the input.
    fireEvent.click(button)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('看看 @橘 @ @')
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
    expect(p.updateMember).toHaveBeenCalledWith('cc', { name: 'CC', persona: '本地', avatar: 'lanxi', cli: 'claude', permissionPreset: 'workspace-write' })
  })

  it('a CLI member shows its DSH permission preset and sends the picked one', async () => {
    const state: ChannelSnapshot = {
      ...ready, thinking: {},
      members: [{ id: 'cc', name: 'CC', kind: 'dsh', online: true, cli: 'claude', permissionPreset: 'danger-full-access', persona: '', editable: true }],
    }
    const p = props(state)
    ;(p as unknown as { listClis: unknown }).listClis = vi.fn(async () => [{ cli: 'claude', path: '/bin/claude' }])
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.editMember }))
    const dialog = await screen.findByRole('dialog')
    await act(async () => {})
    const select = screen.getByRole('combobox', { name: zh.memberPermission }) as HTMLSelectElement
    expect(select.value).toBe('danger-full-access')
    expect([...select.options].map(o => o.textContent)).toEqual([zh.permissionReadOnly, zh.permissionWorkspaceWrite, zh.permissionFullAccess])
    expect(screen.getByText(zh.permissionFullAccessHint)).toBeTruthy()
    fireEvent.change(select, { target: { value: 'read-only' } })
    await act(async () => { fireEvent.submit(dialog) })
    expect(p.updateMember).toHaveBeenCalledWith('cc', { name: 'CC', persona: '', avatar: '', cli: 'claude', permissionPreset: 'read-only' })
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

  it('lists workspaces indented under their chat channel with an in-progress count (#139)', () => {
    const rooms = [
      { id: 1, name: 'general', kind: 'chat' as const, parent_id: null, active: 0 },
      { id: 2, name: 'dev', kind: 'chat' as const, parent_id: null, active: 2 },
      { id: 3, name: '工作区1', kind: 'workspace' as const, parent_id: 1, active: 0 },
      { id: 4, name: '工作区2', kind: 'workspace' as const, parent_id: 1, active: 3 },
    ]
    const view = render(<ChannelsPage {...props({ ...ready, rooms })} />)
    const nav = view.container.querySelector('nav') as HTMLElement
    const buttons = [...nav.querySelectorAll('button[aria-current]')].map(b => b.textContent)
    expect(buttons).toEqual(['#general', '#工作区1进行中 0 件', '#工作区2进行中 3 件', '#dev进行中 2 件'])
    const ws = screen.getByRole('button', { name: /工作区2/ })
    expect(ws.className).toContain('workspace')
    expect(screen.getByRole('button', { name: 'general' }).className).not.toContain('workspace')
  })

  it('replies from a message, shows the quote, cancels, and degrades a deleted original', async () => {
    const send = vi.fn(async () => {})
    const quoted: ChannelSnapshot = {
      ...ready,
      messages: [
        { ...ready.messages[0], id: 1, text: '原话' },
        { ...ready.messages[0], id: 2, author_kind: 'user', author: 'owner', name: '我', text: '回一下', reply_to: { id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '原话' } },
        { ...ready.messages[0], id: 3, author_kind: 'user', author: 'owner', name: '我', text: '回已删', reply_to: { id: 99, deleted: true } },
        { ...ready.messages[0], id: 4, author_kind: 'system', author: 'system', name: '系统', text: '系统通知' },
        { ...ready.messages[0], id: 5, text: '进度', card: JSON.stringify({ title: 'job', state: 'running' }) },
      ],
    }
    const view = render(<ChannelsPage {...props(quoted, send)} />)
    expect(screen.getAllByText('原话')).toHaveLength(2)
    expect(screen.getByText(zh.replyDeleted)).toBeTruthy()
    // Only the three conversation messages offer a reply; system notices and progress cards do not.
    expect(screen.getAllByRole('button', { name: zh.reply })).toHaveLength(3)

    fireEvent.click(screen.getAllByRole('button', { name: zh.reply })[0] as HTMLElement)
    expect(screen.getByText('回复 橘')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.cancelReply }))
    expect(screen.queryByText('回复 橘')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: zh.reply })[0] as HTMLElement)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '收到' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(send).toHaveBeenCalledExactlyOnceWith('收到', 1)
    expect(screen.queryByText('回复 橘')).toBeNull()

    // The original vanishes while a reply is being written: the bar says so.
    fireEvent.click(screen.getAllByRole('button', { name: zh.reply })[0] as HTMLElement)
    view.rerender(<ChannelsPage {...props({ ...quoted, messages: quoted.messages.slice(1) }, send)} />)
    expect(screen.getByText(`回复 橘 · ${zh.replyDeleted}`)).toBeTruthy()
  })
})

describe('progress card detail/brief view', () => {
  const progress = (roomId: number, id: number): ChannelSnapshot['messages'][number] => ({
    id, room_id: roomId, author_kind: 'role', author: 'ju', name: '橘', created_at: 1, from_turn: null,
    text: '第 2 步 · 5秒\n🔧 Bash — go test ./...',
    card: JSON.stringify({ title: 'Codex · 处理中', state: 'running', steps: 2, elapsed_sec: 5, brief: '第 2 步 · 5秒\n🔧 Bash · 进行中' }),
  })
  afterEach(() => { localStorage.clear() })

  it('starts brief, switches to detail, and remembers the choice per room', () => {
    const state: ChannelSnapshot = { ...ready, messages: [progress(1, 10)] }
    const first = render(<ChannelsPage {...props(state)} />)
    expect(screen.getByText(/Bash · 进行中/)).toBeTruthy()
    expect(screen.queryByText(/go test/)).toBeNull()
    expect(screen.getByRole('button', { name: zh.cardViewBrief }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: zh.cardViewDetail }))
    expect(screen.getByText(/go test/)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.cardViewDetail }).getAttribute('aria-pressed')).toBe('true')
    first.unmount()

    // A fresh page (reload) starts in the remembered view for that room ...
    render(<ChannelsPage {...props(state)} />)
    expect(screen.getByText(/go test/)).toBeTruthy()
    cleanup()
    // ... while another room keeps the default.
    render(<ChannelsPage {...props({ ...ready, roomId: 2, messages: [progress(2, 11)] })} />)
    expect(screen.getByText(/Bash · 进行中/)).toBeTruthy()
  })

  it('cards without a brief rendering show their text and no switch', () => {
    const card = JSON.stringify({ title: 'model', state: 'error', action: 'configure-model' })
    render(<ChannelsPage {...props({ ...ready, messages: [{ ...ready.messages[0], id: 2, text: 'need model', card }] })} />)
    expect(screen.getByText('need model')).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.cardViewBrief })).toBeNull()
  })
  it('shows a bot voice clip as an audio player with a download link', () => {
    const withAudio: ChannelSnapshot = { ...ready, messages: [{ ...ready.messages[0], id: 3, text: '', attachments: [
      { id: '33333333-3333-3333-3333-333333333333', name: 'voice.mp3', mime: 'audio/mpeg', size: 1024 },
    ] }] }
    const { container } = render(<ChannelsPage {...props(withAudio, vi.fn(async () => {}))} />)
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('collab/api/attachments/33333333-3333-3333-3333-333333333333')
    expect(audio?.hasAttribute('controls')).toBe(true)
    expect(screen.getByText(/voice\.mp3/).closest('a')?.getAttribute('download')).toBe('voice.mp3')
  })

  it('#144 shows message attachments and sends a pasted image without text', async () => {
    const withFiles: ChannelSnapshot = { ...ready, messages: [{ ...ready.messages[0], id: 2, text: '', attachments: [
      { id: '11111111-1111-1111-1111-111111111111', name: 'shot.png', mime: 'image/png', size: 4 },
      { id: '22222222-2222-2222-2222-222222222222', name: 'run.log', mime: 'text/plain', size: 2048 },
    ] }] }
    const send = vi.fn(async () => {})
    render(<ChannelsPage {...props(withFiles, send)} />)
    expect((screen.getByAltText('shot.png') as HTMLImageElement).getAttribute('src')).toBe('collab/api/attachments/11111111-1111-1111-1111-111111111111')
    expect(screen.getByText(/run\.log/).closest('a')?.getAttribute('download')).toBe('run.log')

    const input = screen.getByRole('combobox') as HTMLTextAreaElement
    const file = new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' })
    await act(async () => { fireEvent.paste(input, { clipboardData: { files: [file], types: ['Files'] } }) })
    await vi.waitFor(() => expect(screen.getByAltText('paste.png')).toBeTruthy())
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(send).toHaveBeenCalledExactlyOnceWith('', undefined, [{ name: 'paste.png', mime: 'image/png', data: 'AQID' }])
  })
})

// #118: exercise the host renderer, rather than mocking Markdown into plain text.
it('renders Markdown and KaTeX for history, incremental replies and permission text (#118)', () => {
  const body = '| name | value |'+String.fromCharCode(10)+'| --- | --- |'+String.fromCharCode(10)+'| row | cell |'+String.fromCharCode(10,10)+'**bold**\n\n- item\n\n$7^3 = 7 \\times 7 \\times 7 = 343$'
  const message = { ...ready.messages[0], text: body }
  const view = render(<ChannelsPage {...props({ ...ready, messages: [message] })} />)
  expect(view.container.querySelector('strong')?.textContent).toBe('bold')
  expect(view.container.querySelector('table td')?.textContent).toBe('row')
  expect(view.container.querySelector('li')?.textContent).toBe('item')
  expect(view.container.querySelector('.katex')).not.toBeNull()
  view.rerender(<ChannelsPage {...props({ ...ready, messages: [{ ...message, text: '**new**' }] })} />)
  expect(view.container.querySelector('strong')?.textContent).toBe('new')
  view.rerender(<ChannelsPage {...props({ ...ready, messages: [{ ...message, card: JSON.stringify({ title: 'approval' }) }] })} />)
  expect(view.container.querySelector('.katex')).not.toBeNull()
})

it('keeps code dollars literal and blocks raw HTML and unsafe links (#118)', () => {
  const body = ['~~~sh', 'echo "$HOME"', '~~~', '', '<script>alert(1)</script>', '', '[bad](javascript:alert(1))', '', '$\\notacommand$'].join('\n')
  const view = render(<ChannelsPage {...props({ ...ready, messages: [{ ...ready.messages[0], text: body }] })} />)
  expect(view.container.querySelector('pre code')?.textContent).toContain('$HOME')
  expect(view.container.querySelector('pre .katex')).toBeNull()
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(view.container.textContent).toContain('notacommand')
})

// #146: the retry label must end. "Retrying" is shown only while the request is in
// flight; once it settles the server marks the card 'retried' and the button goes away.
it('shows retrying only while the retry request is pending, then hides the button (#146)', async () => {
  let finish: () => void = () => {}
  const retryMessage = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const card = JSON.stringify({ title: 'err', state: 'failed', action: 'configure-model' })
  const failed: ChannelSnapshot = { ...ready, messages: [{ ...ready.messages[0], id: 2, text: 'boom', card }] }
  const view = render(<ChannelsPage {...{ ...props(failed), retryMessage }} />)
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(screen.getByRole('button', { name: zh.retrying })).toBeTruthy()
  await act(async () => { finish() })
  expect(screen.queryByRole('button', { name: zh.retrying })).toBeNull()
  const settled = { ...failed, messages: [{ ...failed.messages[0], card: JSON.stringify({ title: 'err', state: 'retried', action: 'configure-model' }) }] }
  view.rerender(<ChannelsPage {...{ ...props(settled), retryMessage }} />)
  expect(screen.queryByRole('button', { name: zh.retry })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.retrying })).toBeNull()
  expect(screen.getByRole('button', { name: zh.configureModel })).toBeTruthy()
})
