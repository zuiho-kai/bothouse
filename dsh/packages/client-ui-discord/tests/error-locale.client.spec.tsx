// @vitest-environment jsdom
// #268 (3): a refusal from the collab service arrives with `code` plus an English sentence. The
// Chinese panel used to show that sentence as-is, so renaming a channel or a member failed in
// English. These cases hold the entry points — the settings dialog, the member dialog, the new
// channel box and the `/` menu title — to the panel's own language.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelSettingsDialog } from '../src/client/ChannelSettingsDialog.tsx'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { MemberDialog } from '../src/client/MemberDialog.tsx'
import { ServiceError, errorText, type ChannelSnapshot } from '../src/client/channel-source.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const dict = { zh, en }

/** The panel's `t`, over one dictionary, interpolating `{name}`-style placeholders. */
function translate(language: 'zh' | 'en') {
  const table = dict[language]
  return (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
    .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(table[key]))
}

const conflict = (message: string) => new ServiceError(409, message, 'conflict')

describe('service refusals in the panel language', () => {
  it('words a taken channel name, a workspace name and a bad name from the code alone', () => {
    for (const language of ['zh', 'en'] as const) {
      const t = translate(language)
      expect(errorText(conflict('channel name 新频道 is already in use'), t, 'room', '新频道'))
        .toBe(t('channelNameTaken', { name: '新频道' }))
      expect(errorText(conflict('channel name 工作区1 is reserved for workspaces'), t, 'room', '工作区1'))
        .toBe(t('channelNameReserved', { name: '工作区1' }))
      expect(errorText(new ServiceError(400, 'room name must be 1-32 characters without spaces', 'invalid'), t, 'room', 'has space'))
        .toBe(t('channelNameInvalid'))
      expect(errorText(conflict('name Coder is already used by Coder'), t, 'member', 'Coder'))
        .toBe(t('memberNameTaken', { name: 'Coder' }))
      expect(errorText(new ServiceError(400, 'name must be 1-32 characters without spaces (except Claude Code), @ or <>', 'invalid'), t, 'member', 'has space'))
        .toBe(t('memberNameInvalid'))
      // The service trims the name and drops a leading #, so the panel words that same name.
      expect(errorText(conflict('channel name 新频道 is already in use'), t, 'room', '  #新频道 '))
        .toBe(t('channelNameTaken', { name: '新频道' }))
    }
  })

  it('keeps a member name exactly as the service answered it, # included', () => {
    for (const language of ['zh', 'en'] as const) {
      const t = translate(language)
      // The service only trims a member name (`roster.mjs`), so a typed `#Coder` is still `#Coder`.
      expect(errorText(conflict('name #Coder is already used by Coder'), t, 'member', ' #Coder '))
        .toBe(t('memberNameTaken', { name: '#Coder' }))
    }
  })

  it('does not blame the member name for an invalid about something else', () => {
    for (const language of ['zh', 'en'] as const) {
      const t = translate(language)
      // `Claude Code` is a name the service accepts; a missing model must not be worded as a bad name.
      const noModel = new ServiceError(400, 'model relay/x is not available: 404', 'invalid')
      expect(errorText(noModel, t, 'member', 'Claude Code')).toBe(t('actionFailed', { message: 'model relay/x is not available: 404' }))
      // The same name with one more space is refused by the service, so that one is a name problem.
      expect(errorText(new ServiceError(400, 'name must be 1-32 characters without spaces (except Claude Code), @ or <>', 'invalid'), t, 'member', 'Claude  Code'))
        .toBe(t('memberNameInvalid'))
      // `Claude Code-<n>` is the de-duplicated stem the service also accepts.
      expect(errorText(new ServiceError(400, 'name must be 1-32 characters without spaces (except Claude Code), @ or <>', 'invalid'), t, 'member', 'Claude Code-2'))
        .toBe(t('actionFailed', { message: 'name must be 1-32 characters without spaces (except Claude Code), @ or <>' }))
    }
  })

  it('keeps the service sentence only inside the fallback line, never as the whole message', () => {
    for (const language of ['zh', 'en'] as const) {
      const t = translate(language)
      const unmapped = new ServiceError(403, 'member must be an agent in this channel list', 'forbidden')
      expect(errorText(unmapped, t, 'room', 'x')).toBe(t('actionFailed', { message: 'member must be an agent in this channel list' }))
      // A local check or a thrown string already reads the way the panel meant it to.
      expect(errorText(new Error('renew failed'), t, 'member', 'x')).toBe('renew failed')
    }
  })

  it('shows the Chinese line in the Chinese settings dialog and the English one in English', async () => {
    for (const language of ['zh', 'en'] as const) {
      cleanup()
      const t = translate(language)
      const renameRoom = vi.fn(async () => { throw conflict('channel name 新频道 is already in use') })
      render(<ChannelSettingsDialog
        room={{ id: 1, name: 'general' }} members={[]} effectiveLead="a"
        renameRoom={renameRoom} setDispatchMode={vi.fn(async () => {})} setMaxRelay={vi.fn(async () => {})}
        setLead={vi.fn(async () => {})} setWorkspacePath={vi.fn(async () => {})} renewRoom={vi.fn(async () => {})}
        onClose={vi.fn()} t={t} />)
      fireEvent.change(screen.getByLabelText(t('channelName')), { target: { value: '新频道' } })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('messageSave') })) })
      const alert = screen.getByRole('alert').textContent
      expect(alert).toBe(t('channelNameTaken', { name: '新频道' }))
      expect(alert).not.toContain('already in use')
    }
  })

  it('shows the member-name clash in the panel language and keeps the form open', async () => {
    for (const language of ['zh', 'en'] as const) {
      cleanup()
      const t = translate(language)
      const onSubmit = vi.fn(async () => { throw conflict('name Coder is already used by Coder') })
      render(<MemberDialog
        member={undefined} listModels={async () => []} listClis={async () => []}
        onSubmit={onSubmit} onClose={vi.fn()} t={t} />)
      fireEvent.change(screen.getByLabelText(t('memberName')), { target: { value: 'Coder' } })
      await act(async () => { fireEvent.submit(screen.getByRole('dialog')) })
      const alert = screen.getByRole('alert').textContent
      expect(alert).toBe(t('memberNameTaken', { name: 'Coder' }))
      expect(alert).not.toContain('already used by')
      expect((screen.getByLabelText(t('memberName')) as HTMLInputElement).value).toBe('Coder')
    }
  })

  it('shows an unrelated member refusal as the fallback line, not as a bad name', async () => {
    const t = translate('zh')
    const onSubmit = vi.fn(async () => { throw new ServiceError(400, 'model relay/x is not available: 404', 'invalid') })
    render(<MemberDialog
      member={undefined} listModels={async () => []} listClis={async () => []}
      onSubmit={onSubmit} onClose={vi.fn()} t={t} />)
    fireEvent.change(screen.getByLabelText(t('memberName')), { target: { value: 'Claude Code' } })
    await act(async () => { fireEvent.submit(screen.getByRole('dialog')) })
    const alert = screen.getByRole('alert').textContent
    expect(alert).toBe(zh.actionFailed.replace('{message}', 'model relay/x is not available: 404'))
    expect(alert).not.toContain('成员名要')
  })

  it('shows the Chinese line when the new channel box is refused', async () => {
    const state: ChannelSnapshot = {
      phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general' }], roomId: 1,
      members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {},
      leadId: 'ju', effectiveLeadId: 'ju', messages: [],
    }
    const createRoom = vi.fn(async () => { throw conflict('channel name 工作区1 is reserved for workspaces') })
    const p = {
      useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
      selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false,
      createRoom, renameRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
      addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
      setLead: vi.fn(async () => {}), setDispatchMode: vi.fn(async () => {}), t: translate('zh'),
    } as unknown as ChannelsPageProps
    render(<ChannelsPage {...p} />)
    fireEvent.click(screen.getByRole('button', { name: zh.newRoom }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.newRoom }), { target: { value: '工作区1' } })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: zh.newRoom }), { key: 'Enter' }) })
    expect(createRoom).toHaveBeenCalledWith('工作区1')
    expect(screen.getByRole('alert').textContent).toBe(zh.channelNameReserved.replace('{name}', '工作区1'))
  })
})

describe('the / menu title over a DSH primary role (#268 1)', () => {
  const state = (kind: 'dsh' | 'bot'): ChannelSnapshot => ({
    phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general' }], roomId: 1,
    members: [{ id: 'ju', name: '橘', kind, online: true }], thinking: {},
    leadId: 'ju', effectiveLeadId: 'ju', messages: [],
  })
  const page = (snapshot: ChannelSnapshot) => ({
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(snapshot),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false,
    createRoom: vi.fn(async () => {}), renameRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
    setLead: vi.fn(async () => {}), setDispatchMode: vi.fn(async () => {}), t: translate('zh'),
  }) as unknown as ChannelsPageProps

  it('says the DSH primary role takes no command instead of "no primary role chosen"', () => {
    render(<ChannelsPage {...page(state('dsh'))} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/' } })
    const menu = within(screen.getByRole('region', { name: zh.slashTitle }))
    expect(menu.getByText(zh.slashTitleDmNoCmd.replace('{name}', '橘'))).toBeTruthy()
    expect(menu.queryByText(zh.slashTitleNoLead)).toBeNull()
  })

  it('still names a bot primary role as the command target', () => {
    render(<ChannelsPage {...page(state('bot'))} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/' } })
    const menu = within(screen.getByRole('region', { name: zh.slashTitle }))
    expect(menu.getByText(zh.slashTitleLead.replace('{name}', '橘'))).toBeTruthy()
  })

  it('still refuses a command when no primary role is set', () => {
    const snapshot = { ...state('dsh'), leadId: undefined, effectiveLeadId: undefined }
    render(<ChannelsPage {...page(snapshot)} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/' } })
    const menu = within(screen.getByRole('region', { name: zh.slashTitle }))
    expect(menu.getByText(zh.slashTitleNoLead)).toBeTruthy()
  })
})
