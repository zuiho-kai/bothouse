package core

import "strings"

// teamModeRulesFile is shared with DSH members: dsh/collab/team-mode-rules.md is
// mirrored into dsh_bundle/collab and both sides read the same text, so every
// backend and every bot gets one rule set (#139 C; user 2026-10-24 00:50
// 「这个提交到仓库，让每个角色都知道」).
//
// The busy reference line in that file (6 in-progress tasks per workspace) comes
// from 2026-10-23 on the operator's machine: with eight parallel lines, cancelling
// timers was missed 3 times (notes/ws-product-workspaces.md). It is guidance only;
// the user said 「这个由工作角色或者主角色决定」, so nothing here creates workspaces.
const teamModeRulesFile = "dsh_bundle/collab/team-mode-rules.md"

var teamModeRules = func() string {
	b, err := embeddedDSH.ReadFile(teamModeRulesFile)
	if err != nil {
		panic("team mode rules missing from embedded bundle: " + err.Error())
	}
	return strings.TrimSpace(string(b))
}()

// withTeamModeRules prefixes the team-mode rules on every delivery, like the
// identity and delegation blocks, so resumed and queued turns see them too.
func withTeamModeRules(prompt string) string {
	return teamModeRules + "\n" + prompt
}

// TeamModeWorkspaceInstructions is the shared opening brief for workspace creation (block D).
func TeamModeWorkspaceInstructions() string { return teamModeRules }
