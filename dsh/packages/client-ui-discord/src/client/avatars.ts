/**
 * Built-in member avatars served by the collab plugin at `collab/avatars/<slug>.png`:
 * the four B-version character portraits (Claude / GPT / DeepSeek / Gemini) + Grok + lanxi.
 * These are the slugs a member can pick for itself (MemberDialog).
 */
export const AVATARS = ['orange', 'whale', 'dragon', 'rainbow', 'lanxi', 'grok'] as const

/**
 * Two built-in sets for members without their own avatar (user 2026-11-10
 * 「默认是各家原本的图标，内置另一套娘化图标」): `brand`, each vendor's own icon (default), and
 * `chibi`, the character set above. The choice lives in the bothouse config
 * ([display] avatar_style), the same value the web panel reads and switches.
 */
export type AvatarStyle = 'brand' | 'chibi'
export const DEFAULT_AVATAR_STYLE: AvatarStyle = 'brand'
type Family = 'claude' | 'gpt' | 'deepseek' | 'gemini' | 'grok' | 'minimax'
export const AVATAR_SETS: Record<AvatarStyle, Record<Family, string>> = {
  brand: { claude: 'brand-claude', gpt: 'brand-openai', deepseek: 'brand-deepseek', gemini: 'brand-gemini', grok: 'brand-grok', minimax: 'brand-minimax' },
  chibi: { claude: 'orange', gpt: 'dragon', deepseek: 'whale', gemini: 'rainbow', grok: 'grok', minimax: 'lanxi' },
}
/** Every image the plugin serves under collab/avatars/ (both sets). */
const SERVED: readonly string[] = [...AVATARS, ...Object.values(AVATAR_SETS.brand)]

export function normalizeAvatarStyle(v: unknown): AvatarStyle {
  return v === 'chibi' ? 'chibi' : DEFAULT_AVATAR_STYLE
}

export interface AvatarOptions {
  avatar?: string
  name?: string
  cli?: string
  model?: string
  id?: string
}

/**
 * Maps member role/model/cli/name to a built-in avatar slug in the given set (default brand):
 * Claude, GPT / Codex, DeepSeek, Gemini, Grok, MiniMax. A member's own built-in pick wins.
 */
export function matchAvatarSlug(opts: AvatarOptions, style: AvatarStyle = DEFAULT_AVATAR_STYLE): string | undefined {
  if (opts.avatar && SERVED.includes(opts.avatar)) {
    return opts.avatar
  }
  const family = matchFamily(opts)
  return family === undefined ? undefined : AVATAR_SETS[style][family]
}

function matchFamily(opts: AvatarOptions): Family | undefined {
  const model = (opts.model || '').toLowerCase()
  const cli = (opts.cli || '').toLowerCase()
  const name = (opts.name || opts.id || '').toLowerCase()

  // Model family
  if (model) {
    if (model.includes('claude') || model.includes('opus') || model.includes('sonnet') || model.includes('haiku')) return 'claude'
    if (model.includes('gpt') || model.includes('codex') || model.includes('o1') || model.includes('o3') || model.includes('o4') || model.includes('chatgpt')) return 'gpt'
    if (model.includes('deepseek') || model.includes('r1') || model.includes('v3')) return 'deepseek'
    if (model.includes('gemini')) return 'gemini'
    if (model.includes('grok') || model.includes('xai')) return 'grok'
  }

  // CLI / agent type
  if (cli) {
    if (cli === 'claude' || cli === 'claudecode') return 'claude'
    if (cli === 'codex') return 'gpt'
    if (cli === 'deepseek' || cli === 'dsh') return 'deepseek'
    if (cli === 'gemini' || cli === 'antigravity') return 'gemini'
    if (cli === 'grok') return 'grok'
  }

  // Role name / identity
  if (name) {
    if (name === '橘' || name === 'c酱' || name === 'cjiang' || name === 'claude') return 'claude'
    if (name === '龙娘' || name === 'g哥' || name === 'gge' || name === 'codex' || name === 'gpt') return 'gpt'
    if (name === '鲸鱼娘' || name === '肥鱼' || name === 'deep' || name === 'deepseek' || name === 'dsh') return 'deepseek'
    if (name === '彩虹猫' || name === '大豆包' || name === 'gjiang' || name === 'gemini') return 'gemini'
    if (name === '岚汐' || name === 'lanxi' || name === 'minimax') return 'minimax'
    if (name === 'grok' || name.includes('grok')) return 'grok'
  }

  return undefined
}

/**
 * Image source for a member avatar.
 * @param avatar - built-in slug, http(s) URL announced by a bot, AvatarOptions, or empty.
 * @param url - #236 path mapper of the panel (a paired computer's panel reads its avatars).
 * @returns a URL relative to the document base, the absolute URL, or undefined for the initial badge.
 */
export function avatarSrc(avatar: string | undefined | AvatarOptions, url: (path: string) => string = path => path, style: AvatarStyle = DEFAULT_AVATAR_STYLE): string | undefined {
  if (avatar === undefined || avatar === '') return undefined
  if (typeof avatar === 'string') {
    if (/^upload:[a-z0-9-]+\.png$/.test(avatar)) return url(`collab/avatars/uploads/${avatar.slice(7)}`)
    if (/^https?:\/\//.test(avatar)) return avatar
    if (SERVED.includes(avatar)) return url(`collab/avatars/${avatar}.png`)
    const matched = matchAvatarSlug({ name: avatar }, style)
    return matched ? url(`collab/avatars/${matched}.png`) : undefined
  }
  const a = avatar.avatar
  if (a && /^upload:[a-z0-9-]+\.png$/.test(a)) return url(`collab/avatars/uploads/${a.slice(7)}`)
  if (a && /^https?:\/\//.test(a)) return a
  const slug = matchAvatarSlug(avatar, style)
  return slug ? url(`collab/avatars/${slug}.png`) : undefined
}
