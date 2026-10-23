// Built-in member avatars: the five original character portraits shipped with
// CoNest (bridge/web/public/avatars, see avatars/README.md). The user kept these
// and rejected newly drawn ones (2026-10-23: 「我还是保留原本那个」).
import { readFileSync } from 'node:fs';

export const AVATARS = ['orange', 'whale', 'dragon', 'rainbow', 'lanxi'];
/** Longest avatar URL a cloud-web bot may announce (common browser URL limit; not from the user). */
export const MAX_AVATAR_URL = 2048;

/** Normalize a member avatar: '' (initial badge), a built-in slug, or — when allowUrl — an http(s) URL. Throws on anything else. */
export function checkAvatar(value, { allowUrl = false } = {}) {
  const v = String(value ?? '').trim();
  if (v === '' || AVATARS.includes(v)) return v;
  if (allowUrl && v.length <= MAX_AVATAR_URL && /^https?:\/\/[^\s"'<>]+$/.test(v)) return v;
  throw new Error(`avatar must be one of ${AVATARS.join(', ')}${allowUrl ? ' or an http(s) URL' : ''}`);
}

/** PNG bytes of a built-in avatar, or undefined for an unknown slug. */
export function avatarImage(slug) {
  if (!AVATARS.includes(slug)) return undefined;
  return readFileSync(new URL(`./avatars/${slug}.png`, import.meta.url));
}
