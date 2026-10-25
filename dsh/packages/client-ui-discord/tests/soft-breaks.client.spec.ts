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
    expect(softBreaksToHard('- 外\n  - 内\n    ```\n    a\n    b\n    ```')).toBe('- 外\n  - 内\n    ```\n    a\n    b\n    ```')
  })
  it('follows CommonMark where a line only looks like a fence', () => {
    // Six spaces cannot open a fence or interrupt the paragraph: the backticks are one inline code
    // span, so only the prose line ending before it becomes a break.
    expect(softBreaksToHard('- 项\n      ```\n      a\n      b\n      ```')).toBe('- 项  \n      ```\n      a\n      b\n      ```')
  })

  it('reads a line that starts with an inline code span as prose', () => {
    expect(softBreaksToHard('```x``` 是行内\n甲\n乙')).toBe('```x``` 是行内  \n甲  \n乙')
  })
  it('keeps a fence opened on a list item line', () => {
    expect(softBreaksToHard('- ```bash\n  a\n  b\n  ```\n\n甲\n乙')).toBe('- ```bash\n  a\n  b\n  ```\n\n甲  \n乙')
    expect(softBreaksToHard('1. ```bash\n   a\n   ```')).toBe('1. ```bash\n   a\n   ```')
  })
  it('breaks quoted prose and leaves a quoted fence that the quote ends', () => {
    expect(softBreaksToHard('> 引\n> 二')).toBe('> 引  \n> 二')
    expect(softBreaksToHard('> ```\n> a\n\n甲\n乙')).toBe('> ```\n> a\n\n甲  \n乙')
  })
  it('leaves an unclosed fence alone', () => {
    expect(softBreaksToHard('前\n\n```\na\nb')).toBe('前\n\n```\na\nb')
  })
  it('does not break inside inline code that spans lines', () => {
    expect(softBreaksToHard('用 `a\nb` 跑\n下一行')).toBe('用 `a\nb` 跑  \n下一行')
  })
  it('keeps math blocks and inline math', () => {
    expect(softBreaksToHard('前\n\n$$\na\nb\n$$\n\n后\n行')).toBe('前\n\n$$\na\nb\n$$\n\n后  \n行')
    expect(softBreaksToHard('\\[\na \\\\\nb\n\\]')).toBe('\\[\na \\\\\nb\n\\]')
    expect(softBreaksToHard('式 \\(a\nb\\) 与 $c\nd$ 完\n下')).toBe('式 \\(a\nb\\) 与 $c\nd$ 完  \n下')
  })
  it('keeps tables and HTML blocks', () => {
    expect(softBreaksToHard('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(softBreaksToHard('<div>\na\nb\n</div>')).toBe('<div>\na\nb\n</div>')
  })
  it('turns CRLF code into LF without trailing spaces', () => {
    expect(softBreaksToHard('```\r\na\r\nb\r\n```\r\n甲\r\n乙')).toBe('```\na\nb\n```\n甲  \n乙')
  })
})
