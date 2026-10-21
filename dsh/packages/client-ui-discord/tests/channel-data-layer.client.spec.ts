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
function harness(initial: ReturnType<typeof message>[] = [], options: { random?: () => number } = {}) {
  const rows = [...initial]
  const calls: string[] = []
  const waits: number[] = []
  const hub = new FakeEventSourceHub()
  const transport: ChannelTransport = {
    fetch: (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      if (input.endsWith('collab/api/state')) {
        return Promise.resolve(json(200, { rooms: [{ id: 1, name: 'drame' }], members: [], thinking: {} }))
      }
      if (input.includes('collab/api/rooms/1/messages')) {
        const query = new URL(input, 'http://host/').searchParams
        const limit = Number(query.get('limit') ?? 100)
        const after = query.get('after')
        const before = query.get('before')
        if (after !== null) {
          return Promise.resolve(json(200, { messages: rows.filter(row => row.id > Number(after)).slice(0, limit) }))
        }
        if (before !== null) {
          return Promise.resolve(json(200, { messages: rows.filter(row => row.id < Number(before)).slice(-limit) }))
        }
        return Promise.resolve(json(200, { messages: rows.slice(-limit) }))
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

  it('catches up with after=newestId and neither loses nor duplicates', async () => {
    const { rows, calls, hub, transport } = harness([message(1, 'a'), message(2, 'b')])
    const { channel, stop } = await ready(transport, hub)
    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])

    // While offline the room gains two rows; the client saw neither.
    rows.push(message(3, 'c'), message(4, 'd'))
    hub.drop()
    await settle()
    expect(hub.attempts).toBe(2)

    // Reconnect: `onopen` refetches state, then catches up from the newest known id.
    expect(hub.open()).toBe(true)
    await settle()

    expect(calls.some(call => call.includes('after=2'))).toBe(true)
    expect(calls.some(call => call.includes('after=1'))).toBe(false) // not a full re-read
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
