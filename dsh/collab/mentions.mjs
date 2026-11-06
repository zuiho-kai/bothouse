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
 * breaks, backtick fences, list items, HTML blocks and a further quote marker. Tilde fences, math
 * blocks and footnote definitions also end a paragraph in CommonMark, but the backend has no
 * tilde-fence or footnote reader, so treating them as spans keeps a different bug out of this
 * change (#259 stays on the six families the report names).
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

/** [start, end) offsets of every physical line; CRLF, CR and LF all end one. */
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
 * True when the text between an opening and a closing backtick run holds something that ends the
 * paragraph, so the run cannot close the span (#259): a blank line, or a line that opens a
 * block-level structure. The renderer decides this inside the containers the span sits in, so the
 * list item's content indent and the blockquote depth of the opening line are carried along, and
 * a line that lazily continues an outer container is judged by what it would start there.
 */
function endsParagraph(text, from, to) {
  if (hasBlankLine(text.slice(from, to))) return true;
  const lines = splitLines(text);
  let openLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i][0] <= from && from <= lines[i][1]) { openLine = i; break; }
  }
  // The container of the span is on the lines the paragraph already holds: walk back over them,
  // stopping at a blank line or a fence, which close the block a later paragraph cannot continue.
  let baseIndent = 0;
  let openDepth = 0;
  for (let i = openLine; i >= 0; i--) {
    const line = text.slice(lines[i][0], lines[i][1]);
    if (line.trim() === '' || FENCE_LINE.test(line)) break;
    const { depth } = stripQuotes(line);
    if (depth > openDepth) openDepth = depth;
    if (baseIndent === 0) {
      const indent = itemContentIndent(line);
      if (indent !== null) baseIndent = indent;
    }
  }
  for (let i = openLine + 1; i < lines.length && lines[i][0] < to; i++) {
    const line = text.slice(lines[i][0], lines[i][1]);
    const { rest, depth, col } = stripQuotes(line);
    if (rest.trim() === '') return true; // a blank line, with or without a quote marker
    if (depth > openDepth) return true; // a deeper quote starts a new block
    if (depth < openDepth) {
      // A lazy continuation: only a block start ends the paragraph here, never a setext underline.
      if (startsBlock(rest, false, true)) return true;
      continue;
    }
    const indent = indentWidth(rest, col) - baseIndent;
    // A line shallower than the item's content lazily continues it, so a setext underline there
    // cannot turn the paragraph into a heading.
    if (startsBlock(' '.repeat(Math.max(0, indent)) + rest.trimStart(), indent >= 0, indent < 0)) {
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
  for (let k = 0; k < runs.length; k++) {
    const { start, len } = runs[k];
    if (len >= 3) continue; // a fence, not an inline span
    for (let c = k + 1; c < runs.length; c++) {
      if (runs[c].len !== len) continue;
      // the paragraph ends before this run, so it cannot close the span (#245, #259); the opener
      // stays literal text and the run is tried as the next opener
      if (endsParagraph(text, start + len, runs[c].start)) break;
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

/**
 * Split text into [segment, memberId|null]; mentions inside ``` fences and inline code spans do
 * not count. The text itself is kept verbatim, so the parts always join back to the input.
 */
export function split(text, members) {
  const list = aliases(members);
  if (list.length === 0) return [[text, null]];
  const lookup = new Map(list);
  const pat = mentionPattern(list);
  const skip = [...fenceRanges(text), ...codeSpanRanges(text)];
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
