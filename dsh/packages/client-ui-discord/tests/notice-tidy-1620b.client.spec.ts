import { describe, expect, it } from 'vitest'
import { tidyNotice } from '../src/client/notice-tidy.ts'

// #1620 second rework (user 11-14): a bounce, reminder or nudge the system writes to a member shows one line, the rest folded.
describe('notice-tidy: system words to a member fold to one line', () => {
  it('a bounced [report]', () => {
    const text = '📬 @小橙 这条 [report] 没有转给用户：「要你做的」把能自己做的事交给了用户（运行 fib.py），这条退回，先换路：用户定过沙盒……。补上后重发：第一行写 [report] #任务板编号 背景：……'
    const t = tidyNotice(text)
    expect(t.text).toBe('')
    expect(t.detail?.summary).toBe('小橙 的汇报被退回：「要你做的」把能自己做的事交给了用户（运行 fib.py）')
    expect(t.detail?.body).toBe(text)
  })
  it('the no-[report] nudge, the watch reminder, the review reminder, the handover and the pause', () => {
    expect(tidyNotice('@小蓝 #6「写 hi.py 打印 hi 并跑一遍」这一轮没有写 [report]，还挂着没交回。你那一份做完了就……').detail?.summary).toBe('系统提醒 小蓝 补交回 #6')
    expect(tidyNotice('@小蓝 任务 #6「写 hi.py」到了检查时间还没交回：请交回结果，或说明卡在哪。').detail?.summary).toBe('系统催 小蓝 交回 #6')
    expect(tidyNotice('@小橙 #6「写 hi.py」交回 10 分钟还没验收。验收 #6：回复里单独一行写…').detail?.summary).toBe('系统提醒 小橙 验收 #6')
    expect(tidyNotice('@小蓝 #6「写 hi.py」交回超过 10 分钟，小橙 在忙，转给你验收（写的人 小橙 不验收自己的活）。\n\n交回内容：\n…').detail?.summary).toBe('#6 转给 小蓝 验收：小橙 在忙')
    expect(tidyNotice('@小蓝 #6「写 hi.py」10 分钟内没有新进展，已暂停。做完了就交回：……').detail?.summary).toBe('#6 已暂停（10 分钟内没有新进展），系统已通知 小蓝')
  })
  it('a title quoting inside itself', () => {
    expect(tidyNotice('@小蓝 #6「写 hi.py 打印 hi；做完那一轮只回两个字「完了」，不加任何标记。」这一轮没有写 [report]，还挂着没交回。你那一份做完了就……').detail?.summary).toBe('系统提醒 小蓝 补交回 #6')
  })
  it('a task row whose title quotes inside itself is cut like any title', () => {
    expect(tidyNotice('#6「写 hi.py 打印 hi 并跑一遍，再写个 test_hi.py；做完那一轮只回两个字「完了」，不加任何标记。」小蓝 交回，用时 37 秒').text)
      .toBe('#6「写 hi.py 打印 hi 并跑一遍…」小蓝 交回，用时 37 秒')
  })
  it('a notice not written to a member stays as it is', () => {
    expect(tidyNotice('#4「小橙写 fib.py」小橙 交回，用时 18 秒').detail).toBeUndefined()
  })
})
