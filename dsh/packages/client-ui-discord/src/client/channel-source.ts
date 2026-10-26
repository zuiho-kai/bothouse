/**
 * React-free client of the CoNest collab channel service (`/collab/api/*`):
 * one observable snapshot of rooms, members, working state, and the selected
 * room's messages. The event stream opens on the first subscriber and closes
 * with the last, so an unopened panel holds no connection.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from './uuid.ts'

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
  /** Uploaded images and files (#144); absent when there are none. */
  readonly attachments?: readonly ChannelAttachment[]
  /** Unix seconds of the author's last edit (#148); absent if never edited. */
  readonly edited_at?: number
}

/** One stored attachment; its bytes are at `attachmentUrl(id)`. */
export interface ChannelAttachment {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly size: number
}

/** A file picked, pasted or dropped in the composer, base64-encoded for the POST body. */
export interface OutgoingAttachment {
  readonly name: string
  readonly mime: string
  readonly data: string
}

/** Relative URL of a stored attachment (same base as the other collab requests). */
export const attachmentUrl = (id: string): string => `collab/api/attachments/${encodeURIComponent(id)}`

/** Read a browser File into the POST form. */
// Same cap as collab's MAX_MESSAGE_BODY (dsh/collab/plugin.mjs): a bigger POST gets a 413.
export const MAX_MESSAGE_BODY = 8 * 1024 * 1024

/** Whether a message with these attachments would exceed the server's body cap (checked before sending). */
export const messageTooLarge = (text: string, attachments: readonly OutgoingAttachment[]): boolean =>
  new TextEncoder().encode(JSON.stringify({ text, client_key: randomUUID(), reply_to: Number.MAX_SAFE_INTEGER, attachments })).length > MAX_MESSAGE_BODY

export const readAttachment = async (file: File): Promise<OutgoingAttachment> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name || 'pasted', mime: file.type || 'application/octet-stream', data: btoa(binary) }
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

export interface MemberPersona { readonly slug: string; readonly name: string; readonly text: string; readonly avatar?: string }

/** One channel member: the human owner, a DSH-native member, or a bothouse bot. */
export interface ChannelMember {
  readonly rooms?: readonly number[]
  readonly id: string
  readonly name: string
  readonly kind: 'human' | 'dsh' | 'bot'
  readonly online: boolean
  readonly error?: string
  /** DSH members only: configured model, or null for the host default. */
  readonly model?: MemberModel | null
  /** Local CLI members only: which CLI the member runs as. */
  readonly cli?: 'claude' | 'codex' | 'gemini'
  /** Local CLI members only: DSH permission preset for its tool calls; absent means DSH's default (workspace-write). */
  readonly permissionPreset?: PermissionPreset
  /** DSH members only. */
  readonly nameCustomized?: boolean
  readonly persona?: string
  /** DSH members only: created in the UI (editable) rather than the config file. */
  readonly editable?: boolean
  /** Built-in avatar slug or a bot's http(s) image URL; absent means the initial badge. */
  readonly avatar?: string
}

/** Fields the UI can set on a DSH member. */
export interface DshMemberInput {
  readonly rooms?: readonly number[]
  readonly name: string
  readonly model: MemberModel | null
  readonly nameCustomized?: boolean
  readonly persona: string
  /** Built-in avatar slug, or '' for the initial badge. */
  readonly avatar?: string
}

/** A member backed by a CLI agent installed on this machine (Claude Code, Codex, Gemini). */
export interface CliMemberInput {
  readonly rooms?: readonly number[]
  readonly name: string
  readonly nameCustomized?: boolean
  readonly persona: string
  /** CLI id as listed by `GET /collab/api/clis`. */
  readonly cli: string
  /** DSH permission preset for the CLI's tool calls; omitted on edit keeps the stored one. */
  readonly permissionPreset?: PermissionPreset
  /** Built-in avatar slug, or '' for the initial badge. */
  readonly avatar?: string
}

/** DSH's built-in permission presets (same ids as DSH's `/permission`; see collab/cli-member.mjs PERMISSION_PRESETS). */
export type PermissionPreset = 'read-only' | 'workspace-write' | 'danger-full-access'

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
export type DispatchMode = 'solo' | 'team' | 'mixed'

export interface ChannelRoom {
  readonly dispatch_mode?: DispatchMode
  readonly dispatch_explicit?: boolean
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

/** One message the human sent that the service has not confirmed yet. */
export interface OutboxMessage {
  /** Idempotency key sent as `client_key`; a retry reuses it so the service dedupes. */
  readonly clientKey: string
  /** Room the message belongs to; it is shown and retried only in this room. */
  readonly roomId: number
  readonly text: string
  /** Message this one replies to, resent unchanged on retry. */
  readonly replyTo?: number
  /** Attachments, resent unchanged on retry. */
  readonly attachments?: readonly OutgoingAttachment[]
  readonly state: 'sending' | 'failed'
  /** Why the last attempt failed; set only when `state` is `failed`. */
  readonly error?: string
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
  /** The selected primary role for the collab service, or null when no role is connected. */
  readonly leadId: string | null
  /** Effective fallback role shown in the selector before an explicit choice. */
  readonly effectiveLeadId?: string | null
  /** Task board of the selected room's chat channel (itself and its workspaces), newest first. */
  readonly tasks?: readonly ChannelTask[]
  /** Chat channel the board belongs to. */
  readonly taskChat?: number
  /** True while `loadOlder` can still page further back in the selected room. */
  readonly hasMoreOlder: boolean
  /** The selected room's messages shown before the service confirmed them, newest last. */
  readonly outbox: readonly OutboxMessage[]
}

/** Actions the panel can take; each returns once the service answered. */
export interface ChannelActions {
  /** Show another room and load its recent messages. */
  selectRoom(roomId: number): Promise<void>
  /** Post one human message into the selected room, optionally replying to `replyTo`; rejects with the service's reason. */
  send(text: string, replyTo?: number, attachments?: readonly OutgoingAttachment[]): Promise<void>
  /** Re-post a failed message, reusing its `client_key` so the service dedupes. */
  retrySend(clientKey: string): Promise<void>
  /** Drop a failed message from the outbox without sending it. */
  dismissSend(clientKey: string): void
  /** Create a room and switch to it. */
  createRoom(name: string): Promise<void>
  /** Rename a chat channel while preserving its identity and history. */
  renameRoom(roomId: number, name: string): Promise<void>
  /** Provider routes and their models for the member picker. */
  listModels(): Promise<readonly ModelRoute[]>
  /** CLI agents installed on this machine, for the "local CLI" member type. */
  listClis(): Promise<readonly LocalCli[]>
  listPersonas?(): Promise<readonly MemberPersona[]>
  /** Add a DSH member; rejects with the service's reason (name taken, model unavailable…). */
  addMember(input: MemberInput): Promise<void>
  /** Edit a UI-created DSH member. */
  updateMember(id: string, input: MemberInput): Promise<void>
  /** Remove a UI-created DSH member. */
  removeMember(id: string): Promise<void>
  /** Select the member that owns the primary-role slot for this collab service. */
  setDispatchMode(roomId: number, mode: DispatchMode): Promise<void>
  setLead(id: string): Promise<void>
  /** Answer a bot's permission prompt (#120); rejects with the service's reason (already decided, expired, offline). */
  decidePermission(messageId: number, decision: PermissionDecision): Promise<void>
  /** Page further back in the selected room; resolves with how many rows arrived. */
  loadOlder(): Promise<number>
  /** Retry a failed message or system error card (#146). */
  retryMessage(messageId: number): Promise<void>
  /** Change the text of a message you wrote (#148); members that already read it are not asked again. */
  editMessage(messageId: number, text: string): Promise<void>
  /** Withdraw a message you wrote (#148); stopped names members whose running turn on it was cancelled, stillRunning those it could not reach. */
  withdrawMessage(messageId: number): Promise<{ readonly stopped: readonly string[]; readonly stillRunning: readonly string[] }>
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
  | { readonly type: 'task'; readonly task: ChannelTask; readonly chat_id: number }
  | { readonly type: 'lead'; readonly lead_id: string | null; readonly effective_lead_id?: string | null }

const INITIAL: ChannelSnapshot = {
  phase: 'idle', error: undefined, rooms: [], roomId: undefined, members: [], thinking: {}, messages: [], leadId: null, tasks: [], taskChat: undefined,
  hasMoreOlder: false, outbox: [],
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
  /** Unconfirmed messages for every room; the snapshot exposes the selected room's. */
  let outbox: OutboxMessage[] = []
  /**
   * Page-back request in flight per room, tagged with the ticket and the epoch
   * it was issued under. Only a latch from the current epoch blocks a new page:
   * after a window rebuild (A → B → A, reconnect) the old request is aborted and
   * can no longer hold the room hostage until it returns.
   */
  const paging = new Map<number, { ticket: number; epoch: number; controller: AbortController }>()
  /** Ticket of the newest page-back request per room, so a page that lost its race is dropped. */
  const pageTicket = new Map<number, number>()
  let nextPageTicket = 0
  /**
   * Bumped whenever the cached window is rebuilt (room switch or reconnect
   * reconcile). A page-back response captured under an older epoch describes a
   * window that no longer exists, so merging it would resurrect stale rows —
   * e.g. A → B → back to A, where the room check alone passes again.
   */
  let historyEpoch = 0

  const set = (next: Partial<ChannelSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  /** Re-publishes the outbox, narrowed to the selected room. */
  const publishOutbox = (): void => {
    set({ outbox: outbox.filter(entry => entry.roomId === snapshot.roomId) })
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
      case 'lead': return { ...current, leadId: event.lead_id, effectiveLeadId: event.effective_lead_id ?? event.lead_id }
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
      const state = await request<{ rooms: ChannelRoom[]; members: ChannelMember[]; thinking: Record<string, string[]>; lead_id?: string | null; effective_lead_id?: string | null }>(
        'collab/api/state', { signal: read.controller.signal },
      )
      if (!current()) return
      const roomId = state.rooms.some(r => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id
      const rows: ChannelMessage[] = []
      let hasMoreOlder = false
      if (roomId !== undefined) {
        if (resume && roomId === previous.roomId && previous.messages.length > 0) {
          // Design §4.3: a reconnect reconciles the WHOLE cached window, not just
          // the newest page. Cards can be edited or deleted while offline and
          // `after=` only reports rows that still exist, so the cached window is
          // re-read from its oldest held id and the service wins for every id in
          // it: an id the service still returns is overwritten with its current
          // content, an id it no longer returns was deleted and is dropped.
          const merged = new Map<number, ChannelMessage>(previous.messages.map(m => [m.id, m]))
          const oldest = previous.messages[0]!.id
          const present = new Set<number>()
          let cursor = oldest - 1
          while (current()) {
            const { messages } = await request<{ messages: ChannelMessage[] }>(
              'collab/api/rooms/' + roomId + '/messages?after=' + cursor + '&limit=' + CATCH_UP_LIMIT,
              { signal: read.controller.signal },
            )
            if (!current()) return
            // Ids are the merge key, so a row that also arrived through SSE is
            // folded in rather than duplicated.
            for (const row of messages) {
              merged.set(row.id, row)
              present.add(row.id)
            }
            if (messages.length < CATCH_UP_LIMIT) break
            const next = messages.at(-1)?.id
            if (next === undefined || next <= cursor) throw new Error('Channel history cursor did not advance')
            cursor = next
          }
          for (const id of [...merged.keys()]) {
            if (id >= oldest && !present.has(id)) merged.delete(id)
          }
          // The window was rebuilt from the service: pages started before this
          // point describe the old contents.
          historyEpoch += 1
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
      const keepBoard = roomId === previous.roomId
      if (!keepBoard) earlyTasks.clear()
      let next: ChannelSnapshot = {
        phase: 'ready', error: undefined, rooms: state.rooms, roomId,
        members: state.members, thinking: state.thinking, messages: rows, hasMoreOlder,
        leadId: state.lead_id ?? null, effectiveLeadId: state.effective_lead_id ?? state.lead_id ?? null,
        tasks: keepBoard ? previous.tasks : [], taskChat: keepBoard ? previous.taskChat : undefined,
        outbox: outbox.filter(entry => entry.roomId === roomId),
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
    // Any page still in flight for the previous window is stale from here on.
    historyEpoch += 1
    // The old board is not this room's: task events wait in earlyTasks until loadBoard.
    if (roomId !== snapshot.roomId) earlyTasks.clear()
    const shown = outbox.filter(entry => entry.roomId === roomId)
    set(roomId === snapshot.roomId ? { roomId, messages: [], outbox: shown } : { roomId, messages: [], outbox: shown, tasks: [], taskChat: undefined })
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
    for (const latch of paging.values()) latch.controller.abort()
    paging.clear()
    pageTicket.clear()
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
    subscribe(listener: () => void) {
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

  /**
   * Posts one message under a stable `client_key`, showing it in the outbox
   * first (design §4.3). A retry reuses the key, so the service dedupes a
   * resend whose first attempt actually landed.
   */
  const post = async (roomId: number, clientKey: string, text: string, replyTo?: number, attachments?: readonly OutgoingAttachment[]): Promise<void> => {
    const files = attachments !== undefined && attachments.length > 0 ? attachments : undefined
    const owner = lifetime
    if (owner === undefined) throw new Error('No channel is open')
    const show = (state: OutboxMessage['state'], error?: string): void => {
      outbox = [...outbox.filter(entry => entry.clientKey !== clientKey), {
        clientKey, roomId, text, ...(replyTo === undefined ? {} : { replyTo }), ...(files === undefined ? {} : { attachments: files }), state, ...(error === undefined ? {} : { error }),
      }]
      publishOutbox()
    }
    show('sending')
    try {
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, client_key: clientKey, ...(replyTo === undefined ? {} : { reply_to: replyTo }), ...(files === undefined ? {} : { attachments: files }) }),
      })
      if (lifetime !== owner) return
      outbox = outbox.filter(entry => entry.clientKey !== clientKey)
      publishOutbox()
      onEvent({ type: 'message', message })
    } catch (error) {
      if (lifetime === owner) show('failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const actions: ChannelActions = {
    selectRoom,
    async send(text, replyTo, attachments) {
      const roomId = snapshot.roomId
      if (roomId === undefined) throw new Error('No channel is open')
      await post(roomId, randomUUID(), text, replyTo, attachments)
    },
    async retrySend(clientKey) {
      const roomId = snapshot.roomId
      const entry = outbox.find(row => row.clientKey === clientKey)
      // A message is retried only in the room it was written for, never elsewhere.
      if (entry === undefined || roomId === undefined || entry.roomId !== roomId) {
        throw new Error('That message does not belong to the selected channel')
      }
      await post(entry.roomId, entry.clientKey, entry.text, entry.replyTo, entry.attachments)
    },
    dismissSend(clientKey) {
      outbox = outbox.filter(entry => entry.clientKey !== clientKey)
      publishOutbox()
    },
    async createRoom(name) {
      const { room, workspace } = await request<{ room: ChannelRoom; workspace?: ChannelRoom }>('collab/api/rooms', json('POST', { name }))
      const added = [room, workspace].filter((r): r is ChannelRoom => r !== undefined && !snapshot.rooms.some(s => s.id === r.id))
      if (added.length > 0) set({ rooms: [...snapshot.rooms, ...added] })
      await selectRoom(room.id)
    },
    async renameRoom(roomId, name) {
      const { room } = await request<{ room: ChannelRoom }>(`collab/api/rooms/${roomId}`, json('PATCH', { name }))
      set({ rooms: snapshot.rooms.map(r => r.id === roomId ? { ...r, ...room } : r) })
    },
    async listModels() {
      const { routes } = await request<{ routes: ModelRoute[] }>('collab/api/models')
      return routes
    },
    async listPersonas() {
      return await request<MemberPersona[]>('collab/api/personas')
    },
    async listClis() {
      return await request<LocalCli[]>('collab/api/clis')
    },
    async addMember(input) {
      const roomId = snapshot.roomId
      if (roomId === undefined) throw new Error('No channel is open')
      const selected = snapshot.rooms.find(r => r.id === roomId)
      const chatId = selected?.parent_id ?? roomId
      await request('collab/api/members', json('POST', { ...input, rooms: [chatId] }))
    },
    async updateMember(id, input) {
      await request(`collab/api/members/${encodeURIComponent(id)}`, json('PATCH', input))
    },
    async removeMember(id) {
      await request(`collab/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async setDispatchMode(roomId, mode) {
      const result = await request<{ dispatch_mode: DispatchMode; dispatch_explicit: boolean }>(`collab/api/rooms/${roomId}/mode`, json('PATCH', { dispatch_mode: mode }))
      const selected = snapshot.rooms.find(r => r.id === roomId)
      const chatId = selected?.parent_id ?? roomId
      set({ rooms: snapshot.rooms.map(r => r.id === chatId || r.parent_id === chatId ? { ...r, ...result } : r) })
    },
    async setLead(id) {
      const result = await request<{ lead_id: string; effective_lead_id?: string | null }>('collab/api/lead', json('PATCH', { lead_id: id }))
      if (lifetime !== undefined) onEvent({ type: 'lead', lead_id: result.lead_id, effective_lead_id: result.effective_lead_id })
    },
    async decidePermission(messageId, decision) {
      const owner = lifetime
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/messages/${messageId}/permission`, json('POST', { decision }))
      if (lifetime === owner) onEvent({ type: 'message', message })
    },
    async loadOlder() {
      const roomId = snapshot.roomId
      const owner = lifetime
      const oldest = snapshot.messages[0]?.id
      if (roomId === undefined || owner === undefined) throw new Error('No channel is open')
      // One page at a time per room: a second overlapping read would interleave
      // pages. Another room's page is independent and must not be blocked.
      const held = paging.get(roomId)
      if (held !== undefined && held.epoch === historyEpoch) return 0
      if (oldest === undefined || !snapshot.hasMoreOlder) return 0
      // A latch left over from an older window is stale: abort its request and
      // take the room over. Its finally sees a different ticket and leaves ours.
      held?.controller.abort()
      // Every page takes a ticket and records the window it was asked against;
      // both must still hold when it comes back, otherwise it is a stale page.
      const ticket = ++nextPageTicket
      const epoch = historyEpoch
      const controller = new AbortController()
      paging.set(roomId, { ticket, epoch, controller })
      pageTicket.set(roomId, ticket)
      try {
        let messages: ChannelMessage[]
        try {
          ({ messages } = await request<{ messages: ChannelMessage[] }>(
            `collab/api/rooms/${roomId}/messages?before=${oldest}&limit=${PAGE_SIZE}`,
            { signal: controller.signal },
          ))
        } catch (error) {
          if (controller.signal.aborted) return 0
          throw error
        }
        if (controller.signal.aborted) return 0
        // The page belongs to the room and the window that asked for it: after a
        // room switch (even one that came back) or a newer request, it is stale.
        if (lifetime !== owner || snapshot.roomId !== roomId) return 0
        if (epoch !== historyEpoch || pageTicket.get(roomId) !== ticket) return 0
        // Older rows and rows already on screen are one ordered set keyed by id.
        const merged = new Map<number, ChannelMessage>(snapshot.messages.map(m => [m.id, m]))
        for (const row of messages) merged.set(row.id, row)
        set({
          messages: [...merged.values()].sort((a, b) => a.id - b.id),
          hasMoreOlder: messages.length >= PAGE_SIZE,
        })
        return messages.length
      } finally {
        // Only the request that owns the latch may release it.
        if (paging.get(roomId)?.ticket === ticket) paging.delete(roomId)
      }
    },
    async retryMessage(messageId) {
      await request<{ ok: boolean }>(`collab/api/messages/${messageId}/retry`, { method: 'POST' })
    },
    async editMessage(messageId, text) {
      const owner = lifetime
      const { message } = await request<{ message: ChannelMessage }>(`collab/api/messages/${messageId}`, json('PATCH', { text }))
      if (lifetime === owner) onEvent({ type: 'message', message })
    },
    async withdrawMessage(messageId) {
      const owner = lifetime
      const roomId = snapshot.roomId
      const { stopped, still_running } = await request<{ stopped?: string[]; still_running?: string[] }>(`collab/api/messages/${messageId}`, { method: 'DELETE' })
      if (lifetime === owner && roomId !== undefined) onEvent({ type: 'deleted', id: messageId, room_id: roomId })
      return { stopped: stopped ?? [], stillRunning: still_running ?? [] }
    },
  }

  return { source, actions, dispose: stop }
}
