// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { createChannelSource, type ChannelSnapshot, type ChannelTransport, type OutgoingAttachment } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const ready: ChannelSnapshot = {
  phase: 'ready', rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], roomId: 1,
  members: [], thinking: {}, messages: [], leadId: null, tasks: [], outbox: [], hasMoreOlder: false,
}
function props(state: ChannelSnapshot, send: ChannelsPageProps['send']): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state), selectRoom: vi.fn(), send,
    openModelSettings: () => false, createRoom: vi.fn(), renameRoom: vi.fn(), listModels: vi.fn(async () => []),
    addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(), setLead: vi.fn(), setDispatchMode: vi.fn(),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
  } as unknown as ChannelsPageProps
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const stored = { id: '11111111-1111-1111-1111-111111111111', name: 'secret.bin', mime: 'application/octet-stream', size: 3 }
const file = () => new File([new Uint8Array([1, 2, 3])], 'secret.bin', { type: 'application/octet-stream' })

it('review197: Enter during upload must preserve the attachment after the upload settles', async () => {
  const job = deferred<OutgoingAttachment>()
  const send = vi.fn(async () => {})
  render(<ChannelsPage {...props(ready, send)} uploadAttachment={() => job.promise} />)
  await act(async () => { fireEvent.paste(screen.getByRole('combobox'), { clipboardData: { files: [file()], types: ['Files'] } }) })
  await act(async () => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }) })
  expect(send).not.toHaveBeenCalled()
  await act(async () => { job.resolve(stored); await job.promise })
  console.log('review197 same-room send args:', JSON.stringify(send.mock.calls))
  expect(send).toHaveBeenCalledExactlyOnceWith('', undefined, [stored], 1)
})

it('review197: switching rooms during upload must keep the queued message in the originating room', async () => {
  const posts: { url: string; body: unknown }[] = []
  const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const transport: ChannelTransport = {
    url: path => '/' + path,
    openEvents: () => ({ onopen: null, onmessage: null, onerror: null, close() {} }),
    fetch: async (url, init) => {
      if (url === '/collab/api/state') return response(ready)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return response({ message: { id: 10, room_id: Number(url.split('/')[4]), author_kind: 'user', author: 'owner', name: 'owner', text: 'private', created_at: 1, card: null, from_turn: null } })
      }
      return response({ messages: [], tasks: [] })
    },
  }
  const { source, actions } = createChannelSource(transport)
  const unsubscribe = source.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    await actions.selectRoom(1)
    const job = deferred<OutgoingAttachment>()
    const uploadAttachment = () => job.promise
    const view = render(<ChannelsPage {...props(source.getSnapshot(), actions.send)} uploadAttachment={uploadAttachment} />)
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'private' } })
      fireEvent.paste(screen.getByRole('combobox'), { clipboardData: { files: [file()], types: ['Files'] } })
    })
    await act(async () => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }) })
    await act(async () => { await actions.selectRoom(2) })
    view.rerender(<ChannelsPage {...props(source.getSnapshot(), actions.send)} uploadAttachment={uploadAttachment} />)
    await act(async () => { job.resolve(stored); await job.promise })
    console.log('review197 cross-room posts:', JSON.stringify(posts))
    expect(posts[0]?.url).toBe('/collab/api/rooms/1/messages')
  } finally { unsubscribe() }
})

it('review197: removing an in-flight file must abort its upload', async () => {
  const job = deferred<OutgoingAttachment>()
  const uploadAttachment = vi.fn((_file: File, _progress?: unknown, _signal?: AbortSignal) => job.promise)
  render(<ChannelsPage {...props(ready, async () => {})} uploadAttachment={uploadAttachment} />)
  await act(async () => { fireEvent.paste(screen.getByRole('combobox'), { clipboardData: { files: [file()], types: ['Files'] } }) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.removeAttachment })) })
  console.log('review197 upload signal:', uploadAttachment.mock.calls[0]?.[2])
  expect(uploadAttachment.mock.calls[0]?.[2]?.aborted).toBe(true)
})

it('keeps the draft and reports an upload failure that settles before React renders', async () => {
  let reject!: (error: Error) => void
  const promise = new Promise<OutgoingAttachment>((_resolve, fail) => { reject = fail })
  const send = vi.fn(async () => {})
  render(<ChannelsPage {...props(ready, send)} uploadAttachment={() => promise} />)
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'keep this draft' } })
    fireEvent.paste(screen.getByRole('combobox'), { clipboardData: { files: [file()], types: ['Files'] } })
  })
  await act(async () => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }) })
  await act(async () => { reject(new Error('connection lost')) })
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('secret.bin')
  expect(screen.getByRole('alert').textContent).toContain('connection lost')
  expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('keep this draft')
})
