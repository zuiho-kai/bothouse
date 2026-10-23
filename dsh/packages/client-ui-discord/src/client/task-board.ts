/**
 * Team mode B (#139) board model, free of React so it is testable without a DOM:
 * status labels, board grouping and order, task-card member rows, elapsed time.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelTask, TaskStatus } from './channel-source.ts'
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
