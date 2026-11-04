// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import * as channelSource from '../src/client/channel-source.ts'
import { apply, type ChannelsInjected } from '../src/client/index.ts'

vi.mock('../src/client/ChannelsIcon.tsx', () => ({ ChannelsIcon: () => null }))

it.each([true, false])('injects channel actions and uses the settings shell when available=%s', (available) => {
  const createSource = vi.spyOn(channelSource, 'createChannelSource')
  let injectMain: ((actions?: { openSection: (id: string) => void }) => ChannelsInjected) | undefined
  let injectGalaxy: (() => { path: string; title: string }) | undefined
  const shellStore = { spec: {}, create: vi.fn() }
  const openSection = vi.fn()
  const cleanups: (() => void)[] = []
  const sidebarIds: string[] = []
  const mainKeys: string[] = []
  const ctx = {
    effect: (effect: () => (() => void)) => { cleanups.push(effect()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      entriesOfSlot: () => available ? [{ store: shellStore }] : [],
      subscribe: () => () => {},
      inject: (_slot: string, register: () => (() => void)) => { cleanups.push(register()) },
      register: (definition: { name: string; key?: string; id?: string; inject?: () => ChannelsInjected }) => {
        if (definition.name === 'main') mainKeys.push(definition.key!)
        if (definition.name === 'main' && definition.key === 'channels') injectMain = definition.inject
        if (definition.name === 'main' && definition.key === 'wiki-galaxy') injectGalaxy = definition.inject as () => { path: string; title: string }
        if (definition.name === 'sidebar.panellist') sidebarIds.push(definition.id!)
        return () => {}
      },
    },
    layout: { selectPanel: vi.fn() },
  }
  try {
    apply(ctx as unknown as Parameters<typeof apply>[0])
    const channels = createSource.mock.results[0].value as ReturnType<typeof channelSource.createChannelSource>
    expect(injectMain).toBeTypeOf('function')
    // #105: desk and the bothouse panel sit next to channels, each with its own main panel;
    // #131 adds the paired-computers page after them. #145 moved the wiki galaxy into the
    // bothouse panel: its old main key stays for `#wiki-galaxy` links, but it lost its own
    // sidebar entry.
    expect(sidebarIds).toEqual(['channels', 'collab-desk', 'bothouse-panel', 'collab-devices'])
    expect(mainKeys).toEqual(['channels', 'wiki-galaxy', 'collab-desk', 'bothouse-panel', 'collab-devices'])
    // The old `#wiki-galaxy` deep link lands on the galaxy as the bothouse panel's sub-page,
    // so there is still a panel to select and no second copy of the canvas.
    expect(injectGalaxy?.()).toEqual({ path: 'collab/panel/wiki-galaxy', title: 'panelGalaxy' })
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
