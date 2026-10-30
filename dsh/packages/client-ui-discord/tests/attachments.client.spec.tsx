// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentList } from '../src/client/Attachments.tsx'
import { attachmentUrl } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => String(zh[key])
const image = { id: 'photo', name: '照片.png', mime: 'image/png', size: 42 }
const copyLabel = '复制图片'
const downloadLabel = '下载'
const failure = '复制失败，请下载图片后保存或复制。'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function setupClipboard() {
  const write = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { write } })
  const Item = vi.fn(class { constructor(public data: Record<string, Blob>) {} })
  vi.stubGlobal('ClipboardItem', Item)
  return { write, Item }
}
function show() { return render(<AttachmentList attachments={[image]} t={t} />) }

it('offers a named download link with new-tab fallback and keeps the image preview', () => {
  show()
  const link = screen.getByRole('link', { name: downloadLabel })
  expect(link.getAttribute('href')).toBe(attachmentUrl(image.id))
  expect(link.getAttribute('download')).toBe(image.name)
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.textContent).toBe(downloadLabel)
  const preview = screen.getByRole('img', { name: image.name }).closest('a')
  expect(preview?.getAttribute('href')).toBe(attachmentUrl(image.id))
  expect(preview?.getAttribute('target')).toBe('_blank')
  expect(preview?.hasAttribute('download')).toBe(false)
})

it('writes the fetched image blob to the clipboard and briefly announces success', async () => {
  vi.useFakeTimers()
  const { write, Item } = setupClipboard()
  const blob = new Blob(['image'], { type: image.mime })
  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
  vi.stubGlobal('fetch', fetcher)
  show()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copyLabel })) })
  expect(fetcher).toHaveBeenCalledWith(attachmentUrl(image.id))
  expect(Item).toHaveBeenCalledWith({ [image.mime]: blob })
  expect(write).toHaveBeenCalledWith([expect.objectContaining({ data: { [image.mime]: blob } })])
  expect(screen.getByRole('button', { name: '已复制' }).textContent).toBe('已复制')
  act(() => { vi.advanceTimersByTime(2000) })
  expect(screen.getByRole('button', { name: copyLabel })).toBeTruthy()
})

it.each(['permission', 'network', 'http', 'format'])('shows a visible error and keeps download available after %s failure', async reason => {
  const { write } = setupClipboard()
  const fetcher = vi.fn().mockResolvedValue({ ok: reason !== 'http', blob: async () => new Blob(['image'], { type: image.mime }) })
  if (reason === 'permission' || reason === 'format') write.mockRejectedValue(new Error(reason))
  if (reason === 'network') fetcher.mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetcher)
  show()
  fireEvent.click(screen.getByRole('button', { name: copyLabel }))
  expect((await screen.findByRole('alert')).textContent).toBe(failure)
  const download = screen.getByRole('link', { name: downloadLabel })
  expect(download.getAttribute('download')).toBe(image.name)
  expect(download.closest('[data-copy-state]')?.getAttribute('data-copy-state')).toBe('error')
  if (reason === 'http') expect(write).not.toHaveBeenCalled()
})

it.each(['clipboard', 'ClipboardItem'])('explains missing %s support without fetching', async missing => {
  setupClipboard()
  if (missing === 'clipboard') vi.stubGlobal('navigator', {})
  else vi.stubGlobal('ClipboardItem', undefined)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  show()
  fireEvent.click(screen.getByRole('button', { name: copyLabel }))
  expect((await screen.findByRole('alert')).textContent).toBe(failure)
  expect(fetcher).not.toHaveBeenCalled()
})

it('prevents duplicate copies while pending and allows retry after failure', async () => {
  const { write } = setupClipboard()
  let reject!: (error: Error) => void
  write.mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: image.mime }) }))
  show()
  fireEvent.click(screen.getByRole('button', { name: copyLabel }))
  await waitFor(() => expect(write).toHaveBeenCalledOnce())
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { reject(new Error('denied')) })
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: copyLabel }))
  await screen.findByRole('button', { name: '已复制' })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(write).toHaveBeenCalledTimes(2)
})

it('keeps download and copy in native keyboard focus order', () => {
  show()
  const download = screen.getByRole('link', { name: downloadLabel })
  const copy = screen.getByRole('button', { name: copyLabel })
  expect(download.tabIndex).toBe(0)
  expect(copy.tabIndex).toBe(0)
  download.focus()
  expect(document.activeElement).toBe(download)
  copy.focus()
  expect(document.activeElement).toBe(copy)
  expect(download.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('leaves audio and file attachments without image action buttons', () => {
  render(<AttachmentList attachments={[{ ...image, id: 'pdf', name: 'note.pdf', mime: 'application/pdf' }, { ...image, id: 'audio', name: 'voice.mp3', mime: 'audio/mpeg' }]} t={t} />)
  expect(screen.queryByRole('button', { name: copyLabel })).toBeNull()
  expect(screen.queryByRole('link', { name: downloadLabel })).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(2)
})
