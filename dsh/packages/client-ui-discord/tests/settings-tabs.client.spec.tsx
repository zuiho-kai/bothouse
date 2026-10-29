// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelSettingsDialog } from '../src/client/ChannelSettingsDialog.tsx'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/ChannelsPage.module.css'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentProps } from 'react'

const stylesheet = readFileSync(resolve(import.meta.dirname, '../src/client/ChannelsPage.module.css'), 'utf8')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function props(): ComponentProps<typeof ChannelSettingsDialog> {
  return {
    room: { id: 1, name: 'general', dispatch_mode: 'mixed', workspace_path: '/old' },
    members: [{ id: 'a', name: 'A', kind: 'dsh', online: true }, { id: 'b', name: 'B', kind: 'dsh', online: true }],
    effectiveLead: 'a', renameRoom: vi.fn(async () => {}), setDispatchMode: vi.fn(async () => {}),
    setLead: vi.fn(async () => {}), setWorkspacePath: vi.fn(async () => {}), renewRoom: vi.fn(async () => {}),
    onClose: vi.fn(), t: ((key: keyof typeof zh) => zh[key]) as ComponentProps<typeof ChannelSettingsDialog>['t'],
  }
}
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.messageSave })) }) }
const saveDisabled = () => (screen.getByRole('button', { name: zh.messageSave }) as HTMLButtonElement).disabled

describe('channel settings tabs', () => {
  it('keeps a fixed dialog and scrolling body with shared tabs and a stationary action bar', () => {
    render(<ChannelSettingsDialog {...props()} />)
    const dialog = screen.getByRole('dialog')
    const button = screen.getByRole('button', { name: zh.messageSave })
    const actions = button.parentElement!
    expect(dialog.classList.contains(css.settingsDialog)).toBe(true)
    expect(stylesheet).toMatch(/\.settingsDialog\s*\{[^}]*height: min\(70vh, calc\(100dvh - 32px\)\)/)
    expect(stylesheet).toMatch(/\.settingsBody\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/)
    expect(stylesheet).toMatch(/\.settingsDialog > :not\(\.settingsBody\)\s*\{[^}]*flex-shrink: 0;/)
    expect(stylesheet).toMatch(/@media \(max-width: 599px\)\s*\{\s*\.settingsDialog\s*\{[^}]*height: calc\(100dvh - 32px\)/)
    expect(actions.classList.contains(css.dialogActions)).toBe(true)
    expect(actions.firstElementChild).toBe(screen.getByRole('button', { name: zh.close }))
    expect(actions.lastElementChild).toBe(button)
    const fixedClass = dialog.className
    for (const target of [zh.settingsDispatch, zh.settingsWorkspace, zh.settingsBasic]) {
      tab(target)
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(dialog.className).toBe(fixedClass)
      expect(screen.getByRole('tablist').className).toBe(css.boardTabs)
      const panel = screen.getByRole('tabpanel')
      expect(panel.classList.contains(css.settingsBody)).toBe(true)
      expect(panel.contains(actions)).toBe(false)
      expect(screen.getByRole('button', { name: zh.messageSave })).toBe(button)
    }
  })

  it.each([zh.settingsBasic, zh.settingsDispatch, zh.settingsWorkspace])('shows pending save state and disables duplicate saves in %s', async target => {
    const p = props()
    let resolve!: () => void
    const pending = vi.fn(() => new Promise<void>(done => { resolve = done }))
    p.renameRoom = pending; p.setDispatchMode = pending; p.setWorkspacePath = pending
    render(<ChannelSettingsDialog {...p} />)
    tab(target)
    expect(saveDisabled()).toBe(true)
    if (target === zh.settingsBasic) change(zh.channelName, 'new')
    else if (target === zh.settingsDispatch) fireEvent.click(screen.getByRole('radio', { name: zh.dispatchSolo }))
    else change(zh.workingDirectory, '/new')
    expect(saveDisabled()).toBe(false)
    await save()
    const button = screen.getByRole('button', { name: zh.settingsSaving }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(pending).toHaveBeenCalledOnce()
    await act(async () => { resolve() })
    expect(saveDisabled()).toBe(true)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(zh.settingsSaved)
    expect(screen.getByRole('tabpanel').contains(status)).toBe(false)
  })

  it('retains all drafts across tabs and saves only the selected tab', async () => {
    const p = props()
    render(<ChannelSettingsDialog {...p} />)
    expect(saveDisabled()).toBe(true)
    change(zh.channelName, 'renamed')
    tab(zh.settingsDispatch)
    fireEvent.click(screen.getByRole('radio', { name: zh.dispatchTeam }))
    change(zh.channelLead, 'b')
    tab(zh.settingsWorkspace)
    change(zh.workingDirectory, '/new')
    expect(p.renameRoom).not.toHaveBeenCalled()
    expect(p.setDispatchMode).not.toHaveBeenCalled()
    expect(p.setLead).not.toHaveBeenCalled()
    expect(p.setWorkspacePath).not.toHaveBeenCalled()
    tab(zh.settingsBasic)
    expect((screen.getByLabelText(zh.channelName) as HTMLInputElement).value).toBe('renamed')
    await save()
    expect(p.renameRoom).toHaveBeenCalledExactlyOnceWith(1, 'renamed')
    expect(saveDisabled()).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(zh.settingsSaved)
    expect(p.setDispatchMode).not.toHaveBeenCalled()
    expect(p.setWorkspacePath).not.toHaveBeenCalled()
    tab(zh.settingsDispatch)
    expect((screen.getByRole('radio', { name: zh.dispatchTeam }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(zh.channelLead) as HTMLSelectElement).value).toBe('b')
    expect(saveDisabled()).toBe(false)
    await save()
    expect(p.setDispatchMode).toHaveBeenCalledExactlyOnceWith(1, 'team')
    expect(p.setLead).toHaveBeenCalledExactlyOnceWith('b', 1)
    expect(saveDisabled()).toBe(true)
    tab(zh.settingsWorkspace)
    expect((screen.getByLabelText(zh.workingDirectory) as HTMLInputElement).value).toBe('/new')
    await save()
    expect(p.setWorkspacePath).toHaveBeenCalledExactlyOnceWith(1, '/new')
    expect(p.renewRoom).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it.each([zh.settingsBasic, zh.settingsDispatch, zh.settingsWorkspace])('keeps server errors inside %s', async target => {
    const p = props()
    const fail = async () => { throw new Error('service: exact failure 原因') }
    p.renameRoom = vi.fn(fail); p.setDispatchMode = vi.fn(fail); p.setWorkspacePath = vi.fn(fail)
    render(<ChannelSettingsDialog {...p} />)
    tab(target)
    if (target === zh.settingsBasic) change(zh.channelName, 'new')
    else if (target === zh.settingsDispatch) fireEvent.click(screen.getByRole('radio', { name: zh.dispatchSolo }))
    else change(zh.workingDirectory, '/new')
    await save()
    const error = screen.getByRole('alert')
    expect(error.textContent).toBe('service: exact failure 原因')
    expect(screen.getByRole('tabpanel').contains(error)).toBe(false)
    expect(error.parentElement!.nextElementSibling).toBe(screen.getByRole('button', { name: zh.messageSave }).parentElement)
    expect(saveDisabled()).toBe(false)
    for (const other of [zh.settingsBasic, zh.settingsDispatch, zh.settingsWorkspace].filter(t => t !== target)) {
      tab(other)
      expect(screen.queryByRole('alert')).toBeNull()
    }
    tab(target)
    expect(screen.getByRole('alert').textContent).toBe('service: exact failure 原因')
  })

  it('retries only the failed dispatch field after partial success', async () => {
    const p = props()
    p.setLead = vi.fn().mockRejectedValueOnce(new Error('lead failed')).mockResolvedValue(undefined)
    render(<ChannelSettingsDialog {...p} />)
    tab(zh.settingsDispatch)
    fireEvent.click(screen.getByRole('radio', { name: zh.dispatchTeam }))
    change(zh.channelLead, 'b')
    await save()
    expect(screen.getByRole('alert').textContent).toBe('lead failed')
    await save()
    expect(p.setDispatchMode).toHaveBeenCalledTimes(1)
    expect(p.setLead).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(saveDisabled()).toBe(true)
  })

  it.each(['button', 'escape', 'backdrop'])('confirms dirty drafts in hidden tabs when closing via %s', method => {
    const p = props()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ChannelSettingsDialog {...p} />)
    change(zh.channelName, 'draft')
    tab(zh.settingsWorkspace)
    const close = () => {
      if (method === 'button') fireEvent.click(screen.getByRole('button', { name: zh.close }))
      else if (method === 'escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      else fireEvent.click(screen.getByRole('dialog').parentElement!)
    }
    close()
    expect(confirm).toHaveBeenCalledWith(zh.settingsDiscardConfirm)
    expect(p.onClose).not.toHaveBeenCalled()
    tab(zh.settingsBasic)
    expect((screen.getByLabelText(zh.channelName) as HTMLInputElement).value).toBe('draft')
    confirm.mockReturnValue(true)
    close()
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('closes without confirmation after saving or reverting every edit', async () => {
    const p = props()
    const confirm = vi.spyOn(window, 'confirm')
    render(<ChannelSettingsDialog {...p} />)
    change(zh.channelName, 'new')
    await save()
    tab(zh.settingsWorkspace)
    change(zh.workingDirectory, '/new')
    change(zh.workingDirectory, '/old')
    expect(saveDisabled()).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(confirm).not.toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('supports arrow navigation and traps focus within the active tab controls', () => {
    render(<ChannelSettingsDialog {...props()} />)
    const basic = screen.getByRole('tab', { name: zh.settingsBasic })
    basic.focus()
    fireEvent.keyDown(basic, { key: 'ArrowRight' })
    const dispatch = screen.getByRole('tab', { name: zh.settingsDispatch })
    expect(document.activeElement).toBe(dispatch)
    expect(dispatch.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(dispatch.id)
    fireEvent.keyDown(dispatch, { key: 'End' })
    const workspace = screen.getByRole('tab', { name: zh.settingsWorkspace })
    expect(document.activeElement).toBe(workspace)
    fireEvent.keyDown(workspace, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.close }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(workspace)
  })

  it('preserves the renew decision across tabs and reports renew errors only in workspace', async () => {
    const p = props()
    p.renewRoom = vi.fn().mockRejectedValueOnce(new Error('renew failed')).mockResolvedValue(undefined)
    render(<ChannelSettingsDialog {...p} />)
    tab(zh.settingsWorkspace)
    change(zh.workingDirectory, '/new')
    await save()
    tab(zh.settingsBasic)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    tab(zh.settingsWorkspace)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.renewNow })) })
    expect(screen.getByRole('alert').textContent).toBe('renew failed')
    tab(zh.settingsDispatch)
    expect(screen.queryByRole('alert')).toBeNull()
    tab(zh.settingsWorkspace)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.renewNow })) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(p.setWorkspacePath).toHaveBeenCalledTimes(1)
    expect(p.renewRoom).toHaveBeenCalledTimes(2)
  })
})
