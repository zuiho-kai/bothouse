/** Member portrait: a built-in or bot-announced image over a colored initial badge. */
import { useState } from 'react'
import { avatarSrc } from './avatars.ts'
import css from './ChannelsPage.module.css'

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']

function color(id: string): string {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}

/** Member portrait, or a colored initial badge when there is none or the image fails to load. */
export function Avatar({ id, name, avatar, small }: { id: string; name: string; avatar?: string; small?: boolean }) {
  const src = avatarSrc(avatar)
  const [broken, setBroken] = useState<string | undefined>(undefined)
  return (
    <span className={small === true ? `${css.avatar} ${css.avatarSmall}` : css.avatar} style={{ background: color(id) }} aria-hidden>
      {(name || id).slice(0, 1)}
      {src !== undefined && broken !== src && <img className={css.avatarImage} src={src} alt="" onError={() => { setBroken(src) }} />}
    </span>
  )
}
