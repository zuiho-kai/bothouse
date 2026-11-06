// #237: the channel page must colour exactly the members the backend calls. Both sides carry this
// same case table — this spec runs it against the page matcher and against dsh/collab/mentions.mjs
// and requires the two answers to be identical, so a rule change on one side alone turns red.
import { describe, expect, it } from 'vitest'
import type { ChannelMember } from '../src/client/channel-source.ts'
import { splitMentions } from '../src/client/mention-highlight.tsx'
import { mentions as backendMentions } from '../../../collab/mentions.mjs'

const members: ChannelMember[] = [
  { id: 'dsh', name: '肥鱼', kind: 'bot', online: true, mentionId: '1001' },
  { id: 'gge', name: 'G哥', kind: 'bot', online: true },
  { id: 'yuzi_long', name: '阿柚子', kind: 'bot', online: true },
  { id: 'yuzi', name: '阿柚', kind: 'bot', online: true },
  { id: 'cat', name: 'cat', kind: 'bot', online: true },
  { id: 'owner', name: 'Owner', kind: 'human', online: true },
]

const backendMembers = members.map(m => ({ id: m.id, name: m.name, mentionId: m.mentionId }))

// [text, the member ids it calls] — the rule the user asked for: coloured == called.
const CASES: Array<[string, string[]]> = [
  ['@肥鱼 你好', ['dsh']],
  ['@dsh 你好', ['dsh']],
  ['联系 xx@dsh.ai', []],
  ['user@cat.com', []],
  ['@dsh2 你好', []],
  ['@dsh_lab 你好', []],
  ['@肥鱼你好', ['dsh']],
  ['@G哥在吗', ['gge']],
  ['@肥鱼 和 @G哥一起看', ['dsh', 'gge']],
  ['```\n@G哥\n```', []],
  ['```js\n@肥鱼\n```', []],
  ['```\n@G哥\n```\n@肥鱼 看下', ['dsh']],
  ['<@1001> 你好', ['dsh']],
  ['<@!1001> 你好', ['dsh']],
  ['来自 <@dsh> 的消息', ['dsh']],
  ['@阿柚子 和 @阿柚', ['yuzi', 'yuzi_long']],
  ['「@肥鱼」看下', ['dsh']],
  ['[@肥鱼] 在吗', ['dsh']],
  ['@unknown_user 和 @test_bot', []],
]

describe('mention rule parity: page highlight == backend call (#237)', () => {
  it.each(CASES)('%s', (text, expected) => {
    const page = splitMentions(text, members)
    // the page keeps every character: colouring must not drop or reorder text
    expect(page.map(s => s.text).join('')).toBe(text)
    const pageIds = [...new Set(page.filter(s => s.member).map(s => s.member!.id))].sort()
    const backendIds = [...backendMentions(text, backendMembers)].sort()
    expect(backendIds).toEqual(expected)
    expect(pageIds).toEqual(backendIds)
  })
})
