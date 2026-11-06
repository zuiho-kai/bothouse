// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelMember } from '../src/client/channel-source.ts'
import {
  buildMentionMatcher,
  formatMentionBadgeText,
  highlightMentionsInElement,
  HighlightedMarkdown,
  renderQuoteMentions,
  splitMentions,
} from '../src/client/mention-highlight.tsx'
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
