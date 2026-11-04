/**
 * `/` commands of the channel composer (#1016). Every entry maps to a command the
 * bothouse bridge already runs (bridge/core/engine.go handleCommand), or to a panel
 * that is already on this page; nothing here needs a new backend.
 *
 * A bridge bot in a group only takes a message that @-mentions it
 * (bridge/platform/cloud-web/cloudweb.go), and collab strips that mention before
 * forwarding (dsh/collab/mentions.mjs forMember), so `@橘 /stop` reaches 橘 as `/stop`.
 * `/stop all` is the one command every bot takes without a mention (core/stop_all.go).
 */

/** What picking a command does. */
export type SlashRun =
  /** Send `@<target> <text>` (or `<text>` alone when `broadcast`) right away. */
  | { readonly kind: 'send'; readonly text: string; readonly broadcast?: true }
  /** Put `@<target> <text>` in the composer for the user to finish (the command takes an argument). */
  | { readonly kind: 'fill'; readonly text: string }
  /** Open a panel of this page. */
  | { readonly kind: 'panel'; readonly panel: 'board' | 'help' }

export interface SlashCommand {
  /** What the user types after `/`; also matched by the filter. */
  readonly name: string
  /** Locale key of the one-line description. */
  readonly hint: SlashHintKey
  readonly run: SlashRun
}

export type SlashHintKey =
  | 'slashStop' | 'slashStopAll' | 'slashPs' | 'slashNew' | 'slashModel' | 'slashReasoning'
  | 'slashCron' | 'slashStatus' | 'slashUsage' | 'slashCompress' | 'slashBoard' | 'slashHelp'

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'stop', hint: 'slashStop', run: { kind: 'send', text: '/stop' } },
  { name: 'stop all', hint: 'slashStopAll', run: { kind: 'send', text: '/stop all', broadcast: true } },
  { name: 'ps', hint: 'slashPs', run: { kind: 'fill', text: '/ps ' } },
  { name: 'new', hint: 'slashNew', run: { kind: 'send', text: '/new' } },
  { name: 'model', hint: 'slashModel', run: { kind: 'send', text: '/model' } },
  { name: 'reasoning', hint: 'slashReasoning', run: { kind: 'send', text: '/reasoning' } },
  { name: 'cron', hint: 'slashCron', run: { kind: 'send', text: '/cron' } },
  { name: 'status', hint: 'slashStatus', run: { kind: 'send', text: '/status' } },
  { name: 'usage', hint: 'slashUsage', run: { kind: 'send', text: '/usage' } },
  { name: 'compress', hint: 'slashCompress', run: { kind: 'send', text: '/compress' } },
  { name: 'board', hint: 'slashBoard', run: { kind: 'panel', panel: 'board' } },
  { name: 'help', hint: 'slashHelp', run: { kind: 'panel', panel: 'help' } },
]

/** The text after a leading `/` while the draft is still a bare command word; undefined otherwise. */
export function slashQuery(draft: string): string | undefined {
  const m = /^\/([^\s/]*(?: all)?)$/.exec(draft)
  return m === null ? undefined : m[1]
}

/** Commands whose name starts with (then contains) the query, case-insensitive. */
export function matchCommands(query: string, hint: (key: SlashHintKey) => string = () => ''): readonly SlashCommand[] {
  const q = query.toLowerCase()
  if (q === '') return SLASH_COMMANDS
  const starts = SLASH_COMMANDS.filter(c => c.name.startsWith(q))
  const rest = SLASH_COMMANDS.filter(c => !c.name.startsWith(q) && (c.name.includes(q) || hint(c.hint).includes(query)))
  return [...starts, ...rest]
}

/**
 * A typed command (`/model gpt-5`) is addressed to the primary role, like a click on the
 * menu; a draft that already names someone, `/stop all`, or a non-command is left alone.
 */
export function addressCommand(text: string, leadName: string | undefined): string {
  if (leadName === undefined || !/^\/[a-z]/i.test(text) || /^\/stop\s+all\s*$/i.test(text)) return text
  return `@${leadName} ${text}`
}
