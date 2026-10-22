import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { createChannelSource, type ChannelTransport, type EventStreamLike } from '../src/client/channel-source.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeTransport(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const streams: EventStreamLike[] = []
  const calls: string[] = []
  const transport: ChannelTransport = {
    fetch: (input, init) => { calls.push(`${init?.method ?? 'GET'} ${input}`); return Promise.resolve(routes(input, init)) },
    openEvents: () => {
      const stream: EventStreamLike = { onopen: null, onmessage: null, onerror: null, close() { closed.push(stream) } }
      streams.push(stream)
      return stream
    },
    url: path => `/${path}`,
  }
  const closed: EventStreamLike[] = []
  return { transport, streams, closed, calls }
}

const message = (id: number, text: string, roomId = 1) => ({
  id, room_id: roomId, author_kind: 'user', author: 'owner', name: '我', text, created_at: 1, card: null, from_turn: null,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const state = { rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'other' }], members: [], thinking: {} }

describe('channel source', () => {
  it('ignores an old startup after the panel is closed and reopened', async () => {
    const oldState = deferred<Response>()
    let requests = 0
    const { transport, streams, closed } = fakeTransport((url) => {
      if (url === '/collab/api/state') return ++requests === 1 ? oldState.promise : json(200, state)
      return json(200, { messages: [] })
    })
    const { source } = createChannelSource(transport)
    source.subscribe(() => {})()
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    oldState.resolve(json(200, { ...state, rooms: [{ id: 9, name: 'obsolete' }] }))
    // Let the stale Response body and its continuations settle before checking
    // that they did not overwrite the new subscription.
    await setImmediate()
    expect(source.getSnapshot().rooms).toEqual(state.rooms)
    expect(streams).toHaveLength(1)
    unsubscribe()
    expect(closed).toEqual(streams)
  })

  it('reconciles every missed page, edits, deletions and presence on reconnect', async () => {
    let reconnected = false
    const { transport, streams } = fakeTransport((url) => {
      if (url === '/collab/api/state') return json(200, { ...state, members: [{ id: 'ju', name: '橘', kind: 'bot', online: !reconnected }], thinking: reconnected ? {} : { 1: ['ju'] } })
      if (!reconnected) return json(200, { messages: [message(1, 'old card'), message(2, 'deleted while offline')] })
      const rows = [message(1, 'finished card'), ...Array.from({ length: 450 }, (_, i) => message(i + 3, `reply ${i}`))]
      const after = Number(new URL(url, 'http://test').searchParams.get('after') ?? 0)
      return json(200, { messages: rows.filter(m => m.id > after).slice(0, 200) })
    })
    const { source } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    reconnected = true
    streams[0]?.onopen?.(new Event('open'))
    await vi.waitFor(() => expect(source.getSnapshot().messages).toHaveLength(451))
    expect(source.getSnapshot().messages[0]?.text).toBe('finished card')
    expect(source.getSnapshot().messages.some(m => m.id === 2)).toBe(false)
    expect(source.getSnapshot().members[0]?.online).toBe(false)
    expect(source.getSnapshot().thinking).toEqual({})
    unsubscribe()
  })

  it('does not let a delayed room load overwrite a newer visit to the same room', async () => {
    const oldRoom = deferred<Response>()
    let reads = 0
    const { transport, streams } = fakeTransport((url) => {
      if (url === '/collab/api/state') return json(200, state)
      if (url.startsWith('/collab/api/rooms/1/')) return ++reads === 2 ? oldRoom.promise : json(200, { messages: [message(1, reads === 1 ? 'first' : 'latest')] })
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const oldVisit = actions.selectRoom(1)
    await vi.waitFor(() => expect(reads).toBe(2))
    await actions.selectRoom(2)
    await actions.selectRoom(1)
    oldRoom.resolve(json(200, { messages: [message(1, 'stale')] }))
    await oldVisit
    expect(source.getSnapshot().messages[0]?.text).toBe('latest')
    unsubscribe()
  })

  it('keeps live edits and deletions received while a room baseline is loading', async () => {
    const baseline = deferred<Response>()
    let loading = false
    const { transport, streams } = fakeTransport((url) => {
      if (url === '/collab/api/state') return json(200, state)
      return loading ? baseline.promise : json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    loading = true
    const visit = actions.selectRoom(1)
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'message', message: message(1, 'new') }) }))
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'deleted', id: 2, room_id: 1 }) }))
    baseline.resolve(json(200, { messages: [message(1, 'old'), message(2, 'deleted')] }))
    await visit
    expect(source.getSnapshot().messages.map(m => m.text)).toEqual(['new'])
    unsubscribe()
  })

  it('recovers from a failed reconnect query on the next stream open', async () => {
    let failing = false
    const { transport, streams } = fakeTransport((url) => {
      if (failing) return json(503, { error: 'temporarily unavailable' })
      if (url === '/collab/api/state') return json(200, state)
      return json(200, { messages: [message(1, 'ok')] })
    })
    const { source } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    failing = true
    streams[0]?.onopen?.(new Event('open'))
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('error'))
    failing = false
    streams[0]?.onopen?.(new Event('open'))
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    unsubscribe()
  })

  it('connects on first subscriber, loads the first room, applies live events, and closes with the last', async () => {
    const { transport, streams, closed, calls } = fakeTransport((url) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (url.startsWith('/collab/api/rooms/1/messages?limit')) return json(200, { messages: [message(1, 'a')] })
      // Reconnect reconciles the whole cached window from its oldest held id
      // (design §4.3), so edits and deletions inside the cache are reconciled.
      if (url.startsWith('/collab/api/rooms/1/messages?after=0')) return json(200, { messages: [message(1, 'a'), message(2, 'b')] })
      return json(404, { error: 'not found' })
    })
    const { source } = createChannelSource(transport)
    expect(source.getSnapshot().phase).toBe('idle')
    expect(calls).toEqual([])

    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    expect(source.getSnapshot()).toMatchObject({ phase: 'ready', roomId: 1 })
    expect(source.getSnapshot().messages.map(m => m.text)).toEqual(['a'])
    expect(streams).toHaveLength(1)

    streams[0]?.onopen?.(new Event('open'))
    await vi.waitFor(() => expect(source.getSnapshot().messages.map(m => m.text)).toEqual(['a', 'b']))

    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'message', message: message(3, 'c') }) }))
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'message', message: message(9, 'other room', 2) }) }))
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'thinking', room_id: 1, members: ['ju'] }) }))
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'deleted', id: 2, room_id: 1 }) }))
    expect(source.getSnapshot().messages.map(m => m.text)).toEqual(['a', 'c'])
    expect(source.getSnapshot().thinking['1']).toEqual(['ju'])

    unsubscribe()
    expect(closed).toEqual(streams)
  })

  it('reports a missing collab plugin as unavailable and does not open a stream', async () => {
    const { transport, streams } = fakeTransport(() => json(404, { error: 'not found' }))
    const { source } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('unavailable'))
    expect(streams).toHaveLength(0)
    unsubscribe()
  })

  it('posts with a client key and surfaces the service refusal', async () => {
    let posted: unknown
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (init?.method === 'POST') {
        posted = JSON.parse(String(init.body))
        return (posted as { text: string }).text === 'bad' ? json(400, { error: 'message text is empty' }) : json(200, { message: message(5, 'hi') })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    await actions.send('hi')
    expect(posted).toMatchObject({ text: 'hi', client_key: expect.any(String) })
    expect(source.getSnapshot().messages.map(m => m.text)).toEqual(['hi'])
    await expect(actions.send('bad')).rejects.toThrow('message text is empty')
    unsubscribe()
  })

  it('calls stop and continue APIs and surfaces their results', async () => {
    const { transport, calls } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (url === '/collab/api/rooms/1/stop' && init?.method === 'POST') {
        return json(200, {
          room_id: 1,
          stopped: true,
          cancelled_jobs: 1,
          unconfirmed: [],
          stopped_members: [{ member: 'ju', outcome: 'confirmed' }],
        })
      }
      if (url === '/collab/api/rooms/1/continue' && init?.method === 'POST') {
        return json(200, { room_id: 1, resumed: 1, stopped: false })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))

    const stopRes = await actions.stopRoom()
    expect(stopRes.stopped).toBe(true)
    expect(stopRes.stopped_members).toEqual([{ member: 'ju', outcome: 'confirmed' }])
    expect(calls).toContain('POST /collab/api/rooms/1/stop')

    const continueRes = await actions.continueRoom(1)
    expect(continueRes.resumed).toBe(1)
    expect(calls).toContain('POST /collab/api/rooms/1/continue')

    unsubscribe()
  })

  it('updates roomControls when receiving a room_control event', async () => {
    const { transport, streams } = fakeTransport((url) => {
      if (url === '/collab/api/state') {
        return json(200, {
          rooms: [{ id: 1, name: 'general' }],
          members: [],
          thinking: {},
          room_controls: [{ room_id: 1, stopped: 0, epoch: 1, cutoff: 10, relay_after: 0 }],
        })
      }
      return json(200, { messages: [] })
    })
    const { source } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    expect(source.getSnapshot().roomControls?.[1]?.stopped).toBe(false)

    streams[0]?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'room_control', room_id: 1, stopped: 1, epoch: 2, cutoff: 20, relay_after: 0 }),
    }))
    expect(source.getSnapshot().roomControls?.[1]?.stopped).toBe(true)
    expect(source.getSnapshot().roomControls?.[1]?.epoch).toBe(2)

    unsubscribe()
  })
})
