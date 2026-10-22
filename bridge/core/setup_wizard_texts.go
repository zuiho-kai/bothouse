package core

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Wizard result copy in zh / ja / en: the detail of each line in "steps" (the web wizard's last
// page and `cc-connect setup apply` print them) and the token / rate-limit errors. The step keys
// themselves ("role 1 persona", "config" …) stay English: scripts match on them; the web page
// translates them (web/src/pages/Setup/texts.ts stepLabel). Warnings: setup_wizard_warnings.go.
// Source for ja: user 2026-10-21「改动量比较大的话，可以就中文，英文，日文。」

// discordTokenInvalidText: Discord answered 401 for a token (the web token check shows only this).
func discordTokenInvalidText(lang string) string {
	return tr3(lang,
		"token 无效（Discord 回 401）：填错了、没复制全，或者已经被重置过。去 "+DiscordPortalURL+" → 你的应用 → Bot → Reset Token，复制新 token 再填。",
		"トークンが無効です（Discord が 401 を返しました）。入力ミス、コピー漏れ、またはリセット済みです。"+DiscordPortalURL+" → アプリ → Bot → Reset Token で新しいトークンをコピーして入れ直してください。",
		"Invalid token (Discord answered 401): mistyped, cut off, or reset since. Open "+DiscordPortalURL+" → your application → Bot → Reset Token and use the new token.")
}

// discordRateLimitedText: Discord kept answering 429.
func discordRateLimitedText(lang string, wait time.Duration) string {
	s := fmt.Sprintf("%.0f", math.Ceil(wait.Seconds()))
	return tr3(lang,
		"Discord 限流（429），重试几次还是不让查。等 "+s+" 秒左右再试一次；什么都没写。",
		"Discord のレート制限（429）で、何度か再試行しても確認できませんでした。"+s+" 秒ほど待ってからもう一度実行してください。何も書き込んでいません。",
		"Discord rate limit (429): still refused after a few retries. Wait about "+s+"s and try again; nothing was written.")
}

func stepBotDetail(lang, bot string, intentKnown, intentOn bool) string {
	switch {
	case !intentKnown:
		return tr3(lang, "机器人 "+bot+"；没查到 Message Content Intent 开没开",
			"ボット "+bot+"。Message Content Intent がオンか確認できませんでした",
			"bot "+bot+"; Message Content Intent could not be checked")
	case !intentOn:
		return tr3(lang, "机器人 "+bot+"；Message Content Intent 没开（开发者后台 → Bot）",
			"ボット "+bot+"。Message Content Intent がオフです（Developer Portal → Bot）",
			"bot "+bot+"; Message Content Intent not enabled (Developer Portal → Bot)")
	}
	return tr3(lang, "机器人 "+bot, "ボット "+bot, "bot "+bot)
}

func stepConfigFresh(lang string, n int) string {
	return tr3(lang,
		fmt.Sprintf("写入 %d 个角色，新建的配置（第一次运行，之前没有配置）", n),
		fmt.Sprintf("%d 個のロールを新しい設定に書き込みました（初回実行、以前の設定なし）", n),
		fmt.Sprintf("%d projects written to a new config (first run, no earlier config)", n))
}

func stepConfigBackup(lang string, n int, backup string) string {
	return tr3(lang,
		fmt.Sprintf("写入 %d 个角色；原配置留在 %s（重写会丢掉注释）", n, backup),
		fmt.Sprintf("%d 個のロールを書き込みました。元の設定は %s に残しています（書き直すとコメントは消えます）", n, backup),
		fmt.Sprintf("%d projects written; previous config kept as %s (the rewrite does not keep comments)", n, backup))
}

func stepPersonaWritten(lang, project, path string) string {
	return tr3(lang, project+" 的人设 → "+path, project+" のペルソナ → "+path, project+" → "+path)
}

func stepPersonaKept(lang, project string) string {
	return tr3(lang, project+"：已有的人设原样不动", project+"：既存のペルソナはそのまま", project+": existing persona left untouched")
}

func stepPersonaLangOnly(lang, project, code, path string) string {
	return tr3(lang,
		project+"：只把 "+path+" 里的回答语言改成 "+code+"（人设其余部分不动）",
		project+"："+path+" の返答言語だけを "+code+" に変更（ペルソナのほかの部分はそのまま）",
		project+": reply language set to "+code+" in "+path+" (rest of the persona untouched)")
}

func stepDryPersonaWrite(lang, path, code string) string {
	return tr3(lang,
		"预演：会写 "+path+"（回答语言 "+code+"）",
		"予行："+path+" を書き込みます（返答言語 "+code+"）",
		"dry run: would write "+path+" (reply language "+code+")")
}

func stepDryPersonaLang(lang, path, code string) string {
	return tr3(lang,
		"预演：会把 "+path+" 里的回答语言改成 "+code,
		"予行："+path+" の返答言語を "+code+" に変更します",
		"dry run: would set the reply-language line of "+path+" to "+code)
}

func stepDryPersonaKept(lang, project string) string {
	return tr3(lang,
		"预演："+project+" 已有的人设不动",
		"予行："+project+" の既存のペルソナはそのまま",
		"dry run: "+project+": existing persona would be left untouched")
}

func stepTeam(lang string, n int, fallbackName string) string {
	return tr3(lang,
		fmt.Sprintf("%d 个机器人，兜底角色 %s", n, fallbackName),
		fmt.Sprintf("ボット %d 体、フォールバック %s", n, fallbackName),
		fmt.Sprintf("%d bots, fallback %s", n, fallbackName))
}

func stepFallbackNote(lang, asked, used string) string {
	return tr3(lang,
		fmt.Sprintf("%q 不是这次的机器人之一，改用 %q", asked, used),
		fmt.Sprintf("%q は今回のボットではないため %q にしました", asked, used),
		fmt.Sprintf("%q is not one of the bots; using %q", asked, used))
}

func stepJevRemoved(lang, path string) string {
	return tr3(lang, "已删除 "+path, path+" を削除しました", "removed "+path)
}

func stepJevKept(lang string) string {
	return tr3(lang, "沿用原来的", "今のものを継続", "kept")
}

func stepJevSaved(lang, path string) string {
	return tr3(lang, "已保存 "+path, path+" に保存しました", "saved "+path)
}

func stepJevNotSaved(lang, reason string) string {
	return tr3(lang, "没保存："+reason, "保存していません："+reason, "not saved: "+reason)
}

func stepHooksOn(lang string, names []string, settings string) string {
	return tr3(lang, "工具 hook 已开（"+strings.Join(names, "、")+"）："+settings+"；关掉用 cc-connect setup hooks off --work-dir <目录>",
		"ツール hook を有効化（"+strings.Join(names, "、")+"）："+settings+"。無効化は cc-connect setup hooks off --work-dir <dir>",
		"tool hooks on ("+strings.Join(names, ", ")+"): "+settings+"; turn off with cc-connect setup hooks off --work-dir <dir>")
}

func stepToolsOn(lang string, names []string, persona string) string {
	return tr3(lang, "小工具已写进人设（"+strings.Join(names, "、")+"）："+persona+"；去掉用 cc-connect setup tools off --work-dir <目录>",
		"小ツールをペルソナに追加（"+strings.Join(names, "、")+"）："+persona+"。外すには cc-connect setup tools off --work-dir <dir>",
		"small tools added to the persona ("+strings.Join(names, ", ")+"): "+persona+"; remove with cc-connect setup tools off --work-dir <dir>")
}
