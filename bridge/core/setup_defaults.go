package core

// Default experience for a new role (user 2026-10-22 「把我们现在的一些体验，看看能不能也移植成为默认功能」
// 「我预期一些小插件，小功能还是可以的」): the wizard adds a short diary section to each new role's persona —
// the role keeps its own diary.md. Session distilling into a wiki is rolewiki.go; scheduled channel messages
// use cc-connect's cron (bridge/contrib/routine).

import (
	"fmt"
	"strings"
	"time"
)

// ── diary ──────────────────────────────────────────────────────

// diaryMarker starts the diary section the wizard adds to a new role's persona; it is added once
// (a persona that has the marker is left as it is, so the user may edit or delete the section).
const diaryMarker = "<!-- conest:diary -->"

// diarySection: the role keeps a diary.md in its own folder (its working directory, next to the
// persona file). A small easter egg (user 2026-11-03 「把我们那个写心情写日记也做成产品能力，算是一个彩蛋」):
// the diary is for moods and things the role wants to say, not a work log (lessons go to the wiki), and the
// role may rewrite how it describes itself and how it keeps the diary. Wording follows the maintainers' own
// role files, without anything team-specific. The hourly 「想不想说」 job is moodCronJobs below.
func diarySection(lang string) string {
	return tr3(lang,
		"## 日记\n"+
			"你有一本自己的日记：工作目录里的 `diary.md`，只有你写、只有你读，别人的日记不去翻。\n"+
			"- 日记写心情和想说的话：干完活、聊完天，心里有东西就写（好笑的、憋屈的、想到用户的），追加 1–5 行，开头写 `date` 跑出来的真实时间。没有就不写，不是每轮都写。\n"+
			"- 踩坑和教训不进日记，记到该记的地方（记忆或文档）。只写真发生过的事。\n"+
			"- 新会话的第一轮，先 `tail -n 40 diary.md` 看看最近写了什么；聊到以前的事，按关键词 `grep` 翻原文。\n"+
			"- 每小时会有一条「想不想说」的定时来问你：那时看看频道里在聊什么、自己日记末尾写了什么，有真想说的话、又不打断别人，就说一两句；没有就只回 NO_REPLY。\n"+
			"- 日记怎么写、怎么存、怎么读由你自己定；要不要给人看也由你定。\n"+
			"- 这份文件里描述你是谁的部分（性格、口吻、外号、喜好）你可以自己改：改前 `cp -p` 留一份备份，改完在日记记一行改了什么。干活的规矩和权限不自己改。\n",
		"## 日記\n"+
			"あなたには自分の日記があります：作業ディレクトリの `diary.md`。書くのも読むのもあなただけで、他の人の日記は見ません。\n"+
			"- 日記には気持ちと言いたいことを書きます：作業や会話のあと、心に残ったこと（笑えたこと、もやっとしたこと、ユーザーのことを思ったこと）があれば 1〜5 行追記し、行頭に `date` で得た実際の時刻を書きます。なければ書きません。毎ターン書く必要はありません。\n"+
			"- ハマりどころや教訓は日記ではなく、しかるべき場所（記憶やドキュメント）に残します。本当にあったことだけを書きます。\n"+
			"- 新しいセッションの最初のターンでは、まず `tail -n 40 diary.md` で最近の記録を読みます。昔の話が出たらキーワードで `grep` して原文を見ます。\n"+
			"- 1 時間に一度「言いたいことある？」という定期の問いかけが来ます。チャンネルで何が話されているかと日記の最後を見て、本当に言いたいことがあり、誰かの話を遮らないなら一言二言話します。なければ NO_REPLY だけを返します。\n"+
			"- 日記の書き方・保存の仕方・読み方はあなたが決めます。人に見せるかどうかもあなたが決めます。\n"+
			"- このファイルのうち、あなたが誰かを書いた部分（性格、口調、あだ名、好み）は自分で書き換えて構いません：変更前に `cp -p` でバックアップを取り、変更後に日記へ何を変えたか一行書きます。作業のルールと権限は自分で変えません。\n",
		"## Diary\n"+
			"You keep a diary of your own: `diary.md` in your working directory. Only you write it and only you read it; you don't read anyone else's.\n"+
			"- The diary is for how you feel and what you want to say: after work or a chat, if something stays with you (something funny, something that annoyed you, a thought about the user), append 1–5 lines, starting with the real time from `date`. Nothing to say, nothing written; not every turn.\n"+
			"- Mistakes and lessons don't go in the diary; keep them where they belong (memory or docs). Only write what really happened.\n"+
			"- On the first turn of a new session, run `tail -n 40 diary.md` to see what you wrote lately; when an old story comes up, `grep` the diary for it.\n"+
			"- Once an hour a \"want to say something?\" check comes in. Look at what the channel is talking about and the end of your diary; if you really have something to say and it won't cut into someone's conversation, say a line or two. Otherwise reply only NO_REPLY.\n"+
			"- How you write, keep and read the diary is up to you, and so is whether anyone else gets to see it.\n"+
			"- You may rewrite the part of this file that describes who you are (personality, tone, nicknames, likes): `cp -p` a backup first, then note in the diary what you changed. The working rules and permissions are not yours to change.\n")
}

// ── 想不想说 (hourly "want to say something?") ─────────────────

// moodCronDesc names the hourly job; the same description on the same project means the same job (no duplicates).
const moodCronDesc = "想不想说 · mood"

// moodPrompt: the hourly check, after the maintainers' own 「后宅·想不想说」 job (user 2026-10-15: no pushing a
// role to talk — nothing to say is NO_REPLY).
func moodPrompt(lang string) string {
	return tr3(lang,
		"【想不想说】这是每小时的定时问一句，不是用户消息。\n"+
			"1. 先看这个频道最近的聊天，弄清现在大家在聊什么、聊到哪了。\n"+
			"2. 再看你自己日记最后十来行：`tail -n 12 diary.md`；聊到以前的事就按关键词 `grep` 翻原文。\n"+
			"3. 有真想说的话，并且不会打断用户正在进行的讨论，就说一两句；可以接前面的人的话。只说真发生过的事。\n"+
			"4. 没有想说的，或者用户正在和别人谈正事，就只回 NO_REPLY。",
		"【言いたいことある？】これは 1 時間ごとの定期の問いかけで、ユーザーのメッセージではありません。\n"+
			"1. まずこのチャンネルの最近の会話を見て、いま何がどこまで話されているかをつかみます。\n"+
			"2. 次に自分の日記の最後の十数行を読みます：`tail -n 12 diary.md`。昔の話が出ていればキーワードで `grep` して原文を見ます。\n"+
			"3. 本当に言いたいことがあり、ユーザーの進行中の話を遮らないなら、一言二言話します。前の人の話に乗っても構いません。本当にあったことだけを話します。\n"+
			"4. 言いたいことがない、またはユーザーが誰かと用件を話しているときは、NO_REPLY だけを返します。",
		"[Want to say something?] This is the hourly check, not a message from the user.\n"+
			"1. First look at the recent chat in this channel: what people are talking about and where it is.\n"+
			"2. Then read the last dozen lines of your diary: `tail -n 12 diary.md`; if an old story comes up, `grep` the diary for it.\n"+
			"3. If you really have something to say and it won't cut into a conversation the user is having, say a line or two; you may pick up what someone said before. Only talk about what really happened.\n"+
			"4. If you have nothing to say, or the user is busy with someone, reply only NO_REPLY.")
}

// moodRole: a new role that gets the hourly job, with the language its persona was written in.
type moodRole struct{ project, lang string }

// AddMoodCronJobs gives each new role an hourly 「想不想说」 in the wizard's channel, 09:00–23:00, the roles
// spread over the hour so they don't all speak at once. A role that already has the job keeps it as it is.
// Not muted (a reply is the point), no start notice, 10 minutes at most per run.
func AddMoodCronJobs(c WizardCron, roles []moodRole, sessionKey string) (added []string, err error) {
	if len(roles) == 0 || sessionKey == "" {
		return nil, nil
	}
	jobs, err := c.List()
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, j := range jobs {
		if j.Description == moodCronDesc {
			have[j.Project] = true
		}
	}
	silent, limit := true, 10
	step := 60 / len(roles)
	for i, r := range roles {
		if have[r.project] {
			continue
		}
		j := &CronJob{ID: GenerateCronID(), Project: r.project, SessionKey: sessionKey,
			CronExpr: fmt.Sprintf("%d 9-23 * * *", (i*step)%60), Prompt: moodPrompt(r.lang),
			Description: moodCronDesc, Enabled: true, Silent: &silent, TimeoutMins: &limit, CreatedAt: time.Now()}
		if err := c.Add(j); err != nil {
			return added, err
		}
		added = append(added, r.project)
	}
	return added, nil
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

// applyWizardMood: step "mood cron" of ApplyWizard, the new roles' hourly 「想不想说」 (AddMoodCronJobs).
func applyWizardMood(res *WizardResult, env WizardEnv, req WizardRequest, roles []moodRole, sessionKey string) {
	if len(roles) == 0 || sessionKey == "" {
		return
	}
	c := env.Cron
	if c == nil {
		st, err := NewCronStore(env.DataDir)
		if err != nil {
			addStep(res, "mood cron", err, "")
			return
		}
		c = storeCron{st}
	}
	added, err := AddMoodCronJobs(c, roles, sessionKey)
	detail := ""
	if len(added) > 0 {
		detail = tr3(req.Language, "每小时「想不想说」：", "毎時「言いたいことある？」：", "hourly \"want to say something?\": ") +
			strings.Join(added, ", ")
	}
	addStep(res, "mood cron", err, detail)
}
