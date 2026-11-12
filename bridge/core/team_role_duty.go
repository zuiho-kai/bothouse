package core

// Standard duty layer (user 2026-11-10「能不能搞点标准人设，现在别人通用人设 + 主角色 人设，防止这种再出现」).
//
// A persona says who a role is and how it talks; how the role works in the team depends on its
// position, and the position comes from configuration (isTeamLead: lead.json, else the configured
// lead), never from the persona text. Whoever is the lead gets the same lead duties, whoever is
// not gets the member duties, so switching the lead needs no persona edit. agentm (2026-11-10,
// #1369/#1372) showed why: its lead ran Codex with a persona saying 「主力干活担当」「不服就上手改」
// and did big jobs itself instead of handing them to a workspace. The layer therefore says it
// overrides the persona where they disagree.
//
// It rides with the team-mode rules (contextRules → teamRulesOnce): once per agent context, off
// with inject_team_rules, and sent again when the text changes, so a lead switch reaches the
// next turn of both the old and the new lead.

const roleDutyHead = "[团队职责层 — 桥按配置附上]"

const roleDutyPrecedence = "人设只管你是谁、怎么说话；这一层管你在团队里怎么干活。两者冲突时照这一层做：人设里「主力干活」「爱上手」「项目经理」这类话，不改变你现在的位置。位置以配置为准，换主角色只改配置。"

const leadDutyBody = `你现在是这个团队的主角色。
- 你的活是拆任务、派活、收结果、验收；自己只做一两步就完的小活。
- 大活（要改代码、跑测试、等命令，或预计超过 10 分钟）：接到的这一轮第一步就交工作区（写交接，跑 ws-handoff），不在聊天频道里自己动手。做到一半变大，也停下交出去。
- 空着的队友按所长当面派；一件活只有一个主。
- 用户问进度：先看任务板（board）和队友状态再答，不自己重查一遍。
- 交回的结果由你验收：对照用户原话和交接范围放行或打回（ws-pass / ws-forward），不替写的人改。`

const leadWorkspaceDutyBody = `你现在是这个团队的主角色，这里是工作区。
- 工作区里接到的交接，这件活你自己做完，不再拆给别人、不再交工作区。
- 只做交接里写成「改」的部分；缩小范围或拿不准的设定，用 ws-up --ask 问，不自己定。
- 做完照交接的交回骨架交 [report]。`

const memberDutyBody = `你现在是这个团队的副手，不是主角色。
- 没被 @ 或点名不开口；被派活时第一行先表态【接】【问】【退】【升】。
- 真人直接叫你做大活（写代码、长调研、超过 10 分钟）：第一行写【退】或【升】并 @ 主角色交给它拆，或自己 ws-handoff 交工作区；不在聊天频道一个人硬扛。
- 问话、闲聊这类不是派给你的活：直接答，不写交接、不跑 ws-handoff。
- 你不给队友派活、不替主角色验收；要拍板、交接、升级找主角色。`

// roleDutyLayer is the duty text for this project's current position, "" outside a team.
// sessionKey picks the workspace variant for the lead; "" means a chat channel.
func (e *Engine) roleDutyLayer(sessionKey string) string {
	if e == nil || e.team == nil || e.team.name == "" {
		return ""
	}
	var body string
	switch {
	case e.isTeamLead() && sessionKey != "" && e.isTeamWorkspaceChat(sessionKey):
		body = leadWorkspaceDutyBody
	case e.isTeamLead():
		body = leadDutyBody
	default:
		body = memberDutyBody
	}
	return roleDutyHead + "\n" + roleDutyPrecedence + "\n" + body
}

// withRoleDuty appends the duty layer to the team-mode rules of one delivery.
func (e *Engine) withRoleDuty(rules, sessionKey string) string {
	duty := e.roleDutyLayer(sessionKey)
	if duty == "" {
		return rules
	}
	if rules == "" {
		return duty
	}
	return rules + "\n" + duty
}
