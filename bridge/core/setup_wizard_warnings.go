package core

import (
	"fmt"
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
	if isJA(lang) {
		w.Message = "ボット「" + bot + "」の Message Content Intent がオフです。メッセージ本文を読めないので、グループで返答しません。"
		w.Fix = "リンク（Developer Portal → Bot）を開き、Message Content Intent をオンにして保存してください。セットアップのやり直しは不要で、bothouse を再起動するだけです。"
	} else if isZH(lang) {
		w.Message = "机器人「" + bot + "」没开 Message Content Intent，读不到消息正文，在群里不会回话。"
		w.Fix = "打开链接（Discord 开发者后台 → Bot），打开 Message Content Intent 并保存；不用重新跑向导，重启 bothouse 即可。"
	} else {
		w.Message = "Bot \"" + bot + "\" has Message Content Intent off: it cannot read messages and will not answer."
		w.Fix = "Open the link (Developer Portal → Bot), turn on Message Content Intent and save; no need to rerun setup, just restart bothouse."
	}
	return w
}

// nameNote: why a bot whose name has no a-z / 0-9 gets project "role-N".
func nameNote(lang, botName, project string) string {
	return tr3(lang,
		"机器人「"+botName+"」的名字里没有英文字母或数字，内部项目名用 "+project+"（项目名要用在文件夹和地址里，只能是英文字母、数字、-、_）。机器人在群里显示的名字不变。",
		"ボット「"+botName+"」の名前には英字や数字がないため、内部のプロジェクト名は "+project+" にしました（フォルダやアドレスに使うため英字・数字・-・_ のみ）。グループでの表示名は変わりません。",
		"Bot \""+botName+"\" has no letters a-z or digits in its name, so its internal project name is "+project+" (project names go into folders and addresses: a-z, 0-9, - and _ only). Its display name in the group does not change.")
}

func warnNotInGuild(lang, bot, invite string, dryRun bool) WizardWarning {
	w := WizardWarning{Code: "bot_not_in_guild", Project: bot, Blocking: true, URL: invite}
	switch {
	case isJA(lang):
		w.Message = "ボット「" + bot + "」はまだ選んだサーバーに入っていません。"
		w.Fix = "招待リンクを開き、このサーバーを選んで「認証」を押してください。設定は保存済みなので、追加した後にセットアップをやり直す必要はありません。"
		if dryRun {
			w.Fix = "招待リンクを開き、このサーバーを選んで「認証」を押してください。今回は予行（dry run）なので何も書き込んでいません。追加した後に --dry-run を外してもう一度実行してください。"
		}
	case isZH(lang) && dryRun:
		w.Message = "机器人「" + bot + "」还没进你选的服务器。"
		w.Fix = "打开邀请链接，选这个服务器，点「授权」。这次是预演（dry run），什么都没写；拉进去之后去掉 --dry-run 正式跑一次。"
	case isZH(lang):
		w.Message = "机器人「" + bot + "」还没进你选的服务器。"
		w.Fix = "打开邀请链接，选这个服务器，点「授权」。配置已经存好，拉进去以后不用重新跑向导。"
	case dryRun:
		w.Message = "Bot \"" + bot + "\" is not in the selected server yet."
		w.Fix = "Open the invite link, pick the server and authorize. This was a dry run: nothing was written; run again without --dry-run to save."
	default:
		w.Message = "Bot \"" + bot + "\" is not in the selected server yet."
		w.Fix = "Open the invite link, pick the server and authorize. The config is saved; no need to rerun setup afterwards."
	}
	return w
}

// warnTokenInvalid: Discord answered 401 for role n's token.
func warnTokenInvalid(lang string, n int) WizardWarning {
	w := WizardWarning{Code: "discord_token_invalid", Blocking: true, URL: DiscordPortalURL}
	if isJA(lang) {
		w.Message = fmt.Sprintf("%d 番目のボットのトークンが無効です（Discord が 401 を返しました）。入力ミス、コピー漏れ、またはリセット済みです。何も書き込んでいません。", n)
		w.Fix = "リンク（Discord Developer Portal）を開く → アプリを選ぶ → 左の Bot → Reset Token で新しいトークンをコピーし（表示は 1 回だけ）、リクエストのトークンを置き換えてもう一度実行してください。"
	} else if isZH(lang) {
		w.Message = fmt.Sprintf("第 %d 个机器人的 token 无效（Discord 回 401）：填错了、没复制全，或者已经被重置过。什么都没写。", n)
		w.Fix = "打开链接（Discord 开发者后台）→ 点你的应用 → 左边 Bot → Reset Token，复制新 token（只显示一次）换掉请求里的 token，再跑一次。"
	} else {
		w.Message = fmt.Sprintf("The token of bot %d is invalid (Discord answered 401): mistyped, cut off, or reset since. Nothing was written.", n)
		w.Fix = "Open the link (Discord Developer Portal) → your application → Bot → Reset Token, copy the new token (shown once) into the request and run again."
	}
	return w
}

// cliLoginHow says how to log in to an agent CLI on this machine (works over SSH too: the
// CLIs print a link to open on any device).
func cliLoginHow(lang, agentType string) string {
	zh := isZH(lang)
	if isJA(lang) {
		switch agentType {
		case "claudecode":
			return "このマシンのターミナルで claude auth login を実行し（または claude を起動して /login と入力）、表示に従ってログインしてください。ブラウザがない場合はリンクが表示されるので、任意の端末で開いてログインし、コードをターミナルに貼り付けます。"
		case "codex":
			return "このマシンのターミナルで codex login を実行し、表示に従ってログインしてください。API キーを使う場合は printenv OPENAI_API_KEY | codex login --with-api-key。"
		case "gemini":
			return "このマシンのターミナルで gemini を実行し、Login with Google を選んでログインしてください。"
		case "opencode":
			return "このマシンのターミナルで opencode auth login を実行し、表示に従ってログインしてください。"
		}
		return "この CLI の説明に従って、このマシンでログインしてください。"
	}
	switch agentType {
	case "claudecode":
		if zh {
			return "在这台机器的终端运行 claude auth login（或运行 claude 后输入 /login），按提示登录；没有浏览器时它会给一个链接，在任意设备打开登录，再把码贴回终端。"
		}
		return "On this machine run claude auth login (or run claude and type /login) and follow the prompts; without a browser it prints a link to open on any device, then paste the code back."
	case "codex":
		if zh {
			return "在这台机器的终端运行 codex login，按提示登录；用 API key 的话运行 printenv OPENAI_API_KEY | codex login --with-api-key。"
		}
		return "On this machine run codex login and follow the prompts; with an API key: printenv OPENAI_API_KEY | codex login --with-api-key."
	case "gemini":
		if zh {
			return "在这台机器的终端运行 gemini，选 Login with Google 按提示登录。"
		}
		return "On this machine run gemini and choose Login with Google."
	case "opencode":
		if zh {
			return "在这台机器的终端运行 opencode auth login，按提示登录。"
		}
		return "On this machine run opencode auth login and follow the prompts."
	}
	if zh {
		return "按这个 CLI 自己的说明在这台机器上登录。"
	}
	return "Log in to this CLI on this machine as its own docs describe."
}

// warnAgentLogins: roles that use a CLI's own login (no provider) whose CLI is not logged in
// (blocking: the bot would answer nothing) or whose login can't be checked (a note). One
// warning per CLI.
func warnAgentLogins(lang string, roles []plannedRole, clis []LocalCLI) []WizardWarning {
	var out []WizardWarning
	byType := map[string][]string{}
	var order []string
	for _, r := range roles {
		if r.Provider != nil {
			continue // a third-party API: the CLI's own login is not used
		}
		if r.reused && r.agentAsked == "" {
			continue // an existing bot keeps its CLI, which may use a provider from config.toml
		}
		if _, ok := byType[r.AgentType]; !ok {
			order = append(order, r.AgentType)
		}
		byType[r.AgentType] = append(byType[r.AgentType], r.Name)
	}
	zh := isZH(lang)
	for _, at := range order {
		var cli *LocalCLI
		for i := range clis {
			if clis[i].AgentType == at {
				cli = &clis[i]
				break
			}
		}
		if cli == nil || (cli.Login != "not_logged_in" && cli.Login != "unknown") {
			continue
		}
		label := cli.Label
		if label == "" {
			label = at
		}
		bots := strings.Join(byType[at], "、")
		w := WizardWarning{Project: strings.Join(byType[at], ",")}
		ja := isJA(lang)
		after := "Then run bothouse setup clis and check that its login is logged_in, and restart bothouse; no need to rerun setup. Or let this role use a third-party API instead: in the web wizard, tick \"Use a third-party API instead\" on the Local CLI step and save again; from the command line, add \"provider\" to the role (see bothouse setup matrix)."
		if zh {
			after = "登录后跑 bothouse setup clis，确认它的 login 是 logged_in，再重启 bothouse；不用重跑配置。也可以给这个角色改用第三方 API：网页向导在「本机 CLI」一步勾「改用第三方 API」，填好再保存一次；命令行在这个 role 里加 \"provider\"（见 bothouse setup matrix）。"
		}
		if ja {
			after = "ログイン後に bothouse setup clis を実行し、login が logged_in になっていることを確認してから bothouse を再起動してください。設定のやり直しは不要です。代わりにこのロールにサードパーティ API を使うこともできます：ウェブのウィザードでは「ローカル CLI」のステップで「代わりにサードパーティ API を使う」にチェックして入力し、もう一度保存。コマンドラインではそのロールに \"provider\" を追加（bothouse setup matrix を参照）。"
		}
		if cli.Login == "not_logged_in" {
			w.Code, w.Blocking = "agent_not_logged_in", true
			if ja {
				w.Message = "「" + bots + "」はこのマシンの " + label + " を使いますが、まだログインしていません。ログインするまでボットはメッセージに答えられません。"
			} else if zh {
				w.Message = "「" + bots + "」用本机的 " + label + "，但它还没登录：登录之前机器人收到消息也答不出来。"
			} else {
				w.Message = "\"" + bots + "\" use(s) this machine's " + label + ", which is not logged in: until it is, the bot cannot answer."
			}
		} else {
			w.Code = "agent_login_unknown"
			if ja {
				w.Message = "「" + bots + "」はこのマシンの " + label + " を使いますが、ログイン状態を確認できません。ログインしていなければボットは答えられません。"
			} else if zh {
				w.Message = "「" + bots + "」用本机的 " + label + "，向导查不了它登没登录。没登录的话机器人答不出来。"
			} else {
				w.Message = "\"" + bots + "\" use(s) this machine's " + label + "; setup cannot tell whether it is logged in. If not, the bot cannot answer."
			}
		}
		w.Fix = cliLoginHow(lang, at) + " " + after
		if zh || ja {
			w.Fix = cliLoginHow(lang, at) + after
		}
		out = append(out, w)
	}
	return out
}

// replyLanguageCodes: common codes to suggest; any language code works ("Always reply in <name>.").
const replyLanguageCodes = "zh, zh-TW, en, ja, ko, es, ru …"

// warnReplyLanguageDefault tells which reply language was picked for roles nobody chose one for,
// where it came from and how to change it (a note, not blocking).
func warnReplyLanguageDefault(lang string, roles []plannedRole) []WizardWarning {
	var bots []string
	var code string
	for _, r := range roles {
		if r.replyFrom != "system" {
			continue
		}
		if r.reused && !r.writesPersona() {
			continue // an existing bot's persona is not touched
		}
		bots = append(bots, r.Name)
		code = r.ReplyLanguage
	}
	if len(bots) == 0 {
		return nil
	}
	w := WizardWarning{Code: "reply_language_default", Project: strings.Join(bots, ",")}
	name := LanguageName(code)
	if isJA(lang) {
		w.Message = "返答言語が指定されていないため、ボット「" + strings.Join(bots, "」「") + "」は " + name + "（" + code + "）で返答します。このコンピューターのシステム言語から決めました。"
		w.Fix = "違う場合はユーザーにどの言語にするか聞き、リクエストに \"language\": \"<コード>\"（" + replyLanguageCodes + "）を追加してもう一度実行してください。設定済みのボットはそのロールに \"reply_language\": \"<コード>\" を追加して実行すると、ペルソナの返答言語の行だけが変わります。persona_file の <!-- conest:reply-language --> の下の行を直接編集しても構いません。"
	} else if isZH(lang) {
		src := "这台电脑的系统语言"
		w.Message = "没指定回复语言，机器人「" + strings.Join(bots, "、") + "」会用 " + name + "（" + code + "）回复，按" + src + "定的。"
		w.Fix = "不对就问用户要哪种语言，在请求里加 \"language\": \"<代码>\"（" + replyLanguageCodes + "）再跑一次；已经配好的机器人在它的 role 里加 \"reply_language\": \"<代码>\" 再跑，只改人设里回复语言那一行。也可以直接改 persona_file 里 <!-- conest:reply-language --> 下面那一行。"
	} else {
		src := "this computer's system locale"
		w.Message = "No reply language was given: bot(s) \"" + strings.Join(bots, "\", \"") + "\" will reply in " + name + " (" + code + "), from " + src + "."
		w.Fix = "If that is wrong, ask the user which language and add \"language\": \"<code>\" (" + replyLanguageCodes + ") to the request and run again; for a bot already set up, add \"reply_language\": \"<code>\" to its role and run again — only the reply-language line of its persona changes. Or edit the line under <!-- conest:reply-language --> in its persona_file."
	}
	return []WizardWarning{w}
}

// AllowFromUnset is written to allow_from when no one is known to allow (owner lookup failed
// and nothing was given). It matches no Discord user ID (those are digits), so the bot answers
// nobody until the user puts their ID there — failing closed instead of open to everyone.
const AllowFromUnset = "set-your-discord-user-id"

const discordUserIDHowZH = "拿法：Discord 设置 → 高级 → 打开「开发者模式」，然后右键自己的头像 → 复制用户 ID。"
const discordUserIDHowEN = "How: Discord Settings → Advanced → turn on Developer Mode, then right-click your avatar → Copy User ID."

func warnAllowFromUnknown(lang string, bots []string) WizardWarning {
	w := WizardWarning{Code: "allow_from_unknown", Blocking: true, Project: strings.Join(bots, ",")}
	if isJA(lang) {
		w.Message = "ボットの所有者が見つからず、誰の指示を聞けばよいか分かりません。安全のため、今は誰の指示も聞きません（allow_from = " + AllowFromUnset + "）。"
		w.Fix = "ウィザード最後のページの「ボットに指示できる人」に自分の Discord ユーザー ID を入れてもう一度保存してください（AI：リクエストに \"allow_from\": \"<ユーザー ID>\" を追加）。取得方法：Discord 設定 → 詳細設定 → 開発者モードをオン、自分のアイコンを右クリック → ユーザー ID をコピー。"
	} else if isZH(lang) {
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
	if isJA(lang) {
		w.Message = "allow_from が * です：サーバーの誰でもボットにこのコンピューターでコマンドを実行させられます。"
		w.Fix = "自分だけで使うなら自分の Discord ユーザー ID にしてください（カンマ区切りで複数人も可）。取得方法：Discord 設定 → 詳細設定 → 開発者モードをオン、自分のアイコンを右クリック → ユーザー ID をコピー。"
	} else if isZH(lang) {
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
	if isJA(lang) {
		w.Message = "ボット「" + bot + "」の Message Content Intent がオンか確認できませんでした（Discord のアプリ情報を取得できません）。オフだとメッセージ本文を読めません。"
		w.Fix = "リンク（Developer Portal → Bot）を開き、Message Content Intent がオンで保存済みか確認してから、bothouse を再起動するか、もう一度セットアップを実行して確認してください。"
	} else if isZH(lang) {
		w.Message = "没查到机器人「" + bot + "」的 Message Content Intent 开没开（Discord 的应用接口没回）。没开的话机器人读不到消息正文。"
		w.Fix = "打开链接（Discord 开发者后台 → Bot），确认 Message Content Intent 已打开并保存；然后重启 bothouse，或者再跑一次向导确认。"
	} else {
		w.Message = "Could not check whether bot \"" + bot + "\" has Message Content Intent on (Discord's application lookup failed). Without it the bot cannot read messages."
		w.Fix = "Open the link (Developer Portal → Bot), make sure Message Content Intent is on and saved; then restart bothouse, or run setup again to check."
	}
	return w
}

// finishWizardResult adds the gate line and decides ok / needs_user_action.
// jevUsable = a jev that returns probabilities is in effect after this run.
func finishWizardResult(res *WizardResult, req WizardRequest, pl *wizardPlan, jevUsable bool) {
	if len(pl.allowFromUnset) > 0 {
		res.Warnings = append(res.Warnings, warnAllowFromUnknown(req.Language, pl.allowFromUnset))
	}
	if (req.Platform == "discord" || isCloudWebPlatform(req.Platform) || isFeishuPlatform(req.Platform)) && len(pl.team) > 1 {
		running := GateRunning()
		res.GateRunning = &running
		res.GateStatus = GateStatusOff
		if req.gateOn() {
			res.GateStatus = gateStatusAfterWizard(res.dataDir)
		}
		res.GateHint = GateHint(req.Language, res.GateStatus, pl.fallbackName)
		switch res.GateStatus {
		case GateStatusPythonMissing, GateStatusPythonTooOld:
			res.Warnings = append(res.Warnings, warnGatePython(req.Language, res.GateStatus))
		}
		if req.gateOn() && !jevUsable {
			res.Warnings = append(res.Warnings, warnJevRecommended(req.Language, pl.fallbackName))
		}
	}
	for _, w := range res.Warnings {
		if w.Blocking {
			res.NeedsUserAction = true
		}
	}
	res.OK = !res.NeedsUserAction
}

// warnJevRecommended: a team of bots with no usable jev. Without it every message that names
// no one goes to the fallback role, so it looks like that role answers everything. A note, not
// blocking. The two ways to get a jev are the ones gate.py prints when started without one
// (contrib/gate/gate.py; docs/ccm-and-wiki.md「起 gate」).
func warnJevRecommended(lang, fallbackName string) WizardWarning {
	w := WizardWarning{Code: "jev_recommended"}
	if isJA(lang) {
		w.Message = "ロールが複数ありますが jev が未設定です：@ されていないメッセージはすべてフォールバックロール「" + fallbackName + "」が答えるので、毎回そのロールが返事しているように見えます。jev を設定するのがおすすめです。無料の小型モデルで十分で、設定すると gate がメッセージごとに答えるべきか・誰が答えるかを賢く判断します。"
		w.Fix = "ウィザードの jev ステップで Base URL・Key・モデル名を入力してください（AI：リクエストに \"jev\": {\"base_url\", \"api_key\", \"model\"} を追加）：SiliconFlow の無料 Qwen 小型モデル、またはローカルで Qwen3 0.6B を起動（mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit）。その後 gate を入れてください：docs/ccm-and-wiki.md の「起 gate」の節を参照。"
	} else if isZH(lang) {
		w.Message = "配了多个角色，但没填 jev：没被 @ 的消息都由兜底角色「" + fallbackName + "」回，看起来就是它每句都回。推荐填一个 jev，免费小模型就够；填了以后 gate 会更智能地判断每句话该不该回、该谁回。"
		w.Fix = "在向导的 jev 一步填 Base URL、Key、模型名（AI：请求里加 \"jev\": {\"base_url\", \"api_key\", \"model\"}）：用硅基流动的免费 Qwen 小模型，或本地起一个 Qwen3 0.6B（mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit）。再装 gate：见 docs/ccm-and-wiki.md「起 gate」。"
	} else {
		w.Message = "Several roles but no jev: every message that @-mentions no one goes to the fallback role \"" + fallbackName + "\", so it looks like that role answers everything. A jev is recommended, and a free small model is enough: with it the gate decides more smartly whether and which role should answer each message."
		w.Fix = "Fill in Base URL, Key and model on the wizard's jev step (AI: add \"jev\": {\"base_url\", \"api_key\", \"model\"} to the request): a free small Qwen model on SiliconFlow, or run Qwen3 0.6B locally (mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit). Then install the gate: see docs/ccm-and-wiki.md \"start the gate\"."
	}
	return w
}

// warnGatePython: the gate is on but this machine has no Python it can run on, so it is not started.
// Not blocking: the lead still answers every message that names no one (core/gate.go fallbackFor).
func warnGatePython(lang, status string) WizardWarning {
	w := WizardWarning{Code: "gate_python_missing", URL: "https://www.python.org/downloads/"}
	old := status == GateStatusPythonTooOld
	if isJA(lang) {
		w.Message = "Python 3.12 以上が見つからないため、gate（誰が答えるかの賢い判断）はまだ起動していません。振り分けは有効で、メインのボットがまとめて返事します。"
		if old {
			w.Message = "Python が古い（3.12 未満）ため、gate（誰が答えるかの賢い判断）はまだ起動していません。振り分けは有効で、メインのボットがまとめて返事します。"
		}
		w.Fix = "Python 3.12 以上を入れてください（リンク）。入れると bothouse が自動で gate を起動します。"
	} else if isZH(lang) {
		w.Message = "没找到 Python 3.12 以上，gate（智能判断谁回）还没启动。分流已生效，主 bot 统一回话。"
		if old {
			w.Message = "Python 版本太旧（低于 3.12），gate（智能判断谁回）还没启动。分流已生效，主 bot 统一回话。"
		}
		w.Fix = "装 Python 3.12 以上（见链接）；装好后 bothouse 会自动启动 gate。"
	} else {
		w.Message = "No Python 3.12 or newer found, so the gate (smart choice of who answers) is not started yet. Routing is on: the lead bot answers for the team."
		if old {
			w.Message = "Python is older than 3.12, so the gate (smart choice of who answers) is not started yet. Routing is on: the lead bot answers for the team."
		}
		w.Fix = "Install Python 3.12 or newer (link); bothouse then starts the gate by itself."
	}
	return w
}

// GateHint says how a team of bots decides who answers. With the gate on, routing works even before
// the gate runs: core/gate.go fallbackFor lets an @-mentioned bot answer and gives every other message
// to the lead ("reply"), the others only listen ("context").
func GateHint(lang, status, fallbackName string) string {
	switch {
	case isJA(lang):
		switch status {
		case GateStatusOff:
			return "振り分けはオフです：gate を使わず、各ボットが自分の設定どおりに返事します。"
		case GateStatusRunning:
			return "振り分けは有効です：gate が動いていて、メッセージごとにどのロールが答えるかを判断します。"
		case GateStatusStarting:
			return "振り分けは有効です：メインのボット「" + fallbackName + "」がまとめて返事します。gate は bothouse が自動で起動し（サービス稼働中ならすぐ、そうでなければ次の起動時）、以後は誰が答えるかを賢く判断します。"
		}
		return "振り分けは有効です：メインのボット「" + fallbackName + "」がまとめて返事し、@ されたロールは普段どおり答えます。python / jev を入れると自動で賢い判断が有効になります。"
	case isZH(lang):
		switch status {
		case GateStatusOff:
			return "没开分流：不用 gate，各机器人按自己的设置回话。"
		case GateStatusRunning:
			return "分流已生效：gate 在运行，每条消息由它判断该哪个角色回。"
		case GateStatusStarting:
			return "分流已生效：主 bot「" + fallbackName + "」统一回话；gate 由 bothouse 自动拉起（服务在跑就马上起，没在跑就下次启动时起），之后会智能判断该谁回。"
		}
		return "分流已生效：主 bot「" + fallbackName + "」统一回话，被 @ 的角色照常回；装好 python/jev 后会自动启用智能判断。"
	}
	switch status {
	case GateStatusOff:
		return "Routing is off: no gate, each bot answers by its own settings."
	case GateStatusRunning:
		return "Routing is on: the gate is running and decides which role answers each message."
	case GateStatusStarting:
		return "Routing is on: the lead bot \"" + fallbackName + "\" answers for the team; bothouse starts the gate (right away if the service is running, otherwise when it next starts), which then decides smartly who answers."
	}
	return "Routing is on: the lead bot \"" + fallbackName + "\" answers for the team and an @-mentioned role answers as usual; smart routing turns on by itself once python and a jev are there."
}
