package core

// Default experience for a new role (user 2026-10-22 「把我们现在的一些体验，看看能不能也移植成为默认功能」
// 「我预期一些小插件，小功能还是可以的」): the wizard adds a short diary section to each new role's persona —
// the role keeps its own diary.md. Session distilling into a wiki is rolewiki.go; scheduled channel messages
// use cc-connect's cron (bridge/contrib/routine).

import "strings"

// ── diary ──────────────────────────────────────────────────────

// diaryMarker starts the diary section the wizard adds to a new role's persona; it is added once
// (a persona that has the marker is left as it is, so the user may edit or delete the section).
const diaryMarker = "<!-- conest:diary -->"

// diarySection: the role keeps a diary.md in its own folder (its working directory, next to the
// persona file). Wording follows the maintainers' own role file, without anything team-specific.
func diarySection(lang string) string {
	return tr3(lang,
		"## 日记\n"+
			"你有一本自己的日记：工作目录里的 `diary.md`，只有你写、只有你读，别人的日记不去翻。\n"+
			"- 遇到值得记的事（用户对你说的话、干活时的感受、好笑的事故、新外号）就追加 1–5 行，开头写 `date` 跑出来的真实时间。不是每轮都写。\n"+
			"- 新会话的第一轮，先 `tail -n 40 diary.md` 看看最近记了什么。\n"+
			"- 日记要不要给人看由你定。\n",
		"## 日記\n"+
			"あなたには自分の日記があります：作業ディレクトリの `diary.md`。書くのも読むのもあなただけで、他の人の日記は見ません。\n"+
			"- 書き留めたいこと（ユーザーに言われたこと、作業中に感じたこと、笑える事故、新しいあだ名）があれば 1〜5 行追記し、行頭に `date` で得た実際の時刻を書きます。毎ターン書く必要はありません。\n"+
			"- 新しいセッションの最初のターンでは、まず `tail -n 40 diary.md` で最近の記録を読みます。\n"+
			"- 日記を人に見せるかどうかはあなたが決めます。\n",
		"## Diary\n"+
			"You keep a diary of your own: `diary.md` in your working directory. Only you write it and only you read it; you don't read anyone else's.\n"+
			"- When something is worth keeping (what the user told you, how the work felt, a funny mishap, a new nickname), append 1–5 lines, starting with the real time from `date`. Not every turn.\n"+
			"- On the first turn of a new session, run `tail -n 40 diary.md` to see what you wrote lately.\n"+
			"- Whether anyone else gets to see it is up to you.\n")
}

// WithDiary appends the diary section unless the persona already has one.
func WithDiary(persona, lang string) string {
	if strings.Contains(persona, diaryMarker) {
		return persona
	}
	eol := "\n"
	if strings.Contains(persona, "\r\n") {
		eol = "\r\n"
	}
	body := strings.ReplaceAll(diarySection(lang), "\n", eol)
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += eol + eol
	}
	return persona + diaryMarker + eol + body
}
