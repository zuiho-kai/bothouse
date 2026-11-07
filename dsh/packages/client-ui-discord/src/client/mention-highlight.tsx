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
 * breaks, backtick fences, list items, HTML blocks and a further quote marker. Tilde fences and
 * math blocks also end a paragraph in CommonMark, but the backend reads neither, so treating them
 * as spans keeps a different bug out of this change (#259 stays on the six families the report
 * names; the deviation list above splitMentions() records both). A footnote definition is handled
 * by footnoteRanges(), not here: it ends a body, not the paragraph a code span sits in (#271).
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

/**
 * [start, end) offsets of every physical line; CRLF, CR and LF all end one. Read once per
 * codeSpanRanges() call and handed to lineIndex(), not rescanned per backtick run (#271: doing
 * that cost O(runs × lines) — 128 KiB of one-backtick lines took 54 s inside hub.post's
 * transaction).
 */
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
 * The line holding `offset`: the last line that starts at or before it. `splitLines` covers the
 * whole text contiguously, so that is the line `offset` sits on, or the one that ends there.
 */
function lineAt(lines: ReadonlyArray<[number, number]>, offset: number): number {
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid]![0] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * What endsParagraph() reads off one line, computed once per line and reused by every backtick run
 * on it (#271). `blank`/`fence` come from the raw line (a line with only a quote marker is blank
 * too), as does `itemIndent`; `rest`/`depth`/`col` are the quote split; `atDepth` is the block
 * test a lazy continuation uses. The setext-aware test depends on the span's list indent, so it
 * stays in endsParagraph() — only the reads that cost a rescan of the line were hoisted.
 */
interface LineFacts {
  blank: boolean
  fence: boolean
  itemIndent: number | undefined
  rest: string
  depth: number
  col: number
  atDepth: boolean
}

function lineFacts(text: string, lines: ReadonlyArray<[number, number]>, i: number): LineFacts {
  const line = text.slice(lines[i]![0], lines[i]![1])
  const { rest, depth, col } = stripQuotes(line)
  return {
    blank: line.trim() === '',
    fence: FENCE_LINE.test(line),
    itemIndent: itemContentIndent(line),
    rest,
    depth,
    col,
    atDepth: startsBlock(rest, false, true),
  }
}

/**
 * Everything endsParagraph() needs about `text`, read once per codeSpanRanges() call (#271): the
 * line split, the per-line facts, and `contained[i]` — the {baseIndent, depth} a walk back from
 * line i over the lines its paragraph already holds reaches, stopping at a blank line or a fence,
 * which close the block a later paragraph cannot continue.
 */
interface LineIndex {
  lines: Array<[number, number]>
  facts: LineFacts[]
  contained: Array<{ baseIndent: number; depth: number }>
}

function lineIndex(text: string): LineIndex {
  const lines = splitLines(text)
  const facts = lines.map((_, i) => lineFacts(text, lines, i))
  const contained: Array<{ baseIndent: number; depth: number }> = new Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    const f = facts[i]!
    if (f.blank || f.fence) {
      contained[i] = { baseIndent: 0, depth: 0 }
      continue
    }
    const run = i > 0 && !facts[i - 1]!.blank && !facts[i - 1]!.fence ? contained[i - 1] : undefined
    contained[i] = {
      baseIndent: f.itemIndent !== undefined ? f.itemIndent : run ? run.baseIndent : 0,
      depth: Math.max(f.depth, run ? run.depth : 0),
    }
  }
  return { lines, facts, contained }
}

/**
 * True when the text between an opening and a closing backtick run holds something that ends the
 * paragraph, so the run cannot close the span (#259): a blank line, or a line that opens a
 * block-level structure. The renderer decides this inside the containers the span sits in, so the
 * list item's content indent and the blockquote depth of the opening line are carried along, and
 * a line that lazily continues an outer container is judged by what it would start there.
 *
 * `index` is the lineIndex(text) of the whole text, shared by every pair (#271): rebuilt per pair
 * it cost O(runs × lines), 128 KiB of one-backtick lines taking 54 s.
 */
function endsParagraph(text: string, from: number, to: number, index: LineIndex): boolean {
  if (hasBlankLine(text.slice(from, to))) return true
  const { lines, facts, contained } = index
  const openLine = lineAt(lines, from)
  const { baseIndent, depth: openDepth } = contained[openLine]!
  for (let i = openLine + 1; i < lines.length && lines[i]![0] < to; i++) {
    const f = facts[i]!
    if (f.rest.trim() === '') return true // a blank line, with or without a quote marker
    if (f.depth > openDepth) return true // a deeper quote starts a new block
    if (f.depth < openDepth) {
      // A lazy continuation: only a block start ends the paragraph here, never a setext underline.
      if (f.atDepth) return true
      continue
    }
    const indent = indentWidth(f.rest, f.col) - baseIndent
    // A line shallower than the item's content lazily continues it, so a setext underline there
    // cannot turn the paragraph into a heading.
    if (startsBlock(' '.repeat(Math.max(0, indent)) + f.rest.trimStart(), indent >= 0, indent < 0)) {
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
  // The line index is only built when a pair actually has to be judged, so a text without
  // backticks (or with a single run) pays nothing (#271).
  let index: LineIndex | undefined
  for (let k = 0; k < runs.length; k++) {
    const { start, len } = runs[k]!
    if (len >= 3) continue // a fence, not an inline span
    for (let c = k + 1; c < runs.length; c++) {
      if (runs[c]!.len !== len) continue
      // the paragraph ends before this run, so it cannot close the span (#245, #259); the opener
      // stays literal text and the run is tried as the next opener
      if (endsParagraph(text, start + len, runs[c]!.start, (index ??= lineIndex(text)))) break
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

// ------------------------------------------------------------------------------------------------
// Footnote definitions (#271). The renderer hides a definition whose label nobody calls, together
// with the lines that continue it; a `@name` inside such a body is not on the page, so colouring it
// promises a call that never happens — the same bug as colouring inside a fence. A body is hidden
// when no visible text refers to its label, which is a fixed point: a reference inside a hidden
// body counts for nothing, and a definition referring to itself stays hidden.
// Keep this in step with dsh/collab/mentions.mjs footnoteRanges().

/** A definition line: `[^label]:` at 0-3 columns, the label holding no space or bracket. */
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:/
/** A line that opens an HTML block (CommonMark types 1-6): its lines are raw until a blank one. */
const HTML_OPEN = new RegExp(
  `^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \\t>]|$)|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[|` +
    `</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/?>|$))`,
  'i',
)

/**
 * True when a line at 0-3 columns opens a block, so it ends a footnote body before it. A setext
 * underline (`===`, `--`) is absorbed by the definition's own paragraph and does not end it, while
 * a bare `-` or `1.` does, because it opens a list. A tilde fence is left out on purpose: it ends a
 * body in CommonMark, but the backend reads only ``` fences (#259), and the footnote rule stays on
 * the same side of that gap.
 */
function endsDefinitionBody(rest: string): boolean {
  if (indentWidth(rest) >= 4) return false // four columns of indent is code, part of the body
  const c = rest.replace(/^[ \t]*/, '')
  if (/^(?:[*\-_][ \t]*){3,}$/.test(c)) return true // a thematic break, `---` included
  if (/^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(c)) return true // a list item, even a bare `-`
  if (/^(?:=+|-+)[ \t]*$/.test(c)) return false // a setext underline, not a block
  return (
    /^#{1,6}(?:[ \t]|$)/.test(c) || // ATX heading
    /^\$\$/.test(c) || // math block: the page renders it as math, so the paragraph stops
    /^ {0,3}`{3,}[^`]*$/.test(c) || // backtick fence
    /^>/.test(c) || // a further quote marker
    /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(c) || // HTML blocks 1-5
    /^ {0,3}<!--/.test(c) ||
    /^ {0,3}<\?/.test(c) ||
    /^ {0,3}<![A-Za-z]/.test(c) ||
    /^ {0,3}<!\[CDATA\[/.test(c) ||
    HTML_BLOCK_TAG.test(c) ||
    HTML_ANY_TAG.test(c)
  )
}

/**
 * Ranges whose lines the renderer does not read as Markdown at all, so a `[^x]:` inside one is
 * plain text and not a definition: backtick fences, `~~~` fences and `$$` math blocks.
 */
function footnoteOpaqueRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [...fencedRanges(text)]
  for (const open of [/^ {0,3}~{3,}/, /^ {0,3}\$\$/]) {
    let start = -1
    let at = 0
    for (const line of text.split('\n')) {
      if (open.test(line)) {
        if (start < 0) start = at
        else {
          ranges.push([start, at + line.length])
          start = -1
        }
      }
      at += line.length + 1
    }
    if (start >= 0) ranges.push([start, text.length])
  }
  return ranges
}

/** Lines of an HTML block: from its opening line to the line before the next blank one. */
function htmlBlockRegions(text: string, lines: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  for (let i = 0; i < lines.length; i++) {
    if (!HTML_OPEN.test(text.slice(lines[i]![0], lines[i]![1]))) continue
    let end = i
    while (end + 1 < lines.length && text.slice(lines[end + 1]![0], lines[end + 1]![1]).trim() !== '') end++
    regions.push([lines[i]![0], lines[end]![1]])
    i = end
  }
  return regions
}

interface FootnoteDef {
  line: number
  label: string
  depth: number
  base: number
}

/**
 * Every footnote definition in the text with the container it sits in: `depth` quote markers and
 * `base` the content indent of the list item that holds it (0 at the top level). Read from the
 * first line only, which is enough to walk the body.
 */
function footnoteDefs(text: string, lines: ReadonlyArray<[number, number]>): FootnoteDef[] {
  const defs: FootnoteDef[] = []
  const opaque = [...footnoteOpaqueRanges(text), ...htmlBlockRegions(text, lines)]
  const inside = (offset: number) => opaque.some(([start, end]) => offset >= start && offset < end)
  for (let i = 0; i < lines.length; i++) {
    if (inside(lines[i]![0])) continue
    const { rest, depth, col } = stripQuotes(text.slice(lines[i]![0], lines[i]![1]))
    let m = FOOTNOTE_DEF.exec(rest)
    if (m) {
      defs.push({ line: i, label: m[1]!, depth, base: 0 })
      continue
    }
    const marker = LIST_MARKER.exec(rest)
    if (!marker) continue
    const after = rest.slice(marker[0].length)
    const gap = /^[ \t]*/.exec(after)![0]
    if (gap === '') continue
    const indent = indentWidth(gap, col + marker[0].length)
    const content = after.slice(gap.length)
    m = FOOTNOTE_DEF.exec(content.length < 4 ? ' '.repeat(Math.min(indent, 3)) + content : content)
    if (m && indent < 4) defs.push({ line: i, label: m[1]!, depth, base: indent })
  }
  return defs
}

/**
 * Last line of the body of `def`, walking the lines its paragraph covers. `next`/`nextEnd` are the
 * definition right after it and the end already known for it: a definition line never ends a body,
 * so once the walk reaches it the two bodies end together — without that, a text of nothing but
 * definitions would re-walk the rest of the text once per definition.
 */
function definitionBodyEnd(
  text: string,
  lines: ReadonlyArray<[number, number]>,
  def: FootnoteDef,
  next: number | undefined,
  nextEnd: number,
): number {
  let last = def.line
  for (let j = def.line + 1; j < lines.length; j++) {
    if (j === next) return nextEnd // the next definition sits in this body, so both end alike
    const { rest, depth, col } = stripQuotes(text.slice(lines[j]![0], lines[j]![1]))
    if (rest.trim() === '') {
      // A blank line continues the body only when an indented line of the same container follows
      // it; anything else closes the definition.
      let k = j
      while (k < lines.length) {
        if (stripQuotes(text.slice(lines[k]![0], lines[k]![1])).rest.trim() !== '') break
        k++
      }
      if (k < lines.length) {
        const r = stripQuotes(text.slice(lines[k]![0], lines[k]![1]))
        if (r.depth >= def.depth && indentWidth(r.rest, r.col) - def.base >= 4) {
          j = k - 1
          last = k - 1
          continue
        }
      }
      break
    }
    if (depth > def.depth) break // a deeper quote is a block of its own
    if (depth < def.depth) {
      // A lazy continuation of the definition's paragraph: judged by what it would start there.
      if (endsDefinitionBody(rest)) break
      last = j
      continue
    }
    if (indentWidth(rest, col) - def.base >= 4) {
      last = j
      continue // code, part of the body
    }
    if (endsDefinitionBody(rest)) break
    last = j
  }
  return last
}

/** Ranges sorted and merged, so overlapping and stacked ranges cost one pass. */
function mergeRanges(ranges: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = out[out.length - 1]
    if (last && start <= last[1]!) last[1] = Math.max(last[1]!, end)
    else out.push([start, end])
  }
  return out
}

/** `text` with every `[start, end)` blanked out, line endings kept so offsets stay put. */
function maskText(text: string, ranges: ReadonlyArray<[number, number]>): string {
  const chars = text.split('')
  for (const [start, end] of mergeRanges(ranges)) {
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
    }
  }
  return chars.join('')
}

/**
 * [start, end) of every hidden footnote definition: the definition line and the lines that
 * continue it, for each label nothing readable refers to. A repeated label keeps only its first
 * definition (the renderer shows that one and drops the rest), and a reference counts only where a
 * reader can see it — not inside a fence, an inline code span, an HTML comment, another definition
 * line or another hidden body. The backend applies the same rule in mentions(), so the page and the
 * gate agree on what was called.
 *
 * The early return keeps the cost off ordinary text: without `[^` nothing is scanned at all.
 */
export function footnoteRanges(
  text: string,
  codeSpans?: Array<[number, number]>,
): Array<[number, number]> {
  // The early return comes first: computing the default argument would build the code spans for
  // every message, and that scan is the expensive half of splitMentions().
  if (!text.includes('[^')) return []
  const spans = codeSpans ?? codeSpanRanges(text)
  const lines = splitLines(text)
  const defs = footnoteDefs(text, lines)
  if (defs.length === 0) return []
  // Bodies are walked back to front, so each one can reuse the end already found for the next.
  const ends: number[] = new Array(defs.length)
  for (let k = defs.length - 1; k >= 0; k--) {
    const next = k + 1 < defs.length ? defs[k + 1]!.line : undefined
    ends[k] = definitionBodyEnd(text, lines, defs[k]!, next, next === undefined ? 0 : ends[k + 1]!)
  }
  const blind: Array<[number, number]> = [...spans, ...footnoteOpaqueRanges(text), ...htmlBlockRegions(text, lines)]
  for (const def of defs) blind.push([lines[def.line]![0], lines[def.line]![1]])
  for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) blind.push([m.index!, m.index! + m[0].length])
  // Only the first definition of a label can be shown; the rest are hidden whatever refers to them.
  const first = new Map<string, number>()
  defs.forEach((def, i) => {
    const key = def.label.toLowerCase()
    if (!first.has(key)) first.set(key, i)
  })
  // Start with everything hidden and un-hide a definition only while something visible refers to
  // its label, so a chain of references into hidden bodies settles instead of waking them.
  const shown = new Set<number>()
  for (;;) {
    const bodies: Array<[number, number]> = []
    defs.forEach((def, i) => {
      if (!shown.has(i)) bodies.push([lines[def.line]![0], lines[ends[i]!]![1]])
    })
    const searchable = maskText(text, [...blind, ...bodies])
    const called = new Set<string>()
    for (const m of searchable.matchAll(/\[\^([^\]\s]+)\]/g)) {
      // A backslash escapes the bracket; an even number of them does not (`\\[^1]` is a call).
      let slashes = 0
      for (let i = m.index! - 1; i >= 0 && searchable[i] === '\\'; i--) slashes++
      if (slashes % 2 === 0) called.add(m[1]!.toLowerCase())
    }
    let changed = false
    for (const [label, i] of first) {
      if (shown.has(i) || !called.has(label)) continue
      shown.add(i)
      changed = true
    }
    if (!changed) break
  }
  const hidden: Array<[number, number]> = []
  defs.forEach((def, i) => {
    if (!shown.has(i)) hidden.push([lines[def.line]![0], lines[ends[i]!]![1]])
  })
  return mergeRanges(hidden)
}

/**
 * Known deviations from the page, kept on purpose (#259, #271). Each one showed the same answer
 * before this code was written, so the list is the honest edge of this rule, not a regression:
 *
 * - `~~~` fences: the page renders them as code, the backend reads only ```, so a name inside one
 *   is coloured nowhere and called there.
 * - `$$` math blocks: the page ends a paragraph at one, the backend does not, so a code span that
 *   crosses `$$` holds there and breaks here (nobody called, page colours both names).
 * - A GFM table delimiter row (`|---|`): same shape — the page ends the paragraph, the backend
 *   keeps the span, so nobody is called while the page colours both names.
 * - A four-column indented code block: the page renders it as code and colours nothing, the
 *   backend has no indented-code reader and calls the name. The footnote rule below shares it: a
 *   `[^x]:` line indented four columns is a code block on the page and hidden there, and it is
 *   not a definition here either, so a name on that line is a call there.
 * - A code span opened on a block line (`# ` + backtick + name): the paragraph already ended
 *   before the opener, so the page never makes it a span and colours the names; endsParagraph()
 *   only reads the lines between the runs, so the span still holds here.
 *
 * Splits plain text into non-mention and mention segments. An @ inside a ``` fence, an inline
 * code span or a hidden footnote definition is left as text: the backend does not call anyone
 * there (dsh/collab/mentions.mjs), so colouring it would promise a call that never happens (#237,
 * #271).
 */
export function splitMentions(text: string, members: readonly ChannelMember[]): MentionSegment[] {
  if (!text) return []
  const matcher = buildMentionMatcher(members)
  if (!matcher) return [{ text }]

  const { regex, aliasMap } = matcher
  const segments: MentionSegment[] = []
  const codeSpans = codeSpanRanges(text)
  const skip = [...fencedRanges(text), ...codeSpans, ...footnoteRanges(text, codeSpans)]
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
