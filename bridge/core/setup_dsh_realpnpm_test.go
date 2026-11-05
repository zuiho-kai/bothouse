package core

import (
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestRefreshDSH_RealPNPMUpgrade runs the upgrade path with the real pnpm and then loads the
// plugin's SDK with node from the live directory, the way DSH does. Opt-in (network, minutes):
// BOTHOUSE_REAL_PNPM=1. It is how the Windows junction breakage (11-05) is reproduced on a
// Windows machine.
func TestRefreshDSH_RealPNPMUpgrade(t *testing.T) {
	if os.Getenv("BOTHOUSE_REAL_PNPM") != "1" {
		t.Skip("set BOTHOUSE_REAL_PNPM=1 (needs pnpm, node and network)")
	}
	dir := installedDSH(t)
	sub, _ := fs.Sub(embeddedDSH, "dsh_bundle")
	for _, f := range []string{"package.json", "pnpm-lock.yaml"} {
		b, err := fs.ReadFile(sub, "collab/"+f)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "collab", f), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if ok, err := RefreshEmbeddedDSH(dir, "v-real"); err != nil || !ok {
		t.Fatalf("refresh = %v %v", ok, err)
	}
	node := exec.Command("node", "--input-type=module", "-e", "await import('@agentclientprotocol/sdk'); await import('ws'); console.log('deps load')")
	node.Dir = filepath.Join(dir, "collab")
	out, err := node.CombinedOutput()
	t.Logf("node: %s", out)
	if err != nil {
		t.Fatalf("plugin deps do not load from the live directory after the upgrade: %v", err)
	}
}
