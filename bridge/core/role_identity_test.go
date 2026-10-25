package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDSHPersonaCatalog(t *testing.T) {
	var catalog map[string][]struct{ Slug, Name, Text, Avatar string }
	b, err := os.ReadFile(filepath.Join("..", "..", "dsh", "collab", "personas.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, lang := range []string{"zh", "en"} {
		want := PersonaPresets(lang)
		if len(catalog[lang]) != len(want) {
			t.Fatalf("%s catalog length: %d, want %d", lang, len(catalog[lang]), len(want))
		}
		for i, p := range want {
			got := catalog[lang][i]
			if got.Slug != p.ID || got.Name != p.Name || got.Text != p.Text || got.Avatar != p.Avatar {
				t.Errorf("%s persona %s differs from source", lang, p.ID)
			}
		}
	}
}

func TestNextRoleName(t *testing.T) {
	if got := NextRoleName(AgentDisplayName("codex"), []string{"Codex", "codex-2", "other"}); got != "Codex-3" {
		t.Fatal(got)
	}
	if got := NextRoleName(AgentDisplayName("claudecode"), nil); got != "Claude Code" {
		t.Fatal(got)
	}
}
