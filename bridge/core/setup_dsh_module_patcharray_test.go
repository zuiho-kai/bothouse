package core

import (
	"os"
	"path/filepath"
	"testing"
)

// dsh-web-app@0.2.1-rc.2 declares dsh.bundle.patch as an ordered array (five
// upstream layers). Bundles may also declare a single string. Layers apply in
// upstream order, and the profile/HOME overrides still apply afterwards (#812).
func TestDSHModuleBundlePatchArrayLayersApplyInOrder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	dir := filepath.Join(home, "profiles", DSHProfile)
	bundle := filepath.Join(dir, "node_modules", "dsh-web-app")
	write := func(path, body string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(dir, "package.json"),
		`{"dsh":{"profile":{"bundles":["dsh-web-app"]}}}`)
	write(filepath.Join(bundle, "package.json"),
		`{"dsh":{"bundle":{"patch":["./first.patch.yml","./second.patch.yml"]}}}`)
	write(filepath.Join(bundle, "first.patch.yml"),
		"- insert:\n    - id: bothouse-dsh\n      name: bothouse-dsh\n")
	write(filepath.Join(bundle, "second.patch.yml"),
		"- id: bothouse-dsh\n  disabled: true\n")

	state, err := GetDSHModuleState()
	if err != nil {
		t.Fatalf("array bundle.patch must be accepted: %v", err)
	}
	if !state.Installed || !state.Disabled {
		t.Fatalf("upstream layers must apply in order (later layer disables): %+v", state)
	}
}