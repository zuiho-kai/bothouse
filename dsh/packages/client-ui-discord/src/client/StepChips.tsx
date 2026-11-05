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
interface StepGroup { tool: string; state: StepChip['state']; steps: StepChip[] }

/** 用户 2026-11-04：brief 连续 bash 显示真实次数；失败和在途状态不能被成功覆盖。 */
function groupBash(chips: readonly StepChip[]): StepGroup[] {
  const groups: StepGroup[] = []
  for (const chip of chips) {
    const previous = groups.at(-1)
    if (chip.tool.toLowerCase() === 'bash' && previous?.tool.toLowerCase() === 'bash') {
      previous.steps.push(chip)
      const states = [previous.state, chip.state]
      previous.state = states.includes('failed') ? 'failed' : states.includes('running') ? 'running' : states.includes('unknown') ? 'unknown' : 'ok'
    } else groups.push({ tool: chip.tool, state: chip.state, steps: [chip] })
  }
  return groups
}

/** Older cards have only brief text; recognize the producer's tool lines, leave other prose intact. */
export function compactBrief(brief: string): string {
  const lines = brief.split('\n').map(line => {
    const match = /^(✅|❌|🔧) (bash)(?: · (成功|失败|进行中))?$/i.exec(line)
    const state: StepChip['state'] = match?.[1] === '❌' ? 'failed' : match?.[1] === '✅' ? 'ok' : match?.[3] === '进行中' ? 'running' : 'unknown'
    return { tool: match?.[2] ?? '', state, output: line }
  })
  return groupBash(lines).map(group => {
    if (group.steps.length === 1) return group.steps[0]!.output
    const status = { failed: '❌', ok: '✅', running: '🔧', unknown: '🔧' }[group.state]
    const suffix = { failed: ' · 失败', ok: ' · 成功', running: ' · 进行中', unknown: '' }[group.state]
    return `${status} ${group.tool} ×${group.steps.length}${suffix}`
  }).join('\n')
}

export function StepChips({ chips: given, runState, t }: { chips: readonly StepChip[]; runState?: string; t: T }) {
  const [open, setOpen] = useState<number>()
  // A step can only still run while its run does: once the card is done, failed or cancelled,
  // an open step has no reported outcome.
  const chips = runState === 'running' ? given : given.map(c => c.state === 'running' ? { ...c, state: 'unknown' as const } : c)
  const groups = groupBash(chips)
  const shown = open === undefined ? undefined : groups[open]
  return (
    <div className={css.stepChips} role="group" aria-label={t('stepChips')}>
      {groups.map((chip, i) => {
        const detail = chip.steps.some(step => step.input !== undefined || step.output !== undefined)
        const name = `${chip.tool}${chip.steps.length > 1 ? ` ×${chip.steps.length}` : ''}`
        const label = `${name} · ${t(LABEL[chip.state])}`
        return (
          <button key={i} type="button" className={css.stepChip} data-state={chip.state} aria-expanded={detail ? open === i : undefined}
            disabled={!detail} title={label} aria-label={label} onClick={() => { setOpen(open === i ? undefined : i) }}>
            <span className={css.stepMark} aria-hidden />
            <b>{name}</b>
          </button>
        )
      })}
      {shown !== undefined && (
        <div className={css.stepOut} data-state={shown.state} role="region" aria-label={t('stepOutput', { tool: shown.tool })}>
          {shown.steps.map((step, i) => (
            <div key={i} data-state={step.state}>
              {shown.steps.length > 1 && <b>{step.tool} · {t(LABEL[step.state])}</b>}
              {step.input !== undefined && <div><span>{t('stepInput')}</span><code>{step.input}</code></div>}
              {step.output !== undefined && <div><span>{t('stepResult')}</span><code>{step.output}</code></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
