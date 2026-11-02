package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestModuleDSHCommandLifecycle(t *testing.T) {
	home := t.TempDir()
	profile := filepath.Join(home, "dsh", "profiles", "web")
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	manifest := "{\"dependencies\":{\"bothouse-dsh\":\"link:local\"}}"
	if err := os.WriteFile(filepath.Join(profile, "package.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "cordis.patch.yml"), []byte("- insert:\n    - id: bothouse-dsh\n      name: bothouse-dsh\n"), 0600); err != nil {
		t.Fatal(err)
	}
	env := []string{"HOME=" + home, "DSH_HOME=" + filepath.Join(home, "dsh")}
	configPath := filepath.Join(home, "config.toml")
	for _, action := range []string{"disable", "add", "enable"} {
		cmd := helper(t, "module", env, action, "dsh", "--config", configPath)
		out, err := cmd.CombinedOutput()
		var result core.DSHModuleResult
		if err != nil || json.Unmarshal(out, &result) != nil || !result.OK || !result.DSH.Installed || result.DSH.Disabled != (action == "disable") {
			t.Fatalf("%s: %v %s", action, err, out)
		}
		list, err := helper(t, "module", env, "list", "--config", configPath).CombinedOutput()
		state := "enabled"
		if action == "disable" {
			state = "disabled"
		}
		if err != nil || !strings.Contains(string(list), "dsh          "+state) {
			t.Fatalf("list after %s: %v %s", action, err, list)
		}
	}
	if raw, _ := os.ReadFile(filepath.Join(profile, "package.json")); string(raw) != manifest {
		t.Fatal("changed dependencies")
	}
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatalf("DSH touched config.toml: %v", err)
	}
}

func TestModuleDSHCommandDryRunDoesNotInstall(t *testing.T) {
	home := t.TempDir()
	profile := filepath.Join(home, "dsh", "profiles", "web")
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "package.json"), []byte("{\"dependencies\":{\"conest-collab\":\"link:local\"}}"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "- insert:\n    - id: conest-collab\n      name: conest-collab\n      disabled: true\n    - id: conest-channels-ui\n      name: '@deepseek-ai/dsh-experimental-client-ui-discord'\n      disabled: true\n"
	path := filepath.Join(profile, "cordis.patch.yml")
	if err := os.WriteFile(path, []byte(patch), 0600); err != nil {
		t.Fatal(err)
	}
	env := []string{"HOME=" + home, "DSH_HOME=" + filepath.Join(home, "dsh")}
	before, _ := os.ReadDir(profile)
	out, err := helper(t, "module", env, "add", "dsh", "--dry-run").CombinedOutput()
	var result core.DSHModuleResult
	if err != nil || json.Unmarshal(out, &result) != nil || !result.OK || !result.DryRun || result.Saved {
		t.Fatalf("dry-run: %v %s", err, out)
	}
	if raw, _ := os.ReadFile(path); string(raw) != patch {
		t.Fatal("dry-run changed patch")
	}
	after, _ := os.ReadDir(profile)
	if len(before) != len(after) {
		t.Fatal("dry-run created files")
	}
}
