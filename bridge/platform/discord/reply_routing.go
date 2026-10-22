package discord

import "github.com/bwmarrin/discordgo"

// humanReplyRoute resolves addressing before quoted content reaches the gate,
// command handling, or a running turn. Group-reply-all is only a fallback for
// unaddressed messages, not permission to consume another bot's reply.
func (p *Platform) humanReplyRoute(m *discordgo.MessageCreate, roleID string, mentioned bool) (addressed, accept bool) {
	if m.GuildID == "" || m.Type != discordgo.MessageTypeReply {
		return mentioned, true
	}

	// Body mentions are intentional recipients; Discord's Mentions also contains
	// the optional reply ping. Ignore that automatic ping when retargeting a reply.
	body := *m.Message
	body.Mentions = nil
	if !p.respondToAtEveryoneAndHere {
		body.Content = stripEveryoneHere(body.Content)
	}
	ref := m.ReferencedMessage
	if otherMentionRe.MatchString(body.Content) {
		self := isDiscordBotMention(&discordgo.MessageCreate{Message: &body}, p.botID, roleID, p.respondToAtEveryoneAndHere)
		// The bot being replied to is addressed too: replying to 橘 while @-ing 彩虹猫 calls both
		// (2026-10-22, user: 「好像我回你的时候同时艾特彩虹猫，你们都不理我」). Before, only the @-ed bot got it.
		if ref != nil && ref.Author != nil && ref.Author.ID == p.botID {
			self = true
		}
		return self, self
	}

	if ref == nil || ref.Author == nil || ref.Author.ID == "" {
		// Deleted/unavailable references do not establish an addressee. Do not
		// guess using group-reply-all or quoted prose; an explicit @ still works.
		return false, false
	}
	if ref.Author.Bot || ref.WebhookID != "" {
		self := ref.Author.ID == p.botID
		return self, self
	}
	// Replies between humans retain the existing channel/gate policy.
	return mentioned, true
}
