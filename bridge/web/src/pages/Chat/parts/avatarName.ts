/* Avatar helpers: a name picks a stable hue, so the same person always looks the same.
   Kept as pure functions so the mapping is unit-tested without DOM. */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** Stable hue (0-359) for a name. Same input → same output, across sessions and reloads. */
export function avatarHue(name: string): number {
  const s = (name || '').trim() || '?';
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

/** One CJK glyph, otherwise up to two initials from word boundaries. */
export function avatarInitials(name: string): string {
  const s = (name || '').trim();
  if (!s) return '?';
  if (CJK.test(s[0])) return s[0];
  const words = s.split(/[\s_\-.·/|:]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/** Which names go into a group avatar; four cells is the readable maximum. */
export function mosaicMembers(names: string[], max = 4): string[] {
  return names.map((n) => (n || '').trim()).filter(Boolean).slice(0, max);
}
