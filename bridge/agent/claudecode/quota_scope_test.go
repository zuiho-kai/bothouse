package claudecode

import "testing"

func TestQuotaScopeCredentialSource(t *testing.T) {
	a := &Agent{activeIdx: -1, configEnv: []string{"ANTHROPIC_API_KEY=fixture-a"}}
	first, pool := a.QuotaScope("sonnet")
	second, _ := a.QuotaScope("opus")
	if first != second || pool != "account" {
		t.Fatal("model ID incorrectly split account quota")
	}
	a.configEnv = []string{"ANTHROPIC_API_KEY=fixture-b"}
	if other, _ := a.QuotaScope("sonnet"); other == first {
		t.Fatal("different credentials share identity")
	}
	a.spawnOpts.RunAsUser = "fixture-user"
	if user, _ := a.QuotaScope("sonnet"); user != "os-user:fixture-user" {
		t.Fatal("isolated user inherited supervisor credentials")
	}
}
