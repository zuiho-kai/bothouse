/** Member portrait: a built-in or bot-announced image over a colored initial badge. */
import { useState } from 'react'
import { avatarSrc } from './avatars.ts'
import { useCollabUrl } from './collab-url.ts'
import css from './ChannelsPage.module.css'

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']

function color(id: string): string {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}

/** Member portrait, or a colored initial badge when there is none or the image fails to load. */
export function Avatar({ id, name, avatar, avatarVersion, small }: { id: string; name: string; avatar?: string; avatarVersion?: string; small?: boolean }) {
  const url = useCollabUrl()
  const base = avatarSrc(avatar, url)
  const src = base && avatar?.startsWith('upload:') && avatarVersion ? `${base}?v=${avatarVersion}` : base
  const [broken, setBroken] = useState<string | undefined>(undefined)
  return (
    <span className={small === true ? `${css.avatar} ${css.avatarSmall}` : css.avatar} style={{ background: color(id) }} aria-hidden>
      {(name || id).slice(0, 1)}
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
export function AvatarStack({ members, max = 3, label }: { members: readonly { id: string; name: string; avatar?: string; avatarVersion?: string }[]; max?: number; label?: string }) {
  const url = useCollabUrl()
  if (members.length === 0) return null
  const shown = members.slice(0, max)
  return (
    <span className={css.avatarStack} title={label ?? members.map(m => m.name).join('、')} aria-hidden>
      {shown.map(m => {
        const base = avatarSrc(m.avatar, url)
        const src = base && m.avatar?.startsWith('upload:') && m.avatarVersion ? `${base}?v=${m.avatarVersion}` : base
        return <span key={m.id} className={css.stackDot} style={{ background: color(m.id), ...(src === undefined ? {} : { backgroundImage: `url("${src}")` }) }} />
      })}
    </span>
  )
}
