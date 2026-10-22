import css from '../ChannelsPage.module.css'

export interface ProgressCardProps {
  title?: string | undefined
  state?: string | undefined
  text: string
}

export function ProgressCard({ title, state, text }: ProgressCardProps) {
  return (
    <div className={css.card} data-state={state}>
      {title && <div className={css.cardTitle}>{title}</div>}
      <div className={css.text}>{text}</div>
    </div>
  )
}
