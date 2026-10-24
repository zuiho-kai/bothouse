package core

import (
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode"
)

// Leading-name calls, moved from platform/discord/mentions.go so platform/cloud-web reads a
// "龙娘，…" line the same way Discord does.

var codeFenceRe = regexp.MustCompile("(?s)```.*?```")

// NameCalled reports whether a teammate's text calls this bot by name without an @: a line that
// opens with her name (alone or among teammates' names, "橘，…" / "龙娘、橘 你们看看"), followed by
// the end, a space, vocative punctuation or a word that calls her ("橘你来", "橘帮我看"). The same
// opening rule the gate uses for a person's message (contrib/gate gate.py LEADING); a name later
// in the line ("行了橘，…", "这个鲸鱼娘你来看看") is talk about her, not a call — a bot naming a
// teammate mid-sentence made her answer what was said to someone else (user 2026-10-23「我都艾特你了，
// 他还在判断」). "说/在/呢/去" from LEADING are left out:
// in a bot's line "橘说得对" / "橘在忙" are about her. Text inside ``` fences is ignored.
func NameCalled(text, botName string, team ...string) bool {
	mine := botNames(botName)
	if len(mine) == 0 {
		return false
	}
	all := append([]string(nil), mine...)
	for _, n := range team {
		all = append(all, botNames(n)...)
	}
	sort.Slice(all, func(i, j int) bool { return len(all[i]) > len(all[j]) }) // longest first: "Claude橘" before "橘"
	text = codeFenceRe.ReplaceAllString(text, "")
	for _, line := range strings.Split(text, "\n") {
		rest, sep, me := strings.TrimSpace(line), "", false
		for matched := true; matched; {
			matched = false
			for _, n := range all {
				if strings.HasPrefix(rest, n) {
					me = me || slices.Contains(mine, n)
					after := rest[len(n):]
					rest = strings.TrimLeft(after, " \t，,、和跟与/")
					sep, matched = after[:len(after)-len(rest)], true
					break
				}
			}
		}
		if me && callFollows(rest, sep) {
			return true
		}
	}
	return false
}

// botNames is a bot's username and the same without its leading ASCII part ("Claude橘" → "橘").
func botNames(botName string) []string {
	if botName == "" {
		return nil
	}
	names := []string{botName}
	if short := strings.TrimLeftFunc(botName, func(r rune) bool { return r < unicode.MaxASCII }); short != "" && short != botName {
		names = append(names, short)
	}
	return names
}

// callFollows: what comes after the opening names makes it a call — the end of the line, a space
// or vocative punctuation (sep is what was trimmed after the last name), or a calling word.
var callWords = []string{"你", "帮", "来", "看", "快", "给", "过来", "出来", "有空"}

func callFollows(rest, sep string) bool {
	if rest == "" || strings.ContainsAny(sep, " \t，,、") {
		return true
	}
	if strings.ContainsRune(":：!！?？~～.。", []rune(rest)[0]) {
		return true
	}
	for _, w := range callWords {
		if strings.HasPrefix(rest, w) {
			return true
		}
	}
	return false
}
