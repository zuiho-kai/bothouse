/**
 * #1447: the address bar names the open main panel, and a reload reopens it.
 *
 * Before this, a panel selection lived only in memory: clicking 插件 or 自动化任务 left the URL
 * alone, so a reload (or a copied link) fell back to a new conversation. Only `#channels` worked,
 * and only because the setup wizard opens that exact link.
 *
 * Two halves, both here rather than in ui-plugin-manager / ui-schedule (upstream npm packages this
 * repo does not patch): every selection is mirrored into the fragment with `history.replaceState`,
 * and a load reads the fragment back once the panel is registered. This plugin is part of every
 * install (the channels page), so it sees upstream panels as well as the bothouse ones.
 */
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Shape the fragment may take: one sidebar key (`plugins`, `schedules`, `collab-desk`, …). */
const PANEL_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/

/** The main-panel id a fragment names; `null` for an empty or unrecognised one. */
export function panelIdFromHash(hash: string): MainPanelId | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return PANEL_ID.test(raw) ? raw as MainPanelId : null
}

/** The root store's panel selection source (ui-layout's `ctx.layout.panelInfo`). */
export interface PanelInfoSource {
  getSnapshot(): { readonly activePanelId: MainPanelId | null }
  subscribe(listener: () => void): () => void
}

/** What mirroring and restoring need from `ctx.layout`. */
export interface PanelLayout {
  readonly panelInfo: PanelInfoSource
  selectPanel(panelId: MainPanelId | null): void
}

/** What restoring needs from `ctx.slots` (the main-slot registry). */
export interface PanelSlots {
  entriesOfSlot(slot: string): readonly { options: { key?: string } }[]
  subscribe(slot: string, listener: () => void): () => void
}

/** The address of the current page with `id` as its fragment: query (the wizard token) untouched. */
function addressFor(id: MainPanelId | null): string {
  return `${location.pathname}${location.search}${id === null ? '' : `#${id}`}`
}

/**
 * Mirror every later panel selection into the fragment; the returned function stops following.
 * Opening a panel writes `#<id>`, going back to the conversation clears it.
 * @param layout - `ctx.layout` (panel selection and its shared source).
 * @returns unsubscribe.
 */
export function followPanelHash(layout: PanelLayout): () => void {
  const source = layout.panelInfo
  let last = source.getSnapshot().activePanelId
  return source.subscribe(() => {
    const next = source.getSnapshot().activePanelId
    if (next === last) return
    last = next
    // Reading the address before writing keeps a panel opened twice (this plugin and the package
    // that owns it both restoring the same fragment) from adding history entries.
    if (addressFor(next) === `${location.pathname}${location.search}${location.hash}`) return
    // replaceState, not `location.hash =`: the latter pushes an entry per panel, so browser Back
    // would walk through every panel visited instead of leaving the page.
    history.replaceState(history.state, '', addressFor(next))
  })
}

/** Whether a keyed `main` panel with this id is registered right now. */
function hasMainPanel(slots: PanelSlots, id: MainPanelId): boolean {
  return slots.entriesOfSlot('main').some(entry => entry.options.key === id)
}

/**
 * Open the panel the fragment names, once its package has registered it; the returned function
 * stops waiting. Panels register when their own browser half loads, which can be after this
 * plugin: `layout.selectPanel` throws for a main key that is not registered yet (see
 * bothouse-dsh-panel/client.js), so this waits for the registration instead of firing once.
 * @param layout - `ctx.layout`.
 * @param slots - `ctx.slots` (main-slot registry and its change subscription).
 * @param hash - the fragment to honour; defaults to the current address.
 * @returns unsubscribe from the pending restore.
 */
export function restorePanelFromHash(layout: PanelLayout, slots: PanelSlots, hash: string = location.hash): () => void {
  const id = panelIdFromHash(hash)
  if (id === null) return () => {}
  if (hasMainPanel(slots, id)) {
    layout.selectPanel(id)
    return () => {}
  }
  // Another half may have opened the panel before this one ran (each package still restores its
  // own id at load, and so does this one when the fragment is its own).
  if (layout.panelInfo.getSnapshot().activePanelId !== null) return () => {}
  let stopWaiting: () => void = () => {}
  let stopWatching: () => void = () => {}
  const done = () => { stopWaiting(); stopWatching() }
  stopWaiting = slots.subscribe('main', () => {
    if (!hasMainPanel(slots, id)) return
    // Stop before selecting: the selection below notifies `panelInfo`, whose watcher would
    // otherwise treat it as someone else's choice. A panel already open (another half restored
    // this very fragment) is left alone, so no panel is selected twice.
    done()
    if (layout.panelInfo.getSnapshot().activePanelId === null) layout.selectPanel(id)
  })
  // Any selection made while we wait wins: a panel the reader opened (or went back from) must not
  // be flipped back, and a panel another half restored must not be opened twice.
  stopWatching = layout.panelInfo.subscribe(done)
  return done
}