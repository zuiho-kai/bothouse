/**
 * Built-in member avatars served by the collab plugin at `collab/avatars/<slug>.png`:
 * the four B-version character portraits (Claude / GPT / DeepSeek / Gemini) + lanxi.
 */
export const AVATARS = ['orange', 'whale', 'dragon', 'rainbow', 'lanxi'] as const

export interface AvatarOptions {
  avatar?: string
  name?: string
  cli?: string
  model?: string
  id?: string
}

/**
 * Maps member role/model/cli/name to a built-in avatar slug:
 * - Claude -> orange
 * - GPT / Codex -> dragon
 * - DeepSeek -> whale
 * - Gemini -> rainbow
 * - Grok -> undefined (never borrow another's asset)
 */
export function matchAvatarSlug(opts: AvatarOptions): string | undefined {
  if (opts.avatar && (AVATARS as readonly string[]).includes(opts.avatar as any)) {
    return opts.avatar
  }
  const model = (opts.model || '').toLowerCase()
  const cli = (opts.cli || '').toLowerCase()
  const name = (opts.name || opts.id || '').toLowerCase()

  // Grok check
  if (model.includes('grok') || cli.includes('grok') || name.includes('grok')) {
    return undefined
  }

  // Model family
  if (model) {
    if (model.includes('claude') || model.includes('opus') || model.includes('sonnet') || model.includes('haiku')) return 'orange'
    if (model.includes('gpt') || model.includes('codex') || model.includes('o1') || model.includes('o3') || model.includes('o4') || model.includes('chatgpt')) return 'dragon'
    if (model.includes('deepseek') || model.includes('r1') || model.includes('v3')) return 'whale'
    if (model.includes('gemini')) return 'rainbow'
  }

  // CLI / agent type
  if (cli) {
    if (cli === 'claude' || cli === 'claudecode') return 'orange'
    if (cli === 'codex') return 'dragon'
    if (cli === 'deepseek' || cli === 'dsh') return 'whale'
    if (cli === 'gemini' || cli === 'antigravity') return 'rainbow'
  }

  // Role name / identity
  if (name) {
    if (name === '橘' || name === 'c酱' || name === 'cjiang' || name === 'claude') return 'orange'
    if (name === '龙娘' || name === 'g哥' || name === 'gge' || name === 'codex' || name === 'gpt') return 'dragon'
    if (name === '鲸鱼娘' || name === '肥鱼' || name === 'deep' || name === 'deepseek' || name === 'dsh') return 'whale'
    if (name === '彩虹猫' || name === '大豆包' || name === 'gjiang' || name === 'gemini') return 'rainbow'
    if (name === '岚汐' || name === 'lanxi' || name === 'minimax') return 'lanxi'
  }

  return undefined
}

/**
 * Image source for a member avatar.
 * @param avatar - built-in slug, http(s) URL announced by a bot, AvatarOptions, or empty.
 * @param url - #236 path mapper of the panel (a paired computer's panel reads its avatars).
 * @returns a URL relative to the document base, the absolute URL, or undefined for the initial badge.
 */
export function avatarSrc(avatar: string | undefined | AvatarOptions, url: (path: string) => string = path => path): string | undefined {
  if (avatar === undefined || avatar === '') return undefined
  if (typeof avatar === 'string') {
    if (/^upload:[a-z0-9-]+\.png$/.test(avatar)) return url(`collab/avatars/uploads/${avatar.slice(7)}`)
    if (/^https?:\/\//.test(avatar)) return avatar
    if ((AVATARS as readonly string[]).includes(avatar as any)) return url(`collab/avatars/${avatar}.png`)
    const matched = matchAvatarSlug({ name: avatar })
    return matched ? url(`collab/avatars/${matched}.png`) : undefined
  }
  const a = avatar.avatar
  if (a && /^upload:[a-z0-9-]+\.png$/.test(a)) return url(`collab/avatars/uploads/${a.slice(7)}`)
  if (a && /^https?:\/\//.test(a)) return a
  const slug = matchAvatarSlug(avatar)
  return slug ? url(`collab/avatars/${slug}.png`) : undefined
}
