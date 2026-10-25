import { describe, expect, it, vi } from 'vitest'
import { activeMention, applyMention, insertMention, rankMembers } from '../src/client/mention-complete.ts'
import type { ChannelMember } from '../src/client/channel-source.ts'

const members: ChannelMember[] = [
  { id: 'owner', name: '我', kind: 'human', online: true },
  { id: 'ju', name: '橘', kind: 'bot', online: true },
  { id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true },
  { id: 'whale', name: '鲸鱼娘', kind: 'bot', online: false },
  { id: 'dragon', name: '龙娘', kind: 'bot', online: true },
]

describe('mention completion', () => {
  it('opens on @ at a boundary and tracks the query up to the caret', () => {
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' })
    expect(activeMention('hi @de', 6)).toEqual({ start: 3, query: 'de' })
    expect(activeMention('看下，@橘', 5)).toEqual({ start: 3, query: '橘' })
    expect(activeMention('mail a@b.com', 12)).toBeUndefined()
    expect(activeMention('@橘 好的', 5)).toBeUndefined()
    expect(activeMention('@DeepSeek 你好', 3)).toEqual({ start: 0, query: 'De' })
  })

  it('lists agents before people, prefix before substring, online before offline', () => {
    expect(rankMembers(members, '').map(m => m.id)).toEqual(['ds', 'ju', 'dragon', 'whale', 'owner'])
    expect(rankMembers(members, 'd').map(m => m.id)).toEqual(['ds', 'dragon'])
    expect(rankMembers(members, 'EEP').map(m => m.id)).toEqual(['ds'])
    expect(rankMembers(members, '娘').map(m => m.id)).toEqual(['dragon', 'whale'])
    expect(rankMembers(members, 'zzz')).toEqual([])
  })

  it('keeps the same mixed-language ranking with Chinese and English system defaults', () => {
    const original = String.prototype.localeCompare
    const expected = ['ds', 'ju', 'dragon', 'whale', 'owner']
    for (const systemLocale of ['zh-CN', 'en-US']) {
      const compare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
        this: string, other: string, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions,
      ) {
        return original.call(this, other, locales ?? systemLocale, options)
      })
      try {
        expect(rankMembers(members, '').map(m => m.id)).toEqual(expected)
      } finally {
        compare.mockRestore()
      }
    }
  })

  it('splices @name into the draft and moves the caret after it', () => {
    const ds = members[2] as ChannelMember
    const text = '你好 @De 帮我看看'
    const caret = 6
    const mention = activeMention(text, caret)
    expect(mention).toBeDefined()
    expect(applyMention(text, caret, mention!, ds)).toEqual({ text: '你好 @DeepSeek 帮我看看', caret: 13 })
    expect(insertMention('看看', 2, ds)).toEqual({ text: '看看 @DeepSeek ', caret: 13 })
    expect(insertMention('', 0, ds)).toEqual({ text: '@DeepSeek ', caret: 10 })
  })
})
