package core

import "strings"

// MapOutsideCode applies fn to each run of text outside Markdown code — ``` fences and inline
// `code` spans (any backtick run length) — and leaves the code itself as written. An @ name in
// code is an example, not a call: 彩虹猫 11-27 18:36 quoted a test line 「`@鲸鱼娘 @橘`」 in
// a progress note, the bridge turned it into real mentions and both were woken (#2099; user
// 「我看你底下都一起干了，怎么回事」). An unclosed backtick run is ordinary text.
func MapOutsideCode(text string, fn func(string) string) string {
	if !strings.Contains(text, "`") {
		return fn(text)
	}
	var b strings.Builder
	start := 0 // start of the pending plain run
	for i := 0; i < len(text); {
		if text[i] != '`' {
			i++
			continue
		}
		n := backtickRun(text, i)
		end := closingBackticks(text, i+n, n)
		if end < 0 {
			i += n // unclosed: literal backticks
			continue
		}
		b.WriteString(fn(text[start:i]))
		b.WriteString(text[i : end+n])
		i = end + n
		start = i
	}
	b.WriteString(fn(text[start:]))
	return b.String()
}

// StripCode is text with its code spans and fences removed (see MapOutsideCode).
func StripCode(text string) string {
	var b strings.Builder
	MapOutsideCode(text, func(s string) string { b.WriteString(s); b.WriteByte(' '); return s })
	return b.String()
}

func backtickRun(s string, i int) int {
	n := 0
	for i+n < len(s) && s[i+n] == '`' {
		n++
	}
	return n
}

// closingBackticks is the index of the next run of exactly n backticks at or after from, or -1.
// A fence (n >= 3) may span lines; an inline span closes on the same paragraph in Markdown, but
// chat text keeps it simple: the next equal run closes it.
func closingBackticks(s string, from, n int) int {
	for i := from; i < len(s); {
		if s[i] != '`' {
			i++
			continue
		}
		m := backtickRun(s, i)
		if m == n {
			return i
		}
		i += m
	}
	return -1
}
