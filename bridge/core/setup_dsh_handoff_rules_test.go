package core

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

// The collab plugin refuses handoffs without handoff-rules.json next to it, so both refresh paths
// (in place, and the staged copy swapped in when deps changed) must leave the LeadToolFS copy there.
func TestRefreshEmbeddedDSH_WritesHandoffRules(t *testing.T) {
	rules := []byte(`{"checks":[],"lead":"#"}` + "\n")
	old := LeadToolFS
	LeadToolFS = fstest.MapFS{"contrib/lead/handoff-rules.json": {Data: rules}}
	t.Cleanup(func() { LeadToolFS = old })
	oldInstall := installCollabDeps
	installCollabDeps = func(dir string) error { return os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755) }
	t.Cleanup(func() { installCollabDeps = oldInstall })

	for _, staged := range []bool{false, true} {
		dir := filepath.Join(t.TempDir(), "dsh")
		if _, err := ExtractEmbeddedDSH(dir); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(dir, "collab", handoffRulesFile)
		if got, _ := os.ReadFile(file); !bytes.Equal(got, rules) {
			t.Fatalf("extract: rules = %q", got)
		}
		os.Remove(file)
		if staged { // node_modules installed from other deps: refresh goes through the staged copy
			os.MkdirAll(filepath.Join(dir, "collab", "node_modules"), 0o755)
			os.WriteFile(filepath.Join(dir, "collab", collabDepsStamp), []byte("old deps"), 0o644)
		}
		if ok, err := RefreshEmbeddedDSH(dir, "v-test-new"); !ok || err != nil {
			t.Fatalf("staged=%v: refresh = %v %v", staged, ok, err)
		}
		if got, err := os.ReadFile(file); err != nil || !bytes.Equal(got, rules) {
			t.Fatalf("staged=%v: after refresh rules = %q, %v; want the LeadToolFS copy", staged, got, err)
		}
	}
}
