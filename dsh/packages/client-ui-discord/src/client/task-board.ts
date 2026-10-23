/**
 * Team mode B (#139) board model, free of React so it is testable without a DOM:
 * status labels, board grouping and order, task-card member rows, elapsed time.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelRoom, ChannelTask, TaskStatus } from './channel-source.ts'
import type { NS } from './locales.ts'

export type T = TranslateNS<typeof NS>

/** Locale key of each status label (dsh/collab/tasks.mjs STATUS). */
export const STATUS_KEY = {
  assigned: 'taskAssigned', accepted: 'taskAccepted', asked: 'taskAsked', declined: 'taskDeclined',
  escalated: 'taskEscalated', returned: 'taskReturned', done: 'taskDone', rework: 'taskRework',
} as const satisfies Record<TaskStatus, string>

/** Board order: the owner's turn first (tasks.mjs WORKING), then waiting for the lead, then finished. */
const GROUPS: readonly (readonly TaskStatus[])[] = [
  ['assigned', 'accepted', 'asked', 'rework'],
  ['returned', 'declined', 'escalated'],
  ['done'],
]
const groupOf = (status: TaskStatus): number => GROUPS.findIndex(g => g.includes(status))

/** Board rows, grouped as above and newest first inside a group. */
export function boardOrder(tasks: readonly ChannelTask[]): ChannelTask[] {
  return [...tasks].sort((a, b) => groupOf(a.status) - groupOf(b.status) || b.id - a.id)
}

/** Seconds a task has taken: until hand-back, until it closed, or until now. */
export function elapsed(task: ChannelTask, now: number): number {
  const end = task.returned_at ?? (task.status === 'done' ? task.updated_at : now)
  return Math.max(0, end - task.created_at)
}

/** Elapsed time as words (unit conversions only). */
export function formatDuration(seconds: number, t: T): string {
  const s = Math.round(seconds)
  if (s < 60) return t('durSeconds', { n: String(s) })
  if (s < 3600) return t('durMinutes', { n: String(Math.round(s / 60)) })
  return t('durHours', { h: String(Math.floor(s / 3600)), m: String(Math.round((s % 3600) / 60)) })
}

/** Board sections: open tasks (owner's turn, then waiting for the lead) and finished ones. */
export function boardGroups(tasks: readonly ChannelTask[]): { open: ChannelTask[]; done: ChannelTask[] } {
  const rows = boardOrder(tasks)
  return { open: rows.filter(task => task.status !== 'done'), done: rows.filter(task => task.status === 'done') }
}

/** Task-card rows: the task's owner first, then each sub-task in dispatch order. */
export function cardMembers(taskId: number, tasks: readonly ChannelTask[]): ChannelTask[] {
  const task = tasks.find(x => x.id === taskId)
  if (task === undefined) return []
  return [task, ...tasks.filter(x => x.parent_task === task.id).sort((a, b) => a.id - b.id)]
}

/** Tasks of one owner inside one room block. */
export interface BoardOwnerGroup {
  readonly owner: string
  readonly ownerName: string
  readonly open: readonly ChannelTask[]
  readonly done: readonly ChannelTask[]
}

/** One room block of the board: the chat channel itself, or one of its workspaces. */
export interface BoardSection {
  readonly roomId: number
  readonly name: string
  readonly chat: boolean
  readonly owners: readonly BoardOwnerGroup[]
  readonly open: number
  readonly done: number
}

/**
 * The board grouped as chat channel -> workspace -> owner, the shape the owner asked for:
 * a chat channel's board covers all of its workspaces, and inside each block the tasks are
 * listed per member. A task belongs to the room it was dispatched in (its room_id); the
 * board only reads that, it never infers a room from a name.
 * `chatId` is the chat channel the board belongs to, `roomId` the room being viewed: a
 * workspace shows only its own block, the chat channel shows itself and its workspaces.
 * Rooms without tasks are left out; the viewed room itself always stays, so an empty
 * board still says which room it is.
 */
export function boardSections(tasks: readonly ChannelTask[], rooms: readonly ChannelRoom[], chatId: number | undefined, roomId?: number): BoardSection[] {
  if (chatId === undefined) return []
  const chat = rooms.find(r => r.id === chatId);
  const viewed = roomId === undefined ? undefined : rooms.find(r => r.id === roomId);
  const blocks: { id: number; name: string; chat: boolean }[] = viewed?.kind === 'workspace'
    ? [{ id: viewed.id, name: viewed.name, chat: false }]
    : [
      { id: chatId, name: chat?.name ?? String(chatId), chat: true },
      ...rooms.filter(r => r.kind === 'workspace' && r.parent_id === chatId).map(r => ({ id: r.id, name: r.name, chat: false })),
    ];
  const sections: BoardSection[] = [];
  for (const block of blocks) {
    const mine = boardOrder(tasks.filter(task => task.room_id === block.id));
    if (block.id !== roomId && !block.chat && mine.length === 0) continue;
    const byOwner = new Map<string, { open: ChannelTask[]; done: ChannelTask[] }>();
    for (const task of mine) {
      let group = byOwner.get(task.owner);
      if (group === undefined) {
        group = { open: [], done: [] };
        byOwner.set(task.owner, group);
      }
      (task.status === 'done' ? group.done : group.open).push(task);
    }
    const owners: BoardOwnerGroup[] = [...byOwner].map(([owner, group]) => ({
      owner, ownerName: (group.open[0] ?? group.done[0]).owner_name, open: group.open, done: group.done,
    }));
    sections.push({
      roomId: block.id, name: block.name, chat: block.chat, owners,
      open: owners.reduce((n, g) => n + g.open.length, 0),
      done: owners.reduce((n, g) => n + g.done.length, 0),
    });
  }
  return sections;
}
