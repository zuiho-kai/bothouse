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

export const AVATAR_STYLE_CHANNEL = 'bothouse-avatar-style'
const SETTINGS_PATH = 'collab/panel/api/v1/settings'

let current: AvatarStyle = DEFAULT_AVATAR_STYLE
let started = false
const listeners = new Set<() => void>()

export function setAvatarStyle(style: AvatarStyle): void {
  if (style === current) return
  current = style
  for (const fn of listeners) fn()
}

export function avatarStyle(): AvatarStyle {
  return current
}

/** Reads the stored set once and listens for switches from the panel. */
export function startAvatarStyle(fetchImpl: typeof fetch = globalThis.fetch): void {
  if (started) return
  started = true
  try {
    const ch = new BroadcastChannel(AVATAR_STYLE_CHANNEL)
    ch.onmessage = (e: MessageEvent) => { setAvatarStyle(normalizeAvatarStyle(e.data)) }
  } catch (error) { void error /* no BroadcastChannel: the next page load picks the switch up */ }
  if (typeof fetchImpl !== 'function') return
  fetchImpl(SETTINGS_PATH, { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : undefined))
    .then((s: { avatar_style?: unknown } | undefined) => { if (s !== undefined) setAvatarStyle(normalizeAvatarStyle(s.avatar_style)) })
    .catch((error: unknown) => { void error /* bothouse not reachable: keep the default set */ })
}

export function useAvatarStyle(): AvatarStyle {
  useEffect(() => { startAvatarStyle() }, [])
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    avatarStyle,
    avatarStyle,
  )
}
