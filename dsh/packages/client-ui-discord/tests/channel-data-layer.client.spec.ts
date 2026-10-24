/**
 * Data-layer regressions for issue #7 (increment catch-up, backoff reconnect,
 * paging back), driven by the reusable fake EventSource in
 * ./helpers/fake-eventsource.ts.
 *
 * The rules these tests pin come from the design doc §4.3: a dropped socket
 * retries after 1/2/4/8… seconds (30 s cap, with jitter), and a reconnect
 * catches up with `after=newestId` instead of re-reading the whole room.
 */
import { setImmediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createChannelSource, type ChannelTransport } from '../src/client/channel-source.ts'
import { FakeEventSourceHub } from './helpers/fake-eventsource.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const message = (id: number, text: string, roomId = 1) => ({
  id, room_id: roomId, author_kind: 'user', author: 'owner', name: '我', text, created_at: id, card: null, from_turn: null,
})

/** A transport whose message routes honour `after`, `before` and `limit`. */
function harness(
  initial: ReturnType<typeof message>[] = [],
  options: { random?: () => number; rooms?: { id: number; name: string }[] } = {},
) {
  const rows = [...initial]
  const rooms = options.rooms ?? [{ id: 1, name: 'drame' }]
  const calls: string[] = []
  const waits: number[] = []
  const hub = new FakeEventSourceHub()
  const transport: ChannelTransport = {
    fetch: (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      if (input.endsWith('collab/api/state')) {
        return Promise.resolve(json(200, { rooms, members: [], thinking: {} }))
      }
      const room = /collab\/api\/rooms\/(\d+)\/messages/.exec(input)
      if (room !== null) {
        const roomId = Number(room[1])
        const query = new URL(input, 'http://host/').searchParams
        const limit = Number(query.get('limit') ?? 100)
        const after = query.get('after')
        const before = query.get('before')
        const inRoom = rows.filter(row => row.room_id === roomId)
        if (after !== null) {
          return Promise.resolve(json(200, { messages: inRoom.filter(row => row.id > Number(after)).slice(0, limit) }))
        }
        if (before !== null) {
          return Promise.resolve(json(200, { messages: inRoom.filter(row => row.id < Number(before)).slice(-limit) }))
        }
        return Promise.resolve(json(200, { messages: inRoom.slice(-limit) }))
      }
      return Promise.resolve(json(404, { error: 'unexpected' }))
    },
    openEvents: hub.openEvents,
    url: path => `/${path}`,
    delay: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    random: options.random ?? (() => 1),
  }
  return { rows, calls, waits, hub, transport }
}

/** Let queued microtasks (refresh, retry) run. */
async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await setImmediate()
}

/** Build a source and wait until its first read is ready and the stream is open. */
async function ready(transport: ChannelTransport, hub: FakeEventSourceHub) {
  const channel = createChannelSource(transport)
  const stop = channel.source.subscribe(() => undefined)
  for (let i = 0; i < 40; i += 1) {
    // `refresh()` sets phase=ready before the live stream opens, so wait for both.
    if (channel.source.getSnapshot().phase === 'ready' && hub.attempts > 0) break
    await setImmediate()
  }
  return { channel, stop }
}

describe('channel data layer: live stream', () => {
  it('applies frames that arrive on the live stream', async () => {
    const { rows, hub, transport } = harness([message(1, 'hi')])
    const { channel, stop } = await ready(transport, hub)

    rows.push(message(2, 'second'))
    expect(hub.emit({ type: 'message', message: message(2, 'second') })).toBe(true)

    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])
    stop()
  })
})

describe('channel data layer: reconnect', () => {
  it('backs off 1/2/4/8… seconds and never waits longer than 30 s', async () => {
    const { hub, waits, transport } = harness([message(1, 'hi')])
    const { channel, stop } = await ready(transport, hub)

    // Seven consecutive failures: the delay doubles until it hits the cap.
    for (let i = 0; i < 7; i += 1) {
      expect(hub.drop()).toBe(true)
      expect(channel.source.getSnapshot().phase).toBe('reconnecting')
      await settle()
    }

    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    expect(hub.attempts).toBe(8)
    stop()
  })

  it('jitters each wait inside the capped doubling window', async () => {
    const { hub, waits, transport } = harness([message(1, 'hi')], { random: () => 0 })
    const { channel, stop } = await ready(transport, hub)

    for (let i = 0; i < 6; i += 1) {
      hub.drop()
      await settle()
    }

    // Jitter at the bottom of the window: half the base, still never above the cap.
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 15000])
    stop()
  })

  it('reconciles the whole cached window on reconnect and neither loses nor duplicates', async () => {
    const { rows, calls, hub, transport } = harness([message(1, 'a'), message(2, 'b')])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])

    // While offline the room gains two rows; the client saw neither.
    rows.push(message(3, 'c'), message(4, 'd'))
    hub.drop()
    await settle()
    expect(hub.attempts).toBe(2)

    // Reconnect: `onopen` refetches state, then re-reads from the oldest held id,
    // so edits and deletions inside the cache are reconciled too (design §4.3).
    expect(hub.open()).toBe(true)
    await settle()

    expect(calls.some(call => call.includes('after=0'))).toBe(true)
    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2, 3, 4])
    stop()
  })

  it('folds a row that arrives both through catch-up and through SSE', async () => {
    const { rows, hub, transport } = harness([message(1, 'a')])
    const { channel, stop } = await ready(transport, hub)

    rows.push(message(2, 'b'))
    hub.drop()
    await settle()

    // The replacement stream replays row 2 before the catch-up read finishes.
    expect(hub.emit({ type: 'message', message: message(2, 'b') })).toBe(true)
    expect(hub.open()).toBe(true)
    await settle()

    const ids = channel.source.getSnapshot().messages.map(row => row.id)
    expect(ids).toEqual([1, 2])
    stop()
  })

  it('cancels a pending reconnect when the last subscriber leaves', async () => {
    const { hub, transport } = harness([message(1, 'a')])
    const { stop } = await ready(transport, hub)

    hub.drop()
    stop()
    await settle()

    expect(hub.attempts).toBe(1)
  })
})

describe('channel data layer: paging back', () => {
  it('pages older rows with before= and keeps them in ascending order', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => message(index + 51, `m${String(index + 51)}`))
    const older = Array.from({ length: 50 }, (_, index) => message(index + 1, `m${String(index + 1)}`))
    const { calls, hub, transport } = harness([...older, ...firstPage])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().messages).toHaveLength(100)
    expect(channel.source.getSnapshot().hasMoreOlder).toBe(true)

    const added = await channel.actions.loadOlder()

    expect(added).toBe(50)
    expect(calls.some(call => call.includes('before=51'))).toBe(true)
    const ids = channel.source.getSnapshot().messages.map(row => row.id)
    expect(ids[0]).toBe(1)
    expect(ids).toHaveLength(150)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
    expect(channel.source.getSnapshot().hasMoreOlder).toBe(false)
    stop()
  })

  it('does nothing when the newest page already holds every row', async () => {
    const { hub, transport } = harness([message(1, 'a'), message(2, 'b')])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().hasMoreOlder).toBe(false)

    expect(await channel.actions.loadOlder()).toBe(0)
    stop()
  })
})

describe('channel data layer: optimistic send', () => {
  /** A transport whose POST answers are released by the test. */
  function sendHarness(initial: ReturnType<typeof message>[] = []) {
    const bodies: { text?: string; client_key?: string }[] = []
    const pending: { release: (body: unknown, status?: number) => void }[] = []
    const base = harness(initial)
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)) as { text?: string; client_key?: string })
          return new Promise<Response>((resolve) => {
            pending.push({
              release: (body, status = 200) => resolve(json(status, body)),
            })
          })
        }
        return base.transport.fetch(input, init)
      },
    }
    return { ...base, transport, bodies, pending }
  }

  it('shows the message before the service answers, then replaces it with the real row', async () => {
    const { hub, transport, pending } = sendHarness()
    const { channel, stop } = await ready(transport, hub)

    const sending = channel.actions.send('hello')
    await settle(2)

    // Visible while the POST is still in flight.
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)
    expect(channel.source.getSnapshot().outbox[0]?.text).toBe('hello')
    expect(channel.source.getSnapshot().outbox[0]?.state).toBe('sending')

    pending[0]?.release({ message: message(1, 'hello') })
    await sending

    expect(channel.source.getSnapshot().outbox).toHaveLength(0)
    expect(channel.source.getSnapshot().messages.map(row => row.text)).toEqual(['hello'])
    stop()
  })

  it('keeps a failed message and retries it under the same client_key', async () => {
    const { hub, transport, bodies, pending } = sendHarness()
    const { channel, stop } = await ready(transport, hub)

    const first = channel.actions.send('retry me')
    await settle(2)
    pending[0]?.release({ error: 'boom' }, 500)
    await expect(first).rejects.toThrow('boom')

    const failed = channel.source.getSnapshot().outbox
    expect(failed).toHaveLength(1)
    expect(failed[0]?.state).toBe('failed')
    expect(failed[0]?.error).toBe('boom')

    // The retry carries the same key, so a resend that did land is deduped.
    const retry = channel.actions.retrySend(failed[0]!.clientKey)
    await settle(2)
    pending[1]?.release({ message: message(1, 'retry me') })
    await retry

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.client_key).toBe(bodies[1]?.client_key)
    expect(bodies[0]?.client_key).toBe(failed[0]?.clientKey)
    expect(channel.source.getSnapshot().outbox).toHaveLength(0)
    stop()
  })

  it('drops a failed message on request', async () => {
    const { hub, transport, pending } = sendHarness()
    const { channel, stop } = await ready(transport, hub)

    const first = channel.actions.send('give up')
    await settle(2)
    pending[0]?.release({ error: 'nope' }, 500)
    await expect(first).rejects.toThrow('nope')

    const key = channel.source.getSnapshot().outbox[0]!.clientKey
    channel.actions.dismissSend(key)

    expect(channel.source.getSnapshot().outbox).toHaveLength(0)
    stop()
  })
})

describe('channel data layer: reconciliation safety', () => {
  it('keeps an unconfirmed optimistic message when a reconnect reconciles the tail', async () => {
    const bodies: { client_key?: string }[] = []
    const releases: ((body: unknown) => void)[] = []
    const base = harness([message(1, 'a')])
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)) as { client_key?: string })
          return new Promise<Response>(resolve => {
            releases.push(body => resolve(json(200, body)))
          })
        }
        return base.transport.fetch(input, init)
      },
    }
    const { hub } = base
    const { channel, stop } = await ready(transport, hub)

    // In flight: shown in the outbox, the service has not written it yet, so the
    // tail page a reconnect re-reads cannot contain it.
    const sending = channel.actions.send('not confirmed yet')
    await settle(2)
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)

    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    // Reconciliation must not treat it as deleted just because the service's page
    // does not list it: it lives in the outbox, not in the confirmed rows.
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)
    expect(channel.source.getSnapshot().outbox[0]?.text).toBe('not confirmed yet')
    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1])

    releases[0]?.({ message: message(2, 'not confirmed yet') })
    await sending
    expect(channel.source.getSnapshot().outbox).toHaveLength(0)
    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])
    stop()
  })

  it('keeps a failed outbox message across a reconnect reconcile', async () => {
    const releases: ((body: unknown, status: number) => void)[] = []
    const base = harness([message(1, 'a')])
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (init?.method === 'POST') {
          return new Promise<Response>(resolve => {
            releases.push((body, status) => resolve(json(status, body)))
          })
        }
        return base.transport.fetch(input, init)
      },
    }
    const { hub } = base
    const { channel, stop } = await ready(transport, hub)

    const first = channel.actions.send('will fail')
    await settle(2)
    releases[0]?.({ error: 'boom' }, 500)
    await expect(first).rejects.toThrow('boom')
    expect(channel.source.getSnapshot().outbox[0]?.state).toBe('failed')

    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    // A failed send is still the human's message: reconciliation must not drop it.
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)
    expect(channel.source.getSnapshot().outbox[0]?.state).toBe('failed')
    expect(channel.source.getSnapshot().outbox[0]?.text).toBe('will fail')
    stop()
  })

  it('does not delete a row that only arrived through SSE during the catch-up', async () => {
    const { rows, hub, transport } = harness([message(1, 'a')])
    const { channel, stop } = await ready(transport, hub)

    // Row 2 exists on the server and reaches us through the new stream, but the
    // tail page read by reconciliation may already be in flight without it.
    rows.push(message(2, 'b'))
    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    expect(hub.emit({ type: 'message', message: message(2, 'b') })).toBe(true)
    await settle()

    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])
    stop()
  })

  it('keeps every jittered wait at or below the 30 s cap', async () => {
    const base = harness([message(1, 'a')], { random: () => 0.999 })
    const { hub, waits, transport } = base
    const { stop } = await ready(transport, hub)

    for (let i = 0; i < 8; i += 1) {
      hub.drop()
      await settle()
    }

    expect(waits.length).toBe(8)
    // With random() near 1 the wait sits at the top of each window, never above it.
    expect(Math.max(...waits)).toBeLessThanOrEqual(30_000)
    const bases = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]
    waits.forEach((wait, index) => {
      expect(wait).toBeLessThanOrEqual(bases[index]!)
      expect(wait).toBeGreaterThan(bases[index]! / 2)
    })
    // Still doubling before the cap is reached.
    expect(waits[1]! / waits[0]!).toBeGreaterThan(1.9)
    expect(waits[2]! / waits[1]!).toBeGreaterThan(1.9)
    stop()
  })
})

describe('channel data layer: review fixes', () => {
  /** Two rooms, and POST answers the test releases itself. */
  function twoRoomHarness() {
    const rooms = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
    const posts: { room: number; client_key?: string; text?: string }[] = []
    const releases: ((body: unknown, status: number) => void)[] = []
    const hub = new FakeEventSourceHub()
    const transport: ChannelTransport = {
      fetch: (input, init) => {
        if (input.endsWith('collab/api/state')) return Promise.resolve(json(200, { rooms, members: [], thinking: {} }))
        if (init?.method === 'POST') {
          const room = Number(/rooms\/(\d+)\/messages/.exec(input)?.[1])
          posts.push({ room, ...(JSON.parse(String(init.body)) as { client_key?: string; text?: string }) })
          return new Promise<Response>(resolve => {
            releases.push((body, status) => resolve(json(status, body)))
          })
        }
        if (input.includes('/messages')) {
          const query = new URL(input, 'http://host/').searchParams
          const limit = Number(query.get('limit') ?? 100)
          return Promise.resolve(json(200, { messages: Array.from({ length: 1 }, (_, i) => message(i + 1, 'm', 1)).slice(-limit) }))
        }
        return Promise.resolve(json(404, { error: 'unexpected' }))
      },
      openEvents: hub.openEvents,
      url: path => `/${path}`,
      delay: () => Promise.resolve(),
      random: () => 1,
    }
    return { hub, transport, posts, releases }
  }

  it('tags each outbox message with its room and only shows it there', async () => {
    const { hub, transport } = twoRoomHarness()
    const { channel, stop } = await ready(transport, hub)

    const sending = channel.actions.send('for room one')
    await settle(2)
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)
    expect(channel.source.getSnapshot().outbox[0]?.roomId).toBe(1)
    const key = channel.source.getSnapshot().outbox[0]!.clientKey

    // Room two must not show room one's pending message.
    await channel.actions.selectRoom(2)
    expect(channel.source.getSnapshot().outbox).toHaveLength(0)
    // And a retry from the wrong room must not post to the wrong room.
    await expect(channel.actions.retrySend(key)).rejects.toThrow()

    await channel.actions.selectRoom(1)
    expect(channel.source.getSnapshot().outbox).toHaveLength(1)
    stop()
    void sending.catch(() => undefined)
  })

  it('clears rows deleted while offline when the re-read page comes back empty', async () => {
    const { rows, hub, transport } = harness([message(1, 'a'), message(2, 'b')])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().messages).toHaveLength(2)

    // Everything the client held was deleted while it was offline.
    rows.length = 0
    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    expect(channel.source.getSnapshot().messages).toHaveLength(0)
    stop()
  })

  it('shows the edited card content after a reconnect', async () => {
    const card = (state: string) => JSON.stringify({ title: '构建发布包', state })
    const { rows, hub, transport } = harness([
      message(1, 'a'),
      { ...message(2, '构建发布包'), card: card('running') },
    ])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().messages.at(-1)?.card).toBe(card('running'))

    // The card is rewritten while this client is offline; `after=` cannot see it.
    rows[1] = { ...rows[1]!, card: card('done') }
    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    expect(channel.source.getSnapshot().messages.at(-1)?.card).toBe(card('done'))
    stop()
  })

  it('reconciles an older card that was paged into the window and edited offline', async () => {
    const card = (state: string) => JSON.stringify({ title: '构建发布包', state })
    // 150 rows so the first read holds only the newest page; loadOlder brings older ones in.
    const seeded = Array.from({ length: 150 }, (_, index) => message(index + 1, `m${String(index + 1)}`))
    seeded[20] = { ...seeded[20]!, card: card('running') }
    const { rows, hub, transport } = harness(seeded)
    const { channel, stop } = await ready(transport, hub)
    const paged = await channel.actions.loadOlder()
    expect(paged).toBeGreaterThan(0)
    // The edited row is now inside the cached window, well below the newest page.
    expect(channel.source.getSnapshot().messages.find(m => m.id === 21)?.card).toBe(card('running'))

    // It is rewritten while the client is offline; the window must be reconciled.
    rows[20] = { ...rows[20]!, card: card('done') }
    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    expect(channel.source.getSnapshot().messages.find(m => m.id === 21)?.card).toBe(card('done'))
    stop()
  })

  it('drops an older row that was deleted offline after paging up', async () => {
    const seeded = Array.from({ length: 150 }, (_, index) => message(index + 1, `m${String(index + 1)}`))
    const { rows, hub, transport } = harness(seeded)
    const { channel, stop } = await ready(transport, hub)
    await channel.actions.loadOlder()
    expect(channel.source.getSnapshot().messages.some(m => m.id === 21)).toBe(true)

    rows.splice(rows.findIndex(row => row.id === 21), 1)
    hub.drop()
    await settle()
    expect(hub.open()).toBe(true)
    await settle()

    expect(channel.source.getSnapshot().messages.some(m => m.id === 21)).toBe(false)
    stop()
  })

  it('drops a page that was in flight when the user switched away and came back', async () => {
    const rooms = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
    const one = Array.from({ length: 150 }, (_, index) => message(index + 1, `one${String(index + 1)}`, 1))
    const two = Array.from({ length: 20 }, (_, index) => message(index + 200, `two${String(index + 200)}`, 2))
    const base = harness([...one, ...two], { rooms })
    let release: (() => void) | undefined
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (input.includes('/rooms/1/messages') && input.includes('before=')) {
          return new Promise<Response>(resolve => {
            // The page was asked against the old window and carries rows marked stale.
            release = () => resolve(json(200, { messages: one.slice(0, 50).map(row => ({ ...row, text: `${row.text}-stale` })) }))
          })
        }
        return base.transport.fetch(input, init)
      },
    }
    const { channel, stop } = await ready(transport, base.hub)

    const stale = channel.actions.loadOlder()
    await settle(2)
    // Away and back: the room matches again, so only the epoch can catch this page.
    await channel.actions.selectRoom(2)
    await channel.actions.selectRoom(1)

    release?.()
    expect(await stale).toBe(0)
    // The stale page must not resurrect rows the rebuilt window does not hold.
    expect(channel.source.getSnapshot().messages.some(row => row.text.endsWith('-stale'))).toBe(false)
    stop()
  })

  it('discards a page that arrives after the room changed and still pages the new room', async () => {
    const rooms = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
    const one = Array.from({ length: 150 }, (_, index) => message(index + 1, `one${String(index + 1)}`, 1))
    const two = Array.from({ length: 150 }, (_, index) => message(index + 1, `two${String(index + 1)}`, 2))
    const base = harness([...one, ...two], { rooms })
    let release: (() => void) | undefined
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (input.includes('/rooms/1/messages') && input.includes('before=')) {
          return new Promise<Response>(resolve => {
            release = () => resolve(json(200, { messages: one.slice(0, 50) }))
          })
        }
        return base.transport.fetch(input, init)
      },
    }
    const { channel, stop } = await ready(transport, base.hub)

    const stale = channel.actions.loadOlder()
    await settle(2)
    // Switch rooms while room 1's page is still in flight.
    await channel.actions.selectRoom(2)
    expect(channel.source.getSnapshot().roomId).toBe(2)
    // The new room can page even though room 1 still has a request out.
    const fresh = await channel.actions.loadOlder()
    expect(fresh).toBeGreaterThan(0)

    release?.()
    expect(await stale).toBe(0)
    // Room 1's stale page must not leak into room 2.
    expect(channel.source.getSnapshot().messages.every(m => m.room_id === 2)).toBe(true)
    stop()
  })

  it('A → B → A while A\'s old page is in flight: a new page goes out and merges, the late stale page changes nothing', async () => {
    const rooms = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
    const one = Array.from({ length: 250 }, (_, index) => message(index + 1, `one${String(index + 1)}`, 1))
    const two = Array.from({ length: 150 }, (_, index) => message(index + 1, `two${String(index + 1)}`, 2))
    const base = harness([...one, ...two], { rooms })
    const held: (() => void)[] = []
    let pageCalls = 0
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (input.includes('/rooms/1/messages') && input.includes('before=')) {
          pageCalls += 1
          // Calls 1 (stale) and 3 (latch probe) hang; call 2 is the fresh page.
          if (pageCalls !== 2) {
            return new Promise<Response>(resolve => {
              held.push(() => resolve(json(200, { messages: one.slice(0, 50).map(row => ({ ...row, text: `${row.text}-stale` })) })))
            })
          }
        }
        return base.transport.fetch(input, init)
      },
    }
    const { channel, stop } = await ready(transport, base.hub)

    const stale = channel.actions.loadOlder()
    await settle(2)
    await channel.actions.selectRoom(2)
    await channel.actions.selectRoom(1)

    // The old request has not returned, yet the rebuilt window can page at once.
    const fresh = await channel.actions.loadOlder()
    expect(fresh).toBe(100)
    expect(pageCalls).toBe(2)
    const ids = channel.source.getSnapshot().messages.map(m => m.id)
    expect(ids[0]).toBe(51)
    expect(ids).toHaveLength(200)

    // A third page is now in flight and must hold the latch for the current epoch.
    const probe = channel.actions.loadOlder()
    await settle(2)
    expect(pageCalls).toBe(3)

    // The stale page lands late: dropped, and it must not release the live latch.
    held[0]?.()
    expect(await stale).toBe(0)
    expect(channel.source.getSnapshot().messages.some(row => row.text.endsWith('-stale'))).toBe(false)
    expect(channel.source.getSnapshot().messages).toHaveLength(200)
    expect(await channel.actions.loadOlder()).toBe(0)
    expect(pageCalls).toBe(3)

    held[1]?.()
    await probe
    stop()
  })

  it('does not start a second page request while one is in flight', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => message(index + 51, `m${String(index + 51)}`))
    const older = Array.from({ length: 50 }, (_, index) => message(index + 1, `m${String(index + 1)}`))
    const base = harness([...older, ...firstPage])
    let paged = 0
    let release: (() => void) | undefined
    const transport: ChannelTransport = {
      ...base.transport,
      fetch: (input, init) => {
        if (input.includes('before=') ) {
          paged += 1
          if (paged === 1) {
            return new Promise<Response>(resolve => {
              release = () => resolve(json(200, { messages: older }))
            })
          }
        }
        return base.transport.fetch(input, init)
      },
    }
    const { channel, stop } = await ready(transport, base.hub)

    const first = channel.actions.loadOlder()
    await settle(2)
    const second = await channel.actions.loadOlder()

    expect(second).toBe(0)
    expect(paged).toBe(1)
    release?.()
    await first
    stop()
  })
})
