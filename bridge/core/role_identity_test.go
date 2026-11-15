package core

import (
	"strings"
	"testing"
)

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
