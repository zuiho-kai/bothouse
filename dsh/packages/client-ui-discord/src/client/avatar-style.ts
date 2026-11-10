/**
 * Which built-in avatar set members without their own avatar show (#602). The value lives in the
 * bothouse config ([display] avatar_style), read through this DSH's panel forwarder
 * (dsh/collab/panel.mjs, `collab/panel/api/v1/settings`), so the channel page and the web panel
 * show the same set. No bothouse, not the owner, or any error: the default brand set.
 * The embedded panel announces a switch on the `bothouse-avatar-style` BroadcastChannel
 * (bridge/web/src/lib/avatarMap.ts), so the page follows without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { DEFAULT_AVATAR_STYLE, normalizeAvatarStyle, type AvatarStyle } from './avatars.ts'
import { localCollabUrl, useCollabUrl, type CollabUrl } from './collab-url.ts'

export const AVATAR_STYLE_CHANNEL = 'bothouse-avatar-style'
const SETTINGS_PATH = 'collab/panel/api/v1/settings'

interface StyleState {
  current: AvatarStyle
  started: boolean
  listeners: Set<() => void>
  channel?: BroadcastChannel
}
const targets = new Map<string, StyleState>()

function stateFor(url: CollabUrl): StyleState {
  const path = url(SETTINGS_PATH)
  let state = targets.get(path)
  if (!state) {
    state = { current: DEFAULT_AVATAR_STYLE, started: false, listeners: new Set() }
    targets.set(path, state)
  }
  return state
}

export function setAvatarStyle(style: AvatarStyle, url: CollabUrl = localCollabUrl): void {
  const state = stateFor(url)
  if (style === state.current) return
  state.current = style
  for (const fn of state.listeners) fn()
}

/** Tests only: forget the read so the next startAvatarStyle reads again. */
export function resetAvatarStyleForTest(): void {
  for (const state of targets.values()) state.channel?.close()
  targets.clear()
}

export function avatarStyle(url: CollabUrl = localCollabUrl): AvatarStyle {
  return stateFor(url).current
}

/** Reads the stored set once and listens for switches from the panel. */
export function startAvatarStyle(fetchImpl: typeof fetch = globalThis.fetch, url: CollabUrl = localCollabUrl): void {
  const state = stateFor(url)
  if (state.started) return
  state.started = true
  const path = url(SETTINGS_PATH)
  // Follow the existing remote forwarder's link identity; local panels keep the original channel.
  const link = path.match(/(?:^|\/)collab\/remote\/([^/]+)\/panel\//)?.[1]
  try {
    const ch = new BroadcastChannel(link ? `${AVATAR_STYLE_CHANNEL}:${link}` : AVATAR_STYLE_CHANNEL)
    state.channel = ch
    ch.onmessage = (e: MessageEvent) => { setAvatarStyle(normalizeAvatarStyle(e.data), url) }
  } catch (error) { void error /* no BroadcastChannel: the next page load picks the switch up */ }
  if (typeof fetchImpl !== 'function') return
  fetchImpl(path, { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : undefined))
    // The management API answers { data: { …settings } } (bridge/core/management.go mgmtJSON).
    .then((s: { data?: { avatar_style?: unknown } } | undefined) => { if (s?.data !== undefined) setAvatarStyle(normalizeAvatarStyle(s.data.avatar_style), url) })
    .catch((error: unknown) => { void error /* bothouse not reachable: keep the default set */ })
}

export function useAvatarStyle(): AvatarStyle {
  const url = useCollabUrl()
  const state = stateFor(url)
  useEffect(() => { startAvatarStyle(globalThis.fetch, url) }, [url])
  return useSyncExternalStore(
    fn => { state.listeners.add(fn); return () => { state.listeners.delete(fn) } },
    () => state.current,
    () => state.current,
  )
}
