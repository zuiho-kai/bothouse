// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import * as channelSource from '../src/client/channel-source.ts'
import { apply, type ChannelsInjected } from '../src/client/index.ts'

vi.mock('../src/client/ChannelsIcon.tsx', () => ({ ChannelsIcon: () => null }))

it('injects the channel hook and every page action through the registered main panel', () => {
  const createSource = vi.spyOn(channelSource, 'createChannelSource')
  let injectMain: (() => ChannelsInjected) | undefined
  const cleanups: (() => void)[] = []
  const ctx = {
    effect: (effect: () => (() => void)) => { cleanups.push(effect()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_slot: string, register: () => (() => void)) => { cleanups.push(register()) },
      register: (definition: { name: string; inject?: () => ChannelsInjected }) => {
        if (definition.name === 'main') injectMain = definition.inject
        return () => {}
      },
    },
    layout: { selectPanel: vi.fn() },
  }
  try {
    apply(ctx as unknown as Parameters<typeof apply>[0])
    const channels = createSource.mock.results[0].value as ReturnType<typeof channelSource.createChannelSource>
    expect(injectMain).toBeTypeOf('function')
    const injected = injectMain!()
    expect(injected.hooks.channels).toBe(channels.source)
    expect(Object.keys(injected).filter(key => key !== 'hooks').sort())
      .toEqual(Object.keys(channels.actions).sort())
    for (const [name, action] of Object.entries(channels.actions)) {
      expect(injected[name as keyof typeof channels.actions], name).toBeTypeOf('function')
      expect(injected[name as keyof typeof channels.actions], name).toBe(action)
    }
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    createSource.mockRestore()
  }
})
