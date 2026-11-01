package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

// Exercise the public command sequence used by a person adding platforms over
// time. Fake platform services answer the connection checks; no live accounts.
func TestModuleMultiPlatformCommandLifecyclePreservesPersonas(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(configPath, []byte("data_dir = \""+filepath.ToSlash(dir)+"\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	discord := fakeDiscordAPI(t, 1<<18, "900")
	feishu := fakeFeishuOpen(t)
	qq := fakeNapCat(t, "")
	env := []string{"HOME=" + dir, "USERPROFILE=" + dir, "DSH_HOME=" + filepath.Join(dir, "dsh"), "CONEST_DISCORD_API_BASE=" + discord.URL, "CONEST_FEISHU_OPEN_BASE=" + feishu.URL, "ANTHROPIC_API_KEY=test-key"}
	var previous map[string][]byte
	for _, args := range [][]string{
		{"add", "discord", "--token", testBotToken, "--guild", "900"},
		{"add", "qq", "--ws-url", qq, "--allow-from", "3889000001"},
		{"add", "feishu", "--app-id", "cli_fixture", "--app-secret", "fixture-secret"},
	} {
		out, err := helper(t, "module", env, append(args, "--config", configPath)...).CombinedOutput()
		if err != nil {
			t.Fatalf("add %s: %v %s", args[1], err, out)
		}
		assertModuleFilesUnchanged(t, previous)
		previous = moduleMarkdownSnapshot(t, dir)
	}
	if len(previous) == 0 {
		t.Fatal("fixture created no persona files; preservation assertion would be vacuous")
	}
	for _, mod := range []string{"discord", "qq", "feishu"} {
		for _, action := range []string{"disable", "add"} {
			out, err := helper(t, "module", env, action, mod, "--config", configPath).CombinedOutput()
			if err != nil {
				t.Fatalf("%s %s: %v %s", action, mod, err, out)
			}
			cfg, err := config.LoadForSetup(configPath)
			if err != nil {
				t.Fatal(err)
			}
			states := config.ModuleStates(cfg)
			for _, other := range []string{"discord", "qq", "feishu"} {
				state, ok := states[other]
				if !ok {
					t.Fatalf("lost %s", other)
				}
				if other == mod && action == "disable" {
					if len(state.Disabled) == 0 || len(state.Enabled) != 0 {
						t.Fatalf("not disabled: %+v", state)
					}
				} else if len(state.Enabled) == 0 || len(state.Disabled) != 0 {
					t.Fatalf("unexpected state %s: %+v", other, state)
				}
			}
			assertModuleFilesUnchanged(t, previous)
		}
	}
}

func moduleMarkdownSnapshot(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	result := map[string][]byte{}
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".md") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		result[path] = body
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func assertModuleFilesUnchanged(t *testing.T, files map[string][]byte) {
	t.Helper()
	for path, before := range files {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("existing persona or memory changed: %s (%v)", path, err)
		}
	}
}
