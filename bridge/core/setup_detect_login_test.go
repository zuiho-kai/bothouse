package core

import (
	"os"
	"path/filepath"
	"testing"
)

func claudeLoginFunc(t *testing.T) func(string) string {
	t.Helper()
	for _, s := range cliSpecs {
		if s.agentType == "claudecode" {
			return s.login
		}
	}
	t.Fatal("no claudecode spec")
	return nil
}

func TestDetectClaudeLoginOAuthTokenEnv(t *testing.T) {
	login := claudeLoginFunc(t)
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

// envOnlyWarnings runs detection's login + env-only check for claudecode in home, then the wizard's
// login warnings for one role that uses the CLI's own login.
func envOnlyWarnings(t *testing.T, home, lang string) []WizardWarning {
	t.Helper()
	c := LocalCLI{AgentType: "claudecode", Label: "Claude Code", Login: claudeLoginFunc(t)(home)}
	c.LoginEnvOnly = loginEnvOnly(c.AgentType, c.Login, home)
	if c.Login != "logged_in" {
		t.Fatalf("login = %q, want logged_in", c.Login)
	}
	roles := []plannedRole{{wizardIdentity: wizardIdentity{WizardRole: WizardRole{Name: "orange", AgentType: "claudecode"}}}}
	return warnAgentLogins(lang, roles, []LocalCLI{c})
}

func TestClaudeEnvOnlyLoginWarns(t *testing.T) {
	for _, env := range []string{"CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"} {
		t.Run(env, func(t *testing.T) {
			t.Setenv("ANTHROPIC_API_KEY", "")
			t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "")
			t.Setenv(env, "test-value")
			for _, lang := range []string{"zh", "en"} {
				ws := envOnlyWarnings(t, t.TempDir(), lang)
				if len(ws) != 1 || ws[0].Code != "agent_login_env_only" || ws[0].Blocking {
					t.Fatalf("%s: want one non-blocking agent_login_env_only, got %+v", lang, ws)
				}
				if ws[0].Message == "" || ws[0].Fix == "" {
					t.Fatalf("%s: empty message/fix: %+v", lang, ws[0])
				}
			}
		})
	}
}

func TestClaudeCredentialFileNoEnvWarning(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "test-value") // env set too: the file login still reaches the daemon
	for name, write := range map[string]func(h string) error{
		"credentials.json": func(h string) error {
			if err := os.MkdirAll(filepath.Join(h, ".claude"), 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(h, ".claude", ".credentials.json"), []byte("{}"), 0o600)
		},
		"oauthAccount": func(h string) error {
			return os.WriteFile(filepath.Join(h, ".claude.json"), []byte(`{"oauthAccount":{}}`), 0o600)
		},
	} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			if err := write(home); err != nil {
				t.Fatal(err)
			}
			if ws := envOnlyWarnings(t, home, "zh"); len(ws) != 0 {
				t.Fatalf("credential file present: want no warning, got %+v", ws)
			}
		})
	}
}
