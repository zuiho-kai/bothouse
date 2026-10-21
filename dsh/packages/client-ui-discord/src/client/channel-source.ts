/**
 * React-free client of the CoNest collab channel service (`/collab/api/*`):
 * one observable snapshot of rooms, members, working state, and the selected
 * room's messages. The event stream opens on the first subscriber and closes
 * with the last, so an unopened panel holds no connection.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** One stored channel message, as the collab service serializes it. */
export interface ChannelMessage {
  readonly id: number
  readonly room_id: number
  readonly author_kind: 'user' | 'role' | 'system'
  readonly author: string
  readonly name: string
  readonly text: string
  /** Unix seconds. */
  readonly created_at: number
  /** Progress-card JSON (`title`, `state`), or null for an ordinary message. */
  readonly card: string | null
  readonly from_turn: number | null
}

/** A provider route and model a DSH member runs on. */
export interface MemberModel {
  readonly provider: string
  readonly model: string
}

/** One channel member: the human owner, a DSH-native member, or a cc-connect bot. */
export interface ChannelMember {
  readonly id: string
  readonly name: string
  readonly kind: 'human' | 'dsh' | 'bot'
  readonly online: boolean
  /** DSH members only: configured model, or null for the host default. */
  readonly model?: MemberModel | null
  /** DSH members only. */
  readonly persona?: string
  /** DSH members only: created in the UI (editable) rather than the config file. */
  readonly editable?: boolean
}

/** Fields the UI can set on a DSH member. */
export interface MemberInput {
  readonly name: string
  readonly model: MemberModel | null
  readonly persona: string
}

/** One provider route and the models it lists, for the member picker. */
export interface ModelRoute {
  readonly provider: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
  /** Set when the route could not list its models. */
  readonly error?: string
}

/** One configured room. */
export interface ChannelRoom {
  readonly id: number
  readonly name: string
}

/** Whole panel state; `phase` says whether the service answered. */
export interface ChannelSnapshot {
  readonly phase: 'idle' | 'loading' | 'ready' | 'reconnecting' | 'unavailable' | 'unauthorized' | 'error'
  readonly error: string | undefined
  readonly rooms: readonly ChannelRoom[]
  readonly roomId: number | undefined
  readonly members: readonly ChannelMember[]
  /** Room id → ids of members currently working there. */
  readonly thinking: Readonly<Record<string, readonly string[]>>
  /** Selected room's messages, ascending by id. */
  readonly messages: readonly ChannelMessage[]
  /** True while `loadOlder` can still page further back in the selected room. */
  readonly hasMoreOlder: boolean
}

/** Actions the panel can take; each returns once the service answered. */
export interface ChannelActions {
  /** Show another room and load its recent messages. */
  selectRoom(roomId: number): Promise<void>
  /** Post one human message into the selected room; rejects with the service's reason. */
  send(text: string): Promise<void>
  /** Create a room and switch to it. */
  createRoom(name: string): Promise<void>
  /** Provider routes and their models for the member picker. */
  listModels(): Promise<readonly ModelRoute[]>
  /** Add a DSH member; rejects with the service's reason (name taken, model unavailable…). */
  addMember(input: MemberInput): Promise<void>
  /** Edit a UI-created DSH member. */
  updateMember(id: string, input: MemberInput): Promise<void>
  /** Remove a UI-created DSH member. */
  removeMember(id: string): Promise<void>
  /** Page further back in the selected room; resolves with how many rows arrived. */
  loadOlder(): Promise<number>
}

/** Narrow EventSource surface used here, so tests can pass a fake. */
export type EventStreamLike = Pick<EventSource, 'close'> & {
  [K in 'onopen' | 'onmessage' | 'onerror']: OmitThisParameter<NonNullable<EventSource[K]>> | null
}

/** Injectable transport for tests; browsers use `fetch` and `EventSource`. */
export interface ChannelTransport {
  fetch(input: string, init?: RequestInit): Promise<Response>
  openEvents(url: string): EventStreamLike
  /** Resolve a service path against the document base. */
  url(path: string): string
  /** Wait before a reconnect attempt; injectable so tests need no real clocks. */
  delay?(ms: number): Promise<void>
  /** Jitter source in `[0, 1)`; injectable so backoff is deterministic in tests. */
  random?(): number
}

type ServiceEvent =
  | { readonly type: 'message'; readonly message: ChannelMessage }
  | { readonly type: 'deleted'; readonly id: number; readonly room_id: number }
  | { readonly type: 'members'; readonly members: readonly ChannelMember[] }
  | { readonly type: 'thinking'; readonly room_id: number; readonly members: readonly string[] }
  | { readonly type: 'rooms'; readonly rooms: readonly ChannelRoom[] }

const INITIAL: ChannelSnapshot = {
  phase: 'idle', error: undefined, rooms: [], roomId: undefined, members: [], thinking: {}, messages: [], hasMoreOlder: false,
}

/** Reconnect backoff: 1, 2, 4, 8… seconds, never beyond this cap. */
const MAX_BACKOFF_MS = 30_000

/** Messages requested per page, both for the first read and for `loadOlder`. */
const PAGE_SIZE = 100

/** Messages requested per catch-up read after a reconnect. */
const CATCH_UP_LIMIT = 200

/** Status-coded service failure so the panel can tell "not enabled" from "not signed in". */
class ServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Browser transport over the page's own origin and document base.
 * @returns fetch and EventSource bound to the current document.
 */
export function browserTransport(): ChannelTransport {
  return {
    fetch: (input, init) => fetch(input, { credentials: 'same-origin', ...init }),
    openEvents: url => new EventSource(url, { withCredentials: true }),
    url: path => new URL(path, document.baseURI).toString(),
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
    random: () => Math.random(),
  }
}

/**
 * Create the channel source and its actions.
 * @param transport - fetch/EventSource binding.
 * @returns the observable snapshot, the actions, and a disposer.
 */
export function createChannelSource(transport: ChannelTransport): {
  source: ObservableSnapshot<ChannelSnapshot>
  actions: ChannelActions
  dispose: () => void
} {
  let snapshot = INITIAL
  const listeners = new Set<() => void>()
  let stream: EventStreamLike | undefined
  let lifetime: object | undefined
  let pending: { controller: AbortController; events: ServiceEvent[] } | undefined
  /** Consecutive reconnect attempts since the stream last opened. */
  let attempt = 0
  /** Identifies the scheduled retry, so a stop() or a newer retry cancels it. */
  let reconnectToken: object | undefined

  const set = (next: Partial<ChannelSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await transport.fetch(transport.url(path), init)
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new ServiceError(response.status, body.error ?? response.statusText)
    }
    return await response.json() as T
  }

  const fail = (error: unknown): void => {
    if (error instanceof ServiceError && error.status === 404) set({ phase: 'unavailable', error: undefined })
    else if (error instanceof ServiceError && error.status === 401) set({ phase: 'unauthorized', error: undefined })
    else set({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
  }


  const applyEvent = (current: ChannelSnapshot, event: ServiceEvent): ChannelSnapshot => {
    switch (event.type) {
      case 'message': {
        if (event.message.room_id !== current.roomId) return current
        const rows = new Map(current.messages.map(m => [m.id, m]))
        rows.set(event.message.id, event.message)
        return { ...current, messages: [...rows.values()].sort((a, b) => a.id - b.id) }
      }
      case 'deleted':
        return event.room_id === current.roomId
          ? { ...current, messages: current.messages.filter(m => m.id !== event.id) }
          : current
      case 'members': return { ...current, members: event.members }
      case 'thinking': return { ...current, thinking: { ...current.thinking, [String(event.room_id)]: event.members } }
      case 'rooms': return { ...current, rooms: event.rooms }
      default: return current // Unknown future events leave the snapshot unchanged.
    }
  }

  const onEvent = (event: ServiceEvent): void => {
    pending?.events.push(event)
    set(applyEvent(snapshot, event))
  }

  // A result belongs to one read and one subscription lifetime, even when the
  // user visits A -> B -> A. Live events replay over the HTTP baseline.
  const refresh = async (resume: boolean): Promise<void> => {
    const owner = lifetime
    if (owner === undefined) return
    pending?.controller.abort()
    const read = { controller: new AbortController(), events: [] as ServiceEvent[] }
    pending = read
    const previous = snapshot
    const current = (): boolean => lifetime === owner && pending === read && !read.controller.signal.aborted
    try {
      const state = await request<{ rooms: ChannelRoom[]; members: ChannelMember[]; thinking: Record<string, string[]> }>(
        'collab/api/state', { signal: read.controller.signal },
      )
      if (!current()) return
      const roomId = state.rooms.some(r => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id
      const rows: ChannelMessage[] = []
      let hasMoreOlder = false
      if (roomId !== undefined) {
        if (resume && roomId === previous.roomId) {
          // Design §4.3: after a reconnect, catch up with `after=newestId` instead
          // of re-reading the room. Ids are the merge key, so a row that also
          // arrived through SSE is folded in rather than duplicated.
          const merged = new Map<number, ChannelMessage>(previous.messages.map(m => [m.id, m]))
          const newest = previous.messages.at(-1)?.id ?? 0
          let cursor = newest
          while (current()) {
            const { messages } = await request<{ messages: ChannelMessage[] }>(
              'collab/api/rooms/' + roomId + '/messages?after=' + cursor + '&limit=' + CATCH_UP_LIMIT,
              { signal: read.controller.signal },
            )
            if (!current()) return
            for (const row of messages) merged.set(row.id, row)
            if (messages.length < CATCH_UP_LIMIT) break
            const next = messages.at(-1)?.id
            if (next === undefined || next <= cursor) throw new Error('Channel history cursor did not advance')
            cursor = next
          }
          // Cards can be edited or deleted while offline, and `after=` cannot see
          // either. Re-read only the page the user was looking at (one request),
          // and treat it as authoritative for the ids it spans; older rows keep
          // their last seen state until the panel reloads.
          if (newest > 0) {
            const { messages: known } = await request<{ messages: ChannelMessage[] }>(
              'collab/api/rooms/' + roomId + '/messages?before=' + (newest + 1) + '&limit=' + PAGE_SIZE,
              { signal: read.controller.signal },
            )
            if (!current()) return
            for (const row of known) merged.set(row.id, row)
            const windowFrom = known[0]?.id
            if (windowFrom !== undefined) {
              const present = new Set(known.map(row => row.id))
              for (const id of [...merged.keys()]) {
                if (id >= windowFrom && id <= newest && !present.has(id)) merged.delete(id)
              }
            }
          }
          rows.push(...[...merged.values()].sort((a, b) => a.id - b.id))
          hasMoreOlder = previous.hasMoreOlder
        } else {
          // First read or a room switch: newest page, then page forward.
          let after: number | undefined
          while (current()) {
            const query = after === undefined ? 'limit=' + PAGE_SIZE : 'after=' + after + '&limit=' + CATCH_UP_LIMIT
            const { messages } = await request<{ messages: ChannelMessage[] }>(
              'collab/api/rooms/' + roomId + '/messages?' + query, { signal: read.controller.signal },
            )
            if (!current()) return
            rows.push(...messages)
            if (after === undefined) {
              hasMoreOlder = messages.length >= PAGE_SIZE
              break
            }
            if (messages.length < CATCH_UP_LIMIT) break
            const next = messages.at(-1)?.id
            if (next === undefined || next <= after) throw new Error('Channel history cursor did not advance')
            after = next
          }
        }
      }
      let next: ChannelSnapshot = {
        phase: 'ready', error: undefined, rooms: state.rooms, roomId,
        members: state.members, thinking: state.thinking, messages: rows, hasMoreOlder,
      }
      for (const event of read.events) next = applyEvent(next, event)
      pending = undefined
      set(next)
    } catch (error) {
      if (!current()) return
      pending = undefined
      fail(error)
    }
  }

  const selectRoom = async (roomId: number): Promise<void> => {
    set({ roomId, messages: [] })
    await refresh(false)
  }

  /** Wait before the next attempt; tests inject a fake so no clock is needed. */
  const pause = (ms: number): Promise<void> =>
    transport.delay === undefined ? Promise.resolve() : transport.delay(ms)

  /** Jitter source in `[0, 1)`. */
  const random = (): number => transport.random?.() ?? 0.5

  /** Backoff before retry `attempt`: 1, 2, 4, 8… seconds, capped, then jittered. */
  const backoffMs = (attempt: number): number => {
    const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)
    // Jitter stays inside `[base/2, base]`, so the cap holds even after jitter.
    return Math.round(base / 2 + random() * (base / 2))
  }

  /** Opens the live stream; `onerror` schedules a backoff retry (design §4.3). */
  const listen = (owner: object): void => {
    if (lifetime !== owner || listeners.size === 0) return
    let events: EventStreamLike
    try {
      events = transport.openEvents(transport.url('collab/api/events'))
    } catch (error) {
      fail(error)
      return
    }
    stream = events
    events.onopen = () => {
      if (lifetime !== owner || stream !== events) return
      attempt = 0
      void refresh(true)
    }
    events.onerror = () => {
      if (lifetime !== owner || stream !== events) return
      // The socket is dead: drop it, then retry on a fresh one.
      stream = undefined
      events.onopen = null
      events.onmessage = null
      events.onerror = null
      events.close()
      pending?.controller.abort()
      pending = undefined
      retry(owner)
    }
    events.onmessage = (event: MessageEvent<string>) => {
      if (lifetime !== owner || stream !== events) return
      try { onEvent(JSON.parse(event.data) as ServiceEvent) } catch (error) { void error /* malformed frames are repaired on reconnect */ }
    }
  }

  /** Enters `reconnecting` and resumes the stream after a jittered backoff. */
  const retry = (owner: object): void => {
    if (lifetime !== owner) return
    const token = { attempt }
    reconnectToken = token
    const wait = backoffMs(attempt)
    attempt += 1
    set({ phase: 'reconnecting', error: undefined })
    void pause(wait).then(() => {
      if (lifetime !== owner || reconnectToken !== token) return
      reconnectToken = undefined
      listen(owner)
    })
  }

  const start = async (owner: object): Promise<void> => {
    set({ phase: 'loading', error: undefined })
    await refresh(false)
    if (lifetime !== owner || listeners.size === 0 || snapshot.phase !== 'ready') return
    listen(owner)
  }

  const stop = (): void => {
    lifetime = undefined
    reconnectToken = undefined
    attempt = 0
    pending?.controller.abort()
    pending = undefined
    if (stream !== undefined) {
      stream.onopen = null
      stream.onmessage = null
      stream.onerror = null
      stream.close()
      stream = undefined
    }
  }

  const source: ObservableSnapshot<ChannelSnapshot> = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (lifetime === undefined) {
        lifetime = {}
        void start(lifetime)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }

  const actions: ChannelActions = {
    selectRoom,
    async send(text) {
      const roomId = snapshot.roomId
      const owner = lifetime
      if (roomId === undefined || owner === undefined) throw new Error('No channel is open')
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, client_key: crypto.randomUUID() }),
      })
      if (lifetime === owner) onEvent({ type: 'message', message })
    },
    async createRoom(name) {
      const { room } = await request<{ room: ChannelRoom }>('collab/api/rooms', json('POST', { name }))
      if (!snapshot.rooms.some(r => r.id === room.id)) set({ rooms: [...snapshot.rooms, room] })
      await selectRoom(room.id)
    },
    async listModels() {
      const { routes } = await request<{ routes: ModelRoute[] }>('collab/api/models')
      return routes
    },
    async addMember(input) {
      await request('collab/api/members', json('POST', input))
    },
    async updateMember(id, input) {
      await request(`collab/api/members/${encodeURIComponent(id)}`, json('PATCH', input))
    },
    async removeMember(id) {
      await request(`collab/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async loadOlder() {
      const roomId = snapshot.roomId
      const owner = lifetime
      const oldest = snapshot.messages[0]?.id
      if (roomId === undefined || owner === undefined) throw new Error('No channel is open')
      if (oldest === undefined || !snapshot.hasMoreOlder) return 0
      const { messages } = await request<{ messages: ChannelMessage[] }>(
        `collab/api/rooms/${roomId}/messages?before=${oldest}&limit=${PAGE_SIZE}`,
      )
      if (lifetime !== owner) return 0
      // Older rows and rows already on screen are one ordered set keyed by id.
      const merged = new Map<number, ChannelMessage>(snapshot.messages.map(m => [m.id, m]))
      for (const row of messages) merged.set(row.id, row)
      set({
        messages: [...merged.values()].sort((a, b) => a.id - b.id),
        hasMoreOlder: messages.length >= PAGE_SIZE,
      })
      return messages.length
    },
  }

  return { source, actions, dispose: stop }
}
