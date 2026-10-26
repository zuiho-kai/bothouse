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
var _ core.TaskThreadArchiver = (*Platform)(nil)
var _ core.TaskThreadReopener = (*Platform)(nil)
var _ core.TaskThreadActivityReader = (*Platform)(nil)

// discordTaskThreadAutoArchiveMinutes is how long Discord keeps a task thread
// before its own auto-archive hides it. Source: Discord accepts 60, 1440, 4320
// and 10080 minutes; 10080 (7 days) is the maximum, chosen so Discord does not
// archive a thread before the bridge's configurable scan waits (defaults:
// 1440 minutes for terminal cards, 4320 for result_ready). The bridge sweep
// remains the thing that archives at the configured time.
const discordTaskThreadAutoArchiveMinutes = 10080

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
	return unrecoverableErr(p.ensureTaskCard(ctx, task, lang, false))
}

// reposted is set on the second pass after the card was found deleted.
func (p *Platform) ensureTaskCard(ctx context.Context, task *core.Task, lang core.Language, reposted bool) error {
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
		if !reposted && isDiscordUnknownMessage(err) {
			// The card was deleted (e.g. by hand): post it again, like the
			// boards do. Its thread, if any, outlives the message and is kept.
			slog.Info("discord: task card deleted, posting it again", "task_id", task.ID, "channel", task.ChannelID, "message", task.MessageID)
			task.MessageID, task.CardURL = "", ""
			return p.ensureTaskCard(ctx, task, lang, true)
		}
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
	thread, err = p.session.MessageThreadStart(task.ChannelID, task.MessageID, truncateDiscordThreadName(task.Title, 90), discordTaskThreadAutoArchiveMinutes, discordgo.WithContext(ctx))
	if err != nil {
		return err
	}
	task.ThreadID, task.ThreadTitle = thread.ID, truncateDiscordThreadName(task.Title, 90)
	return nil
}

// syncTaskThreadName renames the card's thread when the card title changed
// after the thread was opened (a batch card is titled by its first member
// until the lead reports a start title). A thread the card merely lives in
// is the user's own and is never renamed. A thread the bridge archived is
// left archived: renaming is cosmetic, and reopening it here would undo the
// archive without a matching fact or clear thread_archived_at. The rename is
// otherwise best-effort: a refusal (archived/locked thread, rename rate limit)
// is only logged and never blocks the card or the thread's messages. Each
// title is tried once, and a rate limit fails fast instead of sleeping through
// the delivery's deadline.
func (p *Platform) syncTaskThreadName(ctx context.Context, task *core.Task) {
	name := truncateDiscordThreadName(task.Title, 90)
	if task.ThreadID == task.ChannelID || name == "" || name == task.ThreadTitle || task.ThreadArchivedAt != nil {
		return
	}
	task.ThreadTitle = name
	if _, err := p.session.ChannelEdit(task.ThreadID, &discordgo.ChannelEdit{Name: name}, discordgo.WithContext(ctx), discordgo.WithRetryOnRatelimit(false)); err != nil {
		slog.Warn("discord: task thread rename failed", "task_id", task.ID, "thread", task.ThreadID, "error", err)
	}
}

// ArchiveTaskThread hides a finished task's thread. Archiving keeps every
// message and Discord reopens a public thread automatically when someone posts
// in it again. A thread the card merely lives in is the user's own and is left
// alone.
func (p *Platform) ArchiveTaskThread(ctx context.Context, task *core.Task) error {
	if p.session == nil || p.botID == "" {
		return errors.New("discord session is not ready")
	}
	if task.ThreadID == "" || task.ThreadID == task.ChannelID {
		return nil
	}
	thread, err := p.session.Channel(task.ThreadID, discordgo.WithContext(ctx))
	if err != nil {
		var rest *discordgo.RESTError
		if errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == 404 {
			return nil // the thread is already gone; nothing left to archive
		}
		return fmt.Errorf("discord: read task thread: %w", err)
	}
	if !isThreadChannelType(thread.Type) {
		return fmt.Errorf("discord: task thread %s is not a thread", task.ThreadID)
	}
	if thread.ThreadMetadata != nil && thread.ThreadMetadata.Archived {
		return nil
	}
	archived := true
	if _, err := p.session.ChannelEdit(task.ThreadID, &discordgo.ChannelEdit{Archived: &archived}, discordgo.WithContext(ctx)); err != nil {
		return fmt.Errorf("discord: archive task thread: %w", err)
	}
	return nil
}

// ReopenTaskThread unarchives a task thread so a later key fact (for example
// an acceptance) can be posted instead of being refused with 50083. A thread
// that is gone is treated as already handled here; posting the fact will
// surface the missing destination through the normal unrecoverable path.
func (p *Platform) ReopenTaskThread(ctx context.Context, task *core.Task) error {
	if p.session == nil || p.botID == "" {
		return errors.New("discord session is not ready")
	}
	if task.ThreadID == "" || task.ThreadID == task.ChannelID {
		return nil
	}
	archived := false
	if _, err := p.session.ChannelEdit(task.ThreadID, &discordgo.ChannelEdit{Archived: &archived}, discordgo.WithContext(ctx)); err != nil {
		var rest *discordgo.RESTError
		if errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == 404 {
			return nil
		}
		return fmt.Errorf("discord: reopen task thread: %w", err)
	}
	return nil
}

// TaskThreadLastActivity returns when the thread last saw activity: the newest
// message, or the moment Discord last changed its archive status (a reopen).
// The archive sweep waits from the later of this and the card's UpdatedAt, so
// a reply that reopened a thread is not hidden again by the same sweep.
func (p *Platform) TaskThreadLastActivity(ctx context.Context, task *core.Task) (time.Time, error) {
	if p.session == nil || p.botID == "" {
		return time.Time{}, errors.New("discord session is not ready")
	}
	if task.ThreadID == "" || task.ThreadID == task.ChannelID {
		return time.Time{}, nil
	}
	thread, err := p.session.Channel(task.ThreadID, discordgo.WithContext(ctx))
	if err != nil {
		var rest *discordgo.RESTError
		if errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == 404 {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("discord: read task thread activity: %w", err)
	}
	if !isThreadChannelType(thread.Type) {
		return time.Time{}, fmt.Errorf("discord: task thread %s is not a thread", task.ThreadID)
	}
	if thread.ThreadMetadata != nil && thread.ThreadMetadata.Archived {
		return time.Time{}, nil
	}
	var last time.Time
	if thread.ThreadMetadata != nil && !thread.ThreadMetadata.ArchiveTimestamp.IsZero() {
		last = thread.ThreadMetadata.ArchiveTimestamp
	}
	// Source: one newest message is the smallest read that tells whether a
	// human replied after the card's last progress event.
	messages, err := p.session.ChannelMessages(task.ThreadID, 1, "", "", "", discordgo.WithContext(ctx))
	if err != nil {
		return time.Time{}, fmt.Errorf("discord: read task thread messages: %w", err)
	}
	if len(messages) > 0 && messages[0].Timestamp.After(last) {
		last = messages[0].Timestamp
	}
	return last, nil
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
		err := p.publishTaskFactPart(ctx, task, ev, lang, marker, part)
		if isArchivedThreadError(err) && task.ThreadID != task.ChannelID {
			// Discord auto-archives a thread after its own inactivity window,
			// not only when the bridge sweep archived it. Reopen it and retry
			// this one message so an acceptance is not silently dropped.
			if reopenErr := p.ReopenTaskThread(ctx, task); reopenErr == nil {
				err = p.publishTaskFactPart(ctx, task, ev, lang, marker, part)
			} else {
				slog.Warn("discord: reopen archived task thread failed", "task_id", task.ID, "thread", task.ThreadID, "error", reopenErr)
			}
		}
		if err != nil {
			// Missing access or thread is permanent for this account; core
			// reports it visibly instead of blocking later facts on retries.
			// An unrecoverable refusal (e.g. 50083 archived thread) is also
			// undeliverable for this account: core has the creator post a
			// note instead, and drops the fact only if that fails too.
			err = unrecoverableErr(err)
			var rest *discordgo.RESTError
			if errors.Is(err, core.ErrDeliveryUnrecoverable) || errors.As(err, &rest) && rest.Response != nil && (rest.Response.StatusCode == 403 || rest.Response.StatusCode == 404) {
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
