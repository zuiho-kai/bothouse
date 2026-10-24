/**
 * Browser entry of the Discord shell: a "Channels" entry in the left sidebar
 * whose main panel shows the CoNest collab channels (rooms, messages, members).
 * The panel talks to the collab Host plugin over its same-origin HTTP API.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { browserTransport, createChannelSource } from './channel-source.ts'
import { ChannelsIcon } from './ChannelsIcon.tsx'
import { ChannelsPage, type ChannelsInjected } from './ChannelsPage.tsx'
import { en, NS, zh, type ChannelsKey } from './locales.ts'

export type { ChannelsInjected, ChannelsPageProps } from './ChannelsPage.tsx'
export type { ChannelsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Channel panel copy. */
    'discord-channels': ChannelsKey
  }
}

const PANEL_ID = 'channels' as MainPanelId

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
  const injected = (): ChannelsInjected => ({
    hooks: { channels: channels.source },
    selectRoom: channels.actions.selectRoom,
    send: channels.actions.send,
    retrySend: channels.actions.retrySend,
    dismissSend: channels.actions.dismissSend,
    loadOlder: channels.actions.loadOlder,
    createRoom: channels.actions.createRoom,
    listModels: channels.actions.listModels,
    listClis: channels.actions.listClis,
    addMember: channels.actions.addMember,
    updateMember: channels.actions.updateMember,
    removeMember: channels.actions.removeMember,
    setDispatchMode: channels.actions.setDispatchMode,
    setLead: channels.actions.setLead,
    decidePermission: channels.actions.decidePermission,
    retryMessage: channels.actions.retryMessage,
    editMessage: channels.actions.editMessage,
    withdrawMessage: channels.actions.withdrawMessage,
  })
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: injected,
    }, ChannelsPage)
    // Deep link: the setup wizard opens `…#channels` (bridge core/setup_dsh_configure.go dshChannelsHash).
    // ctx.layout is the ui-layout service (`provide('layout')`), so it must be in `inject`.
    if (location.hash === `#${PANEL_ID}`) ctx.layout.selectPanel(PANEL_ID)
    return dispose
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    locale: NS,
    label: () => t('panel'),
  }, ChannelsIcon))
}
