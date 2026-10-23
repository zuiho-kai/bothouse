// @-mention parsing and rewriting, ported from role-household/rh/cloudweb.py so
// cc-connect's gate sees the same text it sees on Discord and the hub.
// A member is { id, name, mentionId? }; mentionId is the numeric <@id> form.

const FENCE = '```';
// Punctuation after a bare name that counts as calling that member
// (bridge/platform/discord/mentions.go nameCalled).
const CALL_PUNCT = '，,：:！!？?、～~';

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** (alias, member id) pairs, longest first so "鲸鱼娘" wins over "鲸鱼". */
function aliases(members) {
  const out = [];
  for (const m of members) {
    out.push(['@' + m.name, m.id], ['@' + m.id, m.id]);
    if (m.mentionId) out.push([`<@${m.mentionId}>`, m.id], [`<@!${m.mentionId}>`, m.id]);
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** Split text into [segment, memberId|null]; mentions inside ``` fences do not count. */
export function split(text, members) {
  const list = aliases(members);
  if (list.length === 0) return [[text, null]];
  const lookup = new Map(list);
  // An alias is a complete recipient token: @foo must not select @foobar.
  const pat = new RegExp(list.map(([a]) => a.startsWith('<') ? escape(a) : `(?<![a-zA-Z0-9_.+-])${escape(a)}(?![\\p{L}\\p{N}_-])`).join('|'), 'gu');
  const parts = [];
  text.split(FENCE).forEach((seg, i) => {
    if (i) parts.push([FENCE, null]);
    if (i % 2) { parts.push([seg, null]); return; }
    let pos = 0;
    for (const m of seg.matchAll(pat)) {
      parts.push([seg.slice(pos, m.index), null], [m[0], lookup.get(m[0])]);
      pos = m.index + m[0].length;
    }
    parts.push([seg.slice(pos), null]);
  });
  return parts;
}

/** Member ids @-mentioned in text. */
export function mentions(text, members) {
  return new Set(split(text, members).map(([, id]) => id).filter(Boolean));
}

/** Unknown explicit recipients must not fall back to the lead; ignore emails/code. */
export function hasUnknownMention(text, members) {
  return text.split(FENCE).some((segment, index) => index % 2 === 0 &&
    split(segment, members).some(([plain, id]) => id === null && /(?<![a-zA-Z0-9_.+-])(?:@[\p{L}\p{N}_-]+|<@!?[^>\s]+>)/u.test(plain)));
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

/** A teammate calls a member by bare name ("行了龙娘，…", "龙娘？", or a line starting "龙娘 …"). */
export function nameCalled(text, name) {
  const body = text.replace(/```[\s\S]*?```/g, '');
  const names = [name];
  const short = name.replace(/^[\x00-\x7f]+/, '');
  if (short && short !== name) names.push(short);
  return names.some(n => called(body, n));
}

function called(text, name) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let i = line.indexOf(name);
    while (i >= 0) {
      const rest = line.slice(i + name.length);
      if (rest[0] !== undefined && CALL_PUNCT.includes(rest[0])) return true;
      if (i === 0 && (rest === '' || /^\s/.test(rest))) return true;
      i = line.indexOf(name, i + name.length);
    }
  }
  return false;
}
