package core

import "testing"

// teamModeRulesMaxBytes caps the always-on team rules text. Source: #574 第6条：常驻规则定总量，加一删一；
// 上限取 2026-10-25 develop 22f4076e 时的字节数（dsh/collab/team-mode-rules.md，最后改动 e35471b6）。
const teamModeRulesMaxBytes = 6249

func TestTeamModeRulesSizeCap(t *testing.T) {
	if n := len(teamModeRulesText); n > teamModeRulesMaxBytes {
		t.Fatalf("规矩超出总量：加一条先删或合一条（%d 字节，上限 %d）", n, teamModeRulesMaxBytes)
	}
}
