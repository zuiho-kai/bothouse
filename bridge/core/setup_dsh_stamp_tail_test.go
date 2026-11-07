package core

import "testing"

// commitFromVersionTail is what makes the same-commit rule possible; a tail that is not a commit
// (release suffix, beta tag, dev) must not be mistaken for one.
//
// #274 第四条: the name starts with TestDSHStamp so the stamp review command
// `go test -run 'Test.*Stamp|TestDSHStamp|TestPlugin'` picks it up; as TestCommitFromVersionTail it
// ran only in the full suite, which is not what a reviewer of this file runs.
func TestDSHStampCommitFromVersionTail(t *testing.T) {
	cases := []struct{ version, want string }{
		{"v0.1.54-local211-final-8ac35a3b", "8ac35a3b"},
		{"v0.1.54-3-gabc1234", "abc1234"},
		{"v0.1.5", ""},
		{"dev", ""},
		{"local211-final-8ac35a3b", "8ac35a3b"},
		{"v0.2.0-beta.9", ""},
		{"v0.1.54-local211-final", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := commitFromVersionTail(c.version); got != c.want {
			t.Errorf("commitFromVersionTail(%q) = %q, want %q", c.version, got, c.want)
		}
	}
}
