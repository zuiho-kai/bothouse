package cloudweb

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: channel backfill on the role-household hub, the cloud_web side of Discord's
// ChannelHistory (platform/discord/discord.go). Without it core falls back to the gate's
// in-memory buffer, so what was said in a room while this bot was offline or restarting never
// reached it (2026-10-20 gap list, user: 「你先看看距离discord差异有什么」).
//
// History is read over HTTP from the hub's existing page API,
// GET /api/rooms/{room}/messages?before=<id>&limit=<n> (oldest first), with the bot token.
// Not over the websocket: inbound messages are handled on the read loop (handleWire), and the
// backfill runs inside that handling (core/gate.go), so a websocket request would wait on itself.
//
// IDs: the hub sends msg_id "hub-<id>" (rh/cloudweb.py on_new), so history uses the same form
// and core's snowflakeAfter (longer, then larger) orders them like the hub's integer ids.

var (
	_ core.ChannelHistoryReader = (*Platform)(nil)
	_ core.AgentReplyMarker     = (*Platform)(nil)
)

// historyTimeout: same as Discord's history read, discordgo's default http.Client Timeout (20 s,
// bwmarrin/discordgo discord.go New).
const historyTimeout = 20 * time.Second

var historyClient = &http.Client{Timeout: historyTimeout}

const hubIDPrefix = "hub-"

type hubMessage struct {
	ID         int64   `json:"id"`
	AuthorKind string  `json:"author_kind"` // user / role / system
	Author     string  `json:"author"`
	Name       string  `json:"name"`
	Text       string  `json:"text"`
	CreatedAt  float64 `json:"created_at"` // unix seconds
	Card       *string `json:"card"`
	FromTurn   *int    `json:"from_turn"`
}

// historyBaseURL is the hub's http(s) origin: base_url when set, else the ws_url's host.
func historyBaseURL(baseURL, wsURL string) string {
	if b := strings.TrimRight(strings.TrimSpace(baseURL), "/"); b != "" {
		return b
	}
	u, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil || u.Host == "" {
		return ""
	}
	switch u.Scheme {
	case "wss":
		return "https://" + u.Host
	case "ws":
		return "http://" + u.Host
	}
	return ""
}

// hubBotID is this bot's id on the hub, picked the way the hub picks it (rh/cloudweb.py handle):
// ?bot= in the ws_url, else the register frame's project.
func hubBotID(wsURL, project string) string {
	if u, err := url.Parse(strings.TrimSpace(wsURL)); err == nil {
		if b := strings.TrimSpace(u.Query().Get("bot")); b != "" {
			return b
		}
	}
	return project
}

// ChannelHistory implements core.ChannelHistoryReader: up to limit messages of room channelID
// ("room-<id>") posted before beforeID ("hub-<id>", "" = up to the newest), oldest first.
func (p *Platform) ChannelHistory(channelID, beforeID string, limit int) ([]core.ChannelHistoryMessage, error) {
	if p.historyBase == "" {
		return nil, fmt.Errorf("cloud_web: channel history: no hub http address")
	}
	room, ok := strings.CutPrefix(channelID, "room-")
	if !ok || !allDigits(room) {
		return nil, fmt.Errorf("cloud_web: channel history: channel %q is not a hub room", channelID)
	}
	q := url.Values{}
	if beforeID != "" {
		n, ok := strings.CutPrefix(beforeID, hubIDPrefix)
		if !ok || !allDigits(n) {
			return nil, fmt.Errorf("cloud_web: channel history: message id %q is not a hub id", beforeID)
		}
		q.Set("before", n)
	}
	q.Set("limit", strconv.Itoa(limit))
	ctx, cancel := context.WithTimeout(context.Background(), historyTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.historyBase+"/api/rooms/"+room+"/messages?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("cloud_web: channel history: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	resp, err := historyClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloud_web: channel history: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return nil, fmt.Errorf("cloud_web: channel history: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var page struct {
		Messages []hubMessage `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, fmt.Errorf("cloud_web: channel history: %w", err)
	}
	out := make([]core.ChannelHistoryMessage, 0, len(page.Messages))
	for _, m := range page.Messages {
		if m.AuthorKind == "system" || m.Card != nil {
			// system notices are not sent to bots live either (rh/cloudweb.py on_new); progress cards
			// are left out like Discord's embeds-only posts (discord.go ChannelHistory)
			continue
		}
		self := m.AuthorKind == "role" && m.Author == p.selfID
		sec, frac := math.Modf(m.CreatedAt)
		out = append(out, core.ChannelHistoryMessage{
			ID: hubIDPrefix + strconv.FormatInt(m.ID, 10), Author: firstNonEmpty(m.Name, m.Author),
			IsBot: m.AuthorKind == "role", IsSelf: self,
			FromTurn: self && m.FromTurn != nil && *m.FromTurn == 1,
			Content:  m.Text, Time: time.Unix(int64(sec), int64(math.Round(frac*1e9))),
		})
	}
	return out, nil
}

// MarkAgentReply implements core.AgentReplyMarker: the reply frame carries "agent": true, the hub
// stores it (from_turn), and backfill skips exactly those of this bot's posts (Discord turn_sent.go).
func (p *Platform) MarkAgentReply(replyCtx any) any {
	if rc, err := parseReplyCtx(replyCtx); err == nil {
		rc.Agent = true
		return rc
	}
	return replyCtx
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
