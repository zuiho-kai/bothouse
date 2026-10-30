// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentList } from '../src/client/Attachments.tsx'
import { attachmentUrl } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => String(zh[key])
const image = { id: 'preview', name: '预览.png', mime: 'image/png', size: 42 }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function show() {
  render(<><button>外部按钮</button><AttachmentList attachments={[image]} t={t} /></>)
  const trigger = screen.getByRole('button', { name: image.name })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger, dialog: screen.getByRole('dialog', { name: image.name }) }
}

it('opens a modal with the original image and focuses its close button', () => {
  const { dialog, trigger } = show()
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(within(dialog).getByRole('img').getAttribute('src')).toBe(attachmentUrl(image.id))
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭' }))
})

it.each(['escape', 'backdrop', 'button'])('closes via %s and restores focus to the triggering image', method => {
  const { dialog, trigger } = show()
  if (method === 'escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  else if (method === 'backdrop') fireEvent.click(dialog.parentElement!)
  else fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('does not close when the large image is clicked', () => {
  const { dialog } = show()
  fireEvent.click(within(dialog).getByRole('img'))
  expect(screen.getByRole('dialog')).toBe(dialog)
})

it('wraps Tab and Shift+Tab and redirects focus from the background', () => {
  const { dialog } = show()
  const close = within(dialog).getByRole('button', { name: '关闭' })
  const copy = within(dialog).getByRole('button', { name: '复制图片' })
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(copy)
  fireEvent.keyDown(copy, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  screen.getByRole('button', { name: '外部按钮' }).focus()
  expect(document.activeElement).toBe(close)
})

it('shares clipboard state and the named download link between preview and thumbnail', async () => {
  const blob = new Blob(['image'], { type: image.mime })
  const write = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { write } })
  const Item = vi.fn(class { constructor(public data: Record<string, Blob>) {} })
  vi.stubGlobal('ClipboardItem', Item)
  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
  vi.stubGlobal('fetch', fetcher)
  const { dialog } = show()
  const download = within(dialog).getByRole('link', { name: '下载' })
  expect(download.getAttribute('href')).toBe(attachmentUrl(image.id))
  expect(download.getAttribute('download')).toBe(image.name)
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '复制图片' })) })
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(attachmentUrl(image.id))
  expect(Item).toHaveBeenCalledWith({ [image.mime]: blob })
  expect(write).toHaveBeenCalledOnce()
  expect(within(dialog).getByRole('button', { name: '已复制' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
})

it('shows copy failure inside the preview and retains download', async () => {
  vi.stubGlobal('navigator', {})
  const { dialog } = show()
  fireEvent.click(within(dialog).getByRole('button', { name: '复制图片' }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe(zh.attachmentCopyError)
  expect(within(dialog).getByRole('link', { name: '下载' })).toBeTruthy()
})

it('skips the disabled copy button when trapping focus during a pending copy', async () => {
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } })
  vi.stubGlobal('ClipboardItem', class {})
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const { dialog } = show()
  fireEvent.click(within(dialog).getByRole('button', { name: '复制图片' }))
  const close = within(dialog).getByRole('button', { name: '关闭' })
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  const download = within(dialog).getByRole('link', { name: '下载' })
  expect(document.activeElement).toBe(download)
  fireEvent.keyDown(download, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
})

it('restores focus to the selected image when there are multiple attachments', () => {
  render(<AttachmentList attachments={[image, { ...image, id: 'second', name: '第二张.png' }]} t={t} />)
  const second = screen.getByRole('button', { name: '第二张.png' })
  fireEvent.click(second)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(document.activeElement).toBe(second)
})
