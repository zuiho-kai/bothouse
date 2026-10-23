package discord

import (
	"log/slog"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"
)

// maomao fork: the 「细节」/「简略」 buttons under a task card and a sub-agent
// table. A press re-renders that one message on the spot; the choice belongs
// to the message only — it is not kept per channel and not persisted.
//
//	细节: name, task, current step, status, elapsed time
//	简略: name, status, elapsed time

type cardView string

const (
	// Default is 细节 so a card looks as it did before the buttons existed
	// (source: review ~/.claude/reviews/card-detail-brief-toggle.md, "默认「细节」可以保留").
	cardViewDetail cardView = "detail"
	cardViewBrief  cardView = "brief"

	cardViewCustomIDPrefix = "cardview:"
)

// cardViews remembers, per Discord message, the chosen view and how to render
// the message's latest content in either view. In memory only.
type cardViews struct {
	mu      sync.Mutex
	modes   map[string]cardView
	renders map[string]cardRender
}

// cardRender renders a message's latest content in either view.
type cardRender struct {
	lang   string
	embeds func(cardView) []*discordgo.MessageEmbed
}

func (c *cardViews) mode(messageID string) cardView {
	c.mu.Lock()
	defer c.mu.Unlock()
	if m, ok := c.modes[messageID]; ok {
		return m
	}
	return cardViewDetail
}

// remember stores the renderer of a message's latest content.
func (c *cardViews) remember(messageID string, render cardRender) {
	if messageID == "" || render.embeds == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.renders == nil {
		c.renders = make(map[string]cardRender)
	}
	c.renders[messageID] = render
}

// set records the view chosen for a message and returns its renderer, if the
// message's content is still known to this process.
func (c *cardViews) set(messageID string, mode cardView) (cardRender, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.modes == nil {
		c.modes = make(map[string]cardView)
	}
	if mode == cardViewDetail {
		delete(c.modes, messageID)
	} else {
		c.modes[messageID] = mode
	}
	r, ok := c.renders[messageID]
	return r, ok
}

func (c *cardViews) forget(messageID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.modes, messageID)
	delete(c.renders, messageID)
}

func parseCardViewCustomID(customID string) (cardView, bool) {
	v, ok := strings.CutPrefix(customID, cardViewCustomIDPrefix)
	if !ok {
		return "", false
	}
	switch cardView(v) {
	case cardViewDetail, cardViewBrief:
		return cardView(v), true
	}
	return "", false
}

// cardViewComponents is the button row; the active view's button is
// highlighted and disabled.
func cardViewComponents(mode cardView, lang string) []discordgo.MessageComponent {
	zh := normalizeDiscordProgressLang(lang) == "zh"
	label := func(v cardView) string {
		switch {
		case v == cardViewDetail && zh:
			return "细节"
		case v == cardViewDetail:
			return "Detail"
		case zh:
			return "简略"
		default:
			return "Brief"
		}
	}
	button := func(v cardView) discordgo.Button {
		style := discordgo.SecondaryButton
		if v == mode {
			style = discordgo.PrimaryButton
		}
		return discordgo.Button{
			Label:    label(v),
			Style:    style,
			CustomID: cardViewCustomIDPrefix + string(v),
			Disabled: v == mode,
		}
	}
	return []discordgo.MessageComponent{discordgo.ActionsRow{Components: []discordgo.MessageComponent{
		button(cardViewDetail), button(cardViewBrief),
	}}}
}

// handleCardViewInteraction switches one message between the two views.
func (p *Platform) handleCardViewInteraction(s *discordgo.Session, i *discordgo.InteractionCreate, mode cardView) {
	if i.Message == nil {
		return
	}
	render, known := p.cardViews.set(i.Message.ID, mode)
	lang := render.lang
	if !known && messageHasChineseCardButtons(i.Message) {
		lang = "zh"
	}
	// Without a known renderer (process restarted since the last edit) only
	// the buttons change now and the current embeds are sent back unchanged
	// (an update without them would clear the card); the next edit of the
	// card uses the chosen view.
	data := &discordgo.InteractionResponseData{Components: cardViewComponents(mode, lang), Embeds: i.Message.Embeds}
	if known {
		data.Embeds = render.embeds(mode)
	}
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseUpdateMessage,
		Data: data,
	}); err != nil {
		slog.Debug("discord: card view update failed", "error", err)
	}
}

func messageHasChineseCardButtons(m *discordgo.Message) bool {
	for _, row := range m.Components {
		r, ok := row.(*discordgo.ActionsRow)
		if !ok {
			continue
		}
		for _, c := range r.Components {
			if b, ok := c.(*discordgo.Button); ok && b.Label == "细节" {
				return true
			}
		}
	}
	return false
}
