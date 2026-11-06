/**
 * Browser entry of the Discord shell: a "Channels" entry in the left sidebar
 * whose main panel shows the CoNest collab channels (rooms, messages, members).
 * The panel talks to the collab Host plugin over its same-origin HTTP API.
 * #1044: team desk, bothouse panel (with the wiki galaxy) and other computers are separate
 * packages now (dsh/packages/bothouse-embeds), one row each on the DSH Plugins page.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { StoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { browserTransport, createChannelSource } from './channel-source.ts'
import { ChannelsIcon } from './ChannelsIcon.tsx'
import { ChannelsPage, type ChannelsInjected } from './ChannelsPage.tsx'
import { mappedTransport, remoteCollabUrl } from './collab-url.ts'
import { RemoteChannelsPage, type RemoteChannelsInjected } from './RemoteChannelsPage.tsx'
import { en, NS, zh, type ChannelsKey } from './locales.ts'
import { bindHostTheme, type Scheme } from './scheme.ts'

export type { ChannelsInjected, ChannelsPageProps } from './ChannelsPage.tsx'
export type { ChannelsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Channel panel copy. */
    'discord-channels': ChannelsKey
  }
}

// Borrow the settings shell root store seat; the renderer shares its instance.
type SettingsStore = StoreHandle<object, { openSection(draft: object, id: string): void }>

const PANEL_ID = 'channels' as MainPanelId
// #236: a paired computer's channels; no sidebar row, opened from 其他电脑 (collab/devices.html).
const REMOTE_PANEL_ID = 'remote-channels' as MainPanelId
// Same key as dsh/packages/bothouse-dsh-devices/client.js main panel 'collab-devices'.
const DEVICES_PANEL_ID = 'collab-devices' as MainPanelId
/** Global the 其他电脑 page (same origin, in an iframe) calls to open a link's channels here. */
export const OPEN_REMOTE = '__bothouseOpenRemoteChannels'

/** Required browser services. */
export const inject = ['slots', 'locale', 'layout']

/**
 * Register the channel dictionaries, the main panel, and its sidebar entry.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-discord: dictionaries')
  const t = ctx.locale.bind(NS)
  const channels = createChannelSource(browserTransport())
  ctx.effect(() => channels.dispose, 'client-ui-discord: channel stream')
  const injected = (openModelSettings: () => boolean): ChannelsInjected => injectedFor(channels, openModelSettings)
  const injectedFor = (channels: ReturnType<typeof createChannelSource>, openModelSettings: () => boolean): ChannelsInjected => ({
    openModelSettings,
    hooks: { channels: channels.source },
    selectRoom: channels.actions.selectRoom,
    send: channels.actions.send,
    reviewTask: channels.actions.reviewTask,
    dispatchTask: channels.actions.dispatchTask,
    openDm: channels.actions.openDm,
    closeDm: channels.actions.closeDm,
    retrySend: channels.actions.retrySend,
    dismissSend: channels.actions.dismissSend,
    loadOlder: channels.actions.loadOlder,
    loadNewer: channels.actions.loadNewer,
    keepLatest: channels.actions.keepLatest,
    showLatest: channels.actions.showLatest,
    createRoom: channels.actions.createRoom,
    renameRoom: channels.actions.renameRoom,
    listModels: channels.actions.listModels,
    listClis: channels.actions.listClis,
    listPersonas: channels.actions.listPersonas,
    addMember: channels.actions.addMember,
    updateMember: channels.actions.updateMember,
    removeMember: channels.actions.removeMember,
    setDispatchMode: channels.actions.setDispatchMode,
    setMaxRelay: channels.actions.setMaxRelay,
    setLead: channels.actions.setLead,
    setWorkspacePath: channels.actions.setWorkspacePath,
    renewRoom: channels.actions.renewRoom,
    decidePermission: channels.actions.decidePermission,
    retryMessage: channels.actions.retryMessage,
    editMessage: channels.actions.editMessage,
    withdrawMessage: channels.actions.withdrawMessage,
  })
  ctx.slots.inject('main', () => {
    let currentStore: SettingsStore | undefined
    let disposePanel: (() => void) | undefined
    const bindPanel = () => {
      const shellStore = ctx.slots.entriesOfSlot('sidebar.settings')[0]?.store as SettingsStore | undefined
      if (disposePanel && shellStore === currentStore) return
      disposePanel?.()
      currentStore = shellStore
      disposePanel = shellStore
        ? ctx.slots.register({
            name: 'main', key: PANEL_ID, locale: NS, store: shellStore,
            inject: actions => injected(() => { actions.openSection('models'); return true }),
          }, ChannelsPage)
        : ctx.slots.register({
            name: 'main', key: PANEL_ID, locale: NS,
            inject: () => injected(() => false),
          }, ChannelsPage)
    }
    bindPanel()
    const unsubscribe = ctx.slots.subscribe('sidebar.settings', bindPanel)
    // Deep link: the setup wizard opens `…#channels` (bridge core/setup_dsh_configure.go dshChannelsHash).
    // ctx.layout is the ui-layout service (`provide('layout')`), so it must be in `inject`.
    if (location.hash === `#${PANEL_ID}`) ctx.layout.selectPanel(PANEL_ID)
    return () => { unsubscribe(); disposePanel?.() }
  })
  // #236: 其他电脑 → 频道 opens the paired computer's channels in this same React page. One link at a
  // time: opening another link (or the same link again after it was dropped) starts a fresh source.
  ctx.slots.inject('main', () => {
    let remote: { link: string; dispose: () => void } | undefined
    const close = () => { remote?.dispose(); remote = undefined }
    const open = (link: string, name: string): boolean => {
      const url = remoteCollabUrl(link)
      if (remote?.link !== link) {
        close()
        const source = createChannelSource(mappedTransport(browserTransport(), url))
        const unregister = ctx.slots.register({
          name: 'main', key: REMOTE_PANEL_ID, locale: NS,
          // Model settings belong to this computer's shell, not the paired one: show the web hint.
          inject: (): ChannelsInjected & RemoteChannelsInjected => ({
            ...injectedFor(source, () => false),
            remoteName: name,
            collabUrl: url,
            back: () => { ctx.layout.selectPanel(DEVICES_PANEL_ID) },
          }),
        }, RemoteChannelsPage)
        remote = { link, dispose: () => { unregister(); source.dispose() } }
      }
      ctx.layout.selectPanel(REMOTE_PANEL_ID)
      return true
    }
    Reflect.set(globalThis, OPEN_REMOTE, open)
    return () => {
      if (Reflect.get(globalThis, OPEN_REMOTE) === open) Reflect.deleteProperty(globalThis, OPEN_REMOTE)
      close()
    }
  })
  // 体检 #11: follow the DSH theme (ui-theme's ThemeRuntime) when it is loaded.
  if (typeof ctx.inject === 'function') ctx.inject(['theme'], (themed) => {
    const theme = Reflect.get(themed, 'theme') as { getTheme(): { active: { colorScheme: Scheme } }; setTheme(id: string): void } | undefined
    if (theme === undefined) return
    const on = Reflect.get(themed, 'on') as (name: string, fn: () => void) => () => void
    themed.effect(() => bindHostTheme({
      scheme: () => theme.getTheme().active.colorScheme,
      set: next => { theme.setTheme(next) },
      subscribe: fn => on.call(themed, 'theme/change', fn),
    }), 'client-ui-discord: host theme')
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    locale: NS,
    label: () => t('panel'),
  }, ChannelsIcon))
}
