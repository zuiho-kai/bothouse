import { describe, expect, it } from 'vitest'
import type { ChannelMember, ChannelMessage } from '../src/client/channel-source.ts'
import { isMentionOrReply } from '../src/client/unread.ts'

const members: ChannelMember[] = [
  { id: 'owner', name: '大主人', kind: 'human', online: true },
  { id: 'bot1', name: '小豆包', kind: 'bot', online: true },
  { id: 'bot2', name: '肥鱼', kind: 'bot', online: true },
]

function makeMsg(overrides: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 1,
    room_id: 1,
    author_kind: 'role',
    author: 'bot1',
    name: '小豆包',
    text: 'hello',
    created_at: 100,
    card: null,
    from_turn: null,
    ...overrides,
  }
}

describe('unread & mention detection (#145)', () => {
  it('does not flag user own message as mention or reply', () => {
    const msg = makeMsg({ author_kind: 'user', author: 'owner', text: '@大主人 提醒自己' })
    expect(isMentionOrReply(msg, 'owner', members)).toBe(false)
  })

  it('detects explicit @mention by owner name or id', () => {
    expect(isMentionOrReply(makeMsg({ text: '@大主人 请看这个改动' }), 'owner', members)).toBe(true)
    expect(isMentionOrReply(makeMsg({ text: '你好 @owner' }), 'owner', members)).toBe(true)
    expect(isMentionOrReply(makeMsg({ text: '<@owner> 任务已完成' }), 'owner', members)).toBe(true)
  })

  it('detects AI reply to user message', () => {
    const reply = makeMsg({
      text: '已收到指令，马上开始做',
      reply_to: { id: 10, author_kind: 'user', author: 'owner', name: '大主人', text: '去修下bug' },
    })
    expect(isMentionOrReply(reply, 'owner', members)).toBe(true)
  })

  it('does not flag AI messages addressing other members', () => {
    const msg = makeMsg({
      text: '@肥鱼 看看这个PR',
      reply_to: { id: 12, author_kind: 'role', author: 'bot2', name: '肥鱼', text: '正在跑测试' },
    })
    expect(isMentionOrReply(msg, 'owner', members)).toBe(false)
  })
})
