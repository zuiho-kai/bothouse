import type { KeyboardEvent, RefObject } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { MentionPopover } from './MentionPopover.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface ComposerProps {
  inputRef: RefObject<HTMLTextAreaElement>
  draft: string
  sendError: string | undefined
  disabled: boolean
  placeholder: string
  popupOpen: boolean
  mentionQuery: string
  candidates: readonly ChannelMember[]
  selected: number
  busy: ReadonlySet<string>
  onDraftChange: (value: string, caret: number) => void
  onSelectCaret: (caret: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onOpenPicker: () => void
  onSelectCandidate: (member: ChannelMember) => void
  onHighlightCandidate: (index: number) => void
  t: T
}

export function Composer({
  inputRef,
  draft,
  sendError,
  disabled,
  placeholder,
  popupOpen,
  mentionQuery,
  candidates,
  selected,
  busy,
  onDraftChange,
  onSelectCaret,
  onKeyDown,
  onOpenPicker,
  onSelectCandidate,
  onHighlightCandidate,
  t,
}: ComposerProps) {
  return (
    <div className={css.composer}>
      {sendError !== undefined && <div className={css.sendError} role="alert">{sendError}</div>}
      {popupOpen && (
        <MentionPopover
          query={mentionQuery}
          candidates={candidates}
          selected={selected}
          busy={busy}
          onSelect={onSelectCandidate}
          onHighlight={onHighlightCandidate}
          t={t}
        />
      )}
      <div className={css.composerRow}>
        <textarea
          ref={inputRef}
          className={css.input}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={popupOpen}
          aria-controls="channel-mention-list"
          aria-autocomplete="list"
          aria-activedescendant={popupOpen && candidates[selected] ? `channel-mention-${candidates[selected]!.id}` : undefined}
          onChange={(event) => {
            onDraftChange(event.target.value, event.target.selectionStart)
          }}
          onSelect={(event) => { onSelectCaret(event.currentTarget.selectionStart) }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={css.mentionButton}
          title={t('mentionButton')}
          aria-label={t('mentionButton')}
          disabled={disabled}
          onClick={onOpenPicker}
        >
          @
        </button>
      </div>
    </div>
  )
}
