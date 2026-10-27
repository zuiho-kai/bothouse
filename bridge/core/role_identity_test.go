package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestRenamePersonaIdentityKeepsProse(t *testing.T) {
	src := "# 角色：橘\n\n你是「橘」——橘色长发、白橘黑礼裙。\n\n- 团队里的画师。\n"
	want := "# 角色：小码\n\n你是「小码」——橘色长发、白橘黑礼裙。\n\n- 团队里的画师。\n"
	if got := RenamePersonaIdentity(src, "橘", "小码"); got != want {
		t.Fatalf("persona renamed incorrectly:\n%s", got)
	}
	if strings.Contains(RenamePersonaIdentity(src, "橘", "小码"), "小码色") {
		t.Fatal("prose word 橘色 was renamed")
	}
	if got := RenamePersonaIdentity("# Character: Ju\n\nYou are \"Ju\".\n", "Ju", "小码"); got != "# Character: 小码\n\nYou are \"小码\".\n" {
		t.Fatalf("English identity not renamed: %q", got)
	}
}
