import { describe, expect, it } from 'vitest'
import { boardGroups, cardMembers, elapsed, formatDuration, STATUS_KEY, type T } from '../src/client/task-board.ts'
import type { ChannelTask, TaskStatus } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))) as unknown as T

function task(id: number, status: TaskStatus, extra: Partial<ChannelTask> = {}): ChannelTask {
  return {
    id, room_id: 1, parent_task: null, title: 'task ' + id, owner: 'o' + id, owner_name: 'owner ' + id,
    created_by: 'ju', created_by_name: '橘', status, next_check_at: null, assign_msg_id: null, result_msg_id: null,
    note: null, created_at: 1000, updated_at: 1000, returned_at: null, ...extra,
  }
}

describe('task board', () => {
  it('puts the owner-turn statuses first, then waiting for the lead, newest first, and done apart', () => {
    const tasks = [task(1, 'done'), task(2, 'returned'), task(3, 'assigned'), task(4, 'rework'), task(5, 'declined'), task(6, 'asked'), task(7, 'accepted'), task(8, 'escalated')]
    const { open, done } = boardGroups(tasks)
    expect(open.map(x => x.id)).toEqual([7, 6, 4, 3, 8, 5, 2])
    expect(done.map(x => x.id)).toEqual([1])
    expect(boardGroups([])).toEqual({ open: [], done: [] })
  })

  it('labels every status', () => {
    for (const key of Object.values(STATUS_KEY)) expect(zh[key]).toBeTruthy()
  })

  it('lists the task owner then each sub-task in dispatch order on the card', () => {
    const tasks = [task(1, 'accepted'), task(4, 'returned', { parent_task: 1 }), task(3, 'assigned', { parent_task: 1 }), task(5, 'assigned', { parent_task: 2 })]
    expect(cardMembers(1, tasks).map(x => x.id)).toEqual([1, 3, 4])
    expect(cardMembers(9, tasks)).toEqual([])
  })

  it('times a task until hand-back, until it closed, or until now', () => {
    expect(elapsed(task(1, 'accepted'), 1090)).toBe(90)
    expect(elapsed(task(1, 'returned', { returned_at: 1600 }), 9999)).toBe(600)
    expect(elapsed(task(1, 'done', { updated_at: 1300 }), 9999)).toBe(300)
    expect(elapsed(task(1, 'assigned'), 500)).toBe(0)
    expect(formatDuration(42, t)).toBe('42 秒')
    expect(formatDuration(600, t)).toBe('10 分钟')
    expect(formatDuration(3600 + 1800, t)).toBe('1 小时 30 分')
  })
})
