import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { createChannelSource, groupRooms, type ChannelRoom, type ChannelTransport, type EventStreamLike } from '../src/client/channel-source.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeTransport(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const streams: EventStreamLike[] = []
  const calls: string[] = []
  const transport: ChannelTransport = {
    // The state read carries this client's read cursors (#145); routes and calls see the plain path.
    fetch: (raw, init) => { const input = raw.replace(/^(\/collab\/api\/state)\?read=[^&]*$/, '$1'); calls.push(`${init?.method ?? 'GET'} ${input}`); return Promise.resolve(routes(input, init)) },
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
  it('updates settings only in the addressed channel and its workspaces, then explicitly renews', async () => {
    const { transport, streams, calls } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { ...state, rooms: [
        { id: 1, name: 'one', effective_lead_id: 'a', workspace_path: '/old' },
        { id: 2, name: 'two', effective_lead_id: 'b', workspace_path: '/two' },
        { id: 1000000, name: '工作区1', parent_id: 1, kind: 'workspace', effective_lead_id: 'a' },
      ] })
      if (url === '/collab/api/rooms/1/settings') {
        expect(init?.method).toBe('PATCH')
        return json(200, { lead_id: 'new', effective_lead_id: 'new', workspace_path: '/new' })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().roomId).toBe(1))
    await actions.setLead('new', 1)
    expect(source.getSnapshot().rooms[0].effective_lead_id).toBe('new')
    expect(source.getSnapshot().rooms[1].effective_lead_id).toBe('b')
    expect(source.getSnapshot().rooms[2].effective_lead_id).toBe('new')
    await actions.setWorkspacePath(1, '/new')
    expect(calls).not.toContain('POST /collab/api/rooms/1/renew')
    streams[0].onmessage?.({ data: JSON.stringify({ type: 'rooms', rooms: state.rooms }) } as MessageEvent)
    expect(source.getSnapshot().rooms[0].workspace_path).toBe('/new')
    await actions.renewRoom(1)
    expect(calls).toContain('POST /collab/api/rooms/1/renew')
    unsubscribe()
  })

  it('uploads a new member portrait and removes the new member when upload fails so retry stays possible', async () => {
    let fail = false
    const { transport, calls } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, state)
      if (url === '/collab/api/members') {
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('avatarPng')
        return json(200, { member: { id: 'new' } })
      }
      if (url.endsWith('/avatar')) {
        expect(JSON.parse(String(init?.body))).toEqual({ png: 'AQID' })
        return json(fail ? 400 : 200, fail ? { error: '头像错误' } : { member: { id: 'new' } })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().roomId).toBe(1))
    await actions.addMember({ name: 'New', persona: '', model: null, avatarPng: 'AQID' })
    expect(calls).toContain('POST /collab/api/members/new/avatar')
    fail = true
    await expect(actions.addMember({ name: 'New', persona: '', model: null, avatarPng: 'AQID' })).rejects.toThrow('头像错误')
    expect(calls).toContain('DELETE /collab/api/members/new')
    unsubscribe()
  })

  it('renames a room without replacing selection, history or dispatch settings', async () => {
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { ...state, rooms: [{ id: 1, name: 'general', dispatch_mode: 'team' }] })
      if (url === '/collab/api/rooms/1') {
        expect(init?.method).toBe('PATCH')
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'renamed' })
        return json(200, { room: { id: 1, name: 'renamed', kind: 'chat', parent_id: null } })
      }
      return json(200, { messages: [message(1, 'history')] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().messages).toHaveLength(1))
    await actions.renameRoom(1, 'renamed')
    expect(source.getSnapshot().roomId).toBe(1)
    expect(source.getSnapshot().rooms[0]).toMatchObject({ id: 1, name: 'renamed', dispatch_mode: 'team' })
    expect(source.getSnapshot().messages[0].text).toBe('history')
    unsubscribe()
  })

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

  it('keeps task events that arrive after a room switch but before its board read returns (PR #136 review 3)', async () => {
    const board = deferred<Response>()
    const task = (id: number, status: string, updated_at: number) => ({
      id, room_id: 2, parent_task: null, title: `t${id}`, owner: 'ds', owner_name: 'DS', created_by: 'ju', created_by_name: '橘',
      status, next_check_at: null, assign_msg_id: null, result_msg_id: null, note: null, created_at: 1, updated_at, returned_at: null,
    })
    const { transport, streams, calls } = fakeTransport((url) => {
      if (url === '/collab/api/state') return json(200, state)
      if (url === '/collab/api/rooms/2/tasks') return board.promise
      if (url.endsWith('/tasks')) return json(200, { chat_id: 1, tasks: [] })
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    await actions.selectRoom(2)
    await vi.waitFor(() => expect(calls).toContain('GET /collab/api/rooms/2/tasks'))
    expect(source.getSnapshot().taskChat).toBeUndefined()
    const send = (event: unknown) => streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }))
    // The server read the board before these were written: the board alone would be stale.
    send({ type: 'task', task: task(5, 'accepted', 20), chat_id: 2, active: 1 })
    send({ type: 'task', task: task(6, 'assigned', 30), chat_id: 2, active: 2 })
    send({ type: 'task', task: task(9, 'assigned', 30), chat_id: 7, active: 1 })
    board.resolve(json(200, { chat_id: 2, tasks: [task(5, 'assigned', 10), task(4, 'done', 40)] }))
    await vi.waitFor(() => expect(source.getSnapshot().taskChat).toBe(2))
    const rows = source.getSnapshot().tasks ?? []
    expect(rows.map(t => [t.id, t.status])).toEqual([[6, 'assigned'], [5, 'accepted'], [4, 'done']])
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

  it('posts a permission decision and replaces the card with the decided one', async () => {
    const pending = { ...message(7, '需要权限', 1), author_kind: 'bot', card: { kind: 'permission', status: 'pending' } }
    const decided = { ...pending, card: { kind: 'permission', status: 'allow' } }
    let posted: { url: string, body: unknown } | undefined
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (init?.method === 'POST') {
        posted = { url, body: JSON.parse(String(init.body)) }
        return (posted.body as { decision: string }).decision === 'deny' ? json(409, { error: 'permission already decided' }) : json(200, { message: decided })
      }
      return json(200, { messages: [pending] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().messages).toHaveLength(1))
    await actions.decidePermission(7, 'allow')
    expect(posted).toEqual({ url: '/collab/api/messages/7/permission', body: { decision: 'allow' } })
    expect(source.getSnapshot().messages).toEqual([decided])
    await expect(actions.decidePermission(7, 'deny')).rejects.toThrow('permission already decided')
    expect(source.getSnapshot().messages).toEqual([decided])
    unsubscribe()
  })

  it('edits and withdraws your own message, reporting members that already started (#148)', async () => {
    const mine = message(3, '打错字')
    const edited = { ...mine, text: '改好了', edited_at: 2 }
    const sent: string[] = []
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (init?.method === 'PATCH') {
        sent.push(`PATCH ${url} ${String(init.body)}`)
        return JSON.parse(String(init.body)).text === 'x' ? json(403, { error: 'only your own plain messages can be edited' }) : json(200, { message: edited })
      }
      if (init?.method === 'DELETE') { sent.push(`DELETE ${url}`); return json(200, { ok: true, recalled: ['ju'], stopped: ['Qwen'], still_running: ['DeepSeek'] }) }
      return json(200, { messages: [mine, message(4, '别的')] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().messages).toHaveLength(2))
    await actions.editMessage(3, '改好了')
    expect(source.getSnapshot().messages[0]).toEqual(edited)
    await expect(actions.editMessage(3, 'x')).rejects.toThrow('only your own plain messages can be edited')
    expect(await actions.withdrawMessage(3)).toEqual({ stopped: ['Qwen'], stillRunning: ['DeepSeek'] })
    expect(source.getSnapshot().messages.map(m => m.id)).toEqual([4])
    expect(sent).toEqual(['PATCH /collab/api/messages/3 {"text":"改好了"}', 'PATCH /collab/api/messages/3 {"text":"x"}', 'DELETE /collab/api/messages/3'])
    unsubscribe()
  })

  it('groups each chat channel with its workspaces; orphans and old services stay top level (#139)', () => {
    const rooms: ChannelRoom[] = [
      { id: 1, name: 'general', kind: 'chat', parent_id: null },
      { id: 2, name: 'dev', kind: 'chat', parent_id: null },
      { id: 3, name: '工作区1', kind: 'workspace', parent_id: 1 },
      { id: 4, name: '工作区1', kind: 'workspace', parent_id: 2 },
      { id: 5, name: '工作区2', kind: 'workspace', parent_id: 1 },
      { id: 6, name: '工作区1', kind: 'workspace', parent_id: 99 },
      { id: 7, name: 'legacy' },
    ]
    expect(groupRooms(rooms).map(r => [r.room.id, r.depth])).toEqual([[1, 0], [3, 1], [5, 1], [2, 0], [4, 1], [6, 0], [7, 0]])
  })

  it('adds a new chat channel and its 工作区1 to the list, then selects the channel (#139)', async () => {
    let posted = false
    const created = { room: { id: 2, name: 'ops', kind: 'chat', parent_id: null }, workspace: { id: 3, name: '工作区1', kind: 'workspace', parent_id: 2 } }
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') {
        const rooms = [{ id: 1, name: 'general', kind: 'chat', parent_id: null }, ...(posted ? [created.room, created.workspace] : [])]
        return json(200, { me: 'owner', rooms, members: [], thinking: {} })
      }
      if (url === '/collab/api/rooms' && init?.method === 'POST') { posted = true; return json(200, created) }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    await actions.createRoom('ops')
    expect(source.getSnapshot().rooms.map(r => r.name)).toEqual(['general', 'ops', '工作区1'])
    expect(source.getSnapshot().roomId).toBe(2)
    unsubscribe()
  })

  it('sends reply_to only for a reply and degrades a quote whose original is deleted', async () => {
    const posted: unknown[] = []
    const { transport, streams } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (init?.method === 'POST') { posted.push(JSON.parse(String(init.body))); return json(200, { message: message(7, 'r') }) }
      return json(200, { messages: [message(1, 'orig'), { ...message(2, 'reply'), reply_to: { id: 1, author_kind: 'user', author: 'owner', name: '我', text: 'orig' } }] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().messages).toHaveLength(2))
    await actions.send('plain')
    await actions.send('re', 1)
    expect(posted[0]).not.toHaveProperty('reply_to')
    expect(posted[1]).toMatchObject({ text: 're', reply_to: 1 })
    streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'deleted', id: 1, room_id: 1 }) }))
    expect(source.getSnapshot().messages.find(m => m.id === 2)?.reply_to).toEqual({ id: 1, deleted: true })
    unsubscribe()
  })
  it('#144 posts attachments with the message and keeps them for a retry', async () => {
    const posted: unknown[] = []
    let fail = true
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        if (fail) { fail = false; return json(500, { error: 'boom' }) }
        return json(200, { message: message(7, '') })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().roomId).toBe(1))
    const file = { name: 'a.png', mime: 'image/png', data: 'iVBORw==' }
    await expect(actions.send('', undefined, [file])).rejects.toThrow()
    const key = source.getSnapshot().outbox?.[0]?.clientKey ?? (posted[0] as { client_key: string }).client_key
    await actions.retrySend(key)
    expect(posted[0]).toMatchObject({ text: '', attachments: [file] })
    expect(posted[1]).toMatchObject({ client_key: key, attachments: [file] })
    expect(posted[0]).not.toHaveProperty('reply_to')
    unsubscribe()
  })

  it('posts a retry request to /collab/api/messages/:id/retry (#146)', async () => {
    let retriedUrl: string | undefined
    const { transport } = fakeTransport((url, init) => {
      if (url === '/collab/api/state') return json(200, { rooms: [{ id: 1, name: 'general' }], members: [], thinking: {} })
      if (url === '/collab/api/messages/99/retry' && init?.method === 'POST') {
        retriedUrl = url
        return json(200, { ok: true, member_id: 'ds', trigger_id: 1 })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    await actions.retryMessage(99)
    expect(retriedUrl).toBe('/collab/api/messages/99/retry')
    unsubscribe()
  })

  it('tracks unread counts and mentions across channels (#145)', async () => {
    const { transport, streams } = fakeTransport((url) => {
      if (url === '/collab/api/state') {
        return json(200, {
          me: 'owner',
          rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'dev' }],
          members: [{ id: 'owner', name: '我', kind: 'human' }, { id: 'bot', name: '豆包', kind: 'bot' }],
          thinking: {},
        })
      }
      return json(200, { messages: [] })
    })
    const { source, actions } = createChannelSource(transport)
    const unsubscribe = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
    expect(source.getSnapshot().roomId).toBe(1)

    // Message arrives for room 2 (another room)
    streams[0]?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'message',
        message: {
          id: 50,
          room_id: 2,
          author_kind: 'role',
          author: 'bot',
          name: '豆包',
          text: '@我 任务完成了！',
          created_at: 10,
          card: null,
          from_turn: null,
        },
      }),
    }))

    const unread = source.getSnapshot().unread[2]
    expect(unread?.count).toBe(1)
    expect(unread?.mention).toBe(true)
    expect(unread?.firstUnreadId).toBe(50)

    // Select room 2: unread count clears
    await actions.selectRoom(2)
    expect(source.getSnapshot().roomId).toBe(2)
    expect(source.getSnapshot().unread[2]?.count).toBe(0)
    unsubscribe()
  })

  it('starts a room it has never seen at zero unread and uses the server count afterwards (#145)', async () => {
    // Read cursors persist for the whole file; these room ids are not used by other tests.
    const reads: string[] = []
    const state = (unread?: number) => json(200, {
      me: 'owner',
      rooms: [{ id: 31, name: 'general', last_message_id: 3 }, { id: 32, name: 'dev', last_message_id: unread === undefined ? 9000 : 9005, ...(unread === undefined ? {} : { unread_count: unread }) }],
      members: [], thinking: {},
    })
    const first = fakeTransport((url) => url === '/collab/api/state' ? state() : json(200, { messages: [] }))
    first.transport.fetch = ((fetch) => (input: string, init?: RequestInit) => { reads.push(input); return fetch(input, init) })(first.transport.fetch)
    const one = createChannelSource(first.transport)
    const stop = one.source.subscribe(() => {})
    await vi.waitFor(() => expect(one.source.getSnapshot().phase).toBe('ready'))
    // Message ids are global, so 9000 is not "9000 unread": a first visit has none.
    expect(one.source.getSnapshot().unread[32]?.count ?? 0).toBe(0)
    stop()
    // Next open sends the saved cursors and shows the server's per-room count.
    const second = fakeTransport((url) => url === '/collab/api/state' ? state(2) : json(200, { messages: [] }))
    second.transport.fetch = ((fetch) => (input: string, init?: RequestInit) => { reads.push(input); return fetch(input, init) })(second.transport.fetch)
    const two = createChannelSource(second.transport)
    const stop2 = two.source.subscribe(() => {})
    await vi.waitFor(() => expect(two.source.getSnapshot().phase).toBe('ready'))
    expect(decodeURIComponent(reads.filter(r => r.startsWith('/collab/api/state')).at(-1)!)).toContain('32:9000')
    expect(two.source.getSnapshot().unread[32]?.count).toBe(2)
    stop2()
  })

  it('counts and notifies a streamed reply once, when it is committed (#145)', async () => {
    const shown: string[] = []
    vi.stubGlobal('Notification', class { static permission = 'granted'; onclick = null; constructor(title: string) { shown.push(title) } close() {} })
    try {
      const { transport, streams } = fakeTransport((url) => url === '/collab/api/state'
        ? json(200, { me: 'owner', rooms: [{ id: 41, name: 'general' }, { id: 42, name: 'dev' }], members: [], thinking: {} })
        : json(200, { messages: [] }))
      const { source } = createChannelSource(transport)
      const unsubscribe = source.subscribe(() => {})
      await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
      const push = (text: string, draft: boolean) => streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        type: 'message',
        message: { id: 70, room_id: 42, author_kind: 'role', author: 'bot', name: '豆包', text, created_at: 10, card: null, from_turn: null, ...(draft ? { draft: true } : {}) },
      }) }))
      push('第一段', true)
      push('第一段第二段', true)
      push('第一段第二段第三段', true)
      expect(source.getSnapshot().unread[42]?.count ?? 0).toBe(0)
      expect(shown).toHaveLength(0)
      push('第一段第二段第三段。', false)
      push('第一段第二段第三段。', false) // a repeated commit event
      expect(source.getSnapshot().unread[42]?.count).toBe(1)
      expect(shown).toHaveLength(1)
      unsubscribe()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('messageTooLarge (#144)', () => {
  it('flags attachments over the server body cap before any request is sent', async () => {
    const { MAX_MESSAGE_BODY, messageTooLarge } = await import('../src/client/channel-source.ts')
    const file = (chars: number) => ({ name: 'a.bin', mime: 'application/octet-stream', data: 'A'.repeat(chars) })
    expect(messageTooLarge('hi', [file(1024)])).toBe(false)
    expect(messageTooLarge('hi', [file(MAX_MESSAGE_BODY / 2), file(MAX_MESSAGE_BODY / 2)])).toBe(true)
  })
})

it('sends an explicit owner review and updates the task from the API response', async () => {
  const returned = { id: 1, room_id: 1, status: 'returned' }
  const { transport, calls } = fakeTransport((url, init) => {
    if (url === '/collab/api/state') return json(200, state)
    if (url === '/collab/api/rooms/1/tasks') return json(200, { chat_id: 1, tasks: [returned] })
    if (url === '/collab/api/tasks/1/review') {
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ verdict: 'rework', note: 'missing evidence' })
      return json(200, { task: { ...returned, status: 'rework' } })
    }
    return json(200, { messages: [] })
  })
  const { source, actions } = createChannelSource(transport)
  const unsubscribe = source.subscribe(() => {})
  await vi.waitFor(() => expect(source.getSnapshot().tasks?.[0]?.status).toBe('returned'))
  await actions.reviewTask(1, 'rework', 'missing evidence')
  expect(source.getSnapshot().tasks?.[0]?.status).toBe('rework')
  expect(calls).toContain('POST /collab/api/tasks/1/review')
  unsubscribe()
})
