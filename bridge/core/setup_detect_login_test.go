package core

import "testing"

func TestDetectClaudeLoginOAuthTokenEnv(t *testing.T) {
	var login func(string) string
	for _, s := range cliSpecs {
		if s.agentType == "claudecode" {
			login = s.login
		}
	}
	home := t.TempDir() // no credential files
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "")
	if got := login(home); got != "not_logged_in" {
		t.Fatalf("empty home, no env: got %q", got)
	}
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat-test")
	if got := login(home); got != "logged_in" {
		t.Fatalf("CLAUDE_CODE_OAUTH_TOKEN set: got %q, want logged_in", got)
	}
}
