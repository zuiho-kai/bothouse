package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The duty layer follows the configured position, not the persona: the configured lead gets the
// lead duties, a member the member duties, and a lead switch (lead.json) swaps them with no persona
// edit; it rides on the channel turn's team rules and is gone with inject_team_rules off
// (user 2026-11-10「通用人设 + 主角色人设，防止这种再出现」).
func TestRoleDutyLayerFollowsConfiguredPosition(t *testing.T) {
	dataDir := t.TempDir()
	writeSetupState(t, dataDir, wizardTwoRoles)
	lead := wizardEngine(t, dataDir, "lead")
	sub := wizardEngine(t, dataDir, "sub")

	isLead := func(s string) bool { return strings.Contains(s, "你现在是这个团队的主角色") }
	isSub := func(s string) bool { return strings.Contains(s, "你现在是这个团队的副手") }
	if d := lead.roleDutyLayer(""); !isLead(d) || !strings.Contains(d, "照团队模式规矩") || !strings.Contains(d, "两者冲突时照这一层做") {
		t.Fatalf("configured lead duty:\n%s", d)
	}
	if d := sub.roleDutyLayer(""); !isSub(d) || isLead(d) {
		t.Fatalf("member duty:\n%s", d)
	}

	if err := os.WriteFile(filepath.Join(dataDir, "lead.json"), []byte(`{"lead":"sub"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if d := sub.roleDutyLayer(""); !isLead(d) {
		t.Fatalf("switched-in lead must get lead duties:\n%s", d)
	}
	if d := lead.roleDutyLayer(""); !isSub(d) {
		t.Fatalf("switched-out lead must get member duties:\n%s", d)
	}

	p := &stubPlatformEngine{n: "discord"}
	if got := sub.withChannelAgentInstructions("hi", "u1", false, p, "discord:c1:u1", nil, nil); !isLead(got) {
		t.Fatalf("channel turn lacks duty layer:\n%s", got)
	}
	sub.SetTeamModeRulesEnabled(false)
	if got := sub.withChannelAgentInstructions("hi", "u1", false, p, "discord:c1:u1", nil, nil); isLead(got) || isSub(got) {
		t.Fatalf("inject_team_rules off must drop the duty layer:\n%s", got)
	}

	if d := NewEngine("solo", nil, nil, "", LangChinese).roleDutyLayer(""); d != "" {
		t.Fatalf("no team, no duty layer: %q", d)
	}
}
