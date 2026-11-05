/**
 * Pure helpers for the channel page's motion and reading position (#115):
 * which rows arrived live (and so animate in once), and how many unread rows
 * sit below the reader. Kept apart from the component so they test without a DOM.
 */
import type { ChannelMessage } from './channel-source.ts'

/** Consecutive live rows stagger in; past this many they all start together. 来源：notes/ui/design-spec-channels.md §4「连续 5 条内 18ms stagger」 */
export const ENTER_STAGGER_MAX = 5
/** Delay between staggered rows, ms. 来源：同上 design-spec-channels.md §4 */
export const ENTER_STAGGER_MS = 18
/** How long a withdrawal can still be undone, ms. 来源：用户 11-03 23:1x 同意「撤回不弹确认、底部 5 秒撤销条」 */
export const WITHDRAW_UNDO_MS = 5000

export interface LiveTracker {
  roomId: number | undefined
  /** Highest id already on screen when the room was first filled or last seen. */
  maxId: number
  /** Live rows of this room and their stagger slot. */
  fresh: Map<number, number>
}

export function createLiveTracker(): LiveTracker {
  return { roomId: undefined, maxId: Number.NEGATIVE_INFINITY, fresh: new Map() }
}

/**
 * Record which rows of `messages` arrived live. The first fill of a room, a
 * room switch and older pages (ids below the known maximum) never animate.
 */
export function trackLive(tracker: LiveTracker, roomId: number | undefined, messages: readonly ChannelMessage[]): ReadonlyMap<number, number> {
  const last = messages.length === 0 ? Number.NEGATIVE_INFINITY : (messages[messages.length - 1] as ChannelMessage).id
  if (tracker.roomId !== roomId || tracker.maxId === Number.NEGATIVE_INFINITY) {
    tracker.roomId = roomId
    tracker.maxId = last
    tracker.fresh = new Map()
    return tracker.fresh
  }
  let slot = 0
  for (const m of messages) {
    if (m.id <= tracker.maxId || tracker.fresh.has(m.id)) continue
    tracker.fresh.set(m.id, Math.min(slot, ENTER_STAGGER_MAX))
    slot++
  }
  if (last > tracker.maxId) tracker.maxId = last
  return tracker.fresh
}

/** Rows from `fromId` on that someone else wrote: what the "back to latest" pill counts. */
export function unreadCount(messages: readonly ChannelMessage[], fromId: number): number {
  return messages.filter(m => m.id >= fromId && m.author_kind !== 'user').length
}

/** The last message you wrote that can still be edited (no card, not being withdrawn). */
export function lastOwnEditable(messages: readonly ChannelMessage[], skipId: number | undefined): ChannelMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChannelMessage
    if (m.author_kind === 'user' && m.card === null && m.id !== skipId) return m
  }
  return undefined
}

/** Whether the reader asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
