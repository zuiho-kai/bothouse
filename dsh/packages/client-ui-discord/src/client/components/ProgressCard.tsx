import css from '../ChannelsPage.module.css'

export interface ProgressCardProps {
  title?: string | undefined
  state?: string | undefined
  text?: string | undefined
}

export function ProgressCard({ title, state, text }: ProgressCardProps) {
  const hasTitle = Boolean(title && title.trim())
  const hasText = Boolean(text && text.trim())
  if (!hasTitle && !hasText) {
    return null
  }
  return (
    <div className={css.card} data-state={state}>
      {hasTitle && <div className={css.cardTitle}>{title}</div>}
      {hasText && <div className={css.text}>{text}</div>}
    </div>
  )
}
