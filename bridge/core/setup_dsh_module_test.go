package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestDSHModuleLifecyclePreservesProfile(t *testing.T) {
	for _, bundle := range []string{"conest-collab", "bothouse-dsh"} {
		t.Run(bundle, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("DSH_HOME", home)
			dir := filepath.Join(home, "profiles", DSHProfile)
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			manifest := []byte("{\"dependencies\":{\"" + bundle + "\":\"link:local\"}}")
			path := filepath.Join(dir, "cordis.patch.yml")
			patch := []byte("# keep my locale\n- id: locale\n  config:\n    preference: zh\n- id: custom\n  config:\n    value: !!js process.env.CUSTOM\n")
			for name, data := range map[string][]byte{"package.json": manifest, "cordis.patch.yml": patch, "persona.md": []byte("my persona"), "memory.md": []byte("my memory")} {
				if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			dry := ApplyDSHModule(context.Background(), false, true, "zh")
			if !dry.OK || dry.Saved {
				t.Fatalf("dry-run: %+v", dry)
			}
			after, _ := os.ReadDir(dir)
			if len(after) != len(before) {
				t.Fatal("dry-run wrote files")
			}
			for _, disabled := range []bool{true, false} {
				result := ApplyDSHModule(context.Background(), disabled, false, "zh")
				if !result.OK || !result.Saved || result.DSH.Disabled != disabled {
					t.Fatalf("toggle: %+v", result)
				}
				state, err := GetDSHModuleState()
				if err != nil || state.Disabled != disabled {
					t.Fatalf("read back: %+v %v", state, err)
				}
				bytes, _ := os.ReadFile(path)
				if !strings.Contains(string(bytes), "# keep my locale") || !strings.Contains(string(bytes), "!!js process.env.CUSTOM") {
					t.Fatalf("lost YAML data: %s", bytes)
				}
				if got, _ := os.ReadFile(filepath.Join(dir, "package.json")); string(got) != string(manifest) {
					t.Fatal("changed dependencies")
				}
				if got, _ := os.ReadFile(filepath.Join(dir, "persona.md")); string(got) != "my persona" {
					t.Fatal("changed persona")
				}
				if got, _ := os.ReadFile(filepath.Join(dir, "memory.md")); string(got) != "my memory" {
					t.Fatal("changed memory")
				}
				before, _ := os.ReadDir(dir)
				repeat := ApplyDSHModule(context.Background(), disabled, false, "zh")
				after, _ := os.ReadDir(dir)
				if !repeat.OK || repeat.Saved || len(after) != len(before) {
					t.Fatalf("not idempotent: %+v", repeat)
				}
			}
		})
	}
}

func TestDSHModuleDirectInsertAndDynamicOverride(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	dir := filepath.Join(home, "profiles", DSHProfile)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "cordis.patch.yml")
	patch := "- insert:\n    - id: personal-collab\n      name: conest-collab\n      config:\n        dataDir: /keep/my/data\n"
	if err := os.WriteFile(path, []byte(patch), 0600); err != nil {
		t.Fatal(err)
	}
	if st, err := SetDSHModuleDisabled(true); err != nil || !st.Disabled {
		t.Fatalf("disable inserted plugin: %+v %v", st, err)
	}
	b, _ := os.ReadFile(path)
	var doc yaml.Node
	if err := yaml.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	entries := dshModuleEntries(doc.Content[0])
	if len(entries) != 1 || mapGet(entries[0], "disabled").Value != "true" || !strings.Contains(string(b), "/keep/my/data") {
		t.Fatalf("invalid patch: %s", b)
	}
	dynamic := "- id: personal-collab\n  name: conest-collab\n  disabled: !!js process.env.DISABLED\n"
	if err := os.WriteFile(path, []byte(dynamic), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := SetDSHModuleDisabled(false); err == nil {
		t.Fatal("overwrote dynamic expression")
	}
	if got, _ := os.ReadFile(path); string(got) != dynamic {
		t.Fatal("modified rejected patch")
	}
}

func TestDSHModuleFreshReadOnlyAndInstall(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_HOME", filepath.Join(home, "dsh"))
	bin := t.TempDir()
	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", bin)
	if st, err := GetDSHModuleState(); err != nil || st.Installed {
		t.Fatalf("fresh status: %+v %v", st, err)
	}
	if got := ApplyDSHModule(context.Background(), false, true, "zh"); got.OK || !strings.Contains(got.Error, "dsh not found") {
		t.Fatalf("missing DSH: %+v", got)
	}
	if got := ApplyDSHModule(context.Background(), true, false, "zh"); !got.OK || got.Saved {
		t.Fatalf("disable absent: %+v", got)
	}
	GetDSHStatus(context.Background())
	entries, _ := os.ReadDir(home)
	if len(entries) != 0 {
		t.Fatalf("read-only path wrote %v", entries)
	}
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte("#!/bin/sh\necho test-version\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+oldPath)
	script := t.TempDir()
	t.Setenv("BOTHOUSE_DSH_DIR", script)
	body := "#!/bin/bash\nset -eu\nmkdir -p \"$DSH_HOME/profiles/web\"\nprintf '%s' '{\"dependencies\":{\"bothouse-dsh\":\"link:local\"}}' > \"$DSH_HOME/profiles/web/package.json\"\nprintf '[]\\n' > \"$DSH_HOME/profiles/web/cordis.patch.yml\"\n"
	if err := os.WriteFile(filepath.Join(script, "install.sh"), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	if got := ApplyDSHModule(context.Background(), false, true, "zh"); !got.OK || got.Saved {
		t.Fatalf("dry installation: %+v", got)
	}
	entries, _ = os.ReadDir(home)
	if len(entries) != 0 {
		t.Fatal("dry installation wrote HOME")
	}
	if got := ApplyDSHModule(context.Background(), false, false, "zh"); !got.OK || !got.Saved || !got.DSH.Installed {
		t.Fatalf("installation: %+v", got)
	}
	if !GetDSHStatus(context.Background()).PluginInstalled {
		t.Fatal("wizard does not see installed bundle")
	}
}
