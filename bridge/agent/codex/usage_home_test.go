package codex

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func writeAuth(t *testing.T, home, body string) {
	t.Helper()
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// The quota probe reads the account of the CODEX_HOME this agent's sessions
// run with (codex_home option, then CODEX_HOME in the agent env), not the
// bridge process's ~/.codex. A relay home (API key, no ChatGPT login) has no
// account quota: the agent and its app-server sessions say so up front, so
// the footer neither shows another account's quota nor waits on a probe.
func TestUsageProbeUsesAgentCodexHome(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	writeAuth(t, filepath.Join(home, ".codex"), `{"tokens":{"access_token":"tok","account_id":"acct-process"}}`)

	relay := filepath.Join(t.TempDir(), "codex-relay")
	writeAuth(t, relay, `{"OPENAI_API_KEY":"sk-relay"}`)
	own := filepath.Join(t.TempDir(), "codex-own")
	writeAuth(t, own, `{"tokens":{"access_token":"tok","account_id":"acct-own"}}`)

	for _, c := range []struct {
		name    string
		agent   *Agent
		account string // "" = no account quota
	}{
		{"codex_home relay", &Agent{codexHome: relay, activeIdx: -1}, ""},
		{"env CODEX_HOME relay", &Agent{configEnv: []string{"CODEX_HOME=" + relay}, activeIdx: -1}, ""},
		{"codex_home account", &Agent{codexHome: own, activeIdx: -1}, "acct-own"},
		{"default home", &Agent{activeIdx: -1}, "acct-process"},
	} {
		t.Run(c.name, func(t *testing.T) {
			tokens, err := c.agent.readOAuthTokens(os.ReadFile)
			if c.account == "" {
				if err == nil {
					t.Fatalf("read account %q from a relay home", tokens.AccountID)
				}
				if c.agent.SupportsUsageReporting() {
					t.Fatal("relay home reports usage support")
				}
				return
			}
			if err != nil || tokens.AccountID != c.account {
				t.Fatalf("tokens = %+v err = %v, want account %s", tokens, err, c.account)
			}
			if !c.agent.SupportsUsageReporting() {
				t.Fatal("account home reports no usage support")
			}
		})
	}

	if (&appServerSession{codexHome: relay}).SupportsUsageReporting() {
		t.Fatal("app-server session on a relay home would probe account/rateLimits on every reply")
	}
	if !(&appServerSession{codexHome: own}).SupportsUsageReporting() {
		t.Fatal("app-server session on an account home lost usage support")
	}
}
