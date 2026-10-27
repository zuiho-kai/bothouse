import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArchivedWorkspace, ChannelActions } from './channel-source.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

export function WorkspaceHistory({ list, restore, t }: {
  list: ChannelActions['listArchivedWorkspaces']
  restore: ChannelActions['unarchiveWorkspace']
  t: TranslateNS<typeof NS>
}) {
  const [opened, setOpened] = useState(false)
  const [rows, setRows] = useState<readonly ArchivedWorkspace[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<number>()
  const [error, setError] = useState<string>()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!opened) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    let active = true
    setLoading(true); setError(undefined)
    list().then(result => { if (active) setRows(result) }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : String(error))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; previous?.focus() }
  }, [opened, list])
  const time = (seconds: number) => seconds === 0 ? '—' : new Date(seconds * 1000).toLocaleString()
  return <>
    <button type="button" className={css.taskBoardTrigger} aria-haspopup="dialog" aria-expanded={opened} onClick={() => { setOpened(true) }}>
      <span>{t('archivedWorkspaces')}</span><span aria-hidden="true">›</span>
    </button>
    {opened && createPortal(<div className={css.dialogBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) setOpened(false) }}>
      <section ref={dialog} className={`${css.dialog} ${css.taskBoardDialog}`} role="dialog" aria-modal="true" aria-label={t('archivedWorkspaces')} tabIndex={-1} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpened(false) }
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const first = controls[0], last = controls[controls.length - 1]
        if (!controls.includes(document.activeElement as HTMLButtonElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus()
        }
      }}>
        <h2 className={css.dialogTitle}>{t('archivedWorkspaces')}</h2>
        {error !== undefined && <p role="alert">{error}</p>}
        <div className={css.taskBoardBody}>
          {loading ? <p role="status">{t('loading')}</p> : rows.length === 0 && error === undefined ? <p>{t('archivedEmpty')}</p> : rows.map(row => <article key={row.id} className={css.boardTaskCard}>
            <h3>{row.name}</h3>
            <dl>
              <dt>{t('archivedParent')}</dt><dd>{row.parent_name}</dd>
              <dt>{t('archivedTime')}</dt><dd>{time(row.archived_at)}</dd>
              <dt>{t('archivedTasks')}</dt><dd>{row.task_count}</dd>
              <dt>{t('archivedActivity')}</dt><dd>{time(row.last_activity_at)}</dd>
            </dl>
            <button type="button" className={css.secondaryButton} disabled={restoring !== undefined} onClick={() => {
              setRestoring(row.id); setError(undefined)
              restore(row.id).then(() => { setRows(previous => previous.filter(item => item.id !== row.id)) }).catch((error: unknown) => {
                setError(error instanceof Error ? error.message : String(error))
              }).finally(() => { setRestoring(undefined) })
            }}>{t('restoreWorkspace')}</button>
          </article>)}
        </div>
        <button type="button" className={css.secondaryButton} onClick={() => { setOpened(false) }}>{t('close')}</button>
      </section>
    </div>, document.body)}
  </>
}
