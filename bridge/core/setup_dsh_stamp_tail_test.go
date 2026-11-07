package core

import "testing"

// commitFromVersionTail is what makes the same-commit rule possible; a tail that is not a commit
// (release suffix, beta tag, dev) must not be mistaken for one.
func TestCommitFromVersionTail(t *testing.T) {
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
