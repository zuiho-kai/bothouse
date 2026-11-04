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

import type { ChannelMessage } from './channel-source.ts'

/** What picking a command does. */
export type SlashRun =
  /** Send `@<target> <text>` (or `<text>` alone when `broadcast`) right away. */
  | { readonly kind: 'send'; readonly text: string; readonly broadcast?: true }
  /** Put `@<target> <text>` in the composer for the user to finish (the command takes an argument). */
  | { readonly kind: 'fill'; readonly text: string }
  /** Open a panel of this page. */
  | { readonly kind: 'panel'; readonly panel: 'board' | 'help' }

/** Menu section a command is listed under (#1017: 控制 / 模型 / 查看). */
export type SlashGroup = 'control' | 'model' | 'view'

export interface SlashCommand {
  /** What the user types after `/`; also matched by the filter. */
  readonly name: string
  readonly group: SlashGroup
  /** Locale key of the one-line description. */
  readonly hint: SlashHintKey
  readonly run: SlashRun
}

export type SlashHintKey =
  | 'slashStop' | 'slashStopAll' | 'slashPs' | 'slashNew' | 'slashModel' | 'slashReasoning'
  | 'slashCron' | 'slashStatus' | 'slashUsage' | 'slashCompress' | 'slashBoard' | 'slashHelp'

// Listed by section; the bare menu shows them in this order under the section titles.
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'stop', group: 'control', hint: 'slashStop', run: { kind: 'send', text: '/stop' } },
  { name: 'stop all', group: 'control', hint: 'slashStopAll', run: { kind: 'send', text: '/stop all', broadcast: true } },
  { name: 'ps', group: 'control', hint: 'slashPs', run: { kind: 'fill', text: '/ps ' } },
  { name: 'new', group: 'control', hint: 'slashNew', run: { kind: 'send', text: '/new' } },
  { name: 'compress', group: 'control', hint: 'slashCompress', run: { kind: 'send', text: '/compress' } },
  { name: 'model', group: 'model', hint: 'slashModel', run: { kind: 'send', text: '/model' } },
  { name: 'reasoning', group: 'model', hint: 'slashReasoning', run: { kind: 'send', text: '/reasoning' } },
  { name: 'status', group: 'view', hint: 'slashStatus', run: { kind: 'send', text: '/status' } },
  { name: 'usage', group: 'view', hint: 'slashUsage', run: { kind: 'send', text: '/usage' } },
  { name: 'cron', group: 'view', hint: 'slashCron', run: { kind: 'send', text: '/cron' } },
  { name: 'board', group: 'view', hint: 'slashBoard', run: { kind: 'panel', panel: 'board' } },
  { name: 'help', group: 'view', hint: 'slashHelp', run: { kind: 'panel', panel: 'help' } },
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

/**
 * A bot command line the owner sent (`@橘 /model x`, or a bare `/stop all`), shown as a thin
 * line instead of a chat bubble (#1017); undefined for any other text.
 */
export function commandLine(text: string): { readonly target?: string; readonly command: string } | undefined {
  const t = text.trim()
  if (/^\/stop\s+all$/i.test(t)) return { command: '/stop all' }
  const m = /^@(\S+)\s+(\/[a-z][\s\S]*)$/i.exec(t)
  if (m === null || m[2].includes('\n')) return undefined
  return { target: m[1], command: m[2].trim() }
}

/**
 * The bridge's own answer to each owner command line (#1017): the target bot's next message
 * that is not agent output (`from_turn === 0`: a command reply, bridge/platform/cloud-web
 * `agent` flag), before the owner speaks again. `/ps` is left out — what follows it is the
 * running turn itself, not an answer to the command.
 * @returns command message id → its answer.
 */
export function commandAnswers(messages: readonly ChannelMessage[], nameOf: (author: string) => string | undefined): ReadonlyMap<number, ChannelMessage> {
  const out = new Map<number, ChannelMessage>()
  messages.forEach((m, index) => {
    if (m.author_kind !== 'user' || m.card !== null) return
    const line = commandLine(m.text)
    if (line?.target === undefined || /^\/ps\b/i.test(line.command)) return
    for (const next of messages.slice(index + 1)) {
      if (next.author_kind === 'user') return
      if (next.author_kind === 'role' && next.card === null && next.from_turn === 0 && nameOf(next.author) === line.target) {
        out.set(m.id, next)
        return
      }
    }
  })
  return out
}

/** A command answer that reports a failure (the bridge prefixes those with ❌ / ⚠️). */
export function answerFailed(text: string): boolean {
  return /^\s*(❌|⚠️|error\b)|失败|未知命令|unknown command/i.test(text)
}
