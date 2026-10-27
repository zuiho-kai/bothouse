// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { avatarSrc } from '../src/client/avatars.ts'
import { Avatar } from '../src/client/Avatar.tsx'
import { MemberDialog } from '../src/client/MemberDialog.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => String(zh[key])
const models = async () => []
const clis = async () => []
const member = { id: 'coder', name: 'Coder', kind: 'dsh' as const, online: true, avatar: 'upload:coder.png' }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('resolves only safe upload filenames and refreshes an existing portrait on replacement', () => {
  expect(avatarSrc('upload:coder.png')).toBe('collab/avatars/uploads/coder.png')
  for (const value of ['upload:../coder.png', 'upload:a/b.png', 'upload:a.png?x', 'upload:a_png.png']) expect(avatarSrc(value)).toBeUndefined()
  const view = render(<Avatar id="coder" name="Coder" avatar={member.avatar} avatarVersion="one" />)
  expect(view.container.querySelector('img')?.src).toContain('?v=one')
  view.rerender(<Avatar id="coder" name="Coder" avatar={member.avatar} avatarVersion="two" />)
  expect(view.container.querySelector('img')?.src).toContain('?v=two')
})

function dialog() {
  render(<MemberDialog member={member} listModels={models} listClis={clis} onSubmit={async () => {}} onClose={() => {}} t={t} />)
  fireEvent.click(screen.getByText(zh.memberOptional))
}

it('opens the file picker, resizes PNG to 256 square, uploads and restores default', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ member }) })
  vi.stubGlobal('fetch', fetcher)
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AQID')
  vi.stubGlobal('Image', class { onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()) } })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:avatar'), revokeObjectURL: vi.fn() })
  dialog()
  const picker = screen.getByLabelText(zh.memberAvatarUpload) as HTMLInputElement
  const click = vi.spyOn(picker, 'click')
  fireEvent.click(screen.getByRole('button', { name: zh.memberAvatarUpload }))
  expect(click).toHaveBeenCalledOnce()
  const file = new File(['png'], 'avatar.png', { type: 'image/png' })
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([137,80,78,71,13,10,26,10]).buffer } as Blob)
  fireEvent.change(picker, { target: { files: [file] } })
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('collab/api/members/coder/avatar', expect.objectContaining({ method: 'POST', body: '{"png":"AQID"}' })))
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 256)
  await waitFor(() => expect(screen.getByAltText(zh.memberAvatarCustom)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: zh.memberAvatarReset }))
  await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith('collab/api/members/coder/avatar', expect.objectContaining({ method: 'DELETE' })))
})

it('shows visible errors for non-PNG and oversized files before sending a request', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  dialog()
  const picker = screen.getByLabelText(zh.memberAvatarUpload)
  fireEvent.change(picker, { target: { files: [new File(['jpeg'], 'image.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(zh.memberAvatarPngError))
  fireEvent.change(picker, { target: { files: [new File([new Uint8Array(256 * 1024 + 1)], 'huge.png', { type: 'image/png' })] } })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(zh.memberAvatarSizeError))
  expect(fetcher).not.toHaveBeenCalled()
})

it('shows server upload errors without discarding the existing avatar', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '头像不能超过 256KB' }) }))
  dialog()
  fireEvent.click(screen.getByRole('button', { name: zh.memberAvatarReset }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('头像不能超过 256KB'))
  expect(screen.getByRole('button', { name: zh.memberAvatarReset })).toBeTruthy()
})
