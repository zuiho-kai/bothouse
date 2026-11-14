package core

import (
	"context"
	"log/slog"
	"strings"
	"unicode/utf8"
)

// Test-only. The bridge no longer reads a handback from a reply's text (#699 C, #1627): the only
// entry is WorkspaceExit → forwardWorkspaceExitKind. The existing cases were written as marked
// replies, so this helper turns such a reply into the kind and body the command would carry.

// forwardWorkspaceExit copies a marked workspace reply into its chat channel.
// It returns the forwarded ask id ("" for a report or when nothing was sent).
func (e *Engine) forwardWorkspaceExit(p Platform, sessionKey, reply string) string {
	return e.forwardWorkspaceExitContext(e.ctx, p, sessionKey, reply)
}

func (e *Engine) forwardWorkspaceExitContext(ctx context.Context, p Platform, sessionKey, reply string) string {
	if err := checkProactiveExecution(ctx, "message.send"); err != nil {
		if strings.TrimSpace(reply) != "" {
			slog.Warn("team exit: task authorization refused the send; nothing forwarded", "session", sessionKey, "error", err)
		}
		return ""
	}
	reply = stripFillerLines(reply)
	kind, body, ok := parseExitKindTurn(reply)
	if !ok {
		// Most turns carry no marker; only complain when one exists but did not start the reply.
		for _, k := range exitRules.Kinds {
			if p != nil && strings.Contains(reply, strings.ReplaceAll(exitRules.Mark, "{kind}", k)) {
				slog.Warn("team exit: marker is not on the first line, nothing forwarded", "session", sessionKey, "project", e.name)
				break
			}
		}
		return ""
	}
	return e.forwardWorkspaceExitKind(ctx, p, sessionKey, kind, body)
}

// parseExitKindTurn reads the exit marker of a whole turn's text. A turn whose agent narrates
// before its final answer (Codex sends commentary-phase messages, and they arrive joined with the
// answer) puts the marker after that narration: then the last marker that starts a line, or follows
// a sentence end (the parts may be joined with no newline), opens the final answer and is read from
// there (agentm #25, 11-09: 「[report] #25」 came after 「退回原因是…」 and nothing reached the chat
// channel). Same idea as the DSH side's exitMark lastLine (dsh/collab/team-exit.mjs).
func parseExitKindTurn(text string) (kind, body string, ok bool) {
	if kind, body, ok = parseExitKind(text); ok {
		return
	}
	if i := lastExitMarker(text); i > 0 {
		return parseExitKind(text[i:])
	}
	return "", "", false
}

// lastExitMarker is the byte offset of the last [ask]/[report] marker that starts a line or follows
// a sentence end; -1 when none. Markers inside a sentence or a quote (「[ask]」, `[report]`) do not count.
func lastExitMarker(text string) int {
	for j := strings.LastIndexByte(text, '['); j >= 0; j = strings.LastIndexByte(text[:j], '[') {
		before := strings.TrimRight(text[:j], " \t")
		if before != "" && !strings.HasSuffix(before, "\n") && !strings.ContainsAny(lastRune(before), "。！？.!?") {
			continue
		}
		for _, k := range exitRules.Kinds {
			tag := strings.ReplaceAll(exitRules.Mark, "{kind}", k)
			if len(text)-j >= len(tag) && strings.EqualFold(text[j:j+len(tag)], tag) {
				return j
			}
		}
	}
	return -1
}

func lastRune(s string) string {
	r, _ := utf8.DecodeLastRuneInString(s)
	return string(r)
}
