/**
 * QQ 接入面板：填 AppID / AppSecret、选绑定频道、起停桥接、看状态和最近日志。
 * 凭据只写不回显；服务端把 secret 打码后返回。
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelRoom } from './channel-source.ts'
import type { NS } from './locales.ts'
import { qqApi, type QqStatus } from './qq.ts'
import css from './ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

/** Props of the panel: locale plus the chat rooms it may bind to. */
export interface QqPanelProps extends PropsLocale<typeof NS> {
  readonly rooms: readonly ChannelRoom[]
  readonly defaultRoomId?: number
  readonly onClose: () => void
}

/** Renders the QQ relay form in a modal card. */
export function QqPanel({ rooms, defaultRoomId, onClose, t }: QqPanelProps) {
  const [status, setStatus] = useState<QqStatus | undefined>(undefined)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [roomId, setRoomId] = useState<number | undefined>(defaultRoomId)
  const [defaultMember, setDefaultMember] = useState('')
  const [mirror, setMirror] = useState(true)
  const [busy, setBusy] = useState<'test' | 'save' | 'stop' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    qqApi.get()
      .then(next => {
        if (!live) return
        setStatus(next)
        setAppId(next.appId)
        setRoomId(next.roomId || defaultRoomId)
        setDefaultMember(next.defaultMember)
        setMirror(next.mirror)
      })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [defaultRoomId])

  const chatRooms = rooms.filter(r => r.kind !== 'workspace')
  const running = status?.running === true

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<QqStatus | void>, done?: string): Promise<void> => {
    setBusy(kind)
    setError(undefined)
    setNotice(undefined)
    try {
      const next = await work()
      if (next !== undefined) setStatus(next)
      if (done !== undefined) setNotice(done)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const input = () => ({
    appId: appId.trim(),
    ...(appSecret === '' ? {} : { appSecret }),
    roomId: roomId ?? 0,
    defaultMember: defaultMember.trim(),
    mirror,
  })

  return (
    <div className={css.dialogBackdrop} onClick={onClose}>
      <section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('qqTitle')} onClick={event => { event.stopPropagation() }}>
        <h2 className={css.dialogTitle}>{t('qqTitle')}</h2>
        <p className={css.qqIntro}>{t('qqIntro')}</p>

        <div className={running ? `${css.qqStatus} ${css.qqOnline}` : css.qqStatus} role="status">
          {running
            ? t('qqStatusRunning', { pid: String(status?.pid ?? '') })
            : status?.configured === true ? t('qqStatusStopped') : t('qqStatusUnconfigured')}
        </div>
        {status?.lastError !== null && status?.lastError !== undefined && !running && (
          <div className={css.sendError} role="alert">{t('qqLastError', { message: status.lastError })}</div>
        )}

        <label className={css.fieldLabel} htmlFor="qq-app-id">{t('qqAppId')}</label>
        <input id="qq-app-id" className={css.fieldInput} value={appId} autoComplete="off" onChange={event => { setAppId(event.target.value) }} />

        <label className={css.fieldLabel} htmlFor="qq-app-secret">{t('qqAppSecret')}</label>
        <input
          id="qq-app-secret"
          className={css.fieldInput}
          type="password"
          autoComplete="new-password"
          placeholder={status?.appSecretMasked !== undefined && status.appSecretMasked !== '' ? t('qqSecretSaved', { masked: status.appSecretMasked }) : ''}
          value={appSecret}
          onChange={event => { setAppSecret(event.target.value) }}
        />

        <label className={css.fieldLabel} htmlFor="qq-room">{t('qqRoom')}</label>
        <select id="qq-room" className={css.fieldInput} value={roomId ?? ''} onChange={event => { setRoomId(Number(event.target.value)) }}>
          {chatRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        <label className={css.fieldLabel} htmlFor="qq-default-member">{t('qqDefaultMember')}</label>
        <input id="qq-default-member" className={css.fieldInput} value={defaultMember} placeholder={t('qqDefaultMemberHint')} onChange={event => { setDefaultMember(event.target.value) }} />

        <label className={css.qqCheck}>
          <input type="checkbox" checked={mirror} onChange={event => { setMirror(event.target.checked) }} />
          <span>{t('qqMirror')}</span>
        </label>

        {error !== undefined && <div className={css.sendError} role="alert">{t('qqFailed', { message: error })}</div>}
        {notice !== undefined && <div className={css.qqNotice} role="status">{notice}</div>}

        <div className={css.dialogActions}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={busy !== undefined || appId.trim() === ''}
            onClick={() => { void run('test', async () => { await qqApi.test({ appId: appId.trim(), ...(appSecret === '' ? {} : { appSecret }) }) }, t('qqTestOk')) }}
          >
            {busy === 'test' ? t('qqTesting') : t('qqTest')}
          </button>
          <button
            type="button"
            className={css.primaryButton}
            disabled={busy !== undefined || appId.trim() === ''}
            onClick={() => { void run('save', async () => { await qqApi.save(input()); return await qqApi.start() }, t('qqStarted')) }}
          >
            {busy === 'save' ? t('qqSaving') : t('qqSaveStart')}
          </button>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={busy !== undefined || !running}
            onClick={() => { void run('stop', () => qqApi.stop(), t('qqStopped')) }}
          >
            {t('qqStop')}
          </button>
          <button type="button" className={css.secondaryButton} onClick={onClose}>{t('qqClose')}</button>
        </div>

        {status !== undefined && status.log.length > 0 && (
          <details className={css.qqLogBox}>
            <summary>{t('qqLog')}</summary>
            <pre className={css.qqLog}>{status.log.slice(-8).join('\n')}</pre>
          </details>
        )}
      </section>
    </div>
  )
}
