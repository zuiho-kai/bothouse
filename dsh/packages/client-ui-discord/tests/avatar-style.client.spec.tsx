// @vitest-environment jsdom
// #602: two built-in sets, default the vendors' own icons (user 2026-11-10「默认是各家原本的图标，内置另一套娘化图标」).
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { avatarSrc, DEFAULT_AVATAR_STYLE, matchAvatarSlug } from '../src/client/avatars.ts'
import { setAvatarStyle } from '../src/client/avatar-style.ts'
import { Avatar } from '../src/client/Avatar.tsx'

afterEach(() => { cleanup(); setAvatarStyle(DEFAULT_AVATAR_STYLE) })

it('defaults to the vendor icon set', () => {
  expect(DEFAULT_AVATAR_STYLE).toBe('brand')
  expect(matchAvatarSlug({ model: 'claude-opus-5-5' })).toBe('brand-claude')
  expect(matchAvatarSlug({ cli: 'codex' }, 'brand')).toBe('brand-openai')
  expect(matchAvatarSlug({ name: '肥鱼' }, 'brand')).toBe('brand-deepseek')
  expect(matchAvatarSlug({ model: 'grok-4' }, 'brand')).toBe('brand-grok')
})

it('maps the chibi set', () => {
  expect(matchAvatarSlug({ model: 'claude-opus-5-5' }, 'chibi')).toBe('orange')
  expect(matchAvatarSlug({ cli: 'gemini' }, 'chibi')).toBe('rainbow')
  expect(matchAvatarSlug({ name: 'minimax' }, 'chibi')).toBe('lanxi')
})

it('keeps a member own avatar above either set', () => {
  for (const style of ['brand', 'chibi'] as const) {
    expect(avatarSrc({ avatar: 'whale', model: 'claude' }, undefined, style)).toBe('collab/avatars/whale.png')
    expect(avatarSrc({ avatar: 'upload:me.png', model: 'claude' }, undefined, style)).toBe('collab/avatars/uploads/me.png')
    expect(avatarSrc({ avatar: 'https://x.test/a.png', model: 'claude' }, undefined, style)).toBe('https://x.test/a.png')
  }
})

it('switches every avatar when the set changes', () => {
  const { container } = render(<Avatar id="c" name="C酱" model="claude-opus-5-5" />)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('collab/avatars/brand-claude.png')
  act(() => { setAvatarStyle('chibi') })
  expect(container.querySelector('img')?.getAttribute('src')).toBe('collab/avatars/orange.png')
})
