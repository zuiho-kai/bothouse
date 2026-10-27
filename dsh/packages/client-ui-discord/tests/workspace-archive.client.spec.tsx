// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { WorkspaceHistory } from '../src/client/WorkspaceHistory.tsx'
import { createChannelSource, type ArchivedWorkspace, type ChannelSnapshot, type ChannelTransport } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh) => zh[key]) as ChannelsPageProps['t']
const archived: ArchivedWorkspace = { id: 1000000, name: '工作区1', parent_id: 1, parent_name: '原频道', archived_at: 50, task_count: 2, last_activity_at: 30 }

it('history opens below the board, shows fields, restores a row and displays the empty state', async () => {
  const restore = vi.fn(async () => {})
  render(<WorkspaceHistory list={async () => [archived]} restore={restore} t={t} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.archivedWorkspaces })) })
  const dialog = screen.getByRole('dialog', { name: zh.archivedWorkspaces })
  expect(within(dialog).getByText('工作区1')).toBeTruthy()
  expect(within(dialog).getByText('原频道')).toBeTruthy()
  expect(within(dialog).getByText('2')).toBeTruthy()
  expect(within(dialog).getByText(new Date(50000).toLocaleString())).toBeTruthy()
  expect(within(dialog).getByText(new Date(30000).toLocaleString())).toBeTruthy()
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: zh.restoreWorkspace })) })
  expect(restore).toHaveBeenCalledWith(archived.id)
  expect(within(dialog).getByText(zh.archivedEmpty)).toBeTruthy()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('history displays load and restore errors and can retry a failed restore', async () => {
  const restore = vi.fn().mockRejectedValueOnce(new Error('恢复失败')).mockResolvedValueOnce(undefined)
  const list = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce([archived])
  render(<WorkspaceHistory list={list} restore={restore} t={t} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.archivedWorkspaces })) })
  expect(screen.getByRole('alert').textContent).toBe('读取失败')
  fireEvent.click(screen.getByRole('button', { name: zh.close }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.archivedWorkspaces })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.restoreWorkspace })) })
  expect(screen.getByRole('alert').textContent).toBe('恢复失败')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.restoreWorkspace })) })
  expect(screen.getByText(zh.archivedEmpty)).toBeTruthy()
})

function props(unfinished: number): ChannelsPageProps {
  const state = { phase: 'ready', rooms: [{ id: 1, name: '原频道' }, { id: 1000000, kind: 'workspace', parent_id: 1, name: '工作区1', unfinished }], roomId: 1000000, members: [], messages: [], tasks: [], thinking: {}, leadId: null } as ChannelSnapshot
  return { useChannels: (select: (snapshot: ChannelSnapshot) => unknown) => select(state), t,
    archiveWorkspace: vi.fn(async () => {}), listArchivedWorkspaces: async () => [], unarchiveWorkspace: async () => {},
  } as unknown as ChannelsPageProps
}

it('workspace settings disable archive for unfinished tasks and show the Chinese explanation', () => {
  render(<ChannelsPage {...props(1)} />)
  const board = screen.getByRole('button', { name: zh.taskBoardOpen })
  const history = screen.getByRole('button', { name: zh.archivedWorkspaces })
  expect(board.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.channelSettings }))
  expect((screen.getByRole('button', { name: zh.archiveWorkspace }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(zh.archiveBlocked)).toBeTruthy()
})

it('completed workspace archives from its own settings', async () => {
  const p = props(0)
  render(<ChannelsPage {...p} />)
  fireEvent.click(screen.getByRole('button', { name: zh.channelSettings }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.archiveWorkspace })) })
  expect(p.archiveWorkspace).toHaveBeenCalledWith(1000000)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('transport archives the selected workspace, returns to parent, then restores without changing channel', async () => {
  const rooms = [{ id: 1, name: '原频道' }, { id: archived.id, name: archived.name, kind: 'workspace', parent_id: 1 }]
  let visible = rooms
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const transport: ChannelTransport = {
    url: path => path,
    openEvents: () => ({ onopen: null, onmessage: null, onerror: null, close() {} }),
    fetch: vi.fn(async (url, init) => {
      if (url.endsWith('/state')) return reply({ rooms: visible, members: [], thinking: {} })
      if (url.endsWith('/unarchive')) { expect(init?.method).toBe('POST'); return reply({ rooms }) }
      if (url.endsWith('/archive')) { expect(init?.method).toBe('POST'); visible = [rooms[0]]; return reply({ rooms: visible }) }
      if (url.endsWith('/archived')) return reply({ workspaces: [archived] })
      if (url.endsWith('/tasks')) return reply({ chat_id: 1, tasks: [] })
      return reply({ messages: [] })
    }),
  }
  const { source, actions, dispose } = createChannelSource(transport)
  const unsubscribe = source.subscribe(() => {})
  await vi.waitFor(() => expect(source.getSnapshot().phase).toBe('ready'))
  await actions.selectRoom(archived.id)
  await actions.archiveWorkspace(archived.id)
  expect(source.getSnapshot().roomId).toBe(1)
  expect(source.getSnapshot().rooms.map(r => r.id)).toEqual([1])
  expect(await actions.listArchivedWorkspaces()).toEqual([archived])
  await actions.unarchiveWorkspace(archived.id)
  expect(source.getSnapshot().roomId).toBe(1)
  expect(source.getSnapshot().rooms[1].parent_id).toBe(1)
  unsubscribe(); dispose()
})
