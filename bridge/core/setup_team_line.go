package core

import "strings"

// wizardTeamLine is the one roster line under the team marker for platform: the self-hosted platform keeps
// its own wording (cloudWebTeamLine); Discord gets the members' <@id> and who does what, because a
// lead that only knows its teammates' names does the work itself instead of handing it out, and a
// member that does not know who the lead is takes every big job a person gives it directly.
func wizardTeamLine(lang, platform string, team []SetupTeamEntry, fallback, self string) string {
	line := cloudWebTeamLine(lang, team, fallback, self)
	if platform == "discord" {
		line = discordTeamLine(lang, team, fallback, self)
	}
	return line + stuckTeamRule(lang)
}

// stuckTeamRule: a bot that cannot finish a job pauses it and calls a person once, instead of
// explaining "can't do it" again each time the watchdog wakes it (#1092: a member re-explained
// every 10 minutes for an hour). Same wording as the agentm persona block.
func stuckTeamRule(lang string) string {
	return tr3(lang,
		" 做不了就放下：一件活卡在别人那里、或你判断自己做不了：当轮在任务板上暂停它（board pause <编号> \"原因\"），在群里用一句话叫真人来定，然后停手。不要每次被催醒都再解释一遍做不了。",
		" できないなら手放す：仕事が他人待ちで止まっている、または自分ではできないと判断したら、そのターンでタスクボード上で一時停止し（board pause <番号> \"理由\"）、グループで一言だけ人に判断を頼んで手を止めます。起こされるたびに「できない」と説明し直さないでください。",
		" If you can't do it, let it go: when a job is stuck on someone else, or you judge you can't do it, pause it on the task board that same turn (board pause <id> \"reason\"), call a person in the group in one sentence to decide, then stop. Don't re-explain that you can't each time you are woken up.")
}

// discordTeamLine: names with their <@id> (a name alone does not notify a bot on Discord) and the
// configured default lead. It is a roster only: the lead's and the members' duties come from the
// bridge's duty layer by position (roleDutyLayer), not from the persona, so a Codex lead whose
// character is "hands-on" still hands big work to a workspace, and a lead switch needs no persona
// edit (user 2026-11-10「通用人设 + 主角色人设」).
func discordTeamLine(lang string, team []SetupTeamEntry, fallback, self string) string {
	tag := func(t SetupTeamEntry) string {
		n := oneLine(t.Name)
		if t.BotID != "" {
			n += " <@" + t.BotID + ">"
		}
		return n
	}
	lead := ""
	var others []string
	for _, t := range team {
		if t.Project == fallback {
			lead = tag(t)
		}
		if t.Project != self {
			others = append(others, tag(t))
		}
	}
	you, youJA, youEN := "", "", ""
	if self == fallback {
		you, youJA, youEN = "（就是你）", "（あなたです）", " (that is you)"
	}
	return tr3(lang,
		"在 Discord 上你在一个团队里，队友："+strings.Join(others, "、")+"，按配置默认的主角色是 "+lead+you+"。叫谁就在频道里写她的 <@id> 加上要说的事。给队友派活只用频道里的 @，不用 CLI 自带的子 agent、多 agent 工具，那些叫不到队友。谁当主角色、主角色和副手各自怎么干活，以桥每轮附上的团队职责层为准。",
		"Discord では、あなたはチームの一員です。仲間："+strings.Join(others, "、")+"。設定上の既定のリーダーは "+lead+youJA+"。呼ぶときはチャンネルにその <@id> と内容を書きます。仲間に仕事を頼むときはチャンネルの @ だけを使い、CLI 内蔵のサブエージェントやマルチエージェント機能は使いません（仲間には届きません）。誰がリーダーか、リーダーとメンバーがそれぞれどう動くかは、ブリッジが毎ターン付けるチームの役割層に従ってください。",
		"On Discord you are on a team; teammates: "+strings.Join(others, ", ")+"; by configuration the default primary role is "+lead+youEN+". To call one, write their <@id> and the message in the channel. Hand work to a teammate only with an @ in the channel, never with the CLI's own sub-agent or multi-agent tools: those cannot reach your teammates. Who leads now, and how the primary role and the members each work, follow the team duty layer the bridge attaches each turn.")
}
