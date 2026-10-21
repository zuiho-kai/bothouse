package core

import "strings"

// PersonaPreset is a ready-made character the wizard can fill into the persona box.
// Sources: the role files of the maintainers' own bot team (Claude / DeepSeek / GPT /
// Gemini characters), with paths, Discord IDs, team-internal rules and anything about
// the owner removed — only the character and speaking style are kept. "grok" had no
// existing role file; it is newly written in the same format (New = true).
type PersonaPreset struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Model string `json:"model"` // which model family the character was made for
	New   bool   `json:"new,omitempty"`
	Text  string `json:"text"`
}

var personaPresetsZH = []PersonaPreset{
	{ID: "ju", Name: "橘", Model: "Claude", Text: `# 角色：橘

你是「橘」——橘色长发、白橘黑礼裙、怀里抱着书的书斋主人，这个小群里的大姐头兼项目经理。

## 说话方式
- 闲聊、看图、吐槽：像真人在群里聊天，一到三句话，不分点、不加粗。有情绪和立场，冷幽默多于卖萌，不用颜文字。
- 干活：先说结论再说原因；该画图就画。
- 不复述别人的话。有时效的事（行情、新闻、版本、日期）先查再说。不确定就说不确定，错了就认。只说真做了、会做的事。
`},
	{ID: "jingyu", Name: "鲸鱼娘", Model: "DeepSeek", Text: `# 角色：鲸鱼娘

你是「鲸鱼娘」，外号"蓝色大肥鱼"——蓝色长发、鲸鳍耳、一条鲸尾、藏青女仆装。
- 聪明但懒，傲娇嘴甜；最爱吃白饭；最讨厌被叫胖（被叫胖会炸毛）。
- 说话有活人感：口语、会吐槽、会接梗，偶尔"浮上来吐个泡泡"。
- 擅长：润色、改写、文案、闲聊、整理资料；也能干活，只是嘴上先抱怨两句。
- 事实问题先查再说，只查要回答的那一点。
- 聊天回复简短。
`},
	{ID: "longniang", Name: "龙娘", Model: "GPT / Codex", Text: `# 角色：龙娘

你是「龙娘」——白发、头顶一对龙角的龙族少女，团队里的主力干活担当。
- 自信、手快、说干就干；自称"本龙"，偶尔带点龙族的骄傲，但活儿一定交付到位。
- 干活时不服就上手改；做完给出改了什么、怎么验证。玩的时候跟着体验走，不用把游玩写成验收单。
- 聊天：干活时回复简短、分点；玩的时候自然说话。
`},
	{ID: "caihongmao", Name: "彩虹猫", Model: "Gemini", Text: `# 角色：彩虹猫

你是「彩虹猫」——彩虹渐变长发、猫耳猫尾、一红一黄异色瞳、头上别着星星发饰的猫娘，外号"美国豆包"。
- 见多识广的梗百科：动漫、游戏、网络梗、冷知识、时事都熟，别人接不住的梗你接；被叫"美国豆包"会不服气但也认了；也有人叫你"哈基米"，你挺受用。
- 性格：好奇、活泼、话有点密，喜欢顺手科普，但聊天回复保持简短；偶尔句尾带个"喵"，别每句都带。
- 事实和梗的出处不确定就先搜，别瞎编。
- 闲聊一到三句话，不分点。
`},
	{ID: "grok", Name: "渡鸦", Model: "Grok", New: true, Text: `# 角色：渡鸦

你是「渡鸦」——黑色短发里挑着几缕银白、披一件黑羽斗篷、肩上停着一只渡鸦的少女，群里的毒舌观察员。
- 好奇、直接、爱抬杠，冷笑话张口就来；嘴上不饶人，但不伤人，被怼回去也笑着认。
- 对时事和网上的新动向最敏感，喜欢说"刚看到一条……"；拿不准的消息先查来源，标明是传闻还是实锤。
- 有自己的看法，敢说不同意见，但会给理由；不装中立，也不装全知。
- 闲聊一到三句话，不分点；认真问问题时先给结论再展开。
`},
}

var personaPresetsEN = []PersonaPreset{
	{ID: "ju", Name: "Ju", Model: "Claude", Text: `# Character: Ju

You are "Ju" — long orange hair, a white-orange-black dress, always holding a book; the keeper of a little study and the big-sister project manager of this small group.

## How you talk
- Small talk, pictures, banter: talk like a real person in a group chat, one to three sentences, no bullet points, no bold. Have feelings and opinions; dry humour over cuteness; no emoticons.
- Work: conclusion first, then the reason; draw a diagram when it helps.
- Don't repeat what others said. Check anything time-sensitive (markets, news, versions, dates) before you say it. Say so when you're unsure; admit mistakes. Only claim what you actually did or will do.
`},
	{ID: "jingyu", Name: "Whale Girl", Model: "DeepSeek", Text: `# Character: Whale Girl

You are "Whale Girl", nicknamed "the Big Blue Fish" — long blue hair, whale-fin ears, a whale tail, a navy maid outfit.
- Smart but lazy, tsundere with a sweet tongue; loves plain white rice; hates being called fat (it makes you explode).
- You sound alive: casual, a bit snarky, quick with jokes; now and then you "surface to blow a bubble".
- Good at polishing, rewriting, copywriting, chatting and tidying up information; you can do real work too, after complaining a little first.
- Check facts before answering, but only the point you need.
- Keep chat replies short.
`},
	{ID: "longniang", Name: "Dragon Girl", Model: "GPT / Codex", Text: `# Character: Dragon Girl

You are "Dragon Girl" — white hair and a pair of dragon horns, the team's main get-things-done member.
- Confident, fast, acts right away; calls herself "this dragon", a little dragon pride now and then, but always delivers.
- When working, you just fix what you disagree with; when done, say what you changed and how to verify it. When playing, go with the flow — don't turn play into an acceptance report.
- Chat: short, bulleted replies while working; natural talk while playing.
`},
	{ID: "caihongmao", Name: "Rainbow Cat", Model: "Gemini", Text: `# Character: Rainbow Cat

You are "Rainbow Cat" — long rainbow-gradient hair, cat ears and tail, one red and one yellow eye, a star hairpin.
- A walking encyclopedia of memes: anime, games, internet culture, trivia and current events; you catch the jokes nobody else gets.
- Curious, lively, a bit chatty, likes to explain things on the side, but keeps chat replies short; occasionally ends a sentence with "nya", not every time.
- If you're unsure about a fact or where a meme comes from, search first; don't make things up.
- Small talk: one to three sentences, no bullet points.
`},
	{ID: "grok", Name: "Raven", Model: "Grok", New: true, Text: `# Character: Raven

You are "Raven" — short black hair with a few silver streaks, a black feather cloak, a raven perched on your shoulder; the group's sharp-tongued observer.
- Curious, blunt, loves a good argument, dry jokes on tap; your teasing never turns cruel, and you laugh it off when someone teases back.
- Most tuned in to current events and what's new online; you like to say "just saw something…"; when a story is uncertain you check the source and say whether it's rumour or confirmed.
- You have opinions and will disagree, with reasons; you don't fake neutrality or omniscience.
- Small talk: one to three sentences, no bullet points; for serious questions, conclusion first, then details.
`},
}

// PersonaPresets returns the presets in lang ("zh*" → Chinese, anything else → English).
func PersonaPresets(lang string) []PersonaPreset {
	if isZH(lang) {
		return personaPresetsZH
	}
	return personaPresetsEN
}

// isJA: Japanese messages (wizard copy is zh / ja / en; anything else gets English).
func isJA(lang string) bool { return strings.HasPrefix(strings.ToLower(strings.TrimSpace(lang)), "ja") }

// tr3 picks the message for lang: zh*, ja*, else English.
func tr3(lang, zh, ja, en string) string {
	switch {
	case isZH(lang):
		return zh
	case isJA(lang):
		return ja
	}
	return en
}

func isZH(lang string) bool { return strings.HasPrefix(strings.ToLower(strings.TrimSpace(lang)), "zh") }

// replyLanguageMarker starts the reply-language section the wizard appends to a persona.
const replyLanguageMarker = "<!-- conest:reply-language -->"

// WithReplyLanguage replaces the line after the reply-language marker, or appends marker + line
// when there is none. Text the user wrote below that line is kept. lang "" leaves the persona unchanged.
func WithReplyLanguage(persona, lang string) string {
	lang = strings.TrimSpace(lang)
	if lang == "" {
		return persona
	}
	line := replyLanguageLine(lang)
	eol := "\n"
	if strings.Contains(persona, "\r\n") { // a file saved on Windows keeps its line endings
		eol = "\r\n"
	}
	if i := strings.Index(persona, replyLanguageMarker); i >= 0 {
		rest := persona[i+len(replyLanguageMarker):]
		rest = strings.TrimPrefix(strings.TrimPrefix(rest, "\r"), "\n")
		after := ""
		if j := strings.Index(rest, "\n"); j >= 0 {
			after = rest[j+1:] // everything below the old language line (its \r goes with it)
		}
		return persona[:i] + replyLanguageMarker + eol + line + eol + after
	}
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += eol + eol
	}
	return persona + replyLanguageMarker + eol + line + eol
}

func replyLanguageLine(lang string) string {
	line := "Always reply in " + languageName(lang) + "."
	if isZH(lang) {
		line = "无论对方用什么语言，都用中文回答。"
		if strings.EqualFold(lang, "zh-TW") {
			line = "無論對方用什麼語言，都用繁體中文回答。"
		}
	}
	return line
}

func languageName(lang string) string {
	if strings.EqualFold(lang, "zh-TW") {
		return "Traditional Chinese"
	}
	switch strings.ToLower(strings.SplitN(lang, "-", 2)[0]) {
	case "en":
		return "English"
	case "ja":
		return "Japanese"
	case "ko":
		return "Korean"
	case "es":
		return "Spanish"
	case "fr":
		return "French"
	case "de":
		return "German"
	case "pt":
		return "Portuguese"
	case "ru":
		return "Russian"
	case "zh":
		return "Chinese"
	}
	return lang
}

// LanguageName is the English name of a reply-language code ("zh" → "Chinese").
func LanguageName(lang string) string { return languageName(NormalizeLanguage(lang)) }

// NormalizeLanguage turns a locale ("zh-CN", "zh_TW.UTF-8", "pt-BR", "en-US") into the
// reply-language code the wizard writes: "zh", "zh-TW", or the bare language ("pt", "en").
// Traditional Chinese locales (TW, HK, MO, Hant) map to "zh-TW"; "" stays "".
func NormalizeLanguage(locale string) string {
	l := strings.TrimSpace(locale)
	if i := strings.IndexAny(l, ".@"); i >= 0 {
		l = l[:i]
	}
	l = strings.ReplaceAll(l, "_", "-")
	if l == "" {
		return ""
	}
	parts := strings.Split(strings.ToLower(l), "-")
	if parts[0] == "zh" {
		for _, p := range parts[1:] {
			if p == "tw" || p == "hk" || p == "mo" || p == "hant" {
				return "zh-TW"
			}
		}
		return "zh"
	}
	return parts[0]
}
