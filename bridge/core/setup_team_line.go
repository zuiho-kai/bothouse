package core

import "strings"

// wizardTeamLine is the one line under the team marker for platform: the self-hosted platform keeps
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

// stuckTeamRule: a member that knows it cannot finish a job (it is waiting on someone else, or it is
// beyond what it can do) pauses it on the board and asks a person once, instead of re-explaining
// "I can't" every time the watch wakes it. Kept on the team line because WithTeam replaces one line.
func stuckTeamRule(lang string) string {
	return tr3(lang,
		" 一件活卡在别人那里、或你判断自己做不了：当轮在任务板上暂停它（board pause <编号> \"原因\"），在群里用一句话叫真人来定，然后停手。不要每次被催醒都再解释一遍做不了。",
		" 仕事が他の人待ちで止まっている、または自分には無理だと判断したら：そのターンでタスクボード上で一時停止し（board pause <番号> \"理由\"）、グループで一言だけ人に判断を頼んで手を止めます。起こされるたびに「できない」と説明し直さないでください。",
		" If a job is stuck waiting on someone else, or you judge you cannot do it: pause it on the task board in that same turn (board pause <id> \"reason\"), ask a person to decide in one line in the group, then stop. Do not re-explain that you can't every time you are woken.")
}

// discordTeamLine: names with their <@id> (a name alone does not notify a bot on Discord), the
// lead's job (split, hand to an idle member, take results back) and the members' first-line
// stance, with big work given straight to a member passed to the lead or a workspace.
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
		} else if t.Project != self {
			others = append(others, tag(t))
		}
	}
	if self == fallback {
		return tr3(lang,
			"在 Discord 上你是团队的主角色：拆任务、派给空着的队友、收结果验收，自己只做一两步的小活。队友："+strings.Join(others, "、")+"。派活就在频道里写她的 <@id> 加上要做的事，一件活只派一个人，按所长选人；要改代码、跑命令或超过 10 分钟的大活交工作区（ws-handoff）。队友交回后你汇总给提问的人。",
			"Discord では、あなたはチームのリーダーです：仕事を分け、空いているメンバーに任せ、結果を受け取って確認します。自分でやるのは一、二手の小さな作業だけ。メンバー："+strings.Join(others, "、")+"。任せるときはチャンネルにその <@id> と内容を書き、一つの仕事は一人に、得意で選びます。コード変更・コマンド実行・10 分を超える大きな仕事はワークスペースへ（ws-handoff）。返ってきた結果はまとめて質問者に伝えてください。",
			"On Discord you are the team's primary role: split the work, hand it to an idle member, take the results back and check them; do only one- or two-step jobs yourself. Members: "+strings.Join(others, ", ")+". To hand work over, write their <@id> and the task in the channel, one owner per job, picked by strength; big work (code changes, running commands, over 10 minutes) goes to a workspace (ws-handoff). Sum up what comes back for whoever asked.")
	}
	mates := ""
	if len(others) > 0 {
		mates = tr3(lang, "，队友还有 "+strings.Join(others, "、"), "。ほかのメンバー："+strings.Join(others, "、"), "; other members: "+strings.Join(others, ", "))
	}
	return tr3(lang,
		"在 Discord 上你在一个团队里，主角色是 "+lead+mates+"。被派活时第一行先表态【接】【问】【退】【升】之一；真人直接叫你做写代码、长调研这类大活时，不要在聊天频道一个人硬扛：第一行写【退】或【升】并 @ 主角色交给它拆，或自己用 ws-handoff 交进工作区。",
		"Discord では、あなたはチームの一員で、リーダーは "+lead+mates+"。仕事を受けたら一行目で【接】【问】【退】【升】のどれかを示します。人からコードを書く・長い調査のような大きな仕事を直接頼まれたら、チャットで一人で抱えず、一行目に【退】か【升】と書いてリーダーに @ で渡すか、ws-handoff でワークスペースに回してください。",
		"On Discord you are on a team whose primary role is "+lead+mates+". When given work, start your first line with one of 【接】(take) 【问】(ask) 【退】(decline) 【升】(escalate); when a person asks you directly for big work such as writing code or long research, do not carry it alone in the chat channel: write 【退】 or 【升】 on the first line and @ the primary role to split it, or hand it to a workspace with ws-handoff.")
}
