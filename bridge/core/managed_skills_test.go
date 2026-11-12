package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	record, err := editManagedSkill(dataDir, "guide", second)
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

func TestManagedSkillEditPreservesDisabledRoles(t *testing.T) {
	dataDir := t.TempDir()
	for _, owner := range []string{"writer", "recommended"} {
		name := owner + "-guide"
		if _, err := writeManagedSkill(dataDir, "writer", name, owner, "First.", true); err != nil {
			t.Fatal(err)
		}
		if _, err := setManagedSkillEnabled(dataDir, "reviewer", name, true); err != nil {
			t.Fatal(err)
		}
		if _, err := setManagedSkillEnabled(dataDir, "writer", name, false); err != nil {
			t.Fatal(err)
		}
		record, err := editManagedSkill(dataDir, name, "Edited.")
		if err != nil {
			t.Fatal(err)
		}
		if record.Enabled["writer"] || !record.Enabled["reviewer"] || len(record.Enabled) != 2 || record.Owner != owner {
			t.Fatalf("edit changed ownership or enablement: %+v", record)
		}
		if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "writer"), name)); !os.IsNotExist(err) {
			t.Fatalf("disabled view returned: %v", err)
		}
		body, err := os.ReadFile(filepath.Join(ManagedSkillViewDir(dataDir, "reviewer"), name, "SKILL.md"))
		if err != nil || string(body) != "Edited." {
			t.Fatalf("enabled view not updated: %q %v", body, err)
		}
	}
}

func TestManagedSkillConcurrentCountDisableAndApproval(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := writeManagedSkill(dataDir, "writer", "guide", "writer", "Guide.", true); err != nil {
		t.Fatal(err)
	}
	if _, err := setManagedSkillEnabled(dataDir, "reader", "guide", true); err != nil {
		t.Fatal(err)
	}
	const operations = 16 // Test workload: overlap independent counts, approvals and one disable.
	for i := 0; i < operations; i++ {
		if _, err := writeManagedSkill(dataDir, "writer", fmt.Sprintf("guide-%d", i), "writer", "Pending.", false); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	launch := func(fn func()) { wg.Add(1); go func() { defer wg.Done(); <-start; fn() }() }
	for i := 0; i < operations; i++ {
		name := fmt.Sprintf("guide-%d", i)
		launch(func() { recordManagedSkillUseFromView(filepath.Join(ManagedSkillViewDir(dataDir, "reader"), "guide")) })
		launch(func() { recordManagedSkillUseFromView(filepath.Join(ManagedSkillViewDir(dataDir, "writer"), "guide")) })
		launch(func() {
			if _, err := approvePendingSkill(dataDir, "writer", name); err != nil {
				t.Error(err)
			}
		})
	}
	launch(func() {
		if _, err := setManagedSkillEnabled(dataDir, "writer", "guide", false); err != nil {
			t.Error(err)
		}
	})
	close(start)
	wg.Wait()
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Skills) != operations+1 || state.Skills["guide"].Enabled["writer"] || state.Skills["guide"].Uses["reader"] != operations {
		t.Fatalf("lost concurrent update: %+v", state)
	}
	// Startup must not resurrect the disabled writer view from a stale state snapshot.
	engine := &Engine{name: "writer", skills: NewSkillRegistry()}
	engine.SetDataDir(dataDir)
	if _, err := os.Stat(filepath.Join(ManagedSkillViewDir(dataDir, "writer"), "guide")); !os.IsNotExist(err) {
		t.Fatalf("disabled view returned: %v", err)
	}
}
