package team

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The two workspace exit kinds: a question for the user ([ask]) and a finished report ([report]).
const (
	ExitKindAsk    = "ask"
	ExitKindReport = "report"
)

// fillerLine matches a whole line a model writes when it believes no answer is wanted
// (kimi 2026-10-29 「No response requested.」): it carries nothing for the user.
var fillerLine = regexp.MustCompile(`(?i)^\s*(no response (is )?(requested|needed|required)|no reply (is )?(requested|needed|required)|不用回话|无需回复)[.。!！]?\s*$`)

// StripFillerLines drops filler lines, so a reply made only of them counts as empty.
func StripFillerLines(reply string) string {
	lines := strings.Split(reply, "\n")
	kept := lines[:0]
	for _, l := range lines {
		if !fillerLine.MatchString(l) {
			kept = append(kept, l)
		}
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

func LocalFileExists(path string) bool {
	st, err := os.Stat(ExpandHome(path))
	return err == nil && !st.IsDir()
}

func ExpandHome(path string) string {
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, rest)
		}
	}
	return path
}
