import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { avatarPng, AvatarOutputSizeError, cropRect } from './avatar-upload.ts'
import css from './ChannelsPage.module.css'

export function AvatarCropDialog({ image, onConfirm, onCancel, t }: {
  image: HTMLImageElement
  onConfirm: (png: string) => void
  onCancel: () => void
  t: TranslateNS<typeof NS>
}) {
  const minimum = 256 / Math.min(image.naturalWidth, image.naturalHeight)
  const [rect, setRect] = useState(() => cropRect(image.naturalWidth, image.naturalHeight, minimum,
    (image.naturalWidth - 256 / minimum) / 2, (image.naturalHeight - 256 / minimum) / 2))
  const [error, setError] = useState<string>()
  const frame = useRef<HTMLDivElement>(null)
  const modal = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number }>()
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modal.current?.focus()
    return () => previous?.focus()
  }, [])
  const zoom = (scale: number) => setRect(old => {
    const next = cropRect(image.naturalWidth, image.naturalHeight, scale, 0, 0)
    return cropRect(image.naturalWidth, image.naturalHeight, next.scale,
      old.x + (old.size - next.size) / 2, old.y + (old.size - next.size) / 2)
  })
  useLayoutEffect(() => {
    const element = frame.current!
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(rect.scale * Math.exp(-event.deltaY * 0.001)) }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [rect.scale])
  const confirm = () => {
    try { onConfirm(avatarPng(image, rect)) } catch (reason) {
      setError(reason instanceof AvatarOutputSizeError
        ? t('memberAvatarOutputSizeError', { kb: (reason.bytes / 1024).toFixed(1) })
        : t('memberAvatarConvertError'))
    }
  }
  return createPortal(<div className={css.dialogBackdrop} onMouseDown={event => {
    event.stopPropagation()
    if (event.target === event.currentTarget) onCancel()
  }}>
    <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('memberAvatarCrop')} tabIndex={-1} ref={modal}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'Enter') { event.preventDefault(); confirm() }
        if (event.key === 'Tab') {
          const controls = modal.current!.querySelectorAll<HTMLElement>('input, button')
          const first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <h2 className={css.dialogTitle}>{t('memberAvatarCrop')}</h2>
      <p>{t('memberAvatarCropHint')}</p>
      <div className={css.avatarCropStage}>
        <div ref={frame} className={css.avatarCropFrame} aria-label={t('memberAvatarCrop')}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onPointerMove={event => {
            const old = drag.current
            if (!old || old.id !== event.pointerId) return
            const ratio = rect.size / event.currentTarget.getBoundingClientRect().width
            const dx = (event.clientX - old.x) * ratio, dy = (event.clientY - old.y) * ratio
            drag.current = { id: old.id, x: event.clientX, y: event.clientY }
            setRect(value => cropRect(image.naturalWidth, image.naturalHeight, value.scale, value.x - dx, value.y - dy))
          }}
          onLostPointerCapture={() => { drag.current = undefined }}
          onPointerCancel={() => { drag.current = undefined }}
          onPointerUp={event => { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId) }}>
          <img src={image.src} alt="" draggable={false} style={{
            width: `${image.naturalWidth / rect.size * 100}%`, height: `${image.naturalHeight / rect.size * 100}%`,
            left: `${-rect.x / rect.size * 100}%`, top: `${-rect.y / rect.size * 100}%`,
          }} />
        </div>
      </div>
      <label className={css.field}>{t('memberAvatarZoom')}<input type="range" min={minimum} max={Math.max(4, minimum)} step="any" value={rect.scale} onChange={event => zoom(Number(event.target.value))} /></label>
      {error && <div role="alert" className={css.sendError}>{error}</div>}
      <div className={css.dialogActions}>
        <button type="button" className={css.secondaryButton} onClick={onCancel}>{t('cancel')}</button>
        <button type="button" className={css.primaryButton} onClick={confirm}>{t('memberAvatarConfirm')}</button>
      </div>
    </div>
  </div>, document.body)
}
