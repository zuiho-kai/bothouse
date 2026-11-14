package core

import "strings"

// The marks the bridge puts on its own line right before the words a turn answers. This file is
// the one definition; every Go path that writes or recognises a mark uses these names.
//
// Scripts outside the bridge read the same marks out of prompts and stored transcripts and cannot
// import this file, so they match the text: contrib/hooks/dsh-cc-compat.py (LATEST_MARK),
// contrib/lead/_handoff_rules.py, contrib/gate/ctxsvc.py, contrib/wiki/llmwiki/ingest.py
// (_TURN_HEAD). Hooks are started by the agent CLI with the CLI's own stdin JSON, the bridge is
// not on that path, so there is no field to hand them the words in. Changing a mark's text here
// means changing those four files in the same commit; old transcripts keep the old text.
const (
	// latestMark: before the message this turn answers, on every path (gate or not, backfill,
	// buffer or none), so the blocks put above it (rules, memory, wiki, team) never read as if
	// they ended with the person's words (#1375).
	latestMark = "（最新，回这条）"
	// scheduledMark: before a cron/timer prompt, so the agent can tell it from a message the
	// user just sent.
	scheduledMark = "（定时任务，回这条）"
	// batchReplyMark / batchLatestMark: inside a merged batch of queued messages, before the one
	// to answer (batchLatestMark when it is also the last one).
	batchReplyMark  = "（回这条）"
	batchLatestMark = "（最新）"
)

// isReplyMarkLine reports whether a prompt line is the mark that ends the bridge's own blocks:
// what follows it is the message itself.
func isReplyMarkLine(line string) bool {
	return strings.HasPrefix(line, latestMark) || strings.HasPrefix(line, scheduledMark)
}
