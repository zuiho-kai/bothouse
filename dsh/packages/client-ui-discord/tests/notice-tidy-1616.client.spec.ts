import { describe, expect, it } from 'vitest'
import { clipTitles, tidyNotice } from '../src/client/notice-tidy.ts'
import { outputLines } from '../src/client/StepChips.tsx'

// #1616 返工（用户 11-14 逐张看截图打回的几条）
describe('#1616 rework', () => {
  it('a cut title ends in one ellipsis, not 「fib.…」', () => {
    const out = clipTitles('#2「你们俩一起做一件活：小橙写 fib.py 打印前 20 个斐波那契数并跑一遍」小橙 交回')
    expect(out).toContain('「你们俩一起做一件活：小橙写 fib.py…」')
    expect(out).not.toMatch(/\.…|\.{2,}/)
    expect(clipTitles('「写个脚本...」')).toBe('「写个脚本…」')
  })
  it('lines dropped from a notice leave no blank stretch', () => {
    expect(tidyNotice('📬 背景：a\n\n验收 #3：回复里单独一行写【验收】#3\n\n\n做了什么：b\n我加的：无\n\n').text).toBe('📬 背景：a\n\n做了什么：b')
    expect(tidyNotice('验收 #3：回复里单独一行写【验收】#3').text).toBe('')
  })
  it('a tool\'s own middle cut reads as one ellipsis line', () => {
    expect(outputLines('a\nb\n\n[...]\n\nc\n')).toEqual(['a', 'b', '…', 'c'])
  })
})
