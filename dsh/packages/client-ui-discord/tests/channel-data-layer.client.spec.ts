/**
 * Regression coverage for the channel data layer (issue #7), driven by the
 * reusable fake EventSource in ./helpers/fake-eventsource.ts.
 *
 * These tests pin the behaviour the data layer must have around a dropped
 * connection. The second test describes the gap rather than the goal: today the
 * client sets `phase: 'loading'` on `onerror` and never opens a new stream, so
 * nothing catches up with the messages missed while offline.
 */
import { setImmediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createChannelSource, type ChannelTransport } from '../src/client/channel-source.ts'
import { FakeEventSourceHub } from './helpers/fake-eventsource.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const message = (id: number, text: string, roomId = 1) => ({
  id, room_id: roomId, author_kind: 'user', author: 'owner', name: '我', text, created_at: 1, card: null, from_turn: null,
})

/** A transport whose HTTP routes are answered from a mutable message list. */
function harness(initial: ReturnType<typeof message>[] = []) {
  const rows = [...initial]
  const calls: string[] = []
  const hub = new FakeEventSourceHub()
  const transport: ChannelTransport = {
    fetch: (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      if (input.endsWith('collab/api/state')) {
        return Promise.resolve(json(200, { rooms: [{ id: 1, name: 'drame' }], members: [], thinking: {} }))
      }
      if (input.includes('collab/api/rooms/1/messages')) {
        return Promise.resolve(json(200, { messages: rows }))
      }
      return Promise.resolve(json(404, { error: 'unexpected' }))
    },
    openEvents: hub.openEvents,
    url: path => `/${path}`,
  }
  return { rows, calls, hub, transport }
}

/** Build a source and wait until its first read reaches `ready` and its stream is open. */
async function ready(transport: ChannelTransport, hub: FakeEventSourceHub) {
  const channel = createChannelSource(transport)
  const stop = channel.source.subscribe(() => undefined)
  for (let i = 0; i < 40; i += 1) {
    // `refresh()` sets phase=ready before the live stream is opened, so wait for
    // both conditions; otherwise the first frame would be emitted too early.
    if (channel.source.getSnapshot().phase === 'ready' && hub.attempts > 0) break
    await setImmediate()
  }
  return { channel, stop }
}

describe('channel data layer: reconnect', () => {
  it('applies frames that arrive on the live stream', async () => {
    const { rows, hub, transport } = harness([message(1, 'hi')])
    const { channel, stop } = await ready(transport, hub)

    rows.push(message(2, 'second'))
    expect(hub.emit({ type: 'message', message: message(2, 'second') })).toBe(true)

    expect(channel.source.getSnapshot().messages.map(row => row.id)).toEqual([1, 2])
    stop()
  })

  it('has no reconnect after the socket drops (known gap for #7)', async () => {
    const { hub, transport } = harness([message(1, 'hi')])
    const { channel, stop } = await ready(transport, hub)
    expect(hub.attempts).toBe(1)

    expect(hub.drop()).toBe(true)
    for (let i = 0; i < 20; i += 1) await setImmediate()

    // Current behaviour: the client drops to `loading` and opens nothing new.
    expect(channel.source.getSnapshot().phase).toBe('loading')
    expect(hub.attempts).toBe(1)
    stop()
  })
})
