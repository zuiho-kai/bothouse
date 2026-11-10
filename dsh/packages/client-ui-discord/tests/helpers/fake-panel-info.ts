/** A stand-in for ui-layout's `ctx.layout.panelInfo`: a shared snapshot plus listeners. */
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

export interface FakePanelInfo {
  getSnapshot(): { readonly activePanelId: MainPanelId | null }
  subscribe(listener: () => void): () => void
  /** Select a panel the way ui-layout's action does, notifying subscribers once. */
  select(panelId: MainPanelId | null): void
  /** How many listeners are attached right now (a finished restore must leave none). */
  readonly listeners: number
}

/** Build a panel-info source starting on the given panel (default: the conversation). */
export function fakePanelInfo(initial: MainPanelId | null = null): FakePanelInfo {
  let activePanelId = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ activePanelId }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select: (panelId) => {
      activePanelId = panelId
      for (const listener of [...listeners]) listener()
    },
    get listeners() { return listeners.size },
  }
}