/**
 * Mention badge highlighting for channel message text and quotes.
 * Highlights valid channel members/roles as pill badges (Discord-style),
 * cleanly separated from regular text, without false positives in code or emails.
 */
import React, { useLayoutEffect, useEffect, useRef } from 'react'
import type { ChannelMember } from './channel-source.ts'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChannelsPage.module.css'

export interface MentionSegment {
  text: string
  member?: ChannelMember
}

// A ``` fence, read the way dsh/collab/mentions.mjs does: alternating outside/inside parts of
// text.split(FENCE), so an odd part is code. The backend calls nobody inside a fence.
const FENCE = '```'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when the text holds a blank line: two line endings with only spaces or tabs between.
 * A `code span` cannot cross one — the blank line ends the paragraph, so the renderer closes the
 * span before it (#245: `@肥鱼` + blank line + `@G哥` inside one pair of backticks is plain text
 * on the page, and must be plain text on the backend too).
 */
function hasBlankLine(text: string): boolean {
  return /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.test(text)
}

/**
 * Offsets of Markdown inline code spans, [start, end) each, matching what the markdown renderer
 * turns into <code> and the backend skips (dsh/collab/mentions.mjs codeSpanRanges — keep them in
 * step). A span is a run of backticks closed by a run of the same length inside the same
 * paragraph; it may hold single line breaks but no blank line. A lone backtick stays literal
 * text, and runs of three or more are fences, left to fencedRanges().
 */
export function codeSpanRanges(text: string): Array<[number, number]> {
  const runs: Array<{ start: number; len: number }> = []
  for (let i = 0; i < text.length;) {
    if (text[i] !== '`') {
      i++
      continue
    }
    let j = i
    while (j < text.length && text[j] === '`') j++
    runs.push({ start: i, len: j - i })
    i = j
  }
  const ranges: Array<[number, number]> = []
  for (let k = 0; k < runs.length; k++) {
    const { start, len } = runs[k]!
    if (len >= 3) continue // a fence, not an inline span
    for (let c = k + 1; c < runs.length; c++) {
      if (runs[c]!.len !== len) continue
      // a blank line ends the paragraph, so this run cannot close the span (#245); the opener
      // stays literal text and the run is tried as the next opener
      if (hasBlankLine(text.slice(start + len, runs[c]!.start))) break
      ranges.push([start + len, runs[c]!.start])
      k = c // the closing run cannot open another span
      break
    }
  }
  return ranges
}

/** True when [index, index + len) overlaps any excluded range. */
function overlaps(ranges: ReadonlyArray<[number, number]>, index: number, len: number): boolean {
  return ranges.some(([start, end]) => index < end && index + len > start)
}

/**
 * Builds a regex matcher and lookup map for channel member mention aliases.
 * Longest aliases are prioritized so e.g. "@阿柚子" matches before "@阿柚".
 */
export function buildMentionMatcher(members: readonly ChannelMember[]): {
  regex: RegExp
  aliasMap: Map<string, ChannelMember>
} | undefined {
  if (!members || members.length === 0) return undefined

  const aliasMap = new Map<string, ChannelMember>()
  for (const m of members) {
    const name = m.name?.trim()
    const id = m.id?.trim()
    if (name) {
      aliasMap.set('@' + name, m)
    }
    if (id) {
      aliasMap.set('@' + id, m)
      aliasMap.set('<@' + id + '>', m)
      aliasMap.set('<@!' + id + '>', m)
    }
    if (m.mentionId) {
      aliasMap.set('<@' + m.mentionId + '>', m)
      aliasMap.set('<@!' + m.mentionId + '>', m)
    }
  }

  const sortedAliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length)
  if (sortedAliases.length === 0) return undefined

  const parts = sortedAliases.map(alias => {
    const escaped = escapeRegex(alias)
    const endsWithWord = /[a-zA-Z0-9_]$/.test(alias)
    return endsWithWord ? `${escaped}(?![a-zA-Z0-9_])` : escaped
  })

  // Lookbehind (?<=^|[^a-zA-Z0-9_]) ensures we do not match inside emails (e.g. user@domain.com)
  const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_])(${parts.join('|')})`, 'g')
  return { regex, aliasMap }
}

/**
 * Offsets of ``` fenced blocks, [start, end) each, the way the backend reads them
 * (dsh/collab/mentions.mjs split(): text.split('```') and odd parts are inside a fence).
 * An unterminated fence runs to the end of the text, as it does there.
 */
export function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let open = -1
  let at = text.indexOf(FENCE)
  while (at >= 0) {
    if (open < 0) {
      open = at + FENCE.length
    } else {
      ranges.push([open, at])
      open = -1
    }
    at = text.indexOf(FENCE, at + FENCE.length)
  }
  if (open >= 0) ranges.push([open, text.length])
  return ranges
}

/**
 * Splits plain text into non-mention and mention segments. An @ inside a ``` fence or an inline
 * code span is left as text: the backend does not call anyone there (dsh/collab/mentions.mjs),
 * so colouring it would promise a call that never happens (#237).
 */
export function splitMentions(text: string, members: readonly ChannelMember[]): MentionSegment[] {
  if (!text) return []
  const matcher = buildMentionMatcher(members)
  if (!matcher) return [{ text }]

  const { regex, aliasMap } = matcher
  const segments: MentionSegment[] = []
  const skip = [...fencedRanges(text), ...codeSpanRanges(text)]
  let lastIndex = 0

  for (const match of text.matchAll(regex)) {
    const matchText = match[0]
    const startIndex = match.index ?? 0
    if (overlaps(skip, startIndex, matchText.length)) continue
    if (startIndex > lastIndex) {
      segments.push({ text: text.slice(lastIndex, startIndex) })
    }
    const member = aliasMap.get(matchText)
    segments.push({ text: matchText, member })
    lastIndex = startIndex + matchText.length
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) })
  }
  return segments
}

/**
 * Formats mention text for display in the pill badge:
 * converts raw Discord tags like <@12345> into readable @Name.
 */
export function formatMentionBadgeText(rawText: string, member: ChannelMember): string {
  if (rawText.startsWith('<@')) {
    return `@${member.name}`
  }
  return rawText
}

/**
 * Highlights mentions in the text nodes of a container element without
 * touching code blocks (<pre>, <code>), input controls, or scripts.
 */
export function highlightMentionsInElement(
  container: HTMLElement,
  members: readonly ChannelMember[],
  badgeClassName: string = css.mentionBadge,
): void {
  if (!container || !members || members.length === 0) return
  const matcher = buildMentionMatcher(members)
  if (!matcher) return

  const doc = container.ownerDocument || document

  // 1. Unwrap any pre-existing mention badges to remain idempotent
  const existing = container.querySelectorAll<HTMLElement>(`.${badgeClassName}, [data-mention]`)
  for (const el of existing) {
    el.replaceWith(doc.createTextNode(el.textContent || ''))
  }
  container.normalize()

  // 2. Collect candidate text nodes outside code / input elements
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('pre, code, textarea, input, script, style')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let curr: Node | null
  while ((curr = walker.nextNode())) {
    textNodes.push(curr as Text)
  }

  // 3. Replace matching text nodes with styled badges and plain text nodes
  for (const node of textNodes) {
    const text = node.nodeValue || ''
    if (!text) continue
    matcher.regex.lastIndex = 0
    if (!matcher.regex.test(text)) continue

    const segments = splitMentions(text, members)
    if (segments.length === 1 && !segments[0]?.member) continue

    const fragment = doc.createDocumentFragment()
    for (const seg of segments) {
      if (!seg.member) {
        fragment.appendChild(doc.createTextNode(seg.text))
      } else {
        const badge = doc.createElement('span')
        badge.className = badgeClassName
        badge.dataset.mention = seg.member.id
        badge.title = `@${seg.member.name}`
        badge.textContent = formatMentionBadgeText(seg.text, seg.member)
        fragment.appendChild(badge)
      }
    }
    node.replaceWith(fragment)
  }
}

/**
 * Renders quote text with mention pill badges as React elements.
 */
export function renderQuoteMentions(
  text: string,
  members: readonly ChannelMember[],
  onMention?: (member: ChannelMember) => void,
  badgeClassName: string = css.mentionBadge,
): React.ReactNode[] {
  const segments = splitMentions(text, members)
  return segments.map((seg, idx) => {
    if (!seg.member) {
      return seg.text
    }
    const member = seg.member
    return (
      <span
        key={idx}
        className={badgeClassName}
        data-mention={member.id}
        title={`@${member.name}`}
        onClick={
          onMention
            ? (e) => {
                e.stopPropagation()
                onMention(member)
              }
            : undefined
        }
      >
        {formatMentionBadgeText(seg.text, member)}
      </span>
    )
  })
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface HighlightedMarkdownProps {
  text: string
  labels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
  members?: readonly ChannelMember[]
  className?: string
  inline?: boolean
  dataCardText?: boolean
  onMention?: (member: ChannelMember) => void
}

/**
 * Wraps MarkdownText and applies Discord-style pill badge highlighting
 * to recognized channel member mentions.
 */
export function HighlightedMarkdown({
  text,
  labels,
  members,
  className,
  inline,
  dataCardText,
  onMention,
}: HighlightedMarkdownProps) {
  const containerRef = useRef<HTMLElement | null>(null)

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !members || members.length === 0) return
    highlightMentionsInElement(el, members, css.mentionBadge)
  }, [text, members])

  const handleClick = (e: React.MouseEvent) => {
    if (!onMention || !members) return
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-mention]')
    if (!target) return
    const mentionId = target.dataset.mention
    const member = members.find(m => m.id === mentionId)
    if (member) {
      e.stopPropagation()
      onMention(member)
    }
  }

  if (inline) {
    return (
      <span
        ref={(el) => { containerRef.current = el }}
        className={className}
        onClick={handleClick}
      >
        <MarkdownText key={text} text={text} labels={labels} />
      </span>
    )
  }

  return (
    <div
      ref={(el) => { containerRef.current = el }}
      className={className}
      data-card-text={dataCardText ? true : undefined}
      onClick={handleClick}
    >
      <MarkdownText key={text} text={text} labels={labels} />
    </div>
  )
}
