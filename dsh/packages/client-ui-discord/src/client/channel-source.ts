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
  /** What this message replies to; absent for a plain message. */
  readonly reply_to?: ChannelQuote
}

/** The quoted original of a reply: an excerpt, or only its id once it was deleted. */
export type ChannelQuote =
  | { readonly id: number; readonly deleted: true }
  | { readonly id: number; readonly deleted?: undefined; readonly author_kind: ChannelMessage['author_kind']; readonly author: string; readonly name: string; readonly text: string }

/** A provider route and model a DSH member runs on. */
export interface MemberModel {
  readonly provider: string
  readonly model: string
}

/** One channel member: the human owner, a DSH-native member, or a bothouse bot. */
export interface ChannelMember {
  readonly id: string
  readonly name: string
  readonly kind: 'human' | 'dsh' | 'bot'
  readonly online: boolean
  readonly error?: string
  /** DSH members only: configured model, or null for the host default. */
  readonly model?: MemberModel | null
  /** Local CLI members only: which CLI the member runs as. */
  readonly cli?: 'claude' | 'codex' | 'gemini'
  /** DSH members only. */
  readonly persona?: string
  /** DSH members only: created in the UI (editable) rather than the config file. */
  readonly editable?: boolean
  /** Built-in avatar slug or a bot's http(s) image URL; absent means the initial badge. */
  readonly avatar?: string
}

/** Fields the UI can set on a DSH member. */
export interface DshMemberInput {
  readonly name: string
  readonly model: MemberModel | null
  readonly persona: string
  /** Built-in avatar slug, or '' for the initial badge. */
  readonly avatar?: string
}

/** A member backed by a CLI agent installed on this machine (Claude Code, Codex, Gemini). */
export interface CliMemberInput {
  readonly name: string
  readonly persona: string
  /** CLI id as listed by `GET /collab/api/clis`. */
  readonly cli: string
  /** Built-in avatar slug, or '' for the initial badge. */
  readonly avatar?: string
}

/** Body of `POST /collab/api/members` / `PATCH /collab/api/members/:id`. */
export type MemberInput = DshMemberInput | CliMemberInput

/** One CLI agent found on this machine, from `GET /collab/api/clis`. */
export interface LocalCli {
  readonly cli: string
  readonly path: string
}

/** One provider route and the models it lists, for the member picker. */
export interface ModelRoute {
  readonly provider: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
  /** Set when the route could not list its models. */
  readonly error?: string
}

/** One room: a chat channel, or a workspace under one chat channel (#139). */
export interface ChannelRoom {
  readonly id: number
  readonly name: string
  /** Absent from older services: treated as a chat channel. */
  readonly kind?: 'chat' | 'workspace'
  /** The chat channel a workspace belongs to; null for chat channels. */
  readonly parent_id?: number | null
  /** Tasks in progress in this room. */
  readonly active?: number
}

/** One row of the channel list: a chat channel at depth 0, its workspaces at depth 1. */
export interface RoomRow {
  readonly room: ChannelRoom
  readonly depth: 0 | 1
}

/**
 * Order rooms as chat channel, then its workspaces, in id order. A workspace whose
 * chat channel is missing is shown at the top level so it stays reachable.
 */
export function groupRooms(rooms: readonly ChannelRoom[]): RoomRow[] {
  const chats = new Set(rooms.filter(r => r.kind !== 'workspace').map(r => r.id))
  const under = new Map<number, ChannelRoom[]>()
  for (const r of rooms) {
    if (r.kind === 'workspace' && r.parent_id != null && chats.has(r.parent_id)) {
      under.set(r.parent_id, [...(under.get(r.parent_id) ?? []), r])
    }
  }
  const rows: RoomRow[] = []
  for (const r of rooms) {
    if (r.kind !== 'workspace') {
      rows.push({ room: r, depth: 0 })
      for (const w of under.get(r.id) ?? []) rows.push({ room: w, depth: 1 })
    } else if (r.parent_id == null || !chats.has(r.parent_id)) {
      rows.push({ room: r, depth: 0 })
    }
  }
  return rows
}

/** Task statuses (dsh/collab/tasks.mjs STATUS). */
export type TaskStatus = 'assigned' | 'accepted' | 'asked' | 'declined' | 'escalated' | 'returned' | 'done' | 'rework'

/** One dispatched task (#139 team mode B), as `GET /collab/api/rooms/:id/tasks` serializes it. */
export interface ChannelTask {
  readonly id: number
  /** Room the task was dispatched in (the chat channel or one of its workspaces). */
  readonly room_id: number
  readonly parent_task: number | null
  readonly title: string
  readonly owner: string
  readonly owner_name: string
  readonly created_by: string
  readonly created_by_name: string
  readonly status: TaskStatus
  /** Unix seconds of the pending reminder, or null when none is pending. */
  readonly next_check_at: number | null
  /** Dispatch message (or its task record) to jump to. */
  readonly assign_msg_id: number | null
  /** Delivery message bound at hand-back. */
  readonly result_msg_id: number | null
  readonly note: string | null
  readonly created_at: number
  readonly updated_at: number
  readonly returned_at: number | null
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
  /** Task board of the selected room's chat channel (itself and its workspaces), newest first. */
  readonly tasks?: readonly ChannelTask[]
  /** Chat channel the board belongs to. */
  readonly taskChat?: number
}

/** Actions the panel can take; each returns once the service answered. */
export interface ChannelActions {
  /** Show another room and load its recent messages. */
  selectRoom(roomId: number): Promise<void>
  /** Post one human message into the selected room, optionally replying to `replyTo`; rejects with the service's reason. */
  send(text: string, replyTo?: number): Promise<void>
  /** Create a room and switch to it. */
  createRoom(name: string): Promise<void>
  /** Provider routes and their models for the member picker. */
  listModels(): Promise<readonly ModelRoute[]>
  /** CLI agents installed on this machine, for the "local CLI" member type. */
  listClis(): Promise<readonly LocalCli[]>
  /** Add a DSH member; rejects with the service's reason (name taken, model unavailable…). */
  addMember(input: MemberInput): Promise<void>
  /** Edit a UI-created DSH member. */
  updateMember(id: string, input: MemberInput): Promise<void>
  /** Remove a UI-created DSH member. */
  removeMember(id: string): Promise<void>
  /** Answer a bot's permission prompt (#120); rejects with the service's reason (already decided, expired, offline). */
  decidePermission(messageId: number, decision: PermissionDecision): Promise<void>
}

/** Decisions a permission prompt accepts (dsh/collab/cloudweb.mjs PERM_DECISIONS). */
export type PermissionDecision = 'allow' | 'deny' | 'allow_all'

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
  | { readonly type: 'task'; readonly task: ChannelTask; readonly chat_id: number }

const INITIAL: ChannelSnapshot = {
  phase: 'idle', error: undefined, rooms: [], roomId: undefined, members: [], thinking: {}, messages: [], tasks: [], taskChat: undefined,
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


  // Task events that arrive before the board of a newly selected room is known
  // (taskChat undefined) are kept here, newest per task, until loadBoard merges them.
  const earlyTasks = new Map<number, { chat: number; task: ChannelTask }>()
  const newer = (a: ChannelTask | undefined, b: ChannelTask): boolean => (a?.updated_at ?? -Infinity) <= b.updated_at

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
          ? {
              ...current,
              // Replies to the removed message keep only its id, so its text stops showing.
              messages: current.messages.filter(m => m.id !== event.id)
                .map(m => (m.reply_to?.id === event.id ? { ...m, reply_to: { id: event.id, deleted: true as const } } : m)),
            }
          : current
      case 'members': return { ...current, members: event.members }
      case 'thinking': return { ...current, thinking: { ...current.thinking, [String(event.room_id)]: event.members } }
      case 'rooms': return { ...current, rooms: event.rooms }
      case 'task': {
        if (current.taskChat === undefined) {
          if (newer(earlyTasks.get(event.task.id)?.task, event.task)) earlyTasks.set(event.task.id, { chat: event.chat_id, task: event.task })
          return current
        }
        if (event.chat_id !== current.taskChat) return current
        const rows = new Map((current.tasks ?? []).map(t => [t.id, t]))
        rows.set(event.task.id, event.task)
        return { ...current, tasks: [...rows.values()].sort((a, b) => b.id - a.id) }
      }
      default: return current // Unknown future events leave the snapshot unchanged.
    }
  }

  const onEvent = (event: ServiceEvent): void => {
    pending?.events.push(event)
    set(applyEvent(snapshot, event))
  }

  // The task board is off the critical path: messages render first, and a
  // collab service without team mode B (404) just leaves the board empty.
  let boardRead: AbortController | undefined
  const loadBoard = async (owner: object, roomId: number): Promise<void> => {
    boardRead?.abort()
    const read = new AbortController()
    boardRead = read
    try {
      const board = await request<{ chat_id: number; tasks: ChannelTask[] }>(
        'collab/api/rooms/' + roomId + '/tasks', { signal: read.signal },
      )
      if (lifetime !== owner || boardRead !== read || snapshot.roomId !== roomId) return
      // Task events that arrived while the board was loading are newer than it.
      const live = snapshot.taskChat === board.chat_id ? snapshot.tasks ?? [] : []
      const early = [...earlyTasks.values()].filter(e => e.chat === board.chat_id).map(e => e.task)
      earlyTasks.clear()
      const rows = new Map(board.tasks.map(t => [t.id, t]))
      for (const t of [...live, ...early]) if (newer(rows.get(t.id), t)) rows.set(t.id, t)
      set({ tasks: [...rows.values()].sort((a, b) => b.id - a.id), taskChat: board.chat_id })
    } catch (error) {
      void error // Optional board: a missing or failed read leaves it as it was.
    } finally {
      if (boardRead === read) boardRead = undefined
    }
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
      const keepBoard = roomId === previous.roomId
      if (!keepBoard) earlyTasks.clear()
      let next: ChannelSnapshot = {
        phase: 'ready', error: undefined, rooms: state.rooms, roomId,
        members: state.members, thinking: state.thinking, messages: rows,
        tasks: keepBoard ? previous.tasks : [], taskChat: keepBoard ? previous.taskChat : undefined,
      }
      for (const event of read.events) next = applyEvent(next, event)
      pending = undefined
      set(next)
      if (roomId !== undefined) void loadBoard(owner, roomId)
    } catch (error) {
      if (!current()) return
      pending = undefined
      fail(error)
    }
  }

  const selectRoom = async (roomId: number): Promise<void> => {
    // The old board is not this room's: task events wait in earlyTasks until loadBoard.
    if (roomId !== snapshot.roomId) earlyTasks.clear()
    set(roomId === snapshot.roomId ? { roomId, messages: [] } : { roomId, messages: [], tasks: [], taskChat: undefined })
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
    boardRead?.abort()
    boardRead = undefined
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
    async send(text, replyTo) {
      const roomId = snapshot.roomId
      const owner = lifetime
      if (roomId === undefined || owner === undefined) throw new Error('No channel is open')
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(replyTo === undefined ? { text, client_key: crypto.randomUUID() } : { text, client_key: crypto.randomUUID(), reply_to: replyTo }),
      })
      if (lifetime === owner) onEvent({ type: 'message', message })
    },
    async createRoom(name) {
      const { room, workspace } = await request<{ room: ChannelRoom; workspace?: ChannelRoom }>('collab/api/rooms', json('POST', { name }))
      const added = [room, workspace].filter((r): r is ChannelRoom => r !== undefined && !snapshot.rooms.some(s => s.id === r.id))
      if (added.length > 0) set({ rooms: [...snapshot.rooms, ...added] })
      await selectRoom(room.id)
    },
    async listModels() {
      const { routes } = await request<{ routes: ModelRoute[] }>('collab/api/models')
      return routes
    },
    async listClis() {
      return await request<LocalCli[]>('collab/api/clis')
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
    async decidePermission(messageId, decision) {
      const owner = lifetime
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/messages/${messageId}/permission`, json('POST', { decision }))
      if (lifetime === owner) onEvent({ type: 'message', message })
    },
  }

  return { source, actions, dispose: stop }
}
