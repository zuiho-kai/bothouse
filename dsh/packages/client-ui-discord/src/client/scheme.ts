// Plugin-owned colour scheme. The user's direction (11-03「学一下这种设计？ 白色」,
// 11-04 10:48「白色整体风格…这些你来做」) is a white page by default, regardless of the
// DSH host/system dark setting; a manual switch is remembered in this plugin's own
// storage only — the host theme is never written.
import { useSyncExternalStore } from 'react'
import './scheme.css'

export type Scheme = 'light' | 'dark'
export const SCHEME_KEY = 'dsh-channels-scheme'
export const DEFAULT_SCHEME: Scheme = 'light'

const listeners = new Set<() => void>()
let current: Scheme | undefined

function readStored(): Scheme {
  try {
    const raw = globalThis.localStorage?.getItem(SCHEME_KEY)
    return raw === 'dark' || raw === 'light' ? raw : DEFAULT_SCHEME
  } catch (error) { void error /* storage unavailable: default */ ; return DEFAULT_SCHEME }
}

export function getScheme(): Scheme { return current ??= readStored() }

export function setScheme(next: Scheme): void {
  current = next
  try { globalThis.localStorage?.setItem(SCHEME_KEY, next) } catch (error) { void error /* storage unavailable: keep the choice in memory */ }
  for (const fn of listeners) fn()
}

/** Test hook: forget the cached choice so the next read goes back to storage. */
export function resetSchemeCache(): void { current = undefined }

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Current plugin scheme; put it on every plugin root as data-dc-scheme (page and body portals). */
export function useScheme(): Scheme { return useSyncExternalStore(subscribe, getScheme, getScheme) }
