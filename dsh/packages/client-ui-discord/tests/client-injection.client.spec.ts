// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import * as channelSource from '../src/client/channel-source.ts'
import { apply, type ChannelsInjected } from '../src/client/index.ts'

vi.mock('../src/client/ChannelsIcon.tsx', () => ({ ChannelsIcon: () => null }))

it.each([true, false])('injects channel actions and uses the settings shell when available=%s', (available) => {
  const createSource = vi.spyOn(channelSource, 'createChannelSource')
  let injectMain: ((actions?: { openSection: (id: string) => void }) => ChannelsInjected) | undefined
  const shellStore = { spec: {}, create: vi.fn() }
  const openSection = vi.fn()
  const cleanups: (() => void)[] = []
  const ctx = {
    effect: (effect: () => (() => void)) => { cleanups.push(effect()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      entriesOfSlot: () => available ? [{ store: shellStore }] : [],
      subscribe: () => () => {},
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
    const injected = injectMain!({ openSection })
    expect(injected.openModelSettings()).toBe(available)
    if (available) expect(openSection).toHaveBeenCalledWith('models')
    else expect(openSection).not.toHaveBeenCalled()
    expect(shellStore.create).not.toHaveBeenCalled()
    expect(injected.hooks.channels).toBe(channels.source)
    expect(Object.keys(injected).filter(key => key !== 'hooks' && key !== 'openModelSettings').sort())
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
