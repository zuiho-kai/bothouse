// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskBoard } from '../src/client/TaskBoard.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { T } from '../src/client/task-board.ts'
import type { ChannelTask } from '../src/client/channel-source.ts'

afterEach(cleanup)
it('keeps all Chinese and English locale keys present and nonempty', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    expect(zh[key].trim().length, key).toBeGreaterThan(0)
    expect(en[key].trim().length, key).toBeGreaterThan(0)
  }
})
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
      expect(dialog.querySelectorAll('li')).toHaveLength(1)
      fireEvent.click(within(dialog).getByRole('tab', { name: `${dict.taskTabAll} 101` }))
      expect(within(dialog).getByText('Workspace 1')).toBeTruthy()
      expect(dialog.querySelectorAll('[data-owner="a"]')).toHaveLength(2)
      expect(within(dialog).getByText(t('taskBoardScope', { room: 'General', channel: '1', workspaces: '100' }))).toBeTruthy()
      expect(dialog.querySelectorAll('li')).toHaveLength(101)
      expect(dialog.querySelector('details')).toBeNull()
      expect(dialog.querySelector('[data-task-id="1"]')?.closest('details')).toBeNull()
      fireEvent.click(within(dialog.querySelector('[data-task-id="1"]') as HTMLElement).getByRole('button', { name: dict.taskOpenAssign }))
      expect(onOpen).toHaveBeenLastCalledWith(1, 5)
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(trigger)
      const reopened = screen.getByRole('dialog')
      fireEvent.click(within(reopened).getByRole('tab', { name: `${dict.taskTabDone} 100` }))
      fireEvent.click(within(reopened.querySelector('[data-task-id="2"]') as HTMLElement).getByRole('button', { name: dict.taskOpenResult }))
      expect(onOpen).toHaveBeenLastCalledWith(10, 6)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('counts and filters every status bucket within the selected channel', () => {
      const statuses = ['assigned', 'accepted', 'asked', 'rework', 'returned', 'declined', 'escalated', 'done'] as const
      render(<TaskBoard tasks={[...statuses.map((status, i) => task(i + 1, { status })), task(99, { room_id: 99 })]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: dict.taskBoardOpen }))
      const tabs = screen.getAllByRole('tab')
      expect(tabs.map(tab => tab.textContent)).toEqual([`${dict.taskTabAll} 8`, `${dict.taskTabWorking} 4`, `${dict.taskTabReview} 3`, `${dict.taskTabDone} 1`])
      expect(tabs[1].getAttribute('aria-selected')).toBe('true')
      const ids = () => Array.from(screen.getByRole('tabpanel').querySelectorAll('[data-task-id]')).map(node => Number(node.getAttribute('data-task-id'))).sort()
      expect(ids()).toEqual([1, 2, 3, 4])
      fireEvent.click(tabs[2])
      expect(ids()).toEqual([5, 6, 7])
      fireEvent.click(tabs[3])
      expect(ids()).toEqual([8])
      fireEvent.click(tabs[0])
      expect(ids()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })
    it('shows a named empty state and switches tabs with arrow keys, including wraparound', () => {
      render(<TaskBoard tasks={[task(1)]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: dict.taskBoardOpen }))
      const tabs = screen.getAllByRole('tab')
      tabs[1].focus()
      fireEvent.keyDown(tabs[1], { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tabs[2])
      expect(tabs[2].getAttribute('aria-selected')).toBe('true')
      expect(screen.getByRole('tabpanel').textContent).toBe(t('taskTabEmpty', { tab: dict.taskTabReview }))
      fireEvent.keyDown(tabs[2], { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(tabs[1])
      fireEvent.keyDown(tabs[1], { key: 'Home' })
      fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(tabs[3])
      fireEvent.keyDown(tabs[3], { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tabs[0])
      expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id)
    })
    it('unmounts the dialog before invoking dispatch and delivery jumps', () => {
      const onOpen = vi.fn(() => { expect(screen.queryByRole('dialog')).toBeNull() })
      render(<TaskBoard tasks={[task(1)]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={onOpen} />)
      for (const name of [dict.taskOpenAssign, dict.taskOpenResult]) {
        fireEvent.click(screen.getByRole('button', { name: dict.taskBoardOpen }))
        fireEvent.click(screen.getByRole('button', { name }))
      }
      expect(onOpen.mock.calls).toEqual([[1, 5], [1, 6]])
    })
    it('traps focus on the selected tab and close button and closes on channel changes', () => {
      const p = { tasks: [task(1)], rooms, chatId: 1, roomId: 1, t, onOpen: vi.fn() }
      const { rerender } = render(<TaskBoard {...p} />)
      fireEvent.click(screen.getByRole('button', { name: dict.taskBoardOpen }))
      const dialog = screen.getByRole('dialog')
      const close = within(dialog).getByRole('button', { name: dict.close })
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getAllByRole('tab')[1])
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(close)
      fireEvent.keyDown(close, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getAllByRole('tab')[1])
      rerender(<TaskBoard {...p} roomId={10} />)
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

it('downloads delivered files and links an existing original through the task board', async () => {
  const t = ((key: keyof typeof zh) => zh[key]) as T
  const result = { id: 3, attachment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: '/collab/api/attachments/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'deliverable' as const,
    label: null, name: 'result.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 4096 }
  const candidate = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', message_id: 23,
    name: 'original.xlsx', mime: result.mime, size: 2048 }
  const onListFiles = vi.fn().mockResolvedValue({ files: [result], candidates: [candidate] })
  const onAttachFile = vi.fn().mockResolvedValue(undefined)
  render(<TaskBoard tasks={[task(1, { files: [result] })]} rooms={rooms} chatId={1} roomId={1} t={t}
    onOpen={vi.fn()} onListFiles={onListFiles} onAttachFile={onAttachFile} />)
  fireEvent.click(screen.getByRole('button', { name: zh.taskBoardOpen }))
  const link = screen.getByRole('link', { name: /result.xlsx/ }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toContain(result.attachment_id)
  expect(link.getAttribute('download')).toBe('result.xlsx')
  fireEvent.click(screen.getByRole('button', { name: zh.taskFileAddSource }))
  await vi.waitFor(() => expect(onListFiles).toHaveBeenCalledWith(1))
  fireEvent.change(await screen.findByRole('combobox', { name: zh.taskFileChoose }), { target: { value: candidate.id } })
  fireEvent.change(screen.getByRole('textbox', { name: zh.taskFileLabel }), { target: { value: '原始账本' } })
  fireEvent.click(screen.getByRole('button', { name: zh.messageSave }))
  await vi.waitFor(() => expect(onAttachFile).toHaveBeenCalledWith(1, candidate.id, '原始账本'))
})

it('offers explicit owner acceptance and requires a reason for rework', async () => {
  const onReview = vi.fn().mockResolvedValue(undefined)
  const t = ((key: keyof typeof zh) => zh[key]) as T
  render(<TaskBoard tasks={[task(1, { status: 'returned' })]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} onReview={onReview} />)
  fireEvent.click(screen.getByRole('button', { name: zh.taskBoardOpen }))
  fireEvent.click(screen.getByRole('tab', { name: `${zh.taskTabReview} 1` }))
  fireEvent.click(screen.getByRole('button', { name: zh.taskApprove }))
  await vi.waitFor(() => expect(onReview).toHaveBeenCalledWith(1, 'done', undefined))
  await vi.waitFor(() => expect((screen.getByRole('button', { name: zh.taskSendBack }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: zh.taskSendBack }))
  expect((screen.getByRole('button', { name: zh.taskReviewSubmit }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(zh.taskReviewReason), { target: { value: 'missing evidence' } })
  fireEvent.click(screen.getByRole('button', { name: zh.taskReviewSubmit }))
  await vi.waitFor(() => expect(onReview).toHaveBeenLastCalledWith(1, 'rework', 'missing evidence'))
})

it('keeps a rejected acceptance visible for retry', async () => {
  const t = ((key: keyof typeof zh) => zh[key]) as T
  render(<TaskBoard tasks={[task(1, { status: 'returned' })]} rooms={rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} onReview={vi.fn().mockRejectedValue(new Error('permission denied'))} />)
  fireEvent.click(screen.getByRole('button', { name: zh.taskBoardOpen }))
  fireEvent.click(screen.getByRole('tab', { name: `${zh.taskTabReview} 1` }))
  fireEvent.click(screen.getByRole('button', { name: zh.taskApprove }))
  await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('permission denied'))
  expect(screen.getByText('#1 Task 1')).toBeTruthy()
})
