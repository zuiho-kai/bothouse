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

function props(
  state: ChannelSnapshot,
  send: ChannelsPageProps['send'] = async () => {},
  stopRoom: ChannelsPageProps['stopRoom'] = vi.fn(async () => ({
    room_id: 1, stopped: true, cancelled_jobs: 0, unconfirmed: [], stopped_members: [],
  })),
  continueRoom: ChannelsPageProps['continueRoom'] = vi.fn(async () => ({
    room_id: 1, resumed: 1, stopped: false,
  })),
): ChannelsPageProps {
  // This panel consumes only its private injected seats; unused main-panel
  // framework seats are deliberately absent so an accidental new read fails.
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send,
    createRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
    stopRoom, continueRoom,
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
  } as unknown as ChannelsPageProps
}

describe('channels page', () => {
  it('renders configured rooms, members, working state and message text without interpreting HTML', () => {
    const view = render(<ChannelsPage {...props(ready)} />)
    expect(screen.getByRole('button', { name: 'general' })).toBeTruthy()
    expect(screen.getByText('橘 正在处理…')).toBeTruthy()
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
    expect(dialog.querySelector('optgroup[label="Broken（读取失败：no key）"]')).toBeTruthy()
    await act(async () => { fireEvent.submit(dialog) })
    expect(p.addMember).toHaveBeenCalledWith({ name: 'Coder', persona: '写代码', model: { provider: 'relay', model: 'deepseek-v4.1-flash' } })
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

  it('stops running room tasks and presents the three-state feedback and errors in the top notice', async () => {
    let resolveStop!: (val: { room_id: number; stopped: boolean; cancelled_jobs: number; unconfirmed: string[]; stopped_members: { member: string; outcome: 'confirmed' | 'requested' | 'unsupported' }[] }) => void
    const stopRoom = vi.fn(() => new Promise<{ room_id: number; stopped: boolean; cancelled_jobs: number; unconfirmed: string[]; stopped_members: { member: string; outcome: 'confirmed' | 'requested' | 'unsupported' }[] }>(resolve => {
      resolveStop = resolve
    }))
    const p = props(ready, undefined, stopRoom)
    render(<ChannelsPage {...p} />)

    const stopButton = screen.getByRole('button', { name: zh.stopRoom })
    expect(stopButton).toBeTruthy()
    fireEvent.click(stopButton)
    expect(stopRoom).toHaveBeenCalledExactlyOnceWith(1)
    expect(stopButton.textContent).toContain(zh.stoppingRoom)
    expect((stopButton as HTMLButtonElement).disabled).toBe(true)

    // Three states breakdown: confirmed, requested, unsupported
    await act(async () => {
      resolveStop({
        room_id: 1,
        stopped: true,
        cancelled_jobs: 3,
        unconfirmed: [],
        stopped_members: [
          { member: 'ju', outcome: 'confirmed' },
        ],
      })
    })
    expect(stopButton.textContent).toContain(zh.stopRoom)
    expect((stopButton as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('已停止：橘')

    // Dismiss notice
    fireEvent.click(screen.getByRole('button', { name: zh.closeNotice }))
    expect(screen.queryByRole('status')).toBeNull()

    // Empty result (idle room)
    ;(stopRoom as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      room_id: 1, stopped: true, cancelled_jobs: 0, unconfirmed: [], stopped_members: [],
    })
    fireEvent.click(stopButton)
    await act(async () => {})
    expect(screen.getByRole('status').textContent).toContain(zh.stopNone)

    // Multi-member mixed 3-state breakdown
    ;(stopRoom as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      room_id: 1, stopped: true, cancelled_jobs: 2, unconfirmed: ['bot2'],
      stopped_members: [
        { member: 'ju', outcome: 'requested' },
        { member: 'ext', outcome: 'unsupported' },
      ],
    })
    fireEvent.click(stopButton)
    await act(async () => {})
    expect(screen.getByRole('status').textContent).toContain('已请求停止：橘')
    expect(screen.getByRole('status').textContent).toContain('不支持终止，只屏蔽旧输出：ext')

    // Failure case
    ;(stopRoom as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'))
    fireEvent.click(stopButton)
    await act(async () => {})
    expect(screen.getByRole('status').textContent).toContain('停止失败：Network error')
  })

  it('renders relay_limit card without title and triggers continueRoom with debouncing and error feedback', async () => {
    let resolveContinue!: (val: { room_id: number; resumed: number; stopped: boolean }) => void
    const continueRoom = vi.fn(() => new Promise<{ room_id: number; resumed: number; stopped: boolean }>(resolve => {
      resolveContinue = resolve
    }))
    const relayCardState: ChannelSnapshot = {
      ...ready,
      messages: [{
        id: 10,
        room_id: 1,
        author_kind: 'system',
        author: 'system',
        name: 'system',
        text: 'Agent 之间已经连续接力 6 次以上，暂停自动接力；点击继续或请人来 @。',
        created_at: 100,
        card: JSON.stringify({ type: 'relay_limit', room_id: 1 }),
        from_turn: null,
      }],
    }
    const p = props(relayCardState, undefined, undefined, continueRoom)
    render(<ChannelsPage {...p} />)

    expect(screen.getByText('Agent 之间已经连续接力 6 次以上，暂停自动接力；点击继续或请人来 @。')).toBeTruthy()
    const continueButton = screen.getByRole('button', { name: zh.continueRoom })
    expect(continueButton).toBeTruthy()

    fireEvent.click(continueButton)
    expect(continueRoom).toHaveBeenCalledExactlyOnceWith(1)
    expect(continueButton.textContent).toContain(zh.continuingRoom)
    expect((continueButton as HTMLButtonElement).disabled).toBe(true)

    // Repeat click while pending should not invoke continueRoom again
    fireEvent.click(continueButton)
    expect(continueRoom).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveContinue({ room_id: 1, resumed: 1, stopped: false })
    })
    expect(continueButton.textContent).toContain(zh.continueResumed)
    expect((continueButton as HTMLButtonElement).disabled).toBe(true)

    // Error case
    cleanup()
    const errorCardState: ChannelSnapshot = {
      ...ready,
      messages: [{
        id: 11,
        room_id: 1,
        author_kind: 'system',
        author: 'system',
        name: 'system',
        text: '接力受限',
        created_at: 101,
        card: JSON.stringify({ type: 'relay_limit', room_id: 1 }),
        from_turn: null,
      }],
    }
    const failContinue = vi.fn().mockRejectedValueOnce(new Error('Room locked'))
    const pErr = props(errorCardState, undefined, undefined, failContinue)
    render(<ChannelsPage {...pErr} />)
    const errButton = screen.getByRole('button', { name: zh.continueRoom })
    fireEvent.click(errButton)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('继续失败：Room locked')
  })
})
