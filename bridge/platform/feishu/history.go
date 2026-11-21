package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// maomao fork: channel history on Feishu, the Feishu side of Discord's ChannelHistory
// (platform/discord/discord.go) and turn_sent.go. Core reads it for channel backfill, the
// history API and the team watches (core/backfill.go, core/api_history.go).
//
// History comes from「获取会话历史消息」, GET /open-apis/im/v1/messages with
// container_id_type=chat (https://open.feishu.cn/document/server-docs/im-v1/message/list):
// the bot must be in the chat, and reading a group needs the im:message.group_msg scope. In a
// normal group a topic shows only its root message.
//
// Feishu's om_ message IDs do not sort by time, so this platform orders messages by their
// create_time (core.MessageOrderer) and turns "before message X" into end_time.

var (
	_ core.ChannelHistoryReader    = (*Platform)(nil)
	_ core.MessageOrderer          = (*Platform)(nil)
	_ core.AgentReplyMarker        = (*Platform)(nil)
	_ core.SessionAgentReplyMarker = (*Platform)(nil)
)

// SPEC: page_size of「获取会话历史消息」is 1～50 (the document linked above).
const historyPageSize = 50

// historyTimeout: same as Discord's and cloud-web's history read (cloud-web/history.go historyTimeout).
const historyTimeout = 20 * time.Second

// 沿用已有配置: Discord remembers this many agent posts per channel (turn_sent.go turnSentPerChannel).
const turnSentPerChat = 500

// turnSentLog records which of this bot's posts carry the agent's own text: channel backfill
// skips exactly those and shows every other post under this bot's name (cron --exec output,
// notices, command replies). Kept on disk so a restart does not hand the last turn's replies
// back. Same file shape as Discord's turnSentLog (platform/discord/turn_sent.go).
type turnSentLog struct {
	mu    sync.Mutex
	path  string
	ids   map[string]struct{}
	order map[string][]string // per chat, oldest first, for eviction
}

// loadTurnSent reads this project's agent-post log from the bridge's data dir (the options
// cmd/cc-connect gives every platform, as Discord's turn-sent log uses them).
func (p *Platform) loadTurnSent(opts map[string]any) {
	if dir, _ := opts["cc_data_dir"].(string); dir != "" {
		project, _ := opts["cc_project"].(string)
		p.turnSent.load(filepath.Join(dir, p.platformName+"_turn_sent_"+project+".json"))
	}
}

func (l *turnSentLog) load(path string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.path = path
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var order map[string][]string
	if err := json.Unmarshal(raw, &order); err != nil {
		slog.Warn("feishu: turn-sent log unreadable", "path", path, "error", err)
		return
	}
	l.order = order
	l.ids = map[string]struct{}{}
	for _, ids := range order {
		for _, id := range ids {
			l.ids[id] = struct{}{}
		}
	}
}

func (l *turnSentLog) add(chatID, id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.ids == nil {
		l.ids = map[string]struct{}{}
		l.order = map[string][]string{}
	}
	if _, ok := l.ids[id]; ok {
		return
	}
	l.ids[id] = struct{}{}
	o := append(l.order[chatID], id)
	if len(o) > turnSentPerChat {
		delete(l.ids, o[0])
		o = o[1:]
	}
	l.order[chatID] = o
	if l.path == "" {
		return
	}
	raw, _ := json.Marshal(l.order)
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err == nil {
		if err := os.Rename(tmp, l.path); err != nil {
			slog.Warn("feishu: save turn-sent log", "error", err)
		}
	}
}

func (l *turnSentLog) has(id string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, ok := l.ids[id]
	return ok
}

// MarkAgentReply implements core.AgentReplyMarker.
func (p *Platform) MarkAgentReply(replyCtx any) any {
	if rc, ok := replyCtx.(replyContext); ok {
		rc.agent = true
		return rc
	}
	return replyCtx
}

// MarkSessionAgentReply implements core.SessionAgentReplyMarker: record gets the id of every
// agent post sent with the returned context.
func (p *Platform) MarkSessionAgentReply(replyCtx any, record func(string)) any {
	if rc, ok := replyCtx.(replyContext); ok {
		rc.recordAgentReply = record
		return rc
	}
	return replyCtx
}

// sentRecorder is what a send with rc calls with the new message's id: core's
// SentMessageRecorder, and the agent-post log when rc carries agent output.
func (p *Platform) sentRecorder(rc replyContext) func(string) {
	if !rc.agent {
		return rc.recordSent
	}
	return func(id string) {
		if rc.recordSent != nil {
			rc.recordSent(id)
		}
		p.noteAgentReply(rc, id)
	}
}

// noteAgentReply records message id as agent output when rc is marked (MarkAgentReply).
func (p *Platform) noteAgentReply(rc replyContext, id string) {
	if !rc.agent || id == "" {
		return
	}
	p.turnSent.add(rc.chatID, id)
	if rc.recordAgentReply != nil {
		rc.recordAgentReply(id)
	}
}

// msgTimes remembers the create_time (ms) of the messages this process has seen, for
// MessageAfter and for "before message X".
type msgTimes struct {
	mu sync.Mutex
	ms map[string]int64
}

func (c *msgTimes) put(id string, ms int64) {
	if id == "" || ms <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ms == nil {
		c.ms = map[string]int64{}
	}
	c.ms[id] = ms
}

func (c *msgTimes) get(id string) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ms[id]
}

// historyPage is the body of「获取会话历史消息」and of「获取指定消息的内容」.
type historyPage struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		HasMore   bool              `json:"has_more"`
		PageToken string            `json:"page_token"`
		Items     []*larkim.Message `json:"items"`
	} `json:"data"`
}

// historyGet runs one GET of the messages API and decodes its page.
func (p *Platform) historyGet(ctx context.Context, op, apiPath string) (*historyPage, error) {
	var page historyPage
	err := p.withFreshTenantAccessTokenRetry(ctx, op, func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		page = historyPage{}
		resp, err := client.Get(ctx, apiPath, nil, larkcore.AccessTokenTypeTenant, options...)
		if err != nil {
			return fmt.Errorf("%s: %s: %w", p.tag(), op, err)
		}
		if err := json.Unmarshal(resp.RawBody, &page); err != nil {
			return fmt.Errorf("%s: %s: HTTP %d: %w", p.tag(), op, resp.StatusCode, err)
		}
		if page.Code != 0 {
			return p.imAPIErr(op, resp, page.Code, page.Msg)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &page, nil
}

// messageTime is the create_time (ms) of message id, 0 when it cannot be read.
func (p *Platform) messageTime(ctx context.Context, id string) int64 {
	if id == "" {
		return 0
	}
	if ms := p.msgTimes.get(id); ms > 0 {
		return ms
	}
	page, err := p.historyGet(ctx, "message time", "/open-apis/im/v1/messages/"+url.PathEscape(id))
	if err != nil {
		slog.Debug(p.tag()+": message time lookup failed", "message_id", id, "error", err)
		return 0
	}
	for _, m := range page.Data.Items {
		if ms, _ := strconv.ParseInt(stringValue(m.CreateTime), 10, 64); ms > 0 {
			p.msgTimes.put(id, ms)
			return ms
		}
	}
	return 0
}

// MessageAfter implements core.MessageOrderer: whether message a was created after b. A message
// whose time cannot be read counts as the oldest.
func (p *Platform) MessageAfter(a, b string) bool {
	if a == b {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), historyTimeout)
	defer cancel()
	return p.messageTime(ctx, a) > p.messageTime(ctx, b)
}

// ChannelHistory implements core.ChannelHistoryReader: up to limit messages of chat channelID
// posted before message beforeID ("" = up to the newest), oldest first. It reads newest first
// and pages until it has limit messages or the chat has no more.
func (p *Platform) ChannelHistory(channelID, beforeID string, limit int) ([]core.ChannelHistoryMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), historyTimeout)
	defer cancel()
	var beforeMs int64
	if beforeID != "" {
		if beforeMs = p.messageTime(ctx, beforeID); beforeMs == 0 {
			return nil, fmt.Errorf("%s: channel history: cannot read the time of message %s", p.tag(), beforeID)
		}
	}
	var out []core.ChannelHistoryMessage // newest first while reading
	pageToken := ""
	for len(out) < limit {
		q := url.Values{}
		q.Set("container_id_type", "chat")
		q.Set("container_id", channelID)
		q.Set("sort_type", "ByCreateTimeDesc")
		q.Set("page_size", strconv.Itoa(min(limit-len(out), historyPageSize)))
		q.Set("card_msg_content_type", "user_card_content") // cards as the JSON they were sent with
		if beforeMs > 0 {
			// end_time is in seconds: ask one second past beforeID and drop by create_time below.
			q.Set("end_time", strconv.FormatInt(beforeMs/1000+1, 10))
		}
		if pageToken != "" {
			q.Set("page_token", pageToken)
		}
		page, err := p.historyGet(ctx, "channel history", "/open-apis/im/v1/messages?"+q.Encode())
		if err != nil {
			return nil, err
		}
		for _, item := range page.Data.Items {
			if len(out) == limit {
				break
			}
			ms, _ := strconv.ParseInt(stringValue(item.CreateTime), 10, 64)
			p.msgTimes.put(stringValue(item.MessageId), ms)
			if beforeMs > 0 && (ms >= beforeMs || stringValue(item.MessageId) == beforeID) {
				continue
			}
			if m, ok := p.historyMessage(item, ms); ok {
				out = append(out, m)
			}
		}
		pageToken = page.Data.PageToken
		if !page.Data.HasMore || pageToken == "" {
			break
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// historyMessage turns one item of the history API into core's form; ok=false for what is not a
// chat message (recalled posts, system notices, cards without text).
func (p *Platform) historyMessage(item *larkim.Message, ms int64) (core.ChannelHistoryMessage, bool) {
	id, msgType := stringValue(item.MessageId), stringValue(item.MsgType)
	if id == "" || msgType == "system" || item.Deleted != nil && *item.Deleted {
		return core.ChannelHistoryMessage{}, false
	}
	content := ""
	if item.Body != nil {
		content = stringValue(item.Body.Content)
	}
	var text string
	switch msgType {
	case "text":
		var body struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal([]byte(content), &body)
		text = body.Text
	case "post":
		text = postText(content)
	case "interactive":
		if text = extractInteractiveCardText(content); text == "" {
			return core.ChannelHistoryMessage{}, false // like Discord's embeds-only posts
		}
	default:
		// image, file, audio, media, sticker, share_chat...: Feishu serves their bytes only
		// through the authenticated resource API, so history names the kind and carries none.
		text = "[" + msgType + "]"
	}
	m := core.ChannelHistoryMessage{
		ID:       id,
		Content:  replaceMentions(text, item.Mentions),
		Time:     time.UnixMilli(ms),
		FromTurn: p.turnSent.has(id),
	}
	for _, mention := range item.Mentions {
		if mid := stringValue(mention.Id); mid != "" {
			m.MentionIDs = append(m.MentionIDs, mid)
		}
	}
	if s := item.Sender; s != nil {
		m.AuthorID = stringValue(s.Id)
		switch stringValue(s.SenderType) {
		case "app": // sender.id is the app_id
			m.IsBot, m.IsSelf = true, m.AuthorID == p.appID
			m.Author = p.resolveBotSenderName(m.AuthorID)
		case "user":
			m.Author = p.resolveUserName(m.AuthorID)
		}
	}
	if m.Author == "" {
		m.Author = "unknown"
	}
	return m, true
}

// postText is the plain text of a rich-text (post) message body, images named, not downloaded.
func postText(raw string) string {
	var post postLang
	if err := json.Unmarshal([]byte(raw), &post); err != nil || post.Content == nil {
		var byLang map[string]postLang
		if json.Unmarshal([]byte(raw), &byLang) != nil {
			return ""
		}
		for _, l := range byLang {
			post = l
			break
		}
	}
	var lines []string
	if post.Title != "" {
		lines = append(lines, post.Title)
	}
	for _, line := range post.Content {
		var sb strings.Builder
		for _, e := range line {
			switch e.Tag {
			case "a":
				if e.Href != "" {
					sb.WriteString("[" + e.Text + "](" + e.Href + ")")
				} else {
					sb.WriteString(e.Text)
				}
			case "at":
				if e.UserName != "" {
					sb.WriteString("@" + e.UserName)
				} else {
					sb.WriteString(e.UserId) // the "@_user_N" key: replaceMentions names it
				}
			case "img":
				sb.WriteString("[image]")
			default:
				sb.WriteString(e.Text)
			}
		}
		lines = append(lines, sb.String())
	}
	return strings.Join(lines, "\n")
}
