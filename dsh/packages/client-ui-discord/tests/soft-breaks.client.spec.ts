import { describe, expect, it } from 'vitest'
import { softBreaksToHard } from '../src/client/softBreaks.ts'

describe('softBreaksToHard', () => {
  it('turns a single newline between two lines into a hard break', () => {
    expect(softBreaksToHard('甲\n乙')).toBe('甲  \n乙')
    expect(softBreaksToHard('甲\n乙\n丙')).toBe('甲  \n乙  \n丙')
  })
  it('leaves paragraph breaks and edges alone', () => {
    expect(softBreaksToHard('甲\n\n乙')).toBe('甲\n\n乙')
    expect(softBreaksToHard('甲\n')).toBe('甲\n')
    expect(softBreaksToHard('')).toBe('')
  })
  it('does not touch fenced code blocks, including their fence lines', () => {
    const text = '说明\n```js\na()\nb()\n```\n后'
    expect(softBreaksToHard(text)).toBe('说明\n```js\na()\nb()\n```\n后')
    expect(softBreaksToHard('~~~\na\nb\n~~~')).toBe('~~~\na\nb\n~~~')
    expect(softBreaksToHard('````\n```\nx\n````')).toBe('````\n```\nx\n````')
  })
  it('does not touch indented code', () => {
    expect(softBreaksToHard('前\n\n    a\n    b\n\n后')).toBe('前\n\n    a\n    b\n\n后')
    expect(softBreaksToHard('前\n\n\ta\n\tb')).toBe('前\n\n\ta\n\tb')
  })
  it('keeps existing hard breaks as they are', () => {
    expect(softBreaksToHard('甲  \n乙')).toBe('甲  \n乙')
    expect(softBreaksToHard('甲\\\n乙')).toBe('甲\\\n乙')
  })
  it('adds a break inside a continued list item', () => {
    expect(softBreaksToHard('- 甲\n  续行')).toBe('- 甲  \n  续行')
  })
  it('treats CRLF like LF, without extra blank lines', () => {
    expect(softBreaksToHard('甲\r\n乙')).toBe('甲  \n乙')
    expect(softBreaksToHard('甲\r\n\r\n乙')).toBe('甲\n\n乙')
  })
  it('does not touch fences inside block quotes or deeply indented in lists', () => {
    expect(softBreaksToHard('> 引\n> ```\n> a\n> b\n> ```\n> 尾')).toBe('> 引\n> ```\n> a\n> b\n> ```\n> 尾')
    expect(softBreaksToHard('- 项\n      ```\n      a\n      b\n      ```')).toBe('- 项\n      ```\n      a\n      b\n      ```')
  })
})
