package config

import (
	"os"
	"path/filepath"
	"testing"
)

// Two avatar sets, default the vendors' own icons (user 2026-11-10「默认是各家原本的图标，内置另一套娘化图标」).
func TestGlobalSettingsAvatarStyle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("language = \"zh\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := ConfigPath
	ConfigPath = path
	t.Cleanup(func() { ConfigPath = old })
	if g := GetGlobalSettings(); g["avatar_style"] != AvatarStyleBrand {
		t.Fatalf("default avatar_style = %v, want brand", g["avatar_style"])
	}
	chibi := "chibi"
	if err := SaveGlobalSettings(GlobalSettingsUpdate{AvatarStyle: &chibi}); err != nil {
		t.Fatal(err)
	}
	if g := GetGlobalSettings(); g["avatar_style"] != AvatarStyleChibi || g["language"] != "zh" {
		t.Fatalf("after save: %v", g)
	}
	bad := "pixel"
	if err := SaveGlobalSettings(GlobalSettingsUpdate{AvatarStyle: &bad}); err == nil {
		t.Fatal("unknown avatar_style accepted")
	}
	if g := GetGlobalSettings(); g["avatar_style"] != AvatarStyleChibi {
		t.Fatalf("rejected value changed the setting: %v", g)
	}
}
