package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// originatorPythonVerifier returns a Python interpreter that can import the
// reference gateway's dependency. CC_TEST_ORIGINATOR_PYTHON pins one; otherwise
// the usual names are tried. The cross-language check must run by default — a
// test that silently skips is no check at all — so a missing interpreter is
// reported loudly rather than passing as green.
func originatorPythonVerifier(t *testing.T) string {
	t.Helper()
	candidates := []string{}
	if pinned := os.Getenv("CC_TEST_ORIGINATOR_PYTHON"); pinned != "" {
		candidates = append(candidates, pinned)
	}
	candidates = append(candidates, "python3", "python")
	for _, candidate := range candidates {
		if _, err := exec.LookPath(candidate); err != nil {
			continue
		}
		if err := exec.Command(candidate, "-c", "import cryptography").Run(); err == nil {
			return candidate
		}
	}
	t.Skipf("no Python interpreter with the 'cryptography' package was found (tried %s); "+
		"install it or set CC_TEST_ORIGINATOR_PYTHON to skip this cross-language check explicitly",
		strings.Join(candidates, ", "))
	return ""
}

// The reference gateway verifies Go-signed tickets with its own canonical
// encoder. Character classes that the two languages escape differently must
// still produce identical bytes, or a legitimate ticket fails verification.
func TestOriginatorTicketPythonGatewayCompatibility(t *testing.T) {
	python := originatorPythonVerifier(t)
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name     string
		userID   string
		session  string
		action   string
		messageI string
	}{
		{name: "plain", userID: "alice", session: "discord:c1", action: "gpu.run", messageI: "message-1"},
		// Go's json.Marshal escapes these as & < >; Python's
		// json.dumps does not. Both sides must sign the same bytes.
		{name: "html escaped by go", userID: "a&b<c>d", session: "discord:c&1", action: "gpu.run<x>", messageI: "m&1<x>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := &Engine{name: "role", dataDir: t.TempDir()}
			e.originatorTurns.Store(tc.session, originatorGrant{platform: "discord", userID: tc.userID, messageID: tc.messageI})
			ticket, err := e.signOriginator(originatorRequest{Project: "role", Session: tc.session, Action: tc.action, ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339)})
			if err != nil {
				t.Fatal(err)
			}
			data, _ := json.Marshal(ticket)
			dir := t.TempDir()
			ticketPath := filepath.Join(dir, "ticket.json")
			if err := os.WriteFile(ticketPath, data, 0o600); err != nil {
				t.Fatal(err)
			}
			keysPath := filepath.Join(dir, "keys.json")
			keys, _ := json.Marshal(map[string]string{ticket.KeyID: ticket.PublicKey})
			if err := os.WriteFile(keysPath, keys, 0o600); err != nil {
				t.Fatal(err)
			}
			policyPath := filepath.Join(dir, "policy.json")
			principal := map[string]any{"role": "member", "projects": map[string]any{"role": map[string]any{"execute_as": "alice-agent", "actions": []string{tc.action}, "command": []string{"unused"}}}}
			policy, _ := json.Marshal(map[string]any{"principals": map[string]any{"discord:" + tc.userID: principal}})
			if err := os.WriteFile(policyPath, policy, 0o600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(python, filepath.Join(repo, "integrations", "gpu-submit", "gpu_submit.py"), "--ticket", ticketPath, "--trusted-keys", keysPath, "--policy", policyPath, "--audit-log", filepath.Join(dir, "audit.jsonl"), "--nonce-db", filepath.Join(dir, "nonces"), "--dry-run")
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("Python rejected Go-issued ticket: %v: %s", err, output)
			}
		})
	}
}
