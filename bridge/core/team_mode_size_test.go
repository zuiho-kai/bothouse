package core

import "testing"

// teamModeInjectMaxBytes caps what one delivery actually carries (contextRules): the team-mode rules of a
// mode, the duty layer of a position and aboutHint. Source: #574 第6条：常驻规则定总量，加一删一. #1588: the
// cap used to cover the rules file only, so the duty layer grew outside it and each 「加一删一」 inside cut
// half sentences instead; it now covers the whole injection. Value: the largest injection on develop
// 590a4aa23 (mixed + lead chat duty + aboutHint) before #1588 merged the dispatch rules into one place.
const teamModeInjectMaxBytes = 6215 + 1 + len(aboutHint)

func TestTeamModeRulesSizeCap(t *testing.T) {
	for _, mode := range []string{DispatchSolo, DispatchTeam, DispatchMixed} {
		for name, body := range map[string]string{"lead": leadDutyBody, "lead-workspace": leadWorkspaceDutyBody, "member": memberDutyBody} {
			if n := len(teamModeRulesFor(mode) + "\n" + roleDutyText(body) + "\n" + aboutHint); n > teamModeInjectMaxBytes {
				t.Fatalf("%s/%s 每轮注入超出总量：加一条先删或合一条（%d 字节，上限 %d）", mode, name, n, teamModeInjectMaxBytes)
			}
		}
	}
}
