// @vitest-environment jsdom
// #602: two built-in sets, default the vendors' own icons (user 2026-11-10「默认是各家原本的图标，内置另一套娘化图标」).
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { avatarSrc, DEFAULT_AVATAR_STYLE, matchAvatarSlug } from '../src/client/avatars.ts'
import { avatarStyle, resetAvatarStyleForTest, setAvatarStyle, startAvatarStyle } from '../src/client/avatar-style.ts'
import { Avatar } from '../src/client/Avatar.tsx'
import { CollabUrlContext, remoteCollabUrl } from '../src/client/collab-url.ts'

afterEach(() => { cleanup(); resetAvatarStyleForTest(); vi.unstubAllGlobals() })

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

it('reads the stored set from the bothouse settings answer', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ data: { avatar_style: 'chibi' } }), { status: 200 })) as unknown as typeof fetch
  startAvatarStyle(fetchImpl)
  await new Promise(r => setTimeout(r, 0))
  expect(avatarStyle()).toBe('chibi')
})

it('keeps local brand and paired chibi settings and switch notifications separate', async () => {
  const link = '12345678-1234-1234-1234-123456789abc'
  const remote = remoteCollabUrl(link)
  const channels = new Map<string, Set<FakeChannel>>()
  class FakeChannel {
    onmessage?: (event: MessageEvent) => void
    constructor(public name: string) {
      if (!channels.has(name)) channels.set(name, new Set())
      channels.get(name)!.add(this)
    }
    postMessage(data: unknown) {
      for (const peer of channels.get(this.name)!) {
        if (peer !== this) peer.onmessage?.(new MessageEvent('message', { data }))
      }
    }
    close() { channels.get(this.name)!.delete(this) }
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  const fetcher = vi.fn(async (path: string) => new Response(JSON.stringify({
    data: { avatar_style: path === remote('collab/panel/api/v1/settings') ? 'chibi' : 'brand' },
  })))
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<>
    <Avatar id="local" name="Local" model="claude" />
    <CollabUrlContext.Provider value={remote}>
      <Avatar id="remote" name="Remote" model="claude" />
    </CollabUrlContext.Provider>
  </>)
  const images = () => Array.from(container.querySelectorAll('img'), image => image.getAttribute('src'))
  await waitFor(() => expect(images()).toEqual([
    'collab/avatars/brand-claude.png', remote('collab/avatars/orange.png'),
  ]))
  expect(fetcher).toHaveBeenCalledWith('collab/panel/api/v1/settings', { credentials: 'same-origin' })
  expect(fetcher).toHaveBeenCalledWith(remote('collab/panel/api/v1/settings'), { credentials: 'same-origin' })
  act(() => { new FakeChannel('bothouse-avatar-style').postMessage('chibi') })
  expect(images()).toEqual(['collab/avatars/orange.png', remote('collab/avatars/orange.png')])
  act(() => { new FakeChannel(`bothouse-avatar-style:${link}`).postMessage('brand') })
  expect(images()).toEqual(['collab/avatars/orange.png', remote('collab/avatars/brand-claude.png')])
})
