// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemberDialog } from '../src/client/MemberDialog.tsx'
import type { ChannelMember, MemberInput } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => String(zh[key])
const clis = async () => ['claude', 'codex', 'gemini'].map(cli => ({ cli, path: '/fixture/' + cli }))
const models = async () => []
const member: ChannelMember = { id: 'claude', name: 'Claude', kind: 'dsh', online: true, cli: 'claude', persona: 'Keep this persona', permissionPreset: 'read-only', avatar: 'dragon' }
afterEach(cleanup)

it('edits a Claude model, preserving identity, persona, avatar and permissions', async () => {
  const submit = vi.fn(async (_input: MemberInput) => {})
  render(<MemberDialog member={member} listModels={models} listClis={clis} onSubmit={submit} onClose={() => {}} t={t} />)
  fireEvent.change(screen.getByRole('textbox', { name: zh.memberModel }), { target: { value: '  claude-custom-model[1M]  ' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Claude', persona: member.persona, avatar: 'dragon', cli: 'claude', permissionPreset: 'read-only', model: 'claude-custom-model[1M]' }))
})

it('reopens the saved Claude model and clears it to the CLI default', async () => {
  const submit = vi.fn(async (_input: MemberInput) => {})
  render(<MemberDialog member={{ ...member, model: 'sonnet' }} listModels={models} listClis={clis} onSubmit={submit} onClose={() => {}} t={t} />)
  const input = screen.getByRole('textbox', { name: zh.memberModel }) as HTMLInputElement
  expect(input.value).toBe('sonnet')
  fireEvent.change(input, { target: { value: ' ' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ cli: 'claude', model: null })))
})

it('includes the Claude model on creation but never sends it to another CLI', async () => {
  const submit = vi.fn(async (_input: MemberInput) => {})
  render(<MemberDialog member={undefined} listModels={models} listClis={clis} onSubmit={submit} onClose={() => {}} t={t} />)
  fireEvent.click(screen.getByRole('radio', { name: zh.memberTypeCli }))
  await waitFor(() => expect((screen.getByRole('radio', { name: 'Claude Code' }) as HTMLInputElement).checked).toBe(true))
  fireEvent.change(screen.getByRole('textbox', { name: zh.memberModel }), { target: { value: 'opus' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ cli: 'claude', model: 'opus' })))
  await waitFor(() => expect((screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
  expect(screen.queryByRole('textbox', { name: zh.memberModel })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[1][0]).not.toHaveProperty('model')
})
