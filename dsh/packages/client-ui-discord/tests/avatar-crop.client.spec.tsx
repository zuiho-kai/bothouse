// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cropRect } from '../src/client/avatar-upload.ts'
import { MemberDialog } from '../src/client/MemberDialog.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh, args?: Record<string, string>) => String(zh[key]).replace('{kb}', args?.kb ?? '')
const list = async () => []
const member = { id: 'coder', name: 'Coder', kind: 'dsh' as const, online: true, avatar: 'upload:coder.png' }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('covers wide and tall sources without distortion and clamps zoom and translation', () => {
  expect(cropRect(800, 400, 0, 200, 0)).toEqual({ x: 200, y: 0, size: 400, scale: 0.64 })
  expect(cropRect(400, 800, 0, 0, 200)).toEqual({ x: 0, y: 200, size: 400, scale: 0.64 })
  expect(cropRect(800, 400, 100, -100, 900)).toEqual({ x: 0, y: 336, size: 64, scale: 4 })
  expect(cropRect(32, 16, 4, 0, 0)).toEqual({ x: 0, y: 0, size: 16, scale: 16 })
})

function setup(output = 'AQID') {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ member }) })
  vi.stubGlobal('fetch', fetcher)
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${output}`)
  vi.stubGlobal('Image', class {
    naturalWidth = 800; naturalHeight = 400; onload?: () => void; url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value; queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:crop'), revokeObjectURL: vi.fn() })
  const close = vi.fn()
  render(<MemberDialog member={member} listModels={list} listClis={list} onSubmit={async () => {}} onClose={close} t={t} />)
  fireEvent.click(screen.getByText(zh.memberOptional))
  return { fetcher, drawImage, encode, close }
}
async function select(type = 'image/jpeg') {
  fireEvent.change(screen.getByLabelText(zh.memberAvatarUpload), { target: { files: [new File([new Uint8Array(300 * 1024)], 'source', { type })] } })
  return screen.findByRole('dialog', { name: zh.memberAvatarCrop })
}

it.each(['image/jpeg', 'image/webp', 'image/png'])('accepts %s over 256KB and exports only on confirmation', async type => {
  const { fetcher, drawImage, encode } = setup()
  const crop = await select(type)
  expect(fetcher).not.toHaveBeenCalled()
  expect(encode).not.toHaveBeenCalled()
  fireEvent.keyDown(crop, { key: 'Enter' })
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 400, 400, 0, 0, 256, 256)
  expect(encode.mock.instances[0]).toMatchObject({ width: 256, height: 256 })
})

it.each(['button', 'Escape'])('cancels with %s without export, upload or closing member editor', async method => {
  const { fetcher, encode, close } = setup()
  const crop = await select()
  if (method === 'button') fireEvent.click(crop.querySelector('button')!)
  else fireEvent.keyDown(crop, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: zh.memberAvatarCrop })).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  expect(encode).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: zh.memberAvatarReset })).toBeTruthy()
})

it('shows actual output KB and keeps crop open when export exceeds 256KB', async () => {
  const { fetcher } = setup(btoa('x'.repeat(256 * 1024 + 100)))
  await select()
  fireEvent.click(screen.getByRole('button', { name: zh.memberAvatarConfirm }))
  expect(screen.getByRole('alert').textContent).toBe(t('memberAvatarOutputSizeError', { kb: '256.1' }))
  expect(screen.getByRole('dialog', { name: zh.memberAvatarCrop })).toBeTruthy()
  expect(fetcher).not.toHaveBeenCalled()
})

it('zooms around the center with slider and wheel while keeping source square', async () => {
  const { drawImage } = setup()
  const crop = await select()
  fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })
  fireEvent.wheel(crop.querySelector('[aria-label]')!, { deltaY: -10000 })
  fireEvent.click(screen.getByRole('button', { name: zh.memberAvatarConfirm }))
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 368, 168, 64, 64, 0, 0, 256, 256)
})
