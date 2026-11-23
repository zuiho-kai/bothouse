package discord

import (
	"log/slog"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// handleTaskForumReply runs after account/guild allowlists and before mention
// and thread-isolation routing. Only the team's persisted post map identifies
// a task; arbitrary threads with task-looking titles keep ordinary behavior.
//
// Being in a task post does not address the bot: people talk to each other there.
// The message goes to the lead only when it @-s the bot or replies to its message,
// by the same rules as a channel (isDiscordBotMention, humanReplyRoute).
func (p *Platform) handleTaskForumReply(s *discordgo.Session, m *discordgo.MessageCreate, botRoleID string) bool {
	if m.GuildID == "" {
		return false
	}
	p.mu.RLock()
	h, ok := p.eventHandler.(core.TaskForumInboundHandler)
	if !ok {
		h, ok = p.lifecycleHandler.(core.TaskForumInboundHandler)
	}
	p.mu.RUnlock()
	if !ok {
		return false
	}
	parent := channelParent(s, m.ChannelID)
	r, known := h.ResolveTaskForumReply(p.Name(), m.GuildID, parent, m.ChannelID)
	if !known {
		return false
	}
	// Webhooks stay out unless test_webhook_people names them (asTestPerson already cleared
	// Author.Bot for those, as on every other route): test servers have no second human account.
	if r == nil || m.Author.Bot || (m.WebhookID != "" && !p.testWebhookPeople[m.WebhookID]) {
		return true
	}
	mentioned, accept := p.humanReplyRoute(m, botRoleID, isDiscordBotMention(m, p.selfID(), botRoleID, p.respondToAtEveryoneAndHere))
	if !mentioned || !accept {
		slog.Debug("discord: ignoring task post message without bot mention", "channel", m.ChannelID)
		return true
	}
	if parent == "" {
		// Threads restored after reconnect may not yet be in gateway state. Use
		// the existing channel API, rather than guessing their parent from text.
		if api := p.boardSession(); api != nil {
			ch, err := api.Channel(m.ChannelID)
			if err != nil {
				slog.Warn("discord: task reply channel lookup failed", "channel", m.ChannelID, "error", err)
				return true
			}
			parent = ch.ParentID
		}
		if parent == "" {
			return true
		}
		if _, matched := h.ResolveTaskForumReply(p.Name(), m.GuildID, parent, m.ChannelID); !matched {
			return true
		}
	}
	images, files, audio, missed := classifyAttachments(m.Attachments, downloadURL)
	content := core.WithMissedAttachments(m.Content, missed...)
	if m.ReferencedMessage != nil {
		content, images = applyReferencedMessage(m.ReferencedMessage, content, images, downloadURL)
	}
	p.dispatchMessage(&core.Message{
		SessionKey: p.makeSessionKey(m.ChannelID, m.Author.ID), Platform: p.Name(),
		ChannelID: m.ChannelID, MessageID: m.ID, UserID: m.Author.ID, UserName: m.Author.Username,
		Content: content, Images: images, Files: files, Audio: audio, Mentioned: mentioned, TaskForum: r,
		ReplyCtx: replyContext{channelID: m.ChannelID, messageID: m.ID},
	})
	return true
}

// isTaskForumThread reports whether channelID is a task-forum post (restart catch-up leaves
// those to the task route; handleTaskForumReply dispatches by itself).
func (p *Platform) isTaskForumThread(s *discordgo.Session, guildID, channelID string) bool {
	if guildID == "" {
		return false
	}
	p.mu.RLock()
	h, ok := p.eventHandler.(core.TaskForumInboundHandler)
	if !ok {
		h, ok = p.lifecycleHandler.(core.TaskForumInboundHandler)
	}
	p.mu.RUnlock()
	if !ok {
		return false
	}
	_, known := h.ResolveTaskForumReply(p.Name(), guildID, channelParent(s, channelID), channelID)
	return known
}
