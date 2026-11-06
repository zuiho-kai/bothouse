// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelMember } from '../src/client/channel-source.ts'
import {
  buildMentionMatcher,
  codeSpanRanges,
  fencedRanges,
  formatMentionBadgeText,
  highlightMentionsInElement,
  HighlightedMarkdown,
  renderQuoteMentions,
  splitMentions,
} from '../src/client/mention-highlight.tsx'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mentions as backendMentions } from '../../../collab/mentions.mjs'
import css from '../src/client/ChannelsPage.module.css'

afterEach(cleanup)

const testMembers: ChannelMember[] = [
  { id: 'fish', name: '肥鱼', kind: 'bot', online: true, mentionId: '1001' },
  { id: 'gjiang', name: '大豆包', kind: 'bot', online: true },
  { id: 'gge', name: 'G哥', kind: 'bot', online: true },
  { id: 'yuzi_long', name: '阿柚子', kind: 'bot', online: true },
  { id: 'yuzi', name: '阿柚', kind: 'bot', online: true },
  { id: 'cat', name: 'cat', kind: 'bot', online: true },
  { id: 'owner', name: 'Owner', kind: 'human', online: true },
]

describe('mention-highlight logic', () => {
  it('builds matcher prioritizing longest alias and enforces boundary rules', () => {
    const matcher = buildMentionMatcher(testMembers)
    expect(matcher).toBeDefined()

    // Single mention
    expect(splitMentions('@肥鱼 你好', testMembers)).toEqual([
      { text: '@肥鱼', member: testMembers[0] },
      { text: ' 你好' },
    ])

    // Multiple mentions
    expect(splitMentions('@肥鱼 和 @大豆包', testMembers)).toEqual([
      { text: '@肥鱼', member: testMembers[0] },
      { text: ' 和 ' },
      { text: '@大豆包', member: testMembers[1] },
    ])

    // Longest alias wins: @阿柚子 before @阿柚
    const yuziResult = splitMentions('@阿柚子 和 @阿柚', testMembers)
    expect(yuziResult[0]).toEqual({ text: '@阿柚子', member: testMembers[3] })
    expect(yuziResult[2]).toEqual({ text: '@阿柚', member: testMembers[4] })

    // ASCII word boundary: @cat should not match in @category
    const catResult = splitMentions('@category and @cat', testMembers)
    expect(catResult).toEqual([
      { text: '@category and ' },
      { text: '@cat', member: testMembers[5] },
    ])

    // Email addresses must not be false-positively matched
    expect(splitMentions('email test@cat.com or user@gjiang.net', testMembers)).toEqual([
      { text: 'email test@cat.com or user@gjiang.net' },
    ])

    // Unregistered/invalid @ mentions are not highlighted
    expect(splitMentions('请联系 @unknown_user 和 @test_bot', testMembers)).toEqual([
      { text: '请联系 @unknown_user 和 @test_bot' },
    ])

    // Discord numeric mention format <@1001> and <@!1001>
    expect(splitMentions('来自 <@1001> 的消息', testMembers)).toEqual([
      { text: '来自 ' },
      { text: '<@1001>', member: testMembers[0] },
      { text: ' 的消息' },
    ])
  })

  it('formats badge display text cleanly', () => {
    expect(formatMentionBadgeText('@肥鱼', testMembers[0]!)).toBe('@肥鱼')
    expect(formatMentionBadgeText('<@1001>', testMembers[0]!)).toBe('@肥鱼')
    expect(formatMentionBadgeText('<@!1001>', testMembers[0]!)).toBe('@肥鱼')
  })

  // #237: these cases come in pairs with dsh/collab/mentions.test.mjs — the page and the backend
  // must agree on who a message calls, so a coloured name is exactly a member that gets woken.
  it('does not colour an @ inside a ``` fence, and colours the rest of the text (#237)', () => {
    const fenced = '```\n@肥鱼 看下\n```'
    expect(splitMentions(fenced, testMembers)).toEqual([{ text: fenced }])

    const mixed = '```\n@肥鱼 在代码里\n```\n@大豆包 你看下'
    const segments = splitMentions(mixed, testMembers)
    expect(segments.filter(s => s.member).map(s => s.text)).toEqual(['@大豆包'])
    expect(segments.map(s => s.text).join('')).toBe(mixed)

    // fencedRanges: an opening fence without its closing one covers the rest, as in mentions.mjs
    expect(fencedRanges('a ```\n@肥鱼')).toEqual([[5, 9]])
    expect(fencedRanges('```x``` tail ```y```')).toEqual([[3, 4], [16, 17]])
    expect(fencedRanges('no fence @肥鱼')).toEqual([])
  })

  it('leaves an email address uncoloured and still colours a name after punctuation', () => {
    expect(splitMentions('联系 xx@肥鱼.ai', testMembers)).toEqual([{ text: '联系 xx@肥鱼.ai' }])
    expect(splitMentions('[@肥鱼] 在吗', testMembers)).toEqual([
      { text: '[' },
      { text: '@肥鱼', member: testMembers[0] },
      { text: '] 在吗' },
    ])
  })

  // #237 rework: the renderer turns `…` into <code> and never colours it, so an @ inside an
  // inline code span must not count on the backend either. Ranges follow mentions.mjs.
  it('does not colour an @ inside an inline code span, and colours the rest (#237 rework)', () => {
    expect(splitMentions('看 `@肥鱼` 这个', testMembers)).toEqual([{ text: '看 `@肥鱼` 这个' }])

    const mixed = '`@肥鱼` 和 @大豆包 看下'
    const segments = splitMentions(mixed, testMembers)
    expect(segments.filter(s => s.member).map(s => s.text)).toEqual(['@大豆包'])
    expect(segments.map(s => s.text).join('')).toBe(mixed)

    // a run of two backticks opens and closes its own span
    expect(splitMentions('``@肥鱼`` 和 @大豆包', testMembers).filter(s => s.member)).toEqual([
      { text: '@大豆包', member: testMembers[1] },
    ])
    // a lone backtick is literal text; adjacent runs of different lengths do not pair
    expect(splitMentions('@肥鱼 后跟 `未闭合', testMembers).filter(s => s.member)).toEqual([
      { text: '@肥鱼', member: testMembers[0] },
    ])
    expect(codeSpanRanges("看 `@肥鱼` 这个")).toEqual([[3, 6]])
    expect(codeSpanRanges('`a` 和 `b`')).toEqual([[1, 2], [7, 8]])
    expect(codeSpanRanges('```x```')).toEqual([])
    expect(codeSpanRanges('`@肥鱼``x')).toEqual([])
  })

  // #245: a blank line ends the paragraph, so a run of backticks cannot close a span across it.
  // The page showed both names in plain text while the backend woke nobody; now both agree.
  // The renderer is the ground truth for "what the page shows as <code>": compare our span
  // offsets with the inlineCode nodes mdast-util-from-markdown produces (#245).
  it('reads inline code spans the way the markdown renderer does (#245)', () => {
    const rendererSpans = (text: string): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      const walk = (node: any): void => {
        if (node.type === 'inlineCode') out.push([node.position.start.offset, node.position.end.offset])
        for (const child of node.children ?? []) walk(child)
      }
      walk(fromMarkdown(text))
      return out
    }
    const raw = (text: string, spans: Array<[number, number]>): string[] =>
      spans.map(([start, end]) => text.slice(start, end))

    for (const text of [
      '`a` b',
      '`a\nb`',
      '`a\r\nb`',
      '`a\rb`',
      '`a\r\n\r\nb`',
      '`a\r\rb`',
      '`a\n\nb`',
      '`a\n \nb`',
      '`a`\n\n`b`',
      '`@肥鱼\n\n@G哥`',
      '看 `@肥鱼` 这个',
    ]) {
      // our ranges are the span without its backtick fence; add the fence back for comparison
      const ours = codeSpanRanges(text).map(([start, end]) => {
        const open = text.lastIndexOf('`', start - 1)
        let close = end
        while (text[close] === '`') close++
        return text.slice(open, close)
      })
      expect(ours).toEqual(raw(text, rendererSpans(text)))
    }
  })

  it('does not treat backticks across a blank line as an inline code span (#245)', () => {
    expect(codeSpanRanges('`a\n\nb`')).toEqual([])
    expect(codeSpanRanges('`a\n \nb`')).toEqual([])
    expect(codeSpanRanges('`a\n\t\nb`')).toEqual([])
    // a single line break is not a blank line, so the span still holds
    expect(codeSpanRanges('`a\nb`')).toEqual([[1, 4]])
    // runs after the rejected opener still pair with each other
    expect(codeSpanRanges('`a\n\nb` 和 `c`')).toEqual([[6, 9]])

    const blank = '`@肥鱼\n\n@G哥`'
    expect(splitMentions(blank, testMembers).filter(s => s.member).map(s => s.text)).toEqual([
      '@肥鱼',
      '@G哥',
    ])
    expect(splitMentions(blank, testMembers).map(s => s.text).join('')).toBe(blank)
    // one line break keeps the span, so neither name is coloured
    expect(splitMentions('`@肥鱼\n@G哥`', testMembers).filter(s => s.member)).toEqual([])
  })
})

describe('highlightMentionsInElement DOM processing', () => {
  it('highlights mentions in text nodes without modifying code blocks', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <p>Hello @肥鱼, check this out!</p>
      <pre><code>console.log('@肥鱼 in code')</code></pre>
      <p>Inline <code>@肥鱼 inline code</code> should be untouched, but @大豆包 should be highlighted.</p>
    `

    highlightMentionsInElement(container, testMembers, css.mentionBadge)

    // Code blocks remain untouched
    const codeElements = container.querySelectorAll('code')
    expect(codeElements[0]?.textContent).toBe("console.log('@肥鱼 in code')")
    expect(codeElements[0]?.querySelector(`.${css.mentionBadge}`)).toBeNull()
    expect(codeElements[1]?.textContent).toBe('@肥鱼 inline code')
    expect(codeElements[1]?.querySelector(`.${css.mentionBadge}`)).toBeNull()

    // Mentions outside code blocks are highlighted as badges
    const badges = container.querySelectorAll<HTMLElement>(`.${css.mentionBadge}`)
    expect(badges.length).toBe(2)
    expect(badges[0]?.textContent).toBe('@肥鱼')
    expect(badges[0]?.dataset.mention).toBe('fish')
    expect(badges[0]?.title).toBe('@肥鱼')
    expect(badges[1]?.textContent).toBe('@大豆包')
    expect(badges[1]?.dataset.mention).toBe('gjiang')
    expect(badges[1]?.title).toBe('@大豆包')
  })

  it('is idempotent when executed repeatedly', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>Hello @肥鱼 and @G哥</p>'

    highlightMentionsInElement(container, testMembers, css.mentionBadge)
    const firstHtml = container.innerHTML

    highlightMentionsInElement(container, testMembers, css.mentionBadge)
    const secondHtml = container.innerHTML

    expect(firstHtml).toBe(secondHtml)
    expect(container.querySelectorAll(`.${css.mentionBadge}`).length).toBe(2)
  })
})

describe('renderQuoteMentions', () => {
  it('renders quote text with mention pill badges', () => {
    const onMention = vi.fn()
    const elements = renderQuoteMentions('回复 @肥鱼：请看这个', testMembers, onMention, css.mentionBadge)
    const { container } = render(<div>{elements}</div>)

    const badge = container.querySelector<HTMLElement>(`.${css.mentionBadge}`)
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('@肥鱼')
    expect(badge?.dataset.mention).toBe('fish')
    expect(badge?.title).toBe('@肥鱼')

    fireEvent.click(badge!)
    expect(onMention).toHaveBeenCalledWith(testMembers[0])
  })
})

describe('HighlightedMarkdown component', () => {
  const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

  // #246: compare the real MarkdownText DOM with both matchers. Comparing only the two
  // matchers let them agree on the same CRLF bug while the page rendered inline code.
  it.each([
    ['LF single', '\n', []],
    ['CRLF single', '\r\n', []],
    ['CR single', '\r', []],
    ['LF blank', '\n\n', ['fish', 'gge']],
    ['CRLF blank', '\r\n\r\n', ['fish', 'gge']],
    ['CR blank', '\r\r', ['fish', 'gge']],
    ['CRLF space blank', '\r\n \r\n', ['fish', 'gge']],
    ['CRLF tab blank', '\r\n\t\r\n', ['fish', 'gge']],
    ['LF then CRLF blank', '\n\r\n', ['fish', 'gge']],
    ['CRLF then LF blank', '\r\n\n', ['fish', 'gge']],
  ] as Array<[string, string, string[]]>)('keeps actual badges and backend calls aligned: %s', (_label, ending, expected) => {
    const text = '`@肥鱼' + ending + '@G哥`'
    const { container } = render(<HighlightedMarkdown text={text} labels={labels} members={testMembers} />)
    const badges = [...container.querySelectorAll<HTMLElement>('[data-mention]')]
      .map(node => node.dataset.mention).sort()
    expect(badges).toEqual(expected)
    expect([...backendMentions(text, testMembers)].sort()).toEqual(badges)
    const segments = splitMentions(text, testMembers)
    expect(segments.filter(s => s.member).map(s => s.member!.id).sort()).toEqual(badges)
    expect(segments.map(s => s.text).join('')).toBe(text)
    expect(container.querySelectorAll('code').length).toBe(expected.length ? 0 : 1)
  })

  it('renders markdown text with mention pill badge and handles click', () => {
    const onMention = vi.fn()
    const { container } = render(
      <HighlightedMarkdown
        text="欢迎 @肥鱼 来到频道！"
        labels={labels}
        members={testMembers}
        className={css.text}
        onMention={onMention}
      />
    )

    const badge = container.querySelector<HTMLElement>(`.${css.mentionBadge}`)
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('@肥鱼')
    expect(badge?.dataset.mention).toBe('fish')
    expect(badge?.title).toBe('@肥鱼')

    fireEvent.click(badge!)
    expect(onMention).toHaveBeenCalledWith(testMembers[0])
  })

  it('does not trigger onMention when clicking non-badge text', () => {
    const onMention = vi.fn()
    const { container } = render(
      <HighlightedMarkdown
        text="普通消息文本没有@提到任何人"
        labels={labels}
        members={testMembers}
        className={css.text}
        onMention={onMention}
      />
    )

    expect(container.querySelector(`.${css.mentionBadge}`)).toBeNull()
    fireEvent.click(container.querySelector(`.${css.text}`)!)
    expect(onMention).not.toHaveBeenCalled()
  })
})
