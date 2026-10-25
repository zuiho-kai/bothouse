package discord

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

var _ core.TaskCardPublisher = (*Platform)(nil)

func (p *Platform) TaskCardDestination(sessionKey string) (string, error) {
	return parseDiscordSessionKeyChannelID(sessionKey)
}

// findPublicFact reconciles a possibly successful POST with a lost response.
// Fail closed when the bounded history cannot establish absence; do not create
// duplicate cards merely because the channel was busy during an outage.
func (p *Platform) findPublicFact(ctx context.Context, channel, marker string, since time.Time) (string, error) {
	before := ""
	for page := 0; page < 20; page++ {
		messages, err := p.session.ChannelMessages(channel, 100, before, "", "", discordgo.WithContext(ctx))
		if err != nil {
			return "", err
		}
		for _, m := range messages {
			if m.Author != nil && m.Author.ID == p.botID {
				for _, embed := range m.Embeds {
					if embed.Footer != nil && embed.Footer.Text == marker {
						return m.ID, nil
					}
				}
			}
		}
		if len(messages) < 100 {
			return "", nil
		}
		last := messages[len(messages)-1]
		if last.Timestamp.Before(since.Add(-time.Minute)) {
			return "", nil
		}
		before = last.ID
	}
	return "", errors.New("task delivery history exceeds reconciliation window; retry after manual inspection")
}

// EnsureTaskCard posts or edits the task card. A destination Discord refuses
// for good (deleted channel or card, lost access, archived thread) is reported
// wrapping core.ErrDeliveryUnrecoverable, so core stops retrying it.
func (p *Platform) EnsureTaskCard(ctx context.Context, task *core.Task, lang core.Language) error {
	return unrecoverableErr(p.ensureTaskCard(ctx, task, lang))
}

func (p *Platform) ensureTaskCard(ctx context.Context, task *core.Task, lang core.Language) error {
	if p.session == nil || p.botID == "" {
		return errors.New("discord session is not ready")
	}
	marker := "cc-task:" + task.ID
	snapshot := task.Clone()
	render := func(v cardView) []*discordgo.MessageEmbed {
		embed := renderTaskCardEmbedView(snapshot, string(lang), v)
		embed.Footer = &discordgo.MessageEmbedFooter{Text: marker}
		embed.Timestamp = snapshot.UpdatedAt.Format(time.RFC3339)
		return []*discordgo.MessageEmbed{embed}
	}
	// maomao fork: the task card follows its turn's 细节/简略 choice and carries
	// no buttons of its own; the turn's progress card holds them (card_view.go).
	if task.MessageID != "" {
		p.cardViews.join(task.ChannelID, task.ChannelID, task.MessageID)
	}
	view := p.cardViews.mode(task.MessageID)
	if task.MessageID == "" {
		view = p.cardViews.turnMode(task.ChannelID)
	}
	embeds := render(view)
	components := []discordgo.MessageComponent{}
	if task.MessageID == "" {
		id, err := p.findPublicFact(ctx, task.ChannelID, marker, task.CreatedAt)
		if err != nil {
			return err
		}
		task.MessageID = id
		if id == "" {
			m, err := p.session.ChannelMessageSendComplex(task.ChannelID, &discordgo.MessageSend{Embeds: embeds, Components: components, AllowedMentions: &discordgo.MessageAllowedMentions{}}, discordgo.WithContext(ctx))
			if err != nil {
				return err
			}
			task.MessageID = m.ID
		}
	}
	// An edit is idempotent and also updates a recovered card to the newest state.
	p.cardViews.join(task.ChannelID, task.ChannelID, task.MessageID)
	view = p.cardViews.mode(task.MessageID)
	embeds = render(view)
	_, err := p.session.ChannelMessageEditComplex(&discordgo.MessageEdit{ID: task.MessageID, Channel: task.ChannelID, Embeds: &embeds, Components: &components, AllowedMentions: &discordgo.MessageAllowedMentions{}}, discordgo.WithContext(ctx))
	if err != nil {
		return err
	}
	p.cardViews.remember(task.MessageID, cardRender{lang: string(lang), embeds: render})
	if task.ThreadID != "" && task.CardURL != "" {
		p.syncTaskThreadName(ctx, task)
		return nil
	}
	ch, err := p.session.Channel(task.ChannelID, discordgo.WithContext(ctx))
	if err != nil {
		return err
	}
	guild := ch.GuildID
	if guild == "" {
		guild = "@me"
	}
	task.CardURL = fmt.Sprintf("https://discord.com/channels/%s/%s/%s", guild, task.ChannelID, task.MessageID)
	if task.ThreadID != "" {
		return nil
	}
	if ch.Type == discordgo.ChannelTypeGuildPublicThread || ch.Type == discordgo.ChannelTypeGuildPrivateThread || ch.Type == discordgo.ChannelTypeGuildNewsThread {
		task.ThreadID = task.ChannelID
		return nil
	}
	// Threads attached to a message have that message's ID. Recover a lost ACK.
	thread, err := p.session.Channel(task.MessageID, discordgo.WithContext(ctx))
	if err == nil {
		task.ThreadID, task.ThreadTitle = thread.ID, thread.Name
		return nil
	}
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) || rest.Response == nil || rest.Response.StatusCode != 404 {
		return err
	}
	thread, err = p.session.MessageThreadStart(task.ChannelID, task.MessageID, truncateDiscordThreadName(task.Title, 90), 1440, discordgo.WithContext(ctx))
	if err != nil {
		return err
	}
	task.ThreadID, task.ThreadTitle = thread.ID, truncateDiscordThreadName(task.Title, 90)
	return nil
}

// syncTaskThreadName renames the card's thread when the card title changed
// after the thread was opened (a batch card is titled by its first member
// until the lead reports a start title). A thread the card merely lives in
// is the user's own and is never renamed. The rename is cosmetic: a refusal
// (archived/locked thread, rename rate limit) is only logged and never blocks
// the card or the thread's messages. Each title is tried once, and a rate
// limit fails fast instead of sleeping through the delivery's deadline.
func (p *Platform) syncTaskThreadName(ctx context.Context, task *core.Task) {
	name := truncateDiscordThreadName(task.Title, 90)
	if task.ThreadID == task.ChannelID || name == "" || name == task.ThreadTitle {
		return
	}
	task.ThreadTitle = name
	unarchive := false
	if _, err := p.session.ChannelEdit(task.ThreadID, &discordgo.ChannelEdit{Name: name, Archived: &unarchive}, discordgo.WithContext(ctx), discordgo.WithRetryOnRatelimit(false)); err != nil {
		slog.Warn("discord: task thread rename failed", "task_id", task.ID, "thread", task.ThreadID, "error", err)
	}
}

func (p *Platform) PublishTaskFact(ctx context.Context, task *core.Task, ev core.TaskEvent, lang core.Language) error {
	if p.session == nil || p.botID == "" {
		return errors.New("discord session is not ready")
	}
	if task.ThreadID == "" {
		return errors.New("task thread unavailable")
	}
	// Source: reuse the Discord text limit so supplementary Unicode also stays
	// below the embed description limit. One event is one message unless it
	// is longer than that; each part has its own recovery marker.
	parts := core.SplitMessageCodeFenceAware(ev.ThreadText(), maxDiscordLen)
	if len(parts) == 0 {
		parts = []string{""}
	}
	for i, part := range parts {
		marker := taskFactMarker(task, ev, i, len(parts))
		if err := p.publishTaskFactPart(ctx, task, ev, lang, marker, part); err != nil {
			// Missing access or thread is permanent for this account; core
			// reports it visibly instead of blocking later facts on retries.
			// A refusal with Discord's error body also wraps
			// core.ErrDeliveryUnrecoverable: core drops it if no other
			// account can post it.
			err = unrecoverableErr(err)
			var rest *discordgo.RESTError
			if errors.As(err, &rest) && rest.Response != nil && (rest.Response.StatusCode == 403 || rest.Response.StatusCode == 404) {
				return fmt.Errorf("%w: %w", core.ErrTaskFactUndeliverable, err)
			}
			return err
		}
	}
	return nil
}

// taskFactMarker is the small footer that lets a retry find an event already
// posted in this thread: "#<seq>" in the card's own thread (one thread per
// task, so the sequence is unique there), with "·n/m" for the parts of an
// over-long event. When the card lives in the user's thread, several cards
// share it and each counts from 1, so the footer carries the event ID, which
// includes the card's ID.
func taskFactMarker(task *core.Task, ev core.TaskEvent, i, n int) string {
	marker := "#" + ev.ID
	if ev.Seq > 0 && (task.ThreadID != task.ChannelID || ev.ID == "") {
		marker = fmt.Sprintf("#%d", ev.Seq)
	}
	if n > 1 {
		marker += fmt.Sprintf(" · %d/%d", i+1, n)
	}
	return marker
}

func (p *Platform) publishTaskFactPart(ctx context.Context, task *core.Task, ev core.TaskEvent, lang core.Language, marker, part string) error {
	id, err := p.findPublicFact(ctx, task.ThreadID, marker, ev.Timestamp)
	if err != nil || id != "" {
		return err
	}
	embed := &discordgo.MessageEmbed{
		Description: part,
		Footer:      &discordgo.MessageEmbedFooter{Text: marker},
		Timestamp:   ev.Timestamp.Format(time.RFC3339),
		Color:       discordTaskColor(ev.State),
	}
	_, err = p.session.ChannelMessageSendComplex(task.ThreadID, &discordgo.MessageSend{Embeds: []*discordgo.MessageEmbed{embed}, AllowedMentions: &discordgo.MessageAllowedMentions{}}, discordgo.WithContext(ctx))
	return err
}
