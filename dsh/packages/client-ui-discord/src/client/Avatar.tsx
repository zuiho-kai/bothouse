/** Member portrait: a built-in or bot-announced image over a colored initial badge. */
import { useState } from 'react'
import { avatarSrc } from './avatars.ts'
import { useCollabUrl } from './collab-url.ts'
import { useAvatarStyle } from './avatar-style.ts'
import css from './ChannelsPage.module.css'

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']

function color(id: string): string {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}

/**
 * #1616 (Fable #20: 小橙 and 小蓝 were both a 「小」 badge): a name opening with a diminutive or
 * kinship prefix (小/阿/老/大) shows its next character, the one that tells members apart.
 */
export function initialOf(name: string): string {
  const chars = [...name.trim()]
  return chars.length >= 2 && '小阿老大'.includes(chars[0]!) ? chars[1]! : chars[0] ?? ''
}

/** Member portrait, or a colored initial badge when there is none or the image fails to load. */
export function Avatar({ id, name, avatar, avatarVersion, small, cli, model }: { id: string; name: string; avatar?: string; avatarVersion?: string; small?: boolean; cli?: string; model?: string }) {
  const url = useCollabUrl()
  const style = useAvatarStyle()
  const base = avatarSrc({ avatar, name, cli, model, id }, url, style)
  const src = base && avatar?.startsWith('upload:') && avatarVersion ? `${base}?v=${avatarVersion}` : base
  const [broken, setBroken] = useState<string | undefined>(undefined)
  return (
    <span className={small === true ? `${css.avatar} ${css.avatarSmall}` : css.avatar} style={{ background: color(id) }} aria-hidden>
      {initialOf(name || id)}
      {src !== undefined && broken !== src && <img className={css.avatarImage} src={src} alt="" onError={() => { setBroken(src) }} />}
    </span>
  )
}

/**
 * Overlapping portraits of the members at work (#113): room rows and the title
 * bar show who is busy at a glance. Decorative only (no text), so a row's
 * accessible name and text stay the room's own; the names go in `title`.
 */
// 来源：#113 草图 v1，频道行与标题栏最多叠三个头像。
export function AvatarStack({ members, max = 3, label }: { members: readonly { id: string; name: string; avatar?: string; avatarVersion?: string; cli?: string; model?: any }[]; max?: number; label?: string }) {
  const url = useCollabUrl()
  const style = useAvatarStyle()
  if (members.length === 0) return null
  const shown = members.slice(0, max)
  return (
    <span className={css.avatarStack} title={label ?? members.map(m => m.name).join('、')} aria-hidden>
      {shown.map(m => {
        const base = avatarSrc({ avatar: m.avatar, name: m.name, cli: (m as any).cli, model: typeof (m as any).model === 'string' ? (m as any).model : (m as any).model?.model, id: m.id }, url, style)
        const src = base && m.avatar?.startsWith('upload:') && m.avatarVersion ? `${base}?v=${m.avatarVersion}` : base
        return <span key={m.id} className={css.stackDot} style={{ background: color(m.id), ...(src === undefined ? {} : { backgroundImage: `url("${src}")` }) }} />
      })}
    </span>
  )
}
