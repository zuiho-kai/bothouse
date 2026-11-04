package core

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// unsentReplyText compares whole narration segments, never arbitrary substrings.
// The caller owns sent for just one turn and records only successful deliveries.
func unsentReplyText(p Platform, content string, sent []string) string {
	capability, ok := p.(RepeatedReplySuppressor)
	if !ok || !capability.SuppressRepeatedReplyText() || replyContainsCode(content) {
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
		if remaining == prior {
			return ""
		}
		if strings.HasPrefix(remaining, prior) {
			rest := remaining[len(prior):]
			next, _ := utf8.DecodeRuneInString(rest)
			last, _ := utf8.DecodeLastRuneInString(prior)
			// A word prefix ("yes" in "yesterday") is new text. Only a
			// whitespace boundary or a completed sentence can delimit a repeat.
			if unicode.IsSpace(next) || unicode.IsPunct(last) {
				remaining = strings.TrimLeftFunc(rest, unicode.IsSpace)
			}
		}
	}
	if remaining == strings.TrimSpace(content) {
		return content
	}
	return remaining
}

func replyContainsCode(text string) bool {
	if strings.Contains(text, "```") || strings.Contains(text, "~~~") {
		return true
	}
	for _, line := range strings.Split(text, "\n") {
		// Source: CommonMark indented code blocks begin with four spaces or a tab.
		if strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t") {
			return true
		}
	}
	return false
}
