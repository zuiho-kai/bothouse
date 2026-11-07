package discord

import (
	"log/slog"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork #1197: the 细节 view of a progress card shows every line of the
// turn in full. A Discord embed description holds 4096 characters, so the
// lines are packed into pages; when there is more than one, a second button
// row (◀ n/m ▶) pages through them. The card follows the newest page until
// someone pages back, and follows again once they page forward to the end.

const (
	discordCardKeepAllEntries = 1 << 20 // core keeps this many entries: in effect all of a turn
	discordDetailPageRunes    = 3800    // under the 4096 embed description limit
	cardPageCustomIDPrefix    = "cardpage:"
)

// buildDiscordProgressDetailPages renders the head, then every item in full,
// one per line, packed into pages that each start with the head.
func buildDiscordProgressDetailPages(payload *core.ProgressCardPayload) []string {
	head := buildDiscordProgressBarLine(&core.ProgressCardPayload{
		Lang: payload.Lang, Steps: payload.Steps, ElapsedSec: payload.ElapsedSec,
	}, nil)
	room := discordDetailPageRunes - utf8.RuneCountInString(head) - 1
	var chunks []string
	if payload.Truncated {
		chunks = append(chunks, "ℹ️ "+discordProgressLatestOnlyText(payload.Lang))
	}
	for _, item := range discordProgressItems(payload) {
		line := buildDiscordProgressLineN(item, payload.Lang, 1<<30)
		if line == "" {
			continue
		}
		chunks = append(chunks, splitDiscordRunes(line, room)...)
	}
	var pages []string
	cur := []string{head}
	size := 0
	for _, c := range chunks {
		n := utf8.RuneCountInString(c) + 1
		if size > 0 && size+n > room {
			pages = append(pages, strings.Join(cur, "\n"))
			cur, size = []string{head}, 0
		}
		cur = append(cur, c)
		size += n
	}
	pages = append(pages, strings.Join(cur, "\n"))
	for i, p := range pages {
		if strings.TrimSpace(p) == "" {
			pages[i] = " "
		}
	}
	return pages
}

// splitDiscordRunes cuts s into pieces of at most n runes.
func splitDiscordRunes(s string, n int) []string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return []string{s}
	}
	rs := []rune(s)
	var out []string
	for len(rs) > n {
		out = append(out, string(rs[:n]))
		rs = rs[n:]
	}
	if len(rs) > 0 {
		out = append(out, string(rs))
	}
	return out
}

// clampCardPage maps a requested page (-1 or past the end = newest) into range.
func clampCardPage(page, total int) int {
	if total <= 0 {
		return 0
	}
	if page < 0 || page >= total {
		return total - 1
	}
	return page
}

// draw renders a card in a view on a page; cards without pages have one.
func (r cardRender) draw(v cardView, page int) ([]*discordgo.MessageEmbed, int, int) {
	if r.pages != nil {
		return r.pages(v, page)
	}
	return r.embeds(v), 0, 1
}

// page is the 细节 page a progress card was read back to; -1 = newest.
func (c *cardViews) page(messageID string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if p, ok := c.pages[messageID]; ok {
		return p
	}
	return -1
}

func (c *cardViews) setPage(messageID string, page int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	if page < 0 {
		delete(c.pages, messageID)
		return
	}
	c.pages[messageID] = page
}

// renderOf is the renderer of a message's latest content, from memory or its
// saved source.
func (c *cardViews) renderOf(messageID string) (cardRender, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	if r, ok := c.renders[messageID]; ok {
		return r, true
	}
	if c.store == nil {
		return cardRender{}, false
	}
	src, ok := c.store.load(messageID)
	if !ok {
		return cardRender{}, false
	}
	return src.render()
}

// cardViewComponentsPaged is the view row plus, in 细节 with several pages,
// the ◀ n/m ▶ row.
func cardViewComponentsPaged(mode cardView, lang string, cur, total int) []discordgo.MessageComponent {
	rows := cardViewComponents(mode, lang)
	if mode != cardViewDetail || total <= 1 {
		return rows
	}
	return append(rows, discordgo.ActionsRow{Components: []discordgo.MessageComponent{
		discordgo.Button{Label: "◀", Style: discordgo.SecondaryButton, CustomID: cardPageCustomIDPrefix + "prev", Disabled: cur <= 0},
		discordgo.Button{Label: strconv.Itoa(cur+1) + "/" + strconv.Itoa(total), Style: discordgo.SecondaryButton, CustomID: cardPageCustomIDPrefix + "at", Disabled: true},
		discordgo.Button{Label: "▶", Style: discordgo.SecondaryButton, CustomID: cardPageCustomIDPrefix + "next", Disabled: cur >= total-1},
	}})
}

func parseCardPageCustomID(customID string) (int, bool) {
	v, ok := strings.CutPrefix(customID, cardPageCustomIDPrefix)
	if !ok {
		return 0, false
	}
	switch v {
	case "prev":
		return -1, true
	case "next":
		return 1, true
	}
	return 0, true // the n/m label: no move
}

// handleCardPageInteraction moves a progress card's 细节 view one page.
func (p *Platform) handleCardPageInteraction(s *discordgo.Session, i *discordgo.InteractionCreate, delta int) {
	if i.Message == nil {
		return
	}
	id := i.Message.ID
	render, ok := p.cardViews.renderOf(id)
	if !ok || render.pages == nil {
		_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{Type: discordgo.InteractionResponseDeferredMessageUpdate})
		return
	}
	mode := cardViewDetail
	_, _, total := render.draw(mode, -1)
	cur := clampCardPage(p.cardViews.page(id), total)
	next := clampCardPage(cur+delta, total)
	if cur+delta < 0 {
		next = 0
	}
	if next >= total-1 {
		p.cardViews.setPage(id, -1) // back at the end: follow new lines again
	} else {
		p.cardViews.setPage(id, next)
	}
	embeds, at, n := render.draw(mode, next)
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseUpdateMessage,
		Data: &discordgo.InteractionResponseData{Embeds: embeds, Components: cardViewComponentsPaged(mode, render.lang, at, n)},
	}); err != nil {
		slog.Debug("discord: card page update failed", "error", err)
	}
}
