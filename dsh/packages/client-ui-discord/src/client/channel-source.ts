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
  readonly visibility?: 'public' | 'private'
}

/** Room membership record. */
export interface RoomMemberEntry {
  readonly member_id: string
  readonly role: 'owner' | 'member'
  readonly added_at: number | null
}

/** Result of stopping tasks for one member. */
export interface StopMemberOutcome {
  readonly member: string
  readonly outcome: 'confirmed' | 'requested' | 'unsupported'
}

/** Result of stopping tasks in a room. */
export interface StopRoomResult {
  readonly room_id: number
  readonly stopped: boolean
  readonly cancelled_jobs: number
  readonly unconfirmed: readonly string[]
  readonly stopped_members: readonly StopMemberOutcome[]
  readonly output_only?: readonly string[]
}

/** Result of continuing relay in a room. */
export interface ContinueRoomResult {
  readonly room_id: number
  readonly resumed: number | boolean
  readonly stopped: boolean
}

/** Control state for one room. */
export interface ChannelRoomControl {
  readonly room_id: number
  readonly stopped: boolean
  readonly epoch: number
  readonly cutoff: number
  readonly relay_after: number
}

/** Whole panel state; `phase` says whether the service answered. */
export interface ChannelSnapshot {
  readonly phase: 'idle' | 'loading' | 'ready' | 'unavailable' | 'unauthorized' | 'error'
  readonly error: string | undefined
  readonly rooms: readonly ChannelRoom[]
  readonly roomId: number | undefined
  readonly members: readonly ChannelMember[]
  /** Room id → ids of members currently working there. */
  readonly thinking: Readonly<Record<string, readonly string[]>>
  /** Selected room's messages, ascending by id. */
  readonly messages: readonly ChannelMessage[]
  /** Room id → room control state. */
  readonly roomControls?: Readonly<Record<number, ChannelRoomControl>>
}

/** Actions the panel can take; each returns once the service answered. */
export interface ChannelActions {
  /** Show another room and load its recent messages. */
  selectRoom(roomId: number): Promise<void>
  /** Post one human message into the selected room; rejects with the service's reason. */
  send(text: string): Promise<void>
  /** Create a room and switch to it. */
  createRoom(name: string, visibility?: 'public' | 'private', initial_members?: readonly string[]): Promise<void>
  /** Fetch members of a private room. */
  getRoomMembers(roomId: number): Promise<readonly RoomMemberEntry[]>
  /** Add a member to a private room. */
  addRoomMember(roomId: number, memberId: string): Promise<void>
  /** Remove a member from a private room. */
  removeRoomMember(roomId: number, memberId: string): Promise<void>
  /** Provider routes and their models for the member picker. */
  listModels(): Promise<readonly ModelRoute[]>
  /** Add a DSH member; rejects with the service's reason (name taken, model unavailable…). */
  addMember(input: MemberInput): Promise<void>
  /** Edit a UI-created DSH member. */
  updateMember(id: string, input: MemberInput): Promise<void>
  /** Remove a UI-created DSH member. */
  removeMember(id: string): Promise<void>
  /** Stop running tasks in the room (defaults to selected room). */
  stopRoom(roomId?: number): Promise<StopRoomResult>
  /** Resume relay continuation in the room (defaults to selected room). */
  continueRoom(roomId?: number): Promise<ContinueRoomResult>
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
}

type ServiceEvent =
  | { readonly type: 'message'; readonly message: ChannelMessage }
  | { readonly type: 'deleted'; readonly id: number; readonly room_id: number }
  | { readonly type: 'members'; readonly members: readonly ChannelMember[] }
  | { readonly type: 'thinking'; readonly room_id: number; readonly members: readonly string[] }
  | { readonly type: 'rooms'; readonly rooms: readonly ChannelRoom[] }
  | { readonly type: 'room_control'; readonly room_id: number; readonly stopped: number | boolean; readonly epoch?: number; readonly cutoff?: number; readonly relay_after?: number }
  | { readonly type: 'room_updated'; readonly room: ChannelRoom }
  | { readonly type: 'room_members_changed'; readonly room_id: number; readonly members: readonly string[]; readonly action: 'add' | 'remove'; readonly target_member_ids?: readonly string[] }

const INITIAL: ChannelSnapshot = {
  phase: 'idle', error: undefined, rooms: [], roomId: undefined, members: [], thinking: {}, messages: [],
}

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
      case 'room_updated': {
        const updated = event.room
        const exists = current.rooms.some(r => r.id === updated.id)
        const rooms = exists
          ? current.rooms.map(r => (r.id === updated.id ? { ...r, ...updated } : r))
          : [...current.rooms, updated]
        return { ...current, rooms }
      }
      case 'room_members_changed': return current
      case 'room_control': {
        const controls = { ...(current.roomControls ?? {}) }
        controls[event.room_id] = {
          room_id: event.room_id,
          stopped: Boolean(event.stopped),
          epoch: event.epoch ?? 0,
          cutoff: event.cutoff ?? 0,
          relay_after: event.relay_after ?? 0,
        }
        return { ...current, roomControls: controls }
      }
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
      const state = await request<{
        rooms: ChannelRoom[]
        members: ChannelMember[]
        thinking: Record<string, string[]>
        room_controls?: readonly { room_id: number; stopped: number | boolean; epoch: number; cutoff: number; relay_after: number }[]
      }>(
        'collab/api/state', { signal: read.controller.signal },
      )
      if (!current()) return
      const roomId = state.rooms.some(r => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id
      const rows: ChannelMessage[] = []
      if (roomId !== undefined) {
        // Re-read retained rows too: cards can be edited/deleted while offline.
        // The paging cursor is independent of messages arriving through SSE.
        let after = resume && roomId === previous.roomId ? (previous.messages[0]?.id ?? 1) - 1 : undefined
        while (current()) {
          const query = after === undefined ? 'limit=100' : 'after=' + after + '&limit=200'
          const { messages } = await request<{ messages: ChannelMessage[] }>(
            'collab/api/rooms/' + roomId + '/messages?' + query, { signal: read.controller.signal },
          )
          if (!current()) return
          rows.push(...messages)
          if (after === undefined || messages.length < 200) break
          const next = messages.at(-1)?.id
          if (next === undefined || next <= after) throw new Error('Channel history cursor did not advance')
          after = next
        }
      }
      const controls: Record<number, ChannelRoomControl> = {}
      if (Array.isArray(state.room_controls)) {
        for (const c of state.room_controls) {
          controls[c.room_id] = {
            room_id: c.room_id,
            stopped: Boolean(c.stopped),
            epoch: c.epoch ?? 0,
            cutoff: c.cutoff ?? 0,
            relay_after: c.relay_after ?? 0,
          }
        }
      }
      let next: ChannelSnapshot = {
        phase: 'ready', error: undefined, rooms: state.rooms, roomId,
        members: state.members, thinking: state.thinking, messages: rows,
        roomControls: controls,
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

  const start = async (owner: object): Promise<void> => {
    set({ phase: 'loading', error: undefined })
    await refresh(false)
    if (lifetime !== owner || listeners.size === 0 || snapshot.phase !== 'ready') return
    try {
      const events = transport.openEvents(transport.url('collab/api/events'))
      stream = events
      events.onopen = () => { if (lifetime === owner) void refresh(true) }
      events.onerror = () => {
        if (lifetime !== owner) return
        pending?.controller.abort()
        pending = undefined
        set({ phase: 'loading', error: undefined })
      }
      events.onmessage = (event: MessageEvent<string>) => {
        if (lifetime !== owner) return
        try { onEvent(JSON.parse(event.data) as ServiceEvent) } catch (error) { void error /* malformed frames are repaired on reconnect */ }
      }
    } catch (error) {
      if (lifetime === owner) fail(error)
    }
  }

  const stop = (): void => {
    lifetime = undefined
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
    async createRoom(name, visibility, initial_members) {
      const payload: { name: string; visibility?: string; initial_members?: readonly string[] } = { name }
      if (visibility !== undefined) payload.visibility = visibility
      if (initial_members !== undefined && initial_members.length > 0) payload.initial_members = initial_members
      const { room } = await request<{ room: ChannelRoom }>('collab/api/rooms', json('POST', payload))
      if (!snapshot.rooms.some(r => r.id === room.id)) set({ rooms: [...snapshot.rooms, room] })
      await selectRoom(room.id)
    },
    async getRoomMembers(roomId) {
      const { members } = await request<{ members: readonly RoomMemberEntry[] }>(`collab/api/rooms/${roomId}/members`)
      return members
    },
    async addRoomMember(roomId, memberId) {
      await request(`collab/api/rooms/${roomId}/members`, json('POST', { member_id: memberId }))
    },
    async removeRoomMember(roomId, memberId) {
      await request(`collab/api/rooms/${roomId}/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' })
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
    async stopRoom(roomId?: number) {
      const target = roomId ?? snapshot.roomId
      if (target === undefined) throw new Error('No channel is open')
      return await request<StopRoomResult>(`collab/api/rooms/${target}/stop`, { method: 'POST' })
    },
    async continueRoom(roomId?: number) {
      const target = roomId ?? snapshot.roomId
      if (target === undefined) throw new Error('No channel is open')
      return await request<ContinueRoomResult>(`collab/api/rooms/${target}/continue`, { method: 'POST' })
    },
  }

  return { source, actions, dispose: stop }
}
