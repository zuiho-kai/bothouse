import { color } from '../theme.ts'
import css from '../ChannelsPage.module.css'

export interface AvatarProps {
  id: string
  name: string
  small?: boolean
}

export function Avatar({ id, name, small }: AvatarProps) {
  return (
    <span className={small === true ? `${css.avatar} ${css.avatarSmall}` : css.avatar} style={{ background: color(id) }} aria-hidden>
      {(name || id).slice(0, 1)}
    </span>
  )
}
