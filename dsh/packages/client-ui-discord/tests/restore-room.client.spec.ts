import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChannelSource, type ChannelTransport, type EventStreamLike } from '../src/client/channel-source.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeTransport(routes: (url: string) => Response | Promise<Response>) {
  const streams: EventStreamLike[] = []
  const transport: ChannelTransport = {
    fetch: input => Promise.resolve(routes(input)),
    openEvents: () => {
      const stream: EventStreamLike = { onopen: null, onmessage: null, onerror: null, close() {} }
      streams.push(stream)
      return stream
    },
    url: path => `/${path}`,
  }
  return { transport, streams }
}

const state = { rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], members: [], thinking: {} }

describe('channel selection survives a reload (#112)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reopens the channel this browser had open instead of the first one', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
    })
    const { transport } = fakeTransport(url => url === '/collab/api/state' ? json(200, state) : json(200, { messages: [] }))

    const first = createChannelSource(transport)
    const stopFirst = first.source.subscribe(() => {})
    await vi.waitFor(() => expect(first.source.getSnapshot().roomId).toBe(1))
    await first.actions.selectRoom(2)
    expect(store.get('dsh-collab.room')).toBe('2')
    stopFirst()

    // a fresh source stands in for the panel reopening after a reload
    const again = createChannelSource(transport)
    const stopAgain = again.source.subscribe(() => {})
    await vi.waitFor(() => expect(again.source.getSnapshot().roomId).toBe(2))
    stopAgain()
  })

  it('falls back to the first channel when the remembered one is gone', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '999', setItem: () => {} })
    const { transport } = fakeTransport(url => url === '/collab/api/state' ? json(200, state) : json(200, { messages: [] }))
    const { source } = createChannelSource(transport)
    const stop = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().roomId).toBe(1))
    stop()
  })
})
