// The bridge's @ rule (bridge/platform/cloud-web/mentions.go, #1662: the plugin no longer parses @) for the
// texts these specs ask about. The answers were recorded from the plugin's former parser, and the Go test
// TestPageParityFixtureMatchesBridge checks the bridge gives every one of them, so page == bridge holds
// through this table: a rule change on either side alone turns one of the two red. A new case goes into
// backend-mentions.json with the bridge's answer.
import recorded from './backend-mentions.json'

type Member = { id: string; name: string; mentionId?: string }
const table = recorded as Record<string, string[]>
const key = (text: string, members: Member[]) =>
  JSON.stringify([text, members.map(m => (m.mentionId ? { id: m.id, name: m.name, mention_id: m.mentionId } : { id: m.id, name: m.name }))])

export function backendMentions(text: string, members: Member[]): Set<string> {
  const k = key(text, members)
  if (!(k in table)) throw new Error(`no bridge answer recorded for ${k} (tests/backend-mentions.json)`)
  return new Set(table[k])
}
