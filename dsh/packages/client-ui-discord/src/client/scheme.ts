// 体检 #11 (11-05「都修一下」): with the DSH theme service present the page follows the host's
// light/dark, and the page's switch sets the host theme too, so the DSH sidebar and the page
// never show two schemes side by side. Without it (tests, standalone) the rules below apply.
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

/** The DSH host theme, when the theme service is there. */
export interface HostTheme {
  scheme(): Scheme
  set(next: Scheme): void
  subscribe(fn: () => void): () => void
}
let host: HostTheme | undefined

function notify(): void { for (const fn of listeners) fn() }

/** Follow the host theme from now on; the returned function lets go of it. */
export function bindHostTheme(next: HostTheme): () => void {
  host = next
  current = next.scheme()
  notify()
  const off = next.subscribe(() => {
    if (host !== next) return
    current = next.scheme()
    notify()
  })
  return () => {
    off()
    if (host !== next) return
    host = undefined
    current = undefined
    notify()
  }
}

export function getScheme(): Scheme { return current ??= readStored() }

export function setScheme(next: Scheme): void {
  current = next
  if (host !== undefined) {
    try { host.set(next) } catch (error) { void error /* host refused: keep the page's own choice */ }
  }
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
