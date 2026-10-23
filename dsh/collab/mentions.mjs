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
  const pat = new RegExp(list.map(([a]) => escape(a)).join('|'), 'g');
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
