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
  ['看@肥鱼', ['dsh']],
  ['x<@1001>y', []],
  ['@unknown_user 和 @test_bot', []],
  // #237 rework: an inline code span calls nobody and colours nothing, like a fence
  ['看 `@肥鱼` 这个', []],
  ['`@肥鱼` 和 @G哥 看下', ['gge']],
  ['``@肥鱼`` 和 ``@G哥``', []],
  ['`a` 和 @肥鱼', ['dsh']],
  ['@肥鱼 后跟 `未闭合的反引号', ['dsh']],
  ['`@肥鱼``x 不是行内代码', ['dsh']],
  // #245: a blank line ends the paragraph, so backticks around it are not a code span; the page
  // shows both names as plain text, so the backend must wake both.
  ['`@肥鱼\n\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n \n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n\t\n@G哥`', ['dsh', 'gge']],
  // a single line break is still one code span: nobody is called or coloured
  ['`@肥鱼\n@G哥`', []],
  // #246: CRLF is a single line ending; only an actual blank line ends the span.
  ['`@肥鱼\r\n@G哥`', []],
  ['`@肥鱼\r@G哥`', []],
  ['`@肥鱼\r\n\r\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\r\n \r\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\r\n\t\r\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\r\r@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n\r\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\r\n\n@G哥`', ['dsh', 'gge']],
  // the span closed before the blank line still counts, the name after it is text
  ['`@肥鱼`\n\n@G哥 看下', ['gge']],
  // #259: a block-level line ends the paragraph too, so the backticks are plain text and both
  // names are calls. Before this rule the page coloured two while the backend called nobody.
  ['`@肥鱼\n# 标题\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n- 列表\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n* 列表\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n> 引用\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n---\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n<div>x</div>\n@G哥`', ['dsh', 'gge']],
  // the rest of the block family ends it the same way
  ['`@肥鱼\n1. 一\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\n===\n@G哥`', ['dsh', 'gge']],
  // a line that does not open a block keeps one span: nobody is called or coloured
  ['`@肥鱼\n普通一行\n@G哥`', []],
  ['`@肥鱼\na # b\n@G哥`', []],
  ['`@肥鱼\na > b\n@G哥`', []],
  ['`@肥鱼\n1.x\n@G哥`', []],
  ['`@肥鱼\n<span>x</span>\n@G哥`', []],
  ['`@肥鱼\n    # 四空格\n@G哥`', []],
  // inside a quote or a list item the block ends the paragraph, the plain line does not
  ['> `@肥鱼\n> # 标题\n> @G哥`', ['dsh', 'gge']],
  ['> `@肥鱼\n> 普通一行\n> @G哥`', []],
  ['- `@肥鱼\n  - 列表\n  @G哥`', ['dsh', 'gge']],
  ['- `@肥鱼\n  普通一行\n  @G哥`', []],
  // a block reached with CRLF endings behaves the same
  ['`@肥鱼\r\n# 标题\r\n@G哥`', ['dsh', 'gge']],
  ['`@肥鱼\r# 标题\r@G哥`', ['dsh', 'gge']],
  // #271: the renderer hides a footnote definition whose label nothing calls, together with the
  // lines that continue it, so an @ inside that body is not on the page and must not be called.
  ['[^1]: 注\n`@肥鱼\n# 标题\n`', []],
  ['[^1]: 注\n`@肥鱼\n- 列表\n`', []],
  ['[^1]: 注\n`@肥鱼\n> 引用\n`', []],
  ['[^1]: 注\n`@肥鱼\n---\n`', []],
  ['[^1]: 注\n`@肥鱼\n<div>x</div>\n`', []],
  ['[^1]: 注\n@肥鱼 看下', []],
  ['[^1]: 注\n    @肥鱼 代码', []],
  ['[^1]: 注\n\n@肥鱼 看下', ['dsh']],
  ['[^1]: 注\n# 标题\n@肥鱼', ['dsh']],
  ['[^1]: 注 @肥鱼\n\n见 [^1]', ['dsh']],
  ['[^1]: 甲 @肥鱼\n\n[^1]: 乙 @G哥\n\n见 [^1]', ['dsh']],
  ['[^1]: 注 @肥鱼\n\n`[^1]`', []],
  // #271 rework: two definitions in a row are two bodies, so the label the text refers to is not
  // swallowed by the first body. Every line family a definition can sit on, one case each.
  ['[^1]: a\n[^2]: 注 @G哥\n\n见 [^2]', ['gge']],
  ['[^1]: a\n[^2]: b\n[^3]: 注 @G哥\n\n见 [^3]', ['gge']],
  ['[^1]: a\n   [^2]: 注 @G哥\n\n见 [^2]', ['gge']],
  ['> [^1]: a\n> [^2]: 注 @G哥\n\n> 见 [^2]', ['gge']],
  ['- [^1]: a\n  [^2]: 注 @G哥\n\n- 见 [^2]', ['gge']],
  ['[^1]: a\r\n[^2]: 注 @G哥\r\n\r\n见 [^2]', ['gge']],
  ['[^1]: a\n    [^2]: 注 @G哥\n\n见 [^1]', ['gge']],
  // #271 rework: a reference on a definition line counts — the page prints that text — while the
  // `[^x]:` marker itself stays invisible
  ['[^1]: 见 [^2]\n\n[^2]: @G哥\n\n见 [^1]', ['gge']],
  ['[^1]: 见 [^2]\n\n[^2]: 见 [^3]\n\n[^3]: @G哥\n\n见 [^1]', ['gge']],
  ['[^1]: 见 [^2]\n\n[^2]: 见 [^3]\n\n[^3]: 见 [^4]\n\n[^4]: @G哥\n\n见 [^1]', ['gge']],
  ['[^1]: 见 \\[^2]\n\n[^2]: @G哥\n\n见 [^1]', []],
  ['[^1]: 注 @肥鱼', []],
  // #271 rework: a definition line with no body opens no paragraph, so the next plain line is text
  ['[^1]:\n@肥鱼 看下', ['dsh']],
  ['[^1]: 注\n@肥鱼 看下', []],
  ['[@肥鱼 看下', ['dsh']],
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
