package core

import "testing"

func TestClaudeEntrypointForEnv(t *testing.T) {
	cases := []struct {
		name, override string
		env            []string
		want           string
	}{
		{"subscription login", "", []string{"HOME=/h"}, "bothouse"},
		{"api key keeps cli default", "", []string{"ANTHROPIC_API_KEY=sk-x"}, "sdk-cli"},
		{"blanked api key", "", []string{"ANTHROPIC_API_KEY=sk-x", "ANTHROPIC_API_KEY="}, "bothouse"},
		{"user override wins", "my-bridge", []string{"ANTHROPIC_API_KEY=sk-x"}, "my-bridge"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv(ClaudeEntrypointEnv, c.override)
			if got := ClaudeEntrypointForEnv(c.env); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
