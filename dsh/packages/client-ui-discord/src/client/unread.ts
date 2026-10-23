/**
 * Utilities for tracking read cursors and mention / reply detection (#145).
 */
import type { ChannelMember, ChannelMessage } from './channel-source'

const STORAGE_KEY_CURSORS = 'bothouse:channel_read_cursors'

let memoryStorage: Record<string, string> | undefined

function getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('__test__')
      return localStorage
    }
  } catch {}
  if (!memoryStorage) memoryStorage = {}
  return {
    getItem: k => memoryStorage![k] ?? null,
    setItem: (k, v) => { memoryStorage![k] = v },
  }
}

/** Load per-room read cursors from localStorage (room_id -> highest read message_id). */
export function loadReadCursors(): Record<number, number> {
  const storage = getStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(STORAGE_KEY_CURSORS)
    if (!raw) return {}
    return JSON.parse(raw) as Record<number, number>
  } catch {
    return {}
  }
}

/** Persist per-room read cursors to localStorage. */
export function saveReadCursors(cursors: Record<number, number>): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY_CURSORS, JSON.stringify(cursors))
  } catch {
    // ignore quota/disabled errors
  }
}

/** Whether the current document is in the background or hidden. */
export function isWindowBackground(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Determine whether a message mentions the human owner or is an AI reply to the owner.
 * Mirrored from mention rules and reply routing:
 * 1. AI reply to a user message (`reply_to.author_kind === 'user'` or `reply_to.author === meId`);
 * 2. @-mention in text addressing the user's name or id.
 */
export function isMentionOrReply(
  msg: ChannelMessage,
  meId: string | undefined,
  members: readonly ChannelMember[],
): boolean {
  // A user's own message never notifies or mentions themselves.
  if (msg.author_kind === 'user') return false

  // 1. AI reply addressing the user:
  if (msg.reply_to !== undefined && msg.reply_to.deleted !== true) {
    const q = msg.reply_to
    if (q.author_kind === 'user' || q.author === 'owner' || (meId !== undefined && q.author === meId)) {
      return true
    }
  }

  // 2. Mention in message text:
  const targetId = meId ?? 'owner'
  const me = members.find(m => m.id === targetId || m.kind === 'human')
  const names = new Set<string>()
  names.add('owner')
  if (targetId) names.add(targetId)
  if (me?.name) names.add(me.name)

  const text = msg.text
  // Check for @name or <@name>
  for (const name of names) {
    if (!name) continue
    const escaped = escapeRegExp(name)
    // Matches @name, <@name>, @name: or at start/end/boundaries
    const pattern = new RegExp(`(?:^|\\s|[<（(])@!?${escaped}(?:[>）)，,：:！!？?、～~\\s]|$)`, 'i')
    if (pattern.test(text)) return true
  }

  return false
}
