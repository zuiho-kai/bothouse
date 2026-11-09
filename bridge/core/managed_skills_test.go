package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedSkillPendingApprovalAndRoleViews(t *testing.T) {
	dataDir := t.TempDir()
	body := "---\nname: role-guide\ndescription: Role scoped guide\n---\n\nUse the role view.\n"
	if _, err := writeManagedSkill(dataDir, "writer", "role-guide", "writer", body, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(managedSkillsDir(dataDir), "library", "role-guide", "SKILL.md")); !os.IsNotExist(err) {
		t.Fatalf("pending skill became active: err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(managedSkillsDir(dataDir), "pending", "writer", "role-guide.md")); err != nil {
		t.Fatalf("pending body missing: %v", err)
	}
	registry := NewSkillRegistry()
	registry.SetDirs([]string{ManagedSkillViewDir(dataDir, "writer")})
	if got := registry.ListAll(); len(got) != 0 {
		t.Fatalf("pending skill discovered: %+v", got)
	}

	if _, err := approvePendingSkill(dataDir, "writer", "role-guide"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(managedSkillsDir(dataDir), "pending", "writer", "role-guide.md")); !os.IsNotExist(err) {
		t.Fatalf("approved pending file remains: err=%v", err)
	}
	registry.Invalidate()
	if got := registry.Resolve("role-guide"); got == nil || got.Prompt != "Use the role view." {
		t.Fatalf("approved skill missing from enabled role view: %+v", got)
	}
	if _, err := setManagedSkillEnabled(dataDir, "reviewer", "role-guide", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "reviewer"), "role-guide", "SKILL.md")); err != nil {
		t.Fatalf("second role view missing: %v", err)
	}
	if _, err := setManagedSkillEnabled(dataDir, "writer", "role-guide", false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "writer"), "role-guide")); !os.IsNotExist(err) {
		t.Fatalf("disabled role still has a discoverable view: err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "reviewer"), "role-guide", "SKILL.md")); err != nil {
		t.Fatalf("disabling writer changed reviewer view: %v", err)
	}
	if err := deleteManagedSkill(dataDir, "role-guide"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "reviewer"), "role-guide")); !os.IsNotExist(err) {
		t.Fatalf("deleted skill remains in reviewer view: err=%v", err)
	}
}

func TestManagedSkillEditCreatesNewApprovedVersion(t *testing.T) {
	dataDir := t.TempDir()
	first := "---\ndescription: First\n---\n\nfirst\n"
	second := "---\ndescription: Second\n---\n\nsecond\n"
	if _, err := writeManagedSkill(dataDir, "writer", "guide", "writer", first, true); err != nil {
		t.Fatal(err)
	}
	record, err := writeManagedSkill(dataDir, "writer", "guide", "writer", second, true)
	if err != nil {
		t.Fatal(err)
	}
	if record.Version != 2 {
		t.Fatalf("version = %d, want 2", record.Version)
	}
	if _, err := os.Stat(filepath.Join(managedSkillsDir(dataDir), "library", "guide", "versions", "1", "SKILL.md")); err != nil {
		t.Fatalf("first version was not retained: %v", err)
	}
	current, err := readManagedSkill(dataDir, "guide", record)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(current.Body, "description: Second") || !strings.Contains(current.Body, "second") {
		t.Fatalf("current document = %q, want frontmatter and updated body", current.Body)
	}
}

func TestManagedSkillUseIsCountedOnlyFromEnabledRoleView(t *testing.T) {
	dataDir := t.TempDir()
	_, err := writeManagedSkill(dataDir, "writer", "guide", "writer", "Follow the guide.", true)
	if err != nil {
		t.Fatal(err)
	}
	view := filepath.Join(ManagedSkillViewDir(dataDir, "writer"), "guide")
	recordManagedSkillUseFromView(view)
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Skills["guide"].Uses["writer"]; got != 1 {
		t.Fatalf("writer uses = %d, want 1", got)
	}
	if _, err := setManagedSkillEnabled(dataDir, "writer", "guide", false); err != nil {
		t.Fatal(err)
	}
	recordManagedSkillUseFromView(view)
	state, err = readManagedSkillState(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Skills["guide"].Uses["writer"]; got != 1 {
		t.Fatalf("disabled view uses = %d, want 1", got)
	}
}
