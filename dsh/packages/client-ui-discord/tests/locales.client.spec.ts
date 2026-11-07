// #1140: every English string the channel panel shows must be English. The English help for
// Direct messages used to name 私聊 / 发私信 — the Chinese UI's labels — so an English reader was
// sent looking for a button that is not on their screen.

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

// Keys whose English value legitimately keeps a Chinese word. Empty today: the panel's English
// dictionary should be free of CJK, and a future exception has to say why here.
const ALLOWED: readonly (keyof typeof en)[] = []

describe('the English dictionary', () => {
  it('has no Chinese characters outside the allowed list', () => {
    // Han, CJK punctuation and full-width forms: what a Chinese word or a Chinese-format string has.
    const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
    const offenders = (Object.keys(en) as (keyof typeof en)[])
      .filter(key => !ALLOWED.includes(key))
      .filter(key => cjk.test(en[key]))
      .map(key => `${key}: ${en[key]}`)
    expect(offenders).toEqual([])
  })

  it('names the direct-message entry points the way the English UI labels them', () => {
    // The help points at real controls: dmNew (New message), dmGroup (Direct messages), dmOpen
    // (Message privately). Keep this in step with the dictionary, not with a copy of the wording.
    expect(en.capabilityDmHelp).toContain(en.dmNew)
    expect(en.capabilityDmHelp).toContain(en.dmGroup)
    expect(en.capabilityDmHelp).toContain(en.dmOpen)
  })

  it('keeps both dictionaries on the same keys and placeholders', () => {
    // A value the English side forgot would fall back to Chinese at runtime; a dropped {name}
    // would render the raw placeholder. Compare the key sets and the placeholders, not the text.
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    const placeholders = (text: string): string[] => (text.match(/\{[a-z]+\}/g) ?? []).sort()
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect([key, placeholders(en[key])]).toEqual([key, placeholders(zh[key])])
    }
  })
})
