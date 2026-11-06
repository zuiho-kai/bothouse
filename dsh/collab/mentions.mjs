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

/**
 * [start, end) of every Markdown inline code span (`@name`, ``a `b` c``), the spans the channel
 * page renders as <code> and never colours. A span is a run of backticks closed by a run of the
 * same length inside the same paragraph (#237, dsh/packages/client-ui-discord/src/client/
 * mention-highlight.tsx codeSpanRanges — keep the two in step); the content may hold single line
 * breaks but no blank line, a lone backtick stays literal text, and runs of three or more are
 * fences, read by fenceRanges().
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
      // a blank line ends the paragraph, so this run cannot close the span (#245); the opener
      // stays literal text and the run is tried as the next opener
      if (hasBlankLine(text.slice(start + len, runs[c].start))) break;
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
