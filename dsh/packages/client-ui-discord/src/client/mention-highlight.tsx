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
  // CRLF is one line ending: normalize this copy so regex backtracking cannot split it (#246).
  // The original text and span offsets stay untouched.
  return /\n[ \t]*\n/.test(text.replace(/\r\n?/g, '\n'))
}

// HTML block tags that start a block on their own line (CommonMark HTML block type 6), and a
// lone open/closing tag (type 7), which opens one only where it cannot continue a paragraph.
const HTML_BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
  'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|' +
  'header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|' +
  'param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul'
const HTML_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]|/?>|$)`, 'i')
const HTML_ANY_TAG = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?[ \t]*\/?>[ \t]*$/
// A list item marker, and the line that opens a fence, used to find the container of a span.
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/

/** Columns the leading indent of `text` covers, starting from column `base`. */
function indentWidth(text: string, base = 0): number {
  let col = base
  for (const ch of text) {
    if (ch === ' ') col += 1
    else if (ch === '\t') col += 4 - (col % 4)
    else break
  }
  return col - base
}

/**
 * The blockquote prefix at `line[i]` (three spaces at most, then `>` and one optional blank), read
 * from column `col`; `{ next, col }` after it, or undefined when the line has none there.
 */
function quotePrefixAt(line: string, from: number, col: number): { next: number; col: number } | undefined {
  let i = from
  let at = col
  let spaces = 0
  while (spaces < 4 && line[i] === ' ') {
    i++
    at++
    spaces++
  }
  if (spaces > 3 || line[i] !== '>') return undefined
  i++
  at++
  if (line[i] === ' ' || line[i] === '\t') {
    at += line[i] === '\t' ? 4 - (at % 4) : 1
    i++
  }
  return { next: i, col: at }
}

/** Strips every blockquote marker of a line, so its content can be measured from column 0. */
function stripQuotes(line: string): { rest: string; depth: number; col: number } {
  let i = 0
  let col = 0
  let depth = 0
  for (;;) {
    const prefix = quotePrefixAt(line, i, col)
    if (!prefix) return { rest: line.slice(i), depth, col }
    i = prefix.next
    col = prefix.col
    depth++
  }
}

/**
 * Column where a list item's content begins, or undefined when the line is not a list item. An
 * empty marker (`1.` alone on its line) cannot open a list inside a paragraph, so it counts as
 * neither.
 */
function itemContentIndent(line: string): number | undefined {
  const { rest, col } = stripQuotes(line)
  const lead = indentWidth(rest, col)
  if (lead >= 4) return undefined // four columns of indent is code, not a list item
  const body = rest.slice(/^[ \t]*/.exec(rest)![0].length)
  const marker = LIST_MARKER.exec(body)
  if (!marker) return undefined
  if (body.slice(marker[0].length).trim() === '') return undefined
  const gap = /^[ \t]*/.exec(body.slice(marker[0].length))![0]
  const padding = gap === '' ? 1 : Math.min(indentWidth(gap, col + lead + marker[0].length), 4)
  return lead + marker[0].length + padding
}

/**
 * True when a line whose content starts with `content` opens one of the block-level structures
 * this rule knows, ending the paragraph before it: ATX headings, setext underlines, thematic
 * breaks, backtick fences, list items, HTML blocks and a further quote marker. Tilde fences, math
 * blocks and footnote definitions also end a paragraph in CommonMark, but the backend has no
 * tilde-fence or footnote reader, so treating them as spans keeps a different bug out of this
 * change (#259 stays on the six families the report names).
 * `container` is set for a line that lazily continues an outer container: there a bare list
 * marker or a lone HTML tag already opens a block the paragraph cannot hold.
 */
function startsBlock(content: string, setext = true, container = false): boolean {
  if (indentWidth(content) >= 4) return false // four columns of indent is code, not a block
  if (container && /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(content)) return true
  if (container && HTML_ANY_TAG.test(content)) return true
  return (
    /^ {0,3}#{1,6}(?:[ \t]|$)/.test(content) || // ATX heading
    (setext && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content)) || // setext underline
    /^ {0,3}(?:[*\-_][ \t]*){3,}$/.test(content) || // thematic break
    /^ {0,3}`{3,}[^`]*$/.test(content) || // backtick fence
    /^ {0,3}>/.test(content) || // a further quote marker
    /^ {0,3}[-*+][ \t]+\S/.test(content) || // bullet item with content
    /^ {0,3}1[.)][ \t]+\S/.test(content) || // ordered item with content
    /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(content) || // HTML blocks 1-5
    /^ {0,3}<!--/.test(content) ||
    /^ {0,3}<\?/.test(content) ||
    /^ {0,3}<![A-Za-z]/.test(content) ||
    /^ {0,3}<!\[CDATA\[/.test(content) ||
    HTML_BLOCK_TAG.test(content)
  )
}

/** [start, end) offsets of every physical line; CRLF, CR and LF all end one. */
function splitLines(text: string): Array<[number, number]> {
  const lines: Array<[number, number]> = []
  for (let start = 0; start <= text.length;) {
    let end = start
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
    lines.push([start, end])
    if (end >= text.length) break
    start = text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1
  }
  return lines
}

/**
 * True when the text between an opening and a closing backtick run holds something that ends the
 * paragraph, so the run cannot close the span (#259): a blank line, or a line that opens a
 * block-level structure. The renderer decides this inside the containers the span sits in, so the
 * list item's content indent and the blockquote depth of the opening line are carried along, and
 * a line that lazily continues an outer container is judged by what it would start there.
 */
function endsParagraph(text: string, from: number, to: number): boolean {
  if (hasBlankLine(text.slice(from, to))) return true
  const lines = splitLines(text)
  let openLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]![0] <= from && from <= lines[i]![1]) {
      openLine = i
      break
    }
  }
  // The container of the span is on the lines the paragraph already holds: walk back over them,
  // stopping at a blank line or a fence, which close the block a later paragraph cannot continue.
  let baseIndent = 0
  let openDepth = 0
  for (let i = openLine; i >= 0; i--) {
    const line = text.slice(lines[i]![0], lines[i]![1])
    if (line.trim() === '' || FENCE_LINE.test(line)) break
    const { depth } = stripQuotes(line)
    if (depth > openDepth) openDepth = depth
    if (baseIndent === 0) {
      const indent = itemContentIndent(line)
      if (indent !== undefined) baseIndent = indent
    }
  }
  for (let i = openLine + 1; i < lines.length && lines[i]![0] < to; i++) {
    const line = text.slice(lines[i]![0], lines[i]![1])
    const { rest, depth, col } = stripQuotes(line)
    if (rest.trim() === '') return true // a blank line, with or without a quote marker
    if (depth > openDepth) return true // a deeper quote starts a new block
    if (depth < openDepth) {
      // A lazy continuation: only a block start ends the paragraph here, never a setext underline.
      if (startsBlock(rest, false, true)) return true
      continue
    }
    const indent = indentWidth(rest, col) - baseIndent
    // A line shallower than the item's content lazily continues it, so a setext underline there
    // cannot turn the paragraph into a heading.
    if (startsBlock(' '.repeat(Math.max(0, indent)) + rest.trimStart(), indent >= 0, indent < 0)) {
      return true
    }
  }
  return false
}

/**
 * Offsets of Markdown inline code spans, [start, end) each, matching what the markdown renderer
 * turns into <code> and the backend skips (dsh/collab/mentions.mjs codeSpanRanges — keep them in
 * step). A span is a run of backticks closed by a run of the same length inside the same
 * paragraph; it may hold single line breaks but nothing that ends the paragraph (a blank line
 * #245, or a block-level structure #259). A lone backtick stays literal text, and runs of three
 * or more are fences, left to fencedRanges().
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
      // the paragraph ends before this run, so it cannot close the span (#245, #259); the opener
      // stays literal text and the run is tried as the next opener
      if (endsParagraph(text, start + len, runs[c]!.start)) break
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
