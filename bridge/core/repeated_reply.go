package core

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// suppressesRepeatedReply reports whether p opted into the same-turn repeat
// suppression (QQ does; every other platform keeps its old behaviour).
func suppressesRepeatedReply(p Platform) bool {
	capability, ok := p.(RepeatedReplySuppressor)
	return ok && capability.SuppressRepeatedReplyText()
}

// unsentReplyText compares whole narration segments, never arbitrary substrings.
// The caller owns sent for just one turn and records only successful deliveries.
func unsentReplyText(p Platform, content string, sent []string) string {
	if !suppressesRepeatedReply(p) || replyContainsCode(content) {
		return content
	}
	remaining := strings.TrimSpace(content)
	for _, prior := range sent {
		if replyContainsCode(prior) {
			continue
		}
		prior = strings.TrimSpace(prior)
		if prior == "" {
			continue
		}
		// The model can echo an already-sent line more than once (measured:
		// s118 turn 2 replied "手滑打错了 当我没说" twice after a sticker send),
		// so keep peeling a repeated prefix until the text stops shrinking.
		for {
			if squashSpace(remaining) == squashSpace(prior) {
				return ""
			}
			if !strings.HasPrefix(remaining, prior) {
				break
			}
			rest := remaining[len(prior):]
			next, _ := utf8.DecodeRuneInString(rest)
			last, _ := utf8.DecodeLastRuneInString(prior)
			// A word prefix ("yes" in "yesterday") is new text. Only a
			// whitespace boundary or a completed sentence can delimit a repeat.
			if !unicode.IsSpace(next) && !unicode.IsPunct(last) {
				break
			}
			trimmed := strings.TrimLeftFunc(rest, unicode.IsSpace)
			if trimmed == remaining {
				break
			}
			remaining = trimmed
		}
	}
	if remaining == strings.TrimSpace(content) {
		return content
	}
	return remaining
}

// unsentFinalReplyText decides what a turn may still post as its own reply.
// It is the send-time guard for a turn that already pushed text through a tool
// script (stickers.py -> bin/qq-bridge send): the same sentence must not appear
// twice, and a bracketed receipt note ("(Already replied above…)") is addressed
// to the agent itself, never to the channel.
func unsentFinalReplyText(p Platform, content string, sent []string) string {
	if !suppressesRepeatedReply(p) {
		return content
	}
	remaining := unsentReplyText(p, content, sent)
	// The agent often glues its receipt note onto the last line instead of
	// putting it on its own line (seen in the stored s118 history), so strip a
	// trailing note before deciding, and drop a note-only remainder.
	if stripped, ok := stripTrailingMetaNotes(remaining); ok {
		remaining = stripped
	}
	if isMetaOnlyReply(remaining) || strings.TrimSpace(remaining) == "" {
		return ""
	}
	return remaining
}

// metaNoteHints are the phrases a self-directed receipt note is built from:
// the agent reporting to itself that something was already posted or saved.
var metaNoteHints = []string{
	"already repl", "already sent", "already posted", "already saved", "already done",
	"已回复", "回复过", "已发送", "已发", "发过", "已存", "已保存", "已记下", "已搞定", "已处理",
}

// metaNoteLineRe matches a line that is one whole parenthesised group.
var metaNoteLineRe = regexp.MustCompile(`^[（(][^（()）]*[)）]$`)

// isMetaNote reports whether text is a single bracketed receipt note.
func isMetaNote(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" || !metaNoteLineRe.MatchString(text) {
		return false
	}
	// A note that addresses the reader ("（已发你私聊了）") is chat content, not
	// a receipt: the agent's own note never speaks to the user.
	if strings.ContainsAny(text, "你您") || strings.Contains(strings.ToLower(text), "you") {
		return false
	}
	lower := strings.ToLower(text)
	for _, hint := range metaNoteHints {
		if strings.Contains(lower, hint) {
			return true
		}
	}
	return false
}

// isMetaOnlyReply reports whether the whole reply is nothing but receipt notes.
func isMetaOnlyReply(text string) bool {
	notes := 0
	for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !isMetaNote(line) {
			return false
		}
		notes++
	}
	return notes > 0
}

// stripTrailingMetaNotes removes receipt notes from the tail of a reply, both
// whole-line ones and notes the model glued onto the end of its last sentence
// after a run of spaces (both shapes appear in the stored QQ history). The
// marker and the note can share a reply ("NO_REPLY\n\n（已存好，标签「奶龙」）"),
// so the caller re-runs the NO_REPLY checks on what is left. A glued note is
// only dropped when whitespace separates it from the text and the bracket wraps
// nothing but the note, so real prose keeps its parentheticals.
func stripTrailingMetaNotes(text string) (string, bool) {
	removed := false
	for {
		trimmed := strings.TrimRightFunc(text, unicode.IsSpace)
		if trimmed == "" {
			break
		}
		if start, ok := trailingMetaNoteStart(trimmed); ok {
			text = trimmed[:start]
			removed = true
			continue
		}
		break
	}
	if !removed {
		return text, false
	}
	return strings.TrimRightFunc(text, unicode.IsSpace), true
}

// trailingMetaNoteStart returns the byte offset where a trailing receipt note
// begins, if the text ends with one.
func trailingMetaNoteStart(text string) (int, bool) {
	last, _ := utf8.DecodeLastRuneInString(text)
	if last != ')' && last != '）' {
		return 0, false
	}
	start := strings.LastIndexAny(text, "（(")
	if start < 0 || !isMetaNote(text[start:]) {
		return 0, false
	}
	// Only a whitespace boundary can separate a pushed note from the sentence
	// it was appended to; anything else means the bracket belongs to that
	// sentence ("好的（已存好）") and must stay.
	if start > 0 {
		prev, _ := utf8.DecodeLastRuneInString(text[:start])
		if !unicode.IsSpace(prev) {
			return 0, false
		}
	}
	return start, true
}

// squashSpace collapses runs of whitespace so "a  b " equals "a b" when the
// channel already received a differently padded copy of the same sentence.
func squashSpace(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func replyContainsCode(text string) bool {
	if strings.Contains(text, "```") || strings.Contains(text, "~~~") {
		return true
	}
	// CommonMark indented code starts with four spaces or a tab, but the QQ
	// corpus (549 assistant messages, 2026-11-05) shows prose is frequently
	// padded that way on a single line, while real indented code spans two or
	// more consecutive lines. Requiring the run keeps space-padded chat text
	// deduplicable without touching genuine code blocks.
	run := 0
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t") {
			run++
			if run >= 2 {
				return true
			}
			continue
		}
		run = 0
	}
	return false
}
