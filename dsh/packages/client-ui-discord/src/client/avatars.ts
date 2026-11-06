/**
 * Built-in member avatars served by the collab plugin at `collab/avatars/<slug>.png`:
 * the five original character portraits (user 2026-10-23: 「我还是保留原本那个」).
 */
export const AVATARS = ['orange', 'whale', 'dragon', 'rainbow', 'lanxi'] as const

/**
 * Image source for a member avatar.
 * @param avatar - built-in slug, http(s) URL announced by a bot, or empty.
 * @param url - #236 path mapper of the panel (a paired computer's panel reads its avatars).
 * @returns a URL relative to the document base, the absolute URL, or undefined for the initial badge.
 */
export function avatarSrc(avatar: string | undefined, url: (path: string) => string = path => path): string | undefined {
  if (avatar === undefined || avatar === '') return undefined
  if (/^upload:[a-z0-9-]+\.png$/.test(avatar)) return url(`collab/avatars/uploads/${avatar.slice(7)}`)
  if (/^https?:\/\//.test(avatar)) return avatar
  return (AVATARS as readonly string[]).includes(avatar) ? url(`collab/avatars/${avatar}.png`) : undefined
}
