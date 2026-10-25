// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemberDialog } from '../src/client/MemberDialog.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => String(zh[key])
const clis = async () => ['claude', 'codex', 'gemini'].map(cli => ({ cli, path: '/fixture/' + cli }))
const models = async () => []
afterEach(cleanup)
it('fills Codex-2, saves without a persona, and keeps an explicit name while switching CLI', async () => {
 const submit = vi.fn(async () => {})
 render(<MemberDialog member={undefined} members={[{id:'codex',name:'Codex',kind:'dsh',online:true,cli:'codex'}]} listModels={models} listClis={clis} onSubmit={submit} onClose={() => {}} t={t} />)
 fireEvent.click(screen.getByRole('radio',{name:zh.memberTypeCli}))
 await waitFor(() => expect((screen.getByRole('radio',{name:'Codex'}) as HTMLInputElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('radio',{name:'Codex'}))
 expect((screen.getByLabelText(zh.memberName) as HTMLInputElement).value).toBe('Codex-2')
 fireEvent.click(screen.getByRole('button',{name:zh.save}))
 await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({name:'Codex-2', nameCustomized:false, persona:''})))
 fireEvent.click(screen.getByText(zh.memberOptional))
 fireEvent.change(screen.getByLabelText(zh.memberName),{target:{value:'小码'}})
 fireEvent.click(screen.getByRole('radio',{name:'Claude Code'}))
 expect(screen.getByText('小码·Claude Code')).toBeTruthy()
})
it('applies a library persona only when selected and rewrites its identity when keeping the name', async () => {
 const submit = vi.fn(async () => {})
 const listPersonas = async () => [{slug:'dragon',name:'龙娘',text:'你是「龙娘」。负责写代码。',avatar:'dragon'}]
 render(<MemberDialog member={undefined} listPersonas={listPersonas} listModels={models} listClis={clis} onSubmit={submit} onClose={() => {}} t={t} />)
 fireEvent.click(screen.getByText(zh.memberOptional))
 fireEvent.change(screen.getByLabelText(zh.memberName),{target:{value:'小码'}})
 await waitFor(() => expect(screen.getByRole('option',{name:'龙娘'})).toBeTruthy())
 fireEvent.change(screen.getByRole('combobox',{name:zh.memberPersona}),{target:{value:'dragon'}})
 fireEvent.click(screen.getByRole('button',{name:zh.save}))
 await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({name:'小码',persona:'你是「小码」。负责写代码。'})))
})
