package core

import (
	"net"
	"strings"
	"time"
)

// Warnings and the gate status line at the end of a wizard run. The web wizard's last
// page and `cc-connect setup apply` print the same result.

// 来源：contrib/gate/gate.py PORT = 9930（与 defaultGateURL 同一个地址）。变量便于测试替换。
var gateAddr = "127.0.0.1:9930"

// GateRunning reports whether the gate answers on this machine.
func GateRunning() bool {
	c, err := net.DialTimeout("tcp", gateAddr, 300*time.Millisecond) // 本机连接，300ms 足够（同 HardwarePresent）
	if err != nil {
		return false
	}
	c.Close()
	return true
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func warnIntentOff(lang, bot, appID string) WizardWarning {
	w := WizardWarning{Code: "message_content_intent_off", Project: bot, Blocking: true,
		URL: "https://discord.com/developers/applications/" + appID + "/bot"}
	if isZH(lang) {
		w.Message = "机器人「" + bot + "」没开 Message Content Intent，读不到消息正文，在群里不会回话。"
		w.Fix = "打开链接（Discord 开发者后台 → Bot），打开 Message Content Intent 并保存；不用重新跑向导，重启 cc-connect 即可。"
	} else {
		w.Message = "Bot \"" + bot + "\" has Message Content Intent off: it cannot read messages and will not answer."
		w.Fix = "Open the link (Developer Portal → Bot), turn on Message Content Intent and save; no need to rerun setup, just restart cc-connect."
	}
	return w
}

func warnNotInGuild(lang, bot, invite string) WizardWarning {
	w := WizardWarning{Code: "bot_not_in_guild", Project: bot, Blocking: true, URL: invite}
	if isZH(lang) {
		w.Message = "机器人「" + bot + "」还没进你选的服务器。"
		w.Fix = "打开邀请链接，选这个服务器，点「授权」。配置已经存好，拉进去以后不用重新跑向导。"
	} else {
		w.Message = "Bot \"" + bot + "\" is not in the selected server yet."
		w.Fix = "Open the invite link, pick the server and authorize. The config is saved; no need to rerun setup afterwards."
	}
	return w
}

// AllowFromUnset is written to allow_from when no one is known to allow (owner lookup failed
// and nothing was given). It matches no Discord user ID (those are digits), so the bot answers
// nobody until the user puts their ID there — failing closed instead of open to everyone.
const AllowFromUnset = "set-your-discord-user-id"

const discordUserIDHowZH = "拿法：Discord 设置 → 高级 → 打开「开发者模式」，然后右键自己的头像 → 复制用户 ID。"
const discordUserIDHowEN = "How: Discord Settings → Advanced → turn on Developer Mode, then right-click your avatar → Copy User ID."

func warnAllowFromUnknown(lang string, bots []string) WizardWarning {
	w := WizardWarning{Code: "allow_from_unknown", Blocking: true, Project: strings.Join(bots, ",")}
	if isZH(lang) {
		w.Message = "没查到机器人的所有者，不知道该听谁的。为了安全，机器人现在谁的话都不听（allow_from = " + AllowFromUnset + "）。"
		w.Fix = "把你自己的 Discord 用户 ID 填进向导最后一页的「谁能指挥这些机器人」（AI：请求里加 \"allow_from\": \"<你的用户 ID>\"）再保存一次。" + discordUserIDHowZH
	} else {
		w.Message = "Could not find the bot's owner, so it is unknown whom to obey. To stay safe the bot obeys no one for now (allow_from = " + AllowFromUnset + ")."
		w.Fix = "Put your Discord user ID in \"Who can command these bots\" on the wizard's last page (AI: add \"allow_from\": \"<your user ID>\" to the request) and save again. " + discordUserIDHowEN
	}
	return w
}

func warnAllowFromEveryone(lang string) WizardWarning {
	w := WizardWarning{Code: "allow_from_everyone"}
	if isZH(lang) {
		w.Message = "allow_from 是 *：服务器里任何人都能让机器人在这台电脑上跑命令。"
		w.Fix = "只想自己用就改成你的 Discord 用户 ID（逗号分隔可以放几个人）。" + discordUserIDHowZH
	} else {
		w.Message = "allow_from is *: anyone in the server can make the bots run commands on this computer."
		w.Fix = "To keep it to yourself, use your Discord user ID instead (comma-separate several people). " + discordUserIDHowEN
	}
	return w
}

func warnIntentUnknown(lang, bot, appID string) WizardWarning {
	w := WizardWarning{Code: "message_content_intent_unknown", Project: bot, Blocking: true,
		URL: "https://discord.com/developers/applications/" + appID + "/bot"}
	if isZH(lang) {
		w.Message = "没查到机器人「" + bot + "」的 Message Content Intent 开没开（Discord 的应用接口没回）。没开的话机器人读不到消息正文。"
		w.Fix = "打开链接（Discord 开发者后台 → Bot），确认 Message Content Intent 已打开并保存；然后重启 cc-connect，或者再跑一次向导确认。"
	} else {
		w.Message = "Could not check whether bot \"" + bot + "\" has Message Content Intent on (Discord's application lookup failed). Without it the bot cannot read messages."
		w.Fix = "Open the link (Developer Portal → Bot), make sure Message Content Intent is on and saved; then restart cc-connect, or run setup again to check."
	}
	return w
}

// finishWizardResult adds the gate line and decides ok / needs_user_action.
func finishWizardResult(res *WizardResult, req WizardRequest, pl *wizardPlan) {
	if len(pl.allowFromUnset) > 0 {
		res.Warnings = append(res.Warnings, warnAllowFromUnknown(req.Language, pl.allowFromUnset))
	}
	if req.Platform == "discord" && len(pl.team) > 1 {
		running := GateRunning()
		res.GateRunning = &running
		res.GateHint = GateHint(req.Language, running, pl.fallbackName)
		if !running {
			w := WizardWarning{Code: "gate_not_running", Message: res.GateHint}
			if isZH(req.Language) {
				w.Fix = "可以不装。想让 AI 自己判断谁回，再装 gate：见 docs/ccm-and-wiki.md「起 gate」。"
			} else {
				w.Fix = "Optional. To let AI decide who answers, install the gate: see docs/ccm-and-wiki.md \"start the gate\"."
			}
			res.Warnings = append(res.Warnings, w)
		}
	}
	for _, w := range res.Warnings {
		if w.Blocking {
			res.NeedsUserAction = true
		}
	}
	res.OK = !res.NeedsUserAction
}

// 来源：「约 3GB」= docs/ccm-and-wiki.md 第 3 步 gate 本地模型下载大小；「几十分钟」= 2026-10-21 新人实测
// （notes/usability-newbie-20261021.md 第 5 条：只装 Python 依赖就等了约 12 分钟，之后才下模型）。
// GateHint says how a team of bots decides who answers, with or without the gate.
// Without it, cc-connect falls back per bot (core/gate.go gate_fallback): the fallback
// role answers ("reply"), the others only listen ("context"); an @-mentioned bot always answers.
func GateHint(lang string, running bool, fallbackName string) string {
	if isZH(lang) {
		if running {
			return "gate 在运行：每条消息由它判断该哪个角色回。"
		}
		return "没装 gate（可以不装）：被 @ 的角色照常回，其余消息都由兜底角色「" + fallbackName + "」回。装 gate 要几十分钟、下载约 3GB。"
	}
	if running {
		return "The gate is running: it decides which role answers each message."
	}
	return "No gate (optional): an @-mentioned role answers; every other message goes to the fallback role \"" + fallbackName + "\". Installing the gate takes tens of minutes and about 3GB of downloads."
}
