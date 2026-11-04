package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The settings page sets who verifies each review tier; the values round-trip through config.toml.
func TestGlobalSettingsReviewRoles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("language = \"zh\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := ConfigPath
	ConfigPath = path
	t.Cleanup(func() { ConfigPath = old })
	simple, complex := " deep ", "gge"
	if err := SaveGlobalSettings(GlobalSettingsUpdate{ReviewSimpleRole: &simple, ReviewComplexRole: &complex}); err != nil {
		t.Fatal(err)
	}
	g := GetGlobalSettings()
	if g["review_simple_role"] != "deep" || g["review_complex_role"] != "gge" {
		t.Fatalf("settings = %v", g)
	}
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), "[team_review]") {
		t.Fatalf("config.toml lacks [team_review]:\n%s", b)
	}
	empty := ""
	if err := SaveGlobalSettings(GlobalSettingsUpdate{ReviewSimpleRole: &empty}); err != nil {
		t.Fatal(err)
	}
	if g := GetGlobalSettings(); g["review_simple_role"] != "" || g["review_complex_role"] != "gge" {
		t.Fatalf("clearing one tier: %v", g)
	}
}
