/**
 * Step chips under a run strip (#125, the owner's 11:53 sample v1): one chip per tool step with
 * its outcome; a click shows that step's call and output, a failed step is marked red. Data comes
 * from the progress card's `chips` (dsh/collab/cloudweb.mjs stepChips); older cards without it
 * keep the plain step lines.
 */
import { useState } from 'react'
import type { T } from './task-board.ts'
import css from './ChannelsPage.module.css'

export interface StepChip { readonly tool: string; readonly state: 'ok' | 'failed' | 'running' | 'unknown'; readonly input?: string; readonly output?: string }

const STATES = new Set(['ok', 'failed', 'running', 'unknown'])
/** The chips of a parsed card, or undefined when the card carries none (older cards). */
export function chipsOf(card: { chips?: unknown } | undefined): StepChip[] | undefined {
  if (!Array.isArray(card?.chips) || card.chips.length === 0) return undefined
  const chips = card.chips.filter((c): c is StepChip => c !== null && typeof c === 'object' && typeof c.tool === 'string' && STATES.has(c.state))
  return chips.length > 0 ? chips : undefined
}

const LABEL = { ok: 'stepOk', failed: 'stepFailed', running: 'stepRunning', unknown: 'stepUnknown' } as const

export function StepChips({ chips, t }: { chips: readonly StepChip[]; t: T }) {
  const [open, setOpen] = useState<number>()
  const shown = open === undefined ? undefined : chips[open]
  return (
    <div className={css.stepChips} role="group" aria-label={t('stepChips')}>
      {chips.map((chip, i) => {
        const detail = chip.input !== undefined || chip.output !== undefined
        const label = `${chip.tool} · ${t(LABEL[chip.state])}`
        return (
          <button key={i} type="button" className={css.stepChip} data-state={chip.state} aria-expanded={detail ? open === i : undefined}
            disabled={!detail} title={label} aria-label={label} onClick={() => { setOpen(open === i ? undefined : i) }}>
            <span className={css.stepMark} aria-hidden />
            <b>{chip.tool}</b>
          </button>
        )
      })}
      {shown !== undefined && (
        <div className={css.stepOut} data-state={shown.state} role="region" aria-label={t('stepOutput', { tool: shown.tool })}>
          {shown.input !== undefined && <div><span>{t('stepInput')}</span><code>{shown.input}</code></div>}
          {shown.output !== undefined && <div><span>{t('stepResult')}</span><code>{shown.output}</code></div>}
        </div>
      )}
    </div>
  )
}
