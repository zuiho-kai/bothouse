import { describe, expect, it } from 'vitest'
import { tidyNotice } from '../src/client/notice-tidy.ts'

// #1620 返工（主角色 11-14 看 a2/a5/a6 打回：交接灰字半屏、汇报两个「做了什么」）
const job = '你们俩一起做一件活：小橙写 fib.py 打印前 20 个斐波那契数并跑一遍；小蓝等小橙写完后读 fib.py 跑一遍，然后挑一条改进意见写给小橙。各自做完交回。'
describe('#1620 rework', () => {
  it('a joint 【交接】 row reads as one line, the whole note folded', () => {
    const first = tidyNotice(`【交接】小蓝：${job}\n\n同一件活还 @ 了 小橙，她接了也进这个工作区：共用目录 /private/tmp/x（就是你的当前目录），队友的文件直接在这里找。你那一份做完就回复首行写 [report] 交回自己那份。`)
    expect(first.text).toBe('')
    expect(first.detail?.summary).toBe('【交接】小蓝：小蓝等小橙写完后读 fib.py 跑一遍，然后挑一条改进…（和 小橙 同一工作区）')
    expect(first.detail?.body).toContain('/private/tmp/x')
    const later = tidyNotice(`【交接】小橙：${job}\n\n同一件活 小蓝 也在这个工作区：共用目录 /private/tmp/x（就是你的当前目录）。`)
    expect(later.detail?.summary).toBe('【交接】小橙：小橙写 fib.py 打印前 20 个斐波那契数并跑一遍（和 小蓝 同一工作区）')
  })
  it('a one-member 【交接】 row is left as it was', () => {
    expect(tidyNotice('【交接】DeepSeek：修登录页\n验收：iPhone 上能看见登录按钮')).toEqual({ text: '【交接】DeepSeek：修登录页\n验收：iPhone 上能看见登录按钮' })
  })
  it('「做了什么：」 on two lines keeps one label', () => {
    expect(tidyNotice('背景：写 hi\n\n做了什么：写好 hi.py。\n做了什么：写好 test_hi.py，跑过。\n\n要你做的：无\n我加的：无').text)
      .toBe('背景：写 hi\n\n做了什么：写好 hi.py。\n写好 test_hi.py，跑过。')
  })
})
