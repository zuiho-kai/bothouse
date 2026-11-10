package claudecode

import (
	"slices"
	"testing"
)

// A role under run_as_user used to lose CC_PROJECT / CC_SESSION_KEY at the sudo boundary, so
// `bothouse member` inside the role could not even name its turn (docs/MEMBER_WORKSPACES.md). The keys
// this session sets on purpose now travel with the spawn; the bridge's own environment still does not.
func TestRunAsSessionEnvKeysCrossSudo(t *testing.T) {
	extra := []string{"CC_PROJECT=lead", "CC_SESSION_KEY=discord:c1", "CC_DATA_DIR=/d", "CC_BIN=/b/bothouse", "ANTHROPIC_API_KEY=k"}
	got := withSessionEnvKeys([]string{"PGSSLMODE"}, extra)
	for _, want := range []string{"PGSSLMODE", "CC_PROJECT", "CC_SESSION_KEY", "CC_DATA_DIR", "CC_BIN", "ANTHROPIC_API_KEY"} {
		if !slices.Contains(got, want) {
			t.Errorf("allowlist missing %q: %v", want, got)
		}
	}
	if slices.Contains(got, "PATH") || slices.Contains(got, "HOME") {
		t.Errorf("allowlist widened beyond this session's own keys: %v", got)
	}
	// The caller's slice is not modified: the agent's spawnOpts is shared by later sessions.
	allow := []string{"PGSSLMODE"}
	_ = withSessionEnvKeys(allow, extra)
	if len(allow) != 1 {
		t.Fatalf("caller's allowlist mutated: %v", allow)
	}
	// Without run_as_env / extra env the allowlist is emptied, not padded.
	if got := withSessionEnvKeys(nil, nil); len(got) != 0 {
		t.Fatalf("empty input grew: %v", got)
	}
}
