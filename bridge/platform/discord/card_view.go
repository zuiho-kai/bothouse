package discord

import (
	"log/slog"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"
)

// maomao fork: one 「细节」/「简略」 button row per turn, on the progress card.
// A press re-renders the progress card and the turn's sub-agent table and
// task card together; those two carry no buttons of their own. The choice
// belongs to the turn (keyed by its progress card); the last choice of a
// channel is kept on disk and starts its next turns (card_view_pref.go).
//
//	progress card 细节: the step lines as before; 简略: head + tool name and result per step
//	sub-agent table / task card: as defined in #114 (subtasks.go, task_card.go)

type cardView string

const (
	// Default is 简略. Source: user 2026-10-23 「严重不符合预期，这些没有说」 —
	// the long progress card had no switch and showed everything; 橘 chose
	// brief as the default (an added setting, listed in the delivery).
	cardViewDefault = cardViewBrief

	cardViewDetail cardView = "detail"
	cardViewBrief  cardView = "brief"

	cardViewCustomIDPrefix = "cardview:"
)

// cardViews keeps, per turn, the chosen view and how to render each of the
// turn's messages in either view. A turn is led by its progress card; the
// sub-agent tables and task cards sent or edited in the same origin channel
// while that card is the newest one join it. In memory only.
type cardViews struct {
	mu       sync.Mutex
	modes    map[string]cardView   // leader (progress card) message ID -> view
	renders  map[string]cardRender // message ID -> renderer of its latest content
	leaderOf map[string]string     // message ID -> its turn's progress card ID
	members  map[string][]cardRef  // leader -> other messages of the turn
	current  map[string]string     // origin channel -> newest progress card ID
	chanOf   map[string]string     // progress card ID -> its channel
	originOf map[string]string     // progress card ID -> its origin channel
	prefs    *cardViewPrefs        // last choice per origin channel; nil = in-memory store
}

type cardRef struct{ channelID, messageID string }

// cardRender renders a message's latest content in either view.
type cardRender struct {
	lang   string
	embeds func(cardView) []*discordgo.MessageEmbed
}

func (c *cardViews) init() {
	if c.modes == nil {
		c.modes = make(map[string]cardView)
		c.renders = make(map[string]cardRender)
		c.leaderOf = make(map[string]string)
		c.members = make(map[string][]cardRef)
		c.current = make(map[string]string)
		c.chanOf = make(map[string]string)
		c.originOf = make(map[string]string)
	}
	if c.prefs == nil {
		c.prefs = &cardViewPrefs{modes: map[string]cardView{}}
	}
}

// startMode is the view a new turn of an origin channel starts in: the
// channel's last choice, else the default.
func (c *cardViews) startMode(origin string) cardView {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	return c.prefs.get(origin)
}

// mode is the view of a message: its turn's choice, else the message's own
// (pressed before a restart), else the default.
func (c *cardViews) mode(messageID string) cardView {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := messageID
	if l, ok := c.leaderOf[messageID]; ok {
		key = l
	}
	if m, ok := c.modes[key]; ok {
		return m
	}
	return cardViewDefault
}

// turnMode is the view of the origin channel's newest turn.
func (c *cardViews) turnMode(origin string) cardView {
	c.mu.Lock()
	defer c.mu.Unlock()
	if l, ok := c.current[origin]; ok {
		if m, ok := c.modes[l]; ok {
			return m
		}
	}
	c.init()
	return c.prefs.get(origin)
}

// lead marks a progress card as the newest turn of an origin channel.
func (c *cardViews) lead(origin, channelID, messageID string) {
	if messageID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	_, known := c.leaderOf[messageID]
	c.leaderOf[messageID] = messageID
	c.chanOf[messageID] = channelID
	if origin != "" {
		// Only the newest turn of a channel is kept: an earlier one is dropped
		// with its tables and task cards (no other bound, so memory does not
		// grow with the number of turns). Its buttons then only update the
		// channel's remembered choice (set).
		if old, ok := c.current[origin]; ok && old != messageID {
			c.dropTurn(old)
		}
		c.current[origin] = messageID
		c.originOf[messageID] = origin
		if _, chosen := c.modes[messageID]; !known && !chosen {
			c.modes[messageID] = c.prefs.get(origin)
		}
	}
}

// join adds a sub-agent table or task card to the origin channel's newest turn.
func (c *cardViews) join(origin, channelID, messageID string) {
	if origin == "" || messageID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	leader, ok := c.current[origin]
	if !ok || leader == messageID {
		return
	}
	if old, ok := c.leaderOf[messageID]; ok {
		if old == leader {
			return
		}
		c.dropMember(old, messageID)
	}
	c.leaderOf[messageID] = leader
	c.members[leader] = append(c.members[leader], cardRef{channelID: channelID, messageID: messageID})
}

func (c *cardViews) dropMember(leader, messageID string) {
	refs := c.members[leader]
	for i, r := range refs {
		if r.messageID == messageID {
			c.members[leader] = append(refs[:i:i], refs[i+1:]...)
			return
		}
	}
}

// remember stores the renderer of a message's latest content.
func (c *cardViews) remember(messageID string, render cardRender) {
	if messageID == "" || render.embeds == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	c.renders[messageID] = render
}

type cardMember struct {
	ref    cardRef
	leader bool // the turn's progress card: keeps the buttons
	render cardRender
}

// set records the view chosen on a message (its whole turn) and returns the
// message's renderer, if still known, and the turn's other messages.
// fallbackOrigin is the origin channel used when the turn is unknown (pressed
// after a restart, or on a dropped earlier turn); then only the channel's
// remembered choice changes.
func (c *cardViews) set(messageID, fallbackOrigin string, mode cardView) (cardRender, bool, []cardMember) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	key := messageID
	l, turnKnown := c.leaderOf[messageID]
	if turnKnown {
		key = l
		c.modes[key] = mode
	}
	origin := c.originOf[key]
	if origin == "" {
		origin = fallbackOrigin
	}
	c.prefs.set(origin, mode)
	if !turnKnown {
		return cardRender{}, false, nil
	}
	r, ok := c.renders[messageID]
	var others []cardMember
	if key != messageID {
		if lr, ok := c.renders[key]; ok {
			others = append(others, cardMember{ref: cardRef{channelID: c.chanOf[key], messageID: key}, render: lr, leader: true})
		}
	}
	for _, ref := range c.members[key] {
		if ref.messageID == messageID {
			continue
		}
		if mr, ok := c.renders[ref.messageID]; ok {
			others = append(others, cardMember{ref: ref, render: mr})
		}
	}
	return r, ok, others
}

// dropTurn removes a turn: its progress card and every table and task card
// filed under it. Caller holds mu.
func (c *cardViews) dropTurn(leader string) {
	for _, r := range c.members[leader] {
		if c.leaderOf[r.messageID] == leader {
			delete(c.leaderOf, r.messageID)
			delete(c.renders, r.messageID)
			delete(c.modes, r.messageID)
		}
	}
	delete(c.members, leader)
	delete(c.modes, leader)
	delete(c.renders, leader)
	delete(c.leaderOf, leader)
	delete(c.chanOf, leader)
	delete(c.originOf, leader)
	for origin, l := range c.current {
		if l == leader {
			delete(c.current, origin)
		}
	}
}

func (c *cardViews) forget(messageID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	if l, ok := c.leaderOf[messageID]; ok && l != messageID {
		c.dropMember(l, messageID)
	}
	delete(c.modes, messageID)
	delete(c.renders, messageID)
	delete(c.leaderOf, messageID)
	delete(c.chanOf, messageID)
	delete(c.originOf, messageID)
	if refs, ok := c.members[messageID]; ok {
		for _, r := range refs {
			delete(c.leaderOf, r.messageID)
		}
		delete(c.members, messageID)
	}
	for origin, l := range c.current {
		if l == messageID {
			delete(c.current, origin)
		}
	}
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

// handleCardViewInteraction switches the pressed card and the rest of its
// turn between the two views.
func (p *Platform) handleCardViewInteraction(s *discordgo.Session, i *discordgo.InteractionCreate, mode cardView) {
	if i.Message == nil {
		return
	}
	render, known, others := p.cardViews.set(i.Message.ID, p.originChannelFor(i.Message.ChannelID), mode)
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
	for _, m := range others {
		channelID := m.ref.channelID
		if channelID == "" {
			channelID = i.Message.ChannelID
		}
		embeds := m.render.embeds(mode)
		edit := &discordgo.MessageEdit{ID: m.ref.messageID, Channel: channelID, Embeds: &embeds}
		if m.leader { // the turn's progress card keeps the buttons
			components := cardViewComponents(mode, m.render.lang)
			edit.Components = &components
		} else { // tables and task cards carry none
			empty := []discordgo.MessageComponent{}
			edit.Components = &empty
		}
		if _, err := s.ChannelMessageEditComplex(edit); err != nil {
			slog.Debug("discord: card view member update failed", "message", m.ref.messageID, "error", err)
		}
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
