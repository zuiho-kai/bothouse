/**
 * Browser entry of the Discord shell: a "Channels" entry in the left sidebar
 * whose main panel shows the CoNest collab channels (rooms, messages, members).
 * The panel talks to the collab Host plugin over its same-origin HTTP API.
 * Team desk, wiki galaxy and bothouse panel entries (#105) sit right below it, so the
 * desktop app (no address bar) reaches the collab pages and the management panel too.
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
import { EmbedPage } from './EmbedPage.tsx'
import { DeskIcon, DevicesIcon, PanelIcon } from './PanelIcons.tsx'
import { en, NS, zh, type ChannelsKey } from './locales.ts'

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
const DESK_ID = 'collab-desk' as MainPanelId
// Legacy panel id: links that still say `#wiki-galaxy` keep opening the galaxy, now as the
// bothouse panel's own sub-page (#145).
const GALAXY_ID = 'wiki-galaxy' as MainPanelId
const BOTHOUSE_ID = 'bothouse-panel' as MainPanelId
const DEVICES_ID = 'collab-devices' as MainPanelId

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
  // #131: while this DSH window is open, keep its 「直到我断开」 remote links (refresh or switching
  // panels must not drop them; closing the window stops the beat and collab ends them).
  // 来源：与 dsh/collab/pairing.mjs ALIVE_EVERY_MS 同一节拍。
  const ALIVE_EVERY_MS = 3000
  ctx.effect(() => {
    const beat = () => {
      globalThis.fetch?.(new URL('collab/api/remote/alive', document.baseURI), { method: 'POST', credentials: 'same-origin' })
        .catch(() => {})
    }
    beat()
    const timer = setInterval(beat, ALIVE_EVERY_MS)
    return () => clearInterval(timer)
  }, 'client-ui-discord: remote link heartbeat')
  const injected = (openModelSettings: () => boolean): ChannelsInjected => ({
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
    // #145: `#wiki-galaxy` is handled after the panel registrations at the end of apply(), because
    // selecting a panel whose main entry is not registered yet fails activation.
    if (location.hash === `#${PANEL_ID}`) ctx.layout.selectPanel(PANEL_ID)
    return () => { unsubscribe(); disposePanel?.() }
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    locale: NS,
    label: () => t('panel'),
  }, ChannelsIcon))

  // #105: the collab pages and the management panel (forwarded by collab, which keeps the
  // panel token server-side) as main panels; order keeps them right under Channels.
  // #145: the wiki galaxy is a page inside the bothouse panel now, not a sidebar entry of its
  // own; the collab host still serves /collab/wiki-galaxy, so old links keep working.
  const embeds = [
    { id: DESK_ID, path: 'collab/desk', label: 'panelDesk', icon: DeskIcon, order: 6 },
    { id: BOTHOUSE_ID, path: 'collab/panel/', label: 'panelBothouse', icon: PanelIcon, order: 7 },
    // #131: pair with another DSH by a one-time number and drive its channels, desk and panel.
    { id: DEVICES_ID, path: 'collab/devices', label: 'panelDevices', icon: DevicesIcon, order: 9 },
  ] as const
  // #145 compatibility: a window or bookmark that still names the old `#wiki-galaxy` panel keeps
  // opening the galaxy — as the bothouse panel's galaxy sub-page, with no sidebar entry of its own.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: GALAXY_ID, locale: NS,
    inject: () => ({ path: 'collab/panel/wiki-galaxy', title: t('panelGalaxy') }),
  }, EmbedPage))
  for (const page of embeds) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: page.id, locale: NS,
      inject: () => ({ path: page.path, title: t(page.label) }),
    }, EmbedPage))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: page.id, order: page.order, locale: NS, label: () => t(page.label),
    }, page.icon))
  }
  // #145: a bookmark or window still saying `#wiki-galaxy` opens the galaxy sub-page. Runs after the
  // registrations above; selecting a panel first leaves the shell with no seat to activate.
  if (location.hash === `#${GALAXY_ID}`) ctx.layout.selectPanel(GALAXY_ID)
}
