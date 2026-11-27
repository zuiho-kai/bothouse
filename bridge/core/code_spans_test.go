package core

import "testing"

// #2099: an @ in code (``` fences and single-backtick spans) is an example, not a call.
func TestMapOutsideCode(t *testing.T) {
	up := func(s string) string { return "[" + s + "]" }
	cases := map[string]string{
		"plain":                     "[plain]",
		"a `@鲸鱼娘 @橘` b":             "[a ]`@鲸鱼娘 @橘`[ b]",
		"x ```\n@橘\n``` y":           "[x ]```\n@橘\n```[ y]",
		"a ``co`de`` b":             "[a ]``co`de``[ b]",
		"unclosed ` @橘":             "[unclosed ` @橘]",
		"`a` mid `b`":               "[]`a`[ mid ]`b`[]",
	}
	for in, want := range cases {
		if got := MapOutsideCode(in, up); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

func TestNameCalledSkipsInlineCode(t *testing.T) {
	if NameCalled("`橘，看看`", "Claude橘") {
		t.Fatal("a call written in code must not count")
	}
	if !NameCalled("橘，看看 `x`", "Claude橘") {
		t.Fatal("a real call next to code must still count")
	}
}
