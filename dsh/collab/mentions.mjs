// @-mention parsing and rewriting, ported from role-household/rh/cloudweb.py so
// cc-connect's gate sees the same text it sees on Discord and the hub.
// A member is { id, name, mentionId? }; mentionId is the numeric <@id> form.

const FENCE = '```';
// Punctuation after a bare name that counts as calling that member
// (bridge/platform/discord/mentions.go nameCalled).
const CALL_PUNCT = '，,：:！!？?、～~';
// Word characters for the mention boundaries below (#237). Same set the channel page colours
// with (client-ui-discord buildMentionMatcher): an @ inside an email or followed by a longer
// ascii word is not a call, while a Chinese name still calls when a character follows it.
const WORD = 'a-zA-Z0-9_';

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** (alias, member id) pairs, longest first so "鲸鱼娘" wins over "鲸鱼". */
function aliases(members) {
  const out = [];
  for (const m of members) {
    out.push(['@' + m.name, m.id], ['@' + m.id, m.id]);
    if (m.id) out.push([`<@${m.id}>`, m.id], [`<@!${m.id}>`, m.id]);
    if (m.mentionId) out.push([`<@${m.mentionId}>`, m.id], [`<@!${m.mentionId}>`, m.id]);
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}

/**
 * The alias pattern for one member list, with the same boundaries the channel page colours with
 * (#237, client-ui-discord buildMentionMatcher): no WORD character before an alias, and none
 * right after it when the alias itself ends in one. So `xx@dsh.ai` and `@dsh2` are not calls
 * while a Chinese name still calls with a character tacked on, and `<@1001>` is matched the way
 * the page matches it too.
 */
function mentionPattern(list) {
  const parts = list.map(([a]) => {
    const escaped = escape(a);
    const tail = new RegExp(`[${WORD}]$`).test(a) ? `(?![${WORD}])` : '';
    return `(?<![${WORD}])${escaped}${tail}`;
  });
  return new RegExp(parts.join('|'), 'g');
}

/** [start, end) of every ``` fence body; an unterminated fence runs to the end of the text. */
function fenceRanges(text) {
  const ranges = [];
  let open = -1;
  let at = text.indexOf(FENCE);
  while (at >= 0) {
    if (open < 0) {
      open = at + FENCE.length;
    } else {
      ranges.push([open, at]);
      open = -1;
    }
    at = text.indexOf(FENCE, at + FENCE.length);
  }
  if (open >= 0) ranges.push([open, text.length]);
  return ranges;
}

/**
 * True when the text holds a blank line: two line endings with only spaces or tabs between.
 * A `code span` cannot cross one — the blank line ends the paragraph, so the renderer closes the
 * span before it (#245: `@肥鱼` + blank line + `@G哥` inside one pair of backticks is plain text
 * on the page, and must be plain text here too, or the page colours two and nobody is woken).
 */
function hasBlankLine(text) {
  // CRLF is one line ending: normalize this copy so regex backtracking cannot split it (#246).
  // The original text and span offsets stay untouched.
  return /\n[ \t]*\n/.test(text.replace(/\r\n?/g, '\n'));
}

// HTML block tags that start a block on their own line (CommonMark HTML block type 6), and a
// lone open/closing tag (type 7), which opens one only where it cannot continue a paragraph.
const HTML_BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
  'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|' +
  'header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|' +
  'param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const HTML_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]|/?>|$)`, 'i');
const HTML_ANY_TAG = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?[ \t]*\/?>[ \t]*$/;
// A list item marker, and the line that opens a fence, used to find the container of a span.
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

/** Columns the leading indent of `text` covers, starting from column `base`. */
function indentWidth(text, base = 0) {
  let col = base;
  for (const ch of text) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col - base;
}

/**
 * The blockquote prefix at `line[i]` (three spaces at most, then `>` and one optional blank), read
 * from column `col`; `{ next, col }` after it, or null when the line has none there.
 */
function quotePrefixAt(line, i, col) {
  let at = col;
  let spaces = 0;
  while (spaces < 4 && line[i] === ' ') {
    i++;
    at++;
    spaces++;
  }
  if (spaces > 3 || line[i] !== '>') return null;
  i++;
  at++;
  if (line[i] === ' ' || line[i] === '\t') {
    at += line[i] === '\t' ? 4 - (at % 4) : 1;
    i++;
  }
  return { next: i, col: at };
}

/** Strips every blockquote marker of a line, so its content can be measured from column 0. */
function stripQuotes(line) {
  let i = 0;
  let col = 0;
  let depth = 0;
  for (;;) {
    const prefix = quotePrefixAt(line, i, col);
    if (!prefix) return { rest: line.slice(i), depth, col };
    i = prefix.next;
    col = prefix.col;
    depth++;
  }
}

/**
 * Column where a list item's content begins, or null when the line is not a list item. An empty
 * marker (`1.` alone on its line) cannot open a list inside a paragraph, so it counts as neither.
 */
function itemContentIndent(line) {
  const { rest, col } = stripQuotes(line);
  const lead = indentWidth(rest, col);
  if (lead >= 4) return null; // four columns of indent is code, not a list item
  const body = rest.slice(/^[ \t]*/.exec(rest)[0].length);
  const marker = LIST_MARKER.exec(body);
  if (!marker) return null;
  if (body.slice(marker[0].length).trim() === '') return null;
  const gap = /^[ \t]*/.exec(body.slice(marker[0].length))[0];
  const padding = gap === '' ? 1 : Math.min(indentWidth(gap, col + lead + marker[0].length), 4);
  return lead + marker[0].length + padding;
}

/**
 * True when a line whose content starts with `content` opens one of the block-level structures
 * this rule knows, ending the paragraph before it: ATX headings, setext underlines, thematic
 * breaks, backtick fences, list items, HTML blocks and a further quote marker. Tilde fences and
 * math blocks also end a paragraph in CommonMark, but this backend reads neither, so treating them
 * as spans keeps a different bug out of this change (#259 stays on the six families the report
 * names; the deviation list above split() records both). A footnote definition is handled by
 * footnoteRanges(), not here: it ends a body, not the paragraph a code span sits in (#271).
 * `container` is set for a line that lazily continues an outer container: there a bare list
 * marker or a lone HTML tag already opens a block the paragraph cannot hold.
 */
function startsBlock(content, setext = true, container = false) {
  if (indentWidth(content) >= 4) return false; // four columns of indent is code, not a block
  if (container && /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(content)) return true;
  if (container && HTML_ANY_TAG.test(content)) return true;
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
  );
}

/**
 * [start, end) offsets of every physical line; CRLF, CR and LF all end one. Read once per
 * codeSpanRanges() call and handed to lineIndex(), not rescanned per backtick run (#271: doing
 * that cost O(runs × lines) — 128 KiB of one-backtick lines took 54 s inside hub.post's
 * transaction).
 */
function splitLines(text) {
  const lines = [];
  for (let start = 0; start <= text.length;) {
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
    lines.push([start, end]);
    if (end >= text.length) break;
    start = text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1;
  }
  return lines;
}

/**
 * The line holding `offset`: the last line that starts at or before it. `splitLines` covers the
 * whole text contiguously, so that is the line `offset` sits on, or the one that ends there.
 */
function lineAt(lines, offset) {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid][0] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * What endsParagraph() reads off one line, computed once per line and reused by every backtick run
 * on it (#271). `blank`/`fence` come from the raw line (a line with only a quote marker is blank
 * too), as does `itemIndent`; `rest`/`depth`/`col` are the quote split; `atDepth` is the block
 * test a lazy continuation uses. The setext-aware test depends on the span's list indent, so it
 * stays in endsParagraph() — only the reads that cost a rescan of the line were hoisted.
 */
function lineFacts(text, lines, i) {
  const line = text.slice(lines[i][0], lines[i][1]);
  const { rest, depth, col } = stripQuotes(line);
  return {
    blank: line.trim() === '',
    fence: FENCE_LINE.test(line),
    itemIndent: itemContentIndent(line),
    rest,
    depth,
    col,
    atDepth: startsBlock(rest, false, true),
  };
}

/**
 * Everything endsParagraph() needs about `text`, read once per codeSpanRanges() call (#271): the
 * line split, the per-line facts, and `contained[i]` — the {baseIndent, depth} a walk back from
 * line i over the lines its paragraph already holds reaches, stopping at a blank line or a fence,
 * which close the block a later paragraph cannot continue.
 */
function lineIndex(text) {
  const lines = splitLines(text);
  const facts = lines.map((_, i) => lineFacts(text, lines, i));
  const contained = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const f = facts[i];
    if (f.blank || f.fence) {
      contained[i] = { baseIndent: 0, depth: 0 };
      continue;
    }
    const run = i > 0 && !facts[i - 1].blank && !facts[i - 1].fence ? contained[i - 1] : null;
    contained[i] = {
      baseIndent: f.itemIndent !== null ? f.itemIndent : run ? run.baseIndent : 0,
      depth: Math.max(f.depth, run ? run.depth : 0),
    };
  }
  return { lines, facts, contained };
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
function endsParagraph(text, from, to, index) {
  if (hasBlankLine(text.slice(from, to))) return true;
  const { lines, facts, contained } = index;
  const openLine = lineAt(lines, from);
  const { baseIndent, depth: openDepth } = contained[openLine];
  for (let i = openLine + 1; i < lines.length && lines[i][0] < to; i++) {
    const f = facts[i];
    if (f.rest.trim() === '') return true; // a blank line, with or without a quote marker
    if (f.depth > openDepth) return true; // a deeper quote starts a new block
    if (f.depth < openDepth) {
      // A lazy continuation: only a block start ends the paragraph here, never a setext underline.
      if (f.atDepth) return true;
      continue;
    }
    const indent = indentWidth(f.rest, f.col) - baseIndent;
    // A line shallower than the item's content lazily continues it, so a setext underline there
    // cannot turn the paragraph into a heading.
    if (startsBlock(' '.repeat(Math.max(0, indent)) + f.rest.trimStart(), indent >= 0, indent < 0)) {
      return true;
    }
  }
  return false;
}

/**
 * [start, end) of every Markdown inline code span (`@name`, ``a `b` c``), the spans the channel
 * page renders as <code> and never colours. A span is a run of backticks closed by a run of the
 * same length inside the same paragraph (#237, dsh/packages/client-ui-discord/src/client/
 * mention-highlight.tsx codeSpanRanges — keep the two in step); the content may hold single line
 * breaks but nothing that ends the paragraph (a blank line #245, or a block-level structure
 * #259), a lone backtick stays literal text, and runs of three or more are fences, read by
 * fenceRanges().
 */
function codeSpanRanges(text) {
  const runs = [];
  for (let i = 0; i < text.length;) {
    if (text[i] !== '`') { i++; continue; }
    let j = i;
    while (j < text.length && text[j] === '`') j++;
    runs.push({ start: i, len: j - i });
    i = j;
  }
  const ranges = [];
  // The line index is only built when a pair actually has to be judged, so a text without
  // backticks (or with a single run) pays nothing (#271).
  let index = null;
  for (let k = 0; k < runs.length; k++) {
    const { start, len } = runs[k];
    if (len >= 3) continue; // a fence, not an inline span
    for (let c = k + 1; c < runs.length; c++) {
      if (runs[c].len !== len) continue;
      if (!index) index = lineIndex(text);
      // the paragraph ends before this run, so it cannot close the span (#245, #259); the opener
      // stays literal text and the run is tried as the next opener
      if (endsParagraph(text, start + len, runs[c].start, index)) break;
      ranges.push([start + len, runs[c].start]);
      k = c; // the closing run cannot open another span
      break;
    }
  }
  return ranges;
}

/** True when [index, index+len) sits inside one of the excluded ranges. */
function excluded(ranges, index, len) {
  return ranges.some(([start, end]) => index < end && index + len > start);
}

// ---------------------------------------------------------------------------------------------
// Footnote definitions (#271). The renderer hides a definition whose label nobody calls, together
// with the lines that continue it; a `@name` inside such a body is not on the page, so waking it
// is the same bug as waking a name inside a fence. A body is hidden if it holds no reference a
// reader can see, so the check is a fixed point: a reference inside a hidden body counts for
// nothing, and a definition referring to itself stays hidden.

/** A definition line: `[^label]:` at 0-3 columns, the label holding no space or bracket. */
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:/;
/** A line that opens an HTML block (CommonMark types 1-6): its lines are raw until a blank one. */
const HTML_OPEN = new RegExp(
  `^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \\t>]|$)|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[|` +
    `</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/?>|$))`,
  'i',
);

/**
 * True when a line at 0-3 columns opens a block, so it ends a footnote body before it. A setext
 * underline (`===`, `--`) is absorbed by the definition's own paragraph and does not end it, while
 * a bare `-` or `1.` does, because it opens a list. A tilde fence is left out on purpose: it ends a
 * body in CommonMark, but this backend reads only ``` fences (#259), and the footnote rule stays on
 * the same side of that gap.
 */
function endsDefinitionBody(rest) {
  if (indentWidth(rest) >= 4) return false; // four columns of indent is code, part of the body
  const c = rest.replace(/^[ \t]*/, '');
  if (/^(?:[*\-_][ \t]*){3,}$/.test(c)) return true; // a thematic break, `---` included
  if (/^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(c)) return true; // a list item, even a bare `-`
  if (/^(?:=+|-+)[ \t]*$/.test(c)) return false; // a setext underline, not a block
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
  );
}

/**
 * Ranges whose lines the renderer does not read as Markdown at all, so a `[^x]:` inside one is
 * plain text and not a definition: backtick fences, `~~~` fences and `$$` math blocks.
 */
function footnoteOpaqueRanges(text) {
  const ranges = [...fenceRanges(text)];
  for (const open of [/^ {0,3}~{3,}/, /^ {0,3}\$\$/]) {
    let start = -1;
    let at = 0;
    for (const line of text.split('\n')) {
      if (open.test(line)) {
        if (start < 0) start = at;
        else { ranges.push([start, at + line.length]); start = -1; }
      }
      at += line.length + 1;
    }
    if (start >= 0) ranges.push([start, text.length]);
  }
  return ranges;
}

/** Lines of an HTML block: from its opening line to the line before the next blank one. */
function htmlBlockRegions(text, lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HTML_OPEN.test(text.slice(lines[i][0], lines[i][1]))) continue;
    let end = i;
    while (end + 1 < lines.length && text.slice(lines[end + 1][0], lines[end + 1][1]).trim() !== '') end++;
    regions.push([lines[i][0], lines[end][1]]);
    i = end;
  }
  return regions;
}

/**
 * Every footnote definition in the text with the container it sits in: `depth` quote markers and
 * `base` the content indent of the list item that holds it (0 at the top level). Read from the
 * first line only, which is enough to walk the body.
 */
function footnoteDefs(text, lines) {
  const defs = [];
  const opaque = [...footnoteOpaqueRanges(text), ...htmlBlockRegions(text, lines)];
  const inside = offset => opaque.some(([start, end]) => offset >= start && offset < end);
  for (let i = 0; i < lines.length; i++) {
    if (inside(lines[i][0])) continue;
    const { rest, depth, col } = stripQuotes(text.slice(lines[i][0], lines[i][1]));
    let m = FOOTNOTE_DEF.exec(rest);
    if (m) { defs.push({ line: i, label: m[1], depth, base: 0 }); continue; }
    const marker = LIST_MARKER.exec(rest);
    if (!marker) continue;
    const after = rest.slice(marker[0].length);
    const gap = /^[ \t]*/.exec(after)[0];
    if (gap === '') continue;
    const indent = indentWidth(gap, col + marker[0].length);
    const content = after.slice(gap.length);
    m = FOOTNOTE_DEF.exec(content.length < 4 ? ' '.repeat(Math.min(indent, 3)) + content : content);
    if (m && indent < 4) defs.push({ line: i, label: m[1], depth, base: indent });
  }
  return defs;
}

/**
 * Last line of the body of `def`, walking the lines its paragraph covers. `next`/`nextEnd` are the
 * definition right after it and the end already known for it: a definition line never ends a body,
 * so once the walk reaches it the two bodies end together — without that, a text of nothing but
 * definitions would re-walk the rest of the text once per definition.
 */
function definitionBodyEnd(text, lines, def, next, nextEnd) {
  let last = def.line;
  for (let j = def.line + 1; j < lines.length; j++) {
    if (j === next) return nextEnd; // the next definition sits in this body, so both end alike
    const { rest, depth, col } = stripQuotes(text.slice(lines[j][0], lines[j][1]));
    if (rest.trim() === '') {
      // A blank line continues the body only when an indented line of the same container follows
      // it; anything else closes the definition.
      let k = j;
      while (k < lines.length) {
        if (stripQuotes(text.slice(lines[k][0], lines[k][1])).rest.trim() !== '') break;
        k++;
      }
      if (k < lines.length) {
        const r = stripQuotes(text.slice(lines[k][0], lines[k][1]));
        if (r.depth >= def.depth && indentWidth(r.rest, r.col) - def.base >= 4) {
          j = k - 1;
          last = k - 1;
          continue;
        }
      }
      break;
    }
    if (depth > def.depth) break; // a deeper quote is a block of its own
    if (depth < def.depth) {
      // A lazy continuation of the definition's paragraph: judged by what it would start there.
      if (endsDefinitionBody(rest)) break;
      last = j;
      continue;
    }
    if (indentWidth(rest, col) - def.base >= 4) { last = j; continue; } // code, part of the body
    if (endsDefinitionBody(rest)) break;
    last = j;
  }
  return last;
}

/** Ranges sorted and merged, so overlapping and stacked ranges cost one pass. */
function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * [start, end) of every hidden footnote definition: the definition line and the lines that
 * continue it, for each label nothing readable refers to. A repeated label keeps only its first
 * definition (the renderer shows that one and drops the rest), and a reference counts only where
 * a reader can see it — not inside a fence, an inline code span, an HTML comment, another
 * definition line or another hidden body.
 *
 * The early return keeps the cost off ordinary text: without `[^` nothing is scanned at all.
 */
export function footnoteRanges(text, codeSpans = null) {
  // The early return comes first: the default parameter would otherwise build the code spans for
  // every message, and that scan is the expensive half of split().
  if (!text.includes('[^')) return [];
  if (codeSpans === null) codeSpans = codeSpanRanges(text);
  const lines = splitLines(text);
  const defs = footnoteDefs(text, lines);
  if (defs.length === 0) return [];
  // Bodies are walked back to front, so each one can reuse the end already found for the next.
  const ends = new Array(defs.length);
  for (let k = defs.length - 1; k >= 0; k--) {
    const next = k + 1 < defs.length ? defs[k + 1].line : null;
    ends[k] = definitionBodyEnd(text, lines, defs[k], next, next === null ? 0 : ends[k + 1]);
  }
  const blind = [
    ...codeSpans,
    ...footnoteOpaqueRanges(text),
    ...htmlBlockRegions(text, lines),
  ];
  for (const def of defs) blind.push([lines[def.line][0], lines[def.line][1]]);
  for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) blind.push([m.index, m.index + m[0].length]);
  // Only the first definition of a label can be shown; the rest are hidden whatever refers to them.
  const first = new Map();
  defs.forEach((def, i) => {
    const key = def.label.toLowerCase();
    if (!first.has(key)) first.set(key, i);
  });
  // Start with everything hidden and un-hide a definition only while something visible refers to
  // its label, so a chain of references into hidden bodies settles instead of waking them.
  const shown = new Set();
  for (;;) {
    const bodies = [];
    defs.forEach((def, i) => {
      if (!shown.has(i)) bodies.push([lines[def.line][0], lines[ends[i]][1]]);
    });
    const searchable = maskText(text, [...blind, ...bodies]);
    const called = new Set();
    for (const m of searchable.matchAll(/\[\^([^\]\s]+)\]/g)) {
      // A backslash escapes the bracket; an even number of them does not (`\\[^1]` is a call).
      let slashes = 0;
      for (let i = m.index - 1; i >= 0 && searchable[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0) called.add(m[1].toLowerCase());
    }
    let changed = false;
    for (const [label, i] of first) {
      if (shown.has(i) || !called.has(label)) continue;
      shown.add(i);
      changed = true;
    }
    if (!changed) break;
  }
  const hidden = [];
  defs.forEach((def, i) => {
    if (!shown.has(i)) hidden.push([lines[def.line][0], lines[ends[i]][1]]);
  });
  return mergeRanges(hidden);
}

/** `text` with every `[start, end)` blanked out, line endings kept so offsets stay put. */
function maskText(text, ranges) {
  const chars = text.split('');
  for (const [start, end] of mergeRanges(ranges)) {
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/**
 * Known deviations from the page, kept on purpose (#259, #271). Each one showed the same answer
 * before this code was written, so the list is the honest edge of this rule, not a regression:
 *
 * - `~~~` fences: the page renders them as code, this backend reads only ```, so a name inside one
 *   is coloured nowhere and called here.
 * - `$$` math blocks: the page ends a paragraph at one, this backend does not, so a code span that
 *   crosses `$$` holds here and breaks there (nobody called, page colours both names).
 * - A GFM table delimiter row (`|---|`): same shape — the page ends the paragraph, this backend
 *   keeps the span, so nobody is called while the page colours both names.
 * - A four-column indented code block: the page renders it as code and colours nothing, this
 *   backend has no indented-code reader and calls the name. The footnote rule below shares it: a
 *   `[^x]:` line indented four columns is a code block on the page and hidden there, and it is
 *   not a definition here either, so a name on that line is a call here.
 * - A code span opened on a block line (`# ` + backtick + name): the paragraph already ended
 *   before the opener, so the page never makes it a span and colours the names; endsParagraph()
 *   only reads the lines between the runs, so the span still holds here.
 *
 * Split text into [segment, memberId|null]; mentions inside ``` fences, inline code spans and
 * hidden footnote definitions do not count. The text itself is kept verbatim, so the parts always
 * join back to the input.
 */
export function split(text, members) {
  const list = aliases(members);
  if (list.length === 0) return [[text, null]];
  const lookup = new Map(list);
  const pat = mentionPattern(list);
  const codeSpans = codeSpanRanges(text);
  const skip = [...fenceRanges(text), ...codeSpans, ...footnoteRanges(text, codeSpans)];
  const parts = [];
  let pos = 0;
  for (const m of text.matchAll(pat)) {
    if (excluded(skip, m.index, m[0].length)) continue;
    parts.push([text.slice(pos, m.index), null], [m[0], lookup.get(m[0])]);
    pos = m.index + m[0].length;
  }
  parts.push([text.slice(pos), null]);
  return parts;
}

/** Member ids @-mentioned in text. */
export function mentions(text, members) {
  return new Set(split(text, members).map(([, id]) => id).filter(Boolean));
}

/** text with the @-mentions (and blanks) it opens with taken out. */
export function withoutLeadingMentions(text, members) {
  const parts = split(text, members);
  let i = 0;
  while (i < parts.length && (parts[i][1] !== null || !parts[i][0].trim())) i++;
  return parts.slice(i).map(([seg]) => seg).join('').trimStart();
}

/** Stored/displayed form: every mention becomes @name. */
export function forDisplay(text, members) {
  const byId = new Map(members.map(m => [m.id, m]));
  return split(text, members).map(([s, id]) => (id ? '@' + byId.get(id).name : s)).join('');
}

/**
 * Text as one member receives it: its own mention is removed (or becomes
 * "@name(你)" when others are also mentioned), other members become <@mentionId>
 * when they have one so cc-connect's "mentioned someone else" rule applies.
 */
export function forMember(text, to, members) {
  const byId = new Map(members.map(m => [m.id, m]));
  const parts = split(text, members);
  const others = parts.some(([, id]) => id && id !== to.id);
  const out = [];
  let eat = false;
  for (const [s, id] of parts) {
    if (id === null) {
      out.push(eat && (s[0] === ' ' || s[0] === '\t') ? s.slice(1) : s);
      eat = false;
    } else if (id === to.id) {
      out.push(others ? `@${to.name}(你)` : '');
      const so_far = out.join('');
      eat = !others && (!so_far.trim() || /\s$/.test(so_far));
    } else {
      const o = byId.get(id);
      out.push(o.mentionId ? `<@${o.mentionId}>` : '@' + o.name);
    }
  }
  return out.join('').trim();
}

/** A teammate calls a member by bare name: a line opening with her name, alone or among
 *  teammates' names ("橘，…" / "龙娘、橘 你们看看"). Translated line for line from
 *  bridge/platform/discord/mentions.go nameCalled/callFollows/botNames — keep them in step. */
export function nameCalled(text, name, team = []) {
  const mine = botNames(name);
  if (mine.length === 0) return false;
  const all = [...mine];
  for (const n of team) all.push(...botNames(n));
  all.sort((a, b) => b.length - a.length); // longest first: "Claude橘" before "橘"
  const body = text.replace(/```[\s\S]*?```/g, '');
  for (const raw of body.split('\n')) {
    let rest = raw.trim();
    let sep = '';
    let me = false;
    for (let matched = true; matched;) {
      matched = false;
      for (const n of all) {
        if (!rest.startsWith(n)) continue;
        me = me || mine.includes(n);
        const after = rest.slice(n.length);
        rest = after.replace(/^[ \t，,、和跟与/]+/, '');
        sep = after.slice(0, after.length - rest.length);
        matched = true;
        break;
      }
    }
    if (me && callFollows(rest, sep)) return true;
  }
  return false;
}

/** A bot's username and the same without its leading ASCII part ("Claude橘" → "橘"). */
function botNames(botName) {
  if (!botName) return [];
  const names = [botName];
  const short = botName.replace(/^[\x00-\x7f]+/, '');
  if (short && short !== botName) names.push(short);
  return names;
}

/** Calling words: what follows the opening name may call her ("橘你来", "橘帮我看"). */
const CALL_WORDS = ['你', '帮', '来', '看', '快', '给', '过来', '出来', '有空'];

/** callFollows: the end of the line, a space or vocative punctuation after the last opening
 *  name, or a calling word (mentions.go callFollows). */
function callFollows(rest, sep) {
  if (rest === '' || /[ \t，,、]/.test(sep)) return true;
  if (':：!！?？~～.。'.includes(rest[0])) return true;
  return CALL_WORDS.some(w => rest.startsWith(w));
}
