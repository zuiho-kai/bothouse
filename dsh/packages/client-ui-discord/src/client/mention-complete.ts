/**
 * Pure @-mention completion for the channel composer (React-free): find the
 * `@query` being typed at the caret, rank the members it can name, and splice
 * the chosen `@name ` into the draft.
 */
import type { ChannelMember } from './channel-source.ts'

/** The `@query` token the caret is inside: `start` is the index of `@`. */
export interface ActiveMention {
  readonly start: number
  readonly query: string
}

/** Characters that may sit right before an `@` that starts a mention. */
const MENTION_BOUNDARY = /[\s([{"'“‘，。、！？：；,.!?:;]/

/**
 * The mention being typed at `caret`, if any. A mention starts at an `@` at the
 * beginning of the text or after whitespace/punctuation, and its query runs to
 * the caret without whitespace (so `a@b.com` and finished `@name ` do not open it).
 * @param text - the draft.
 * @param caret - caret offset in `text`.
 * @returns the active mention, or undefined.
 */
export function activeMention(text: string, caret: number): ActiveMention | undefined {
  const head = text.slice(0, caret)
  const at = head.lastIndexOf('@')
  if (at < 0) return undefined
  const query = head.slice(at + 1)
  if (/\s/.test(query)) return undefined
  if (at > 0 && !MENTION_BOUNDARY.test(head[at - 1] as string)) return undefined
  return { start: at, query }
}

/**
 * Members the query can name, best first: agents before people, then prefix
 * matches before substring matches (on name or id, case-insensitive), then
 * online before offline, then name order. An empty query lists everyone.
 * @param members - channel members.
 * @param query - text typed after `@`.
 * @returns ranked candidates.
 */
export function rankMembers(members: readonly ChannelMember[], query: string): ChannelMember[] {
  const q = query.toLowerCase()
  const score = (m: ChannelMember): number | undefined => {
    if (q === '') return 0
    const name = m.name.toLowerCase()
    const id = m.id.toLowerCase()
    if (name.startsWith(q) || id.startsWith(q)) return 0
    if (name.includes(q) || id.includes(q)) return 1
    return undefined
  }
  return members
    .map(m => ({ m, s: score(m) }))
    .filter((x): x is { m: ChannelMember; s: number } => x.s !== undefined)
    .sort((a, b) => Number(a.m.kind === 'human') - Number(b.m.kind === 'human')
      || a.s - b.s
      || Number(!a.m.online) - Number(!b.m.online)
      || a.m.name.localeCompare(b.m.name, 'en'))
    .map(x => x.m)
}

/**
 * Replace the active `@query` with `@name ` and put the caret after it.
 * @param text - the draft.
 * @param caret - caret offset in `text`.
 * @param mention - the active mention at `caret`.
 * @param member - the chosen member.
 * @returns the new draft and caret.
 */
export function applyMention(text: string, caret: number, mention: ActiveMention, member: ChannelMember): { text: string; caret: number } {
  const insert = `@${member.name} `
  const tail = text.slice(caret).replace(/^ /, '')
  return { text: text.slice(0, mention.start) + insert + tail, caret: mention.start + insert.length }
}

/**
 * Insert `@name ` at the caret (member-list click), adding a separating space
 * when the caret sits right after a non-space character.
 * @param text - the draft.
 * @param caret - caret offset in `text`.
 * @param member - the member to mention.
 * @returns the new draft and caret.
 */
export function insertMention(text: string, caret: number, member: ChannelMember): { text: string; caret: number } {
  const before = text.slice(0, caret)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const insert = `${lead}@${member.name} `
  return { text: before + insert + text.slice(caret), caret: caret + insert.length }
}
