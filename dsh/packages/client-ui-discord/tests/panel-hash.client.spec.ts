// @vitest-environment jsdom
// #1447: switching panels by sidebar left the address bar alone, so a reload fell back to a new
// conversation; only `#channels` came back, because the setup wizard opens that exact link.
// These checks pin both halves: selections mirror into the fragment, and a load reopens what the
// fragment names — including panels of the upstream packages this repo does not patch.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { followPanelHash, panelIdFromHash, restorePanelFromHash, type PanelSlots } from '../src/client/panel-hash.ts'
import { fakePanelInfo, type FakePanelInfo } from './helpers/fake-panel-info.ts'

const PANEL_ID = 'channels' as MainPanelId
const PLUGINS = 'plugins' as MainPanelId
const SCHEDULES = 'schedules' as MainPanelId

/** A main-slot registry whose registrations the test can add and which reports them. */
function fakeSlots(registered: string[] = []) {
  const keys = [...registered]
  const listeners = new Set<() => void>()
  const slots: PanelSlots & { register(key: string): void } = {
    entriesOfSlot: () => keys.map(key => ({ options: { key } })),
    subscribe: (_slot, listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    register: (key) => { keys.push(key); for (const listener of [...listeners]) listener() },
  }
  return slots
}

/** A layout whose selectPanel records the call and publishes it through the shared source. */
function fakeLayout(panel: FakePanelInfo) {
  const calls: (MainPanelId | null)[] = []
  return {
    panelInfo: panel,
    selectPanel: (id: MainPanelId | null) => { calls.push(id); panel.select(id) },
    calls,
  }
}

/** Point the window at a fragment without navigating (jsdom throws "Not implemented" on navigation). */
function at(hash: string) {
  history.replaceState(null, '', `/${location.search}${hash}`)
}

beforeEach(() => { at('') })
afterEach(() => { vi.unstubAllGlobals(); at('') })

it('reads one panel id out of the fragment and ignores anything that is not one', () => {
  expect(panelIdFromHash('#plugins')).toBe(PLUGINS)
  expect(panelIdFromHash('#schedules')).toBe(SCHEDULES)
  expect(panelIdFromHash('#collab-desk')).toBe('collab-desk')
  expect(panelIdFromHash('')).toBeNull()
  expect(panelIdFromHash('#')).toBeNull()
  expect(panelIdFromHash('#a/b')).toBeNull()
  expect(panelIdFromHash('#plugins?x=1')).toBeNull()
})

it('writes #<id> when a sidebar panel opens and clears it on the way back to the conversation', () => {
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const stop = followPanelHash(layout)
  try {
    // A selection made by the panel itself (a sidebar row) — not by us.
    layout.selectPanel(PLUGINS)
    expect(location.hash).toBe('#plugins')
    layout.selectPanel(SCHEDULES)
    expect(location.hash).toBe('#schedules')
    layout.selectPanel(null)
    expect(location.hash).toBe('')
    // The token query the setup wizard hands out is not part of the panel state.
    history.replaceState(null, '', '/?token=abc')
    layout.selectPanel(PANEL_ID)
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/?token=abc#channels')
  } finally { stop() }
})

it('adds no history entry per panel, so Back leaves the page instead of walking panels', () => {
  const entries = vi.spyOn(history, 'replaceState')
  const push = vi.spyOn(history, 'pushState')
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const stop = followPanelHash(layout)
  try {
    layout.selectPanel(PLUGINS)
    layout.selectPanel(SCHEDULES)
    expect(entries).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
  } finally { stop(); entries.mockRestore(); push.mockRestore() }
})

it('does not rewrite an address it already matches (a second half restoring the same panel)', () => {
  at('#plugins')
  const entries = vi.spyOn(history, 'replaceState')
  const panel = fakePanelInfo(PLUGINS)
  const layout = fakeLayout(panel)
  const stop = followPanelHash(layout)
  try {
    layout.selectPanel(PLUGINS)
    expect(entries).not.toHaveBeenCalled()
  } finally { stop(); entries.mockRestore() }
})

it('opens the panel an upstream package (#plugins) names, after that package registers it', () => {
  at('#plugins')
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const slots = fakeSlots()
  const stop = restorePanelFromHash(layout, slots, location.hash)
  try {
    // Nothing registered yet: selecting now would throw inside ctx.layout, so the restore waits.
    expect(layout.calls).toEqual([])
    slots.register(PLUGINS)
    expect(layout.calls).toEqual([PLUGINS])
    expect(location.hash).toBe('#plugins')
    expect(panel.listeners).toBe(0)
  } finally { stop() }
})

it('opens a panel that is already registered at load (#schedules) without waiting', () => {
  at('#schedules')
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const stop = restorePanelFromHash(layout, fakeSlots([SCHEDULES]), location.hash)
  try {
    expect(layout.calls).toEqual([SCHEDULES])
    // The restore added no listener of its own beyond the mirroring half.
    expect(panel.listeners).toBe(0)
  } finally { stop() }
})

it('restores the #channels deep link the setup wizard opens', () => {
  at('#channels')
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const stop = restorePanelFromHash(layout, fakeSlots([PANEL_ID]), location.hash)
  try { expect(layout.calls).toEqual([PANEL_ID]) } finally { stop() }
})

it('does nothing for a bare or unrecognised fragment, and stops waiting when the reader picks', () => {
  const panel = fakePanelInfo()
  const layout = fakeLayout(panel)
  const slots = fakeSlots()
  expect(restorePanelFromHash(layout, slots, '')).toBeTypeOf('function')
  expect(layout.calls).toEqual([])

  const stop = restorePanelFromHash(layout, slots, '#plugins')
  expect(panel.listeners).toBe(1)
  // The reader opens the conversation or another panel first; the pending restore lets go.
  layout.selectPanel(null)
  expect(panel.listeners).toBe(0)
  slots.register(PLUGINS)
  expect(layout.calls).toEqual([null])
  stop()
})

it('does not fight a restore another package already finished', () => {
  at('#plugins')
  const panel = fakePanelInfo(PLUGINS)
  const layout = fakeLayout(panel)
  const stop = restorePanelFromHash(layout, fakeSlots(), location.hash)
  try {
    expect(layout.calls).toEqual([])
    expect(panel.listeners).toBe(0)
  } finally { stop() }
})