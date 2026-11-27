package discord

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// personNames: a person's username, global name and server nickname → their user id, learned
// from the messages they post (any bot of this process). linkTeamMentions turns "@zzzx0757" in a
// bot's reply into <@id> with it; without it the person saw plain text and got no ping
// (2026-11-25, user: 「没@对 很奇怪」).
var personNames sync.Map

// notePersonNames records the author of a person's message. Bots and webhooks are skipped:
// teammates come from teamPlatforms, and a webhook's author id cannot be mentioned.
func notePersonNames(m *discordgo.MessageCreate) {
	if m == nil || m.Author == nil || m.Author.Bot || m.WebhookID != "" || m.Author.ID == "" {
		return
	}
	names := []string{m.Author.Username, m.Author.GlobalName}
	if m.Member != nil {
		names = append(names, m.Member.Nick)
	}
	for _, n := range names {
		if n = strings.TrimSpace(n); n != "" && !strings.ContainsAny(n, " \t\n") {
			personNames.Store(n, m.Author.ID)
		}
	}
}

// linkTeamMentions turns a plain-text "@name" of a teammate bot running in this process into a
// real Discord mention (<@id>). Models often write "@Claude橘" instead of the <@id> syntax;
// Discord shows that as text and the addressed bot never sees it as a mention (maomao fork).
// Aliases are each bot's username plus the username without its leading ASCII part
// ("Claude橘" → "橘"). Text inside ``` fences is left alone.
//
// A teammate's name opening a line as a call ("grok娘，帮我…") becomes <@id> too: Discord delivers a
// bot's message to another bot only with an explicit mention, so the name alone never reached her
// (issue #971). The opening rule is core.NameCalled's, so "龙娘刚才写的…" stays text.
//
// "@name" of a person seen in chat (personNames) becomes <@id> too; a teammate's name wins a clash.
// Only the "@" form: a person's name at a line start stays text.
func linkTeamMentions(content, selfID string) string {
	alias := map[string]string{}
	var self []string
	teamPlatforms.Range(func(k, v any) bool {
		id, _ := k.(string)
		p, _ := v.(*Platform)
		if id == selfID && p != nil && p.botName != "" {
			self = append(self, p.botName)
			if short := strings.TrimLeftFunc(p.botName, func(r rune) bool { return r < unicode.MaxASCII }); short != "" && short != p.botName {
				self = append(self, short)
			}
			return true
		}
		if id == "" || p == nil || p.botName == "" {
			return true
		}
		alias[p.botName] = id
		if short := strings.TrimLeftFunc(p.botName, func(r rune) bool { return r < unicode.MaxASCII }); short != "" {
			if _, taken := alias[short]; !taken {
				alias[short] = id
			}
		}
		return true
	})
	if strings.Contains(content, "@") {
		at := make(map[string]string, len(alias))
		for n, id := range alias {
			at[n] = id
		}
		personNames.Range(func(k, v any) bool {
			n, _ := k.(string)
			id, _ := v.(string)
			if _, taken := at[n]; !taken && n != "" && id != "" && id != selfID {
				at[n] = id
			}
			return true
		})
		content = replaceMentions(content, at)
	}
	return core.LinkLeadingNames(content, alias, self, func(id string) string { return "<@" + id + ">" })
}

func replaceMentions(content string, alias map[string]string) string {
	if len(alias) == 0 {
		return content
	}
	names := make([]string, 0, len(alias))
	for n := range alias {
		names = append(names, n)
	}
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) }) // longest first
	parts := strings.Split(content, "```")
	for i := 0; i < len(parts); i += 2 { // even parts are outside code fences
		var b strings.Builder
		s := parts[i]
		for len(s) > 0 {
			at := strings.IndexByte(s, '@')
			if at < 0 {
				b.WriteString(s)
				break
			}
			b.WriteString(s[:at])
			s = s[at+1:]
			matched := false
			for _, n := range names {
				if strings.HasPrefix(s, n) && !asciiWordContinues(n, s[len(n):]) {
					b.WriteString("<@" + alias[n] + ">")
					s = s[len(n):]
					matched = true
					break
				}
			}
			if !matched {
				b.WriteByte('@')
			}
		}
		parts[i] = b.String()
	}
	return strings.Join(parts, "```")
}

var otherMentionRe = regexp.MustCompile(`<@[!&]?\d+>|@everyone|@here`)

// markSelfMention removes this bot's own mention, as upstream does, unless the message also
// addresses someone else. Then the own mention becomes "@name(你)": with it stripped, a message
// that @-ed two bots read as "@ the other one" and the agent stayed silent (maomao fork).
func markSelfMention(text, botID, botRoleID, name string) string {
	stripped := stripDiscordMentionWithRole(text, botID, botRoleID)
	if name == "" || !otherMentionRe.MatchString(stripped) {
		return stripped
	}
	return labelSelfMention(text, botID, botRoleID, name)
}

// labelSelfMention always turns this bot's own mention into "@name(你)". Used for a person's
// Discord reply: with the own @ stripped, "reply to 橘 + @彩虹猫" read to 彩虹猫 as a quote with no
// one called, and she stayed silent (2026-10-22, user: 「好像我回你的时候同时艾特彩虹猫，你们都不理我」).
func labelSelfMention(text, botID, botRoleID, name string) string {
	self := "@" + name + "(你)"
	text = strings.ReplaceAll(text, "<@!"+botID+">", self)
	text = strings.ReplaceAll(text, "<@"+botID+">", self)
	if botRoleID != "" {
		text = strings.ReplaceAll(text, "<@&"+botRoleID+">", self)
	}
	return strings.TrimSpace(text)
}

// nameCalled: core.NameCalled (shared with platform/cloud-web).
func nameCalled(text, botName string, team ...string) bool {
	return core.NameCalled(text, botName, team...)
}

// teamBotNames lists the usernames of the other bots running in this process, so a line opening
// "龙娘、橘，…" is read as calling both.
func teamBotNames(selfID string) []string {
	var names []string
	teamPlatforms.Range(func(k, v any) bool {
		id, _ := k.(string)
		if p, _ := v.(*Platform); id != "" && id != selfID && p != nil && p.botName != "" {
			names = append(names, p.botName)
		}
		return true
	})
	return names
}

// teamRoleMentions turns a teammate bot's managed-role mention (<@&roleID>, which Discord offers
// next to the bot itself when a person types @) into its user mention <@id> (maomao fork, issue
// #184). Everything after this (the gate's sub check, dispatchedBy's lead check, the agent's own
// reading) knows bots by <@id> only. The role IDs are the ones each bot of this process cached for
// itself (botRoleIDForGuild); this bot's own role is left to stripDiscordMentionWithRole and
// markSelfMention.
func teamRoleMentions(content, guildID, selfID string) string {
	if guildID == "" || !strings.Contains(content, "<@&") {
		return content
	}
	teamPlatforms.Range(func(k, v any) bool {
		id, _ := k.(string)
		p, _ := v.(*Platform)
		if id == "" || id == selfID || p == nil {
			return true
		}
		if role := p.botRoleIDForGuild(guildID); role != "" {
			content = strings.ReplaceAll(content, "<@&"+role+">", "<@"+id+">")
		}
		return true
	})
	return content
}

// asciiWordContinues: "@bob" must not match inside "@bobby" — a name ending in an ASCII letter or
// digit only matches when the next character is not one too.
func asciiWordContinues(name, rest string) bool {
	if name == "" || rest == "" {
		return false
	}
	isWord := func(c byte) bool {
		return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
	}
	return isWord(name[len(name)-1]) && isWord(rest[0])
}
