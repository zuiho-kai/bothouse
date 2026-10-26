// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskBoard } from '../src/client/TaskBoard.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { T } from '../src/client/task-board.ts'
import type { ChannelTask } from '../src/client/channel-source.ts'

afterEach(cleanup)
const rooms = [{ id: 1, name: 'General', kind: 'chat' as const }, { id: 10, name: 'Workspace 1', kind: 'workspace' as const, parent_id: 1 }]
const task = (id: number, extra: Partial<ChannelTask> = {}): ChannelTask => ({
  id, room_id: 1, parent_task: null, title: `Task ${id}`, owner: 'a', owner_name: 'Alice',
  created_by: 'a', created_by_name: 'Alice', status: 'accepted', next_check_at: null,
  assign_msg_id: 5, result_msg_id: 6, note: null, created_at: 1, updated_at: 2, returned_at: null, ...extra,
})
for (const [lang, dict] of [['zh', zh], ['en', en]] as const) {
  const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
    .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), String(dict[key]))) as T
  describe(`task board dialog (${lang})`, () => {
    it('keeps 100 finished tasks outside the sidebar, groups them in the modal and preserves jumps', () => {
      const onOpen = vi.fn()
      const tasks = [task(1), ...Array.from({ length: 100 }, (_, i) => task(i + 2, { room_id: 10, status: 'done' }))]
      const { container } = render(<aside><TaskBoard tasks={tasks} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={onOpen} /></aside>)
      const sidebar = container.querySelector('aside')!
      expect(sidebar.textContent).toContain(t('taskBoardSummary', { open: '1', done: '100' }))
      expect(sidebar.querySelectorAll('li')).toHaveLength(0)
      expect(sidebar.textContent).not.toContain('Task 1')
      const trigger = screen.getByRole('button', { name: t('taskBoardOpen') })
      fireEvent.click(trigger)
      const dialog = screen.getByRole('dialog', { name: `${dict.taskBoard} · General` })
      expect(sidebar.querySelectorAll('li')).toHaveLength(0)
      expect(within(dialog).getByText('Workspace 1')).toBeTruthy()
      expect(within(dialog).getAllByText('Alice')).toHaveLength(2)
      expect(within(dialog).getByText(t('taskBoardScope', { room: 'General', channel: '1', workspaces: '100' }))).toBeTruthy()
      expect(dialog.querySelectorAll('li')).toHaveLength(101)
      expect(dialog.querySelector('details')?.open).toBe(false)
      expect(dialog.querySelector('[data-task-id="1"]')?.closest('details')).toBeNull()
      fireEvent.click(within(dialog.querySelector('[data-task-id="1"]') as HTMLElement).getByRole('button', { name: dict.taskOpenAssign }))
      expect(onOpen).toHaveBeenLastCalledWith(1, 5)
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(trigger)
      const reopened = screen.getByRole('dialog')
      reopened.querySelector('details')!.open = true
      fireEvent.click(within(reopened.querySelector('[data-task-id="2"]') as HTMLElement).getByRole('button', { name: dict.taskOpenResult }))
      expect(onOpen).toHaveBeenLastCalledWith(10, 6)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('opens empty state and closes with button, Escape and backdrop, restoring focus', () => {
      render(<TaskBoard tasks={[]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} />)
      const trigger = screen.getByRole('button', { name: t('taskBoardOpen') })
      expect(trigger.textContent).toContain(dict.taskBoardNoTasks)
      trigger.focus()
      fireEvent.click(trigger)
      expect(within(screen.getByRole('dialog')).getByText(dict.taskBoardEmptyInModal)).toBeTruthy()
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      fireEvent.click(trigger)
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: dict.close }))
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(trigger)
      fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
}
