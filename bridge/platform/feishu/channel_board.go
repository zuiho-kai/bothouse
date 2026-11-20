package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// maomao fork: the channel task board ("频道任务看板") on Feishu/Lark — one
// pinned card per chat, posted and edited by the project with
// channel_board = true. See core/channel_board.go; same shape as
// platform/discord/channel_board.go.
//
// A board whose stored ID was lost is found again by channelBoardMarker in the
// card (a grey line at the bottom, like the Discord embed footer), among the
// chat's pinned messages first, then its latest messages.

// channelBoardMarker marks this bot's board card.
const channelBoardMarker = "cc-board"

// Card body and line caps, so the board is the same length on both platforms.
const (
	// 沿用 platform/discord/progress.go maxDiscordProgressDescLen (the Discord board's body cap).
	channelBoardMaxRunes = 3500
	// 沿用 platform/discord/progress.go maxDiscordProgressLineLen (one short line per step).
	channelBoardLineRunes = 80
	// SPEC 「获取群内 Pin 消息」page_size 最大 50: one page, as Discord reads one pin list.
	channelBoardPinPage = 50
)

var _ core.ChannelBoardPoster = (*Platform)(nil)

func channelBoardCard(content string) (string, error) {
	payload, ok := core.ParseChannelBoardPayload(content)
	if !ok {
		return "", fmt.Errorf("feishu: not a channel board payload")
	}
	return buildFeishuChannelBoardCard(payload, time.Local), nil
}

// PostChannelBoard implements core.ChannelBoardPoster.
func (p *Platform) PostChannelBoard(ctx context.Context, channelID, content string) (string, error) {
	card, err := channelBoardCard(content)
	if err != nil {
		return "", err
	}
	id, err := p.createMessageID(ctx, channelID, "interactive", card, "")
	if err != nil {
		return "", fmt.Errorf("feishu: post channel board: %w", unrecoverableErr(err))
	}
	return id, nil
}

// EditChannelBoard implements core.ChannelBoardPoster. A recalled card, or one
// past the 14-day edit window, is reported as core.ErrChannelBoardGone so a
// new one is posted.
func (p *Platform) EditChannelBoard(ctx context.Context, _ string, messageID, content string) error {
	card, err := channelBoardCard(content)
	if err != nil {
		return err
	}
	if err := p.patchCardMessage(ctx, messageID, card); err != nil {
		if isFeishuMessageGone(err) || isFeishuMessageDeleted(err) {
			return fmt.Errorf("%w: %v", core.ErrChannelBoardGone, err)
		}
		return fmt.Errorf("feishu: edit channel board: %w", unrecoverableErr(err))
	}
	return nil
}

// PinChannelBoard implements core.ChannelBoardPoster (needs the pin scope, and
// the group must let members pin).
func (p *Platform) PinChannelBoard(ctx context.Context, _ string, messageID string) error {
	if err := p.pinMessage(ctx, messageID); err != nil {
		return fmt.Errorf("feishu: pin channel board: %w", err)
	}
	return nil
}

// FindChannelBoard implements core.ChannelBoardPoster: this bot's card with the
// board marker among the chat's pins, then the latest page of the chat.
func (p *Platform) FindChannelBoard(ctx context.Context, channelID string) (string, bool, error) {
	// A failed pin list is not fatal: the latest messages are still looked at.
	if pins, err := p.listPins(ctx, channelID); err == nil {
		for _, id := range pins {
			page, err := p.historyGet(ctx, "read pinned message", "/open-apis/im/v1/messages/"+url.PathEscape(id)+"?card_msg_content_type=user_card_content")
			if err != nil {
				continue
			}
			for _, m := range page.Data.Items {
				if p.isOwnBoard(m) {
					return stringValue(m.MessageId), true, nil
				}
			}
		}
	}
	q := url.Values{}
	q.Set("container_id_type", "chat")
	q.Set("container_id", channelID)
	q.Set("sort_type", "ByCreateTimeDesc")
	q.Set("page_size", strconv.Itoa(historyPageSize))
	q.Set("card_msg_content_type", "user_card_content")
	page, err := p.historyGet(ctx, "find channel board", "/open-apis/im/v1/messages?"+q.Encode())
	if err != nil {
		return "", false, fmt.Errorf("feishu: list messages: %w", unrecoverableErr(err))
	}
	for _, m := range page.Data.Items {
		if p.isOwnBoard(m) {
			return stringValue(m.MessageId), false, nil
		}
	}
	return "", false, nil
}

// listPins returns the message IDs pinned in chat (one page).
func (p *Platform) listPins(ctx context.Context, chatID string) ([]string, error) {
	req := larkim.NewListPinReqBuilder().ChatId(chatID).PageSize(channelBoardPinPage).Build()
	var ids []string
	err := p.withFreshTenantAccessTokenRetry(ctx, "list pins", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		ids = nil
		resp, err := client.Im.Pin.List(ctx, req, options...)
		if err != nil {
			return fmt.Errorf("%s: list pins api call: %w", p.tag(), err)
		}
		if !resp.Success() {
			return p.imAPIErr("list pins failed", resp.ApiResp, resp.Code, resp.Msg)
		}
		if resp.Data != nil {
			for _, pin := range resp.Data.Items {
				if id := stringValue(pin.MessageId); id != "" {
					ids = append(ids, id)
				}
			}
		}
		return nil
	})
	return ids, err
}

// isOwnBoard: a card this app sent that carries the board marker.
func (p *Platform) isOwnBoard(m *larkim.Message) bool {
	if m == nil || stringValue(m.MsgType) != "interactive" || m.Deleted != nil && *m.Deleted {
		return false
	}
	if m.Sender == nil || stringValue(m.Sender.SenderType) != "app" || stringValue(m.Sender.Id) != p.appID {
		return false
	}
	return m.Body != nil && strings.Contains(stringValue(m.Body.Content), channelBoardMarker)
}

// buildFeishuChannelBoardCard renders the board as a card (times in loc):
//
//	在做的
//	🔄 橘 · <在做什么> · 15:04 开始
//	　└ 🔧 Bash · go test ./core/
//	　🔄 <子 agent 描述> · <当前那一步>
//	排着队的
//	💬 龙娘 · <排队的消息>
//	⏰ 橘 · <定时任务描述> · 18:00
//	今天做完的
//	✅ 鲸鱼娘 · <做了什么> · 14:20
//	cc-board
func buildFeishuChannelBoardCard(b *core.ChannelBoardPayload, loc *time.Location) string {
	zh := isZhLikeProgressLang(b.Lang)
	t := func(zhText, en string) string {
		if zh {
			return zhText
		}
		return en
	}
	clock := func(at time.Time) string { return at.In(loc).Format("15:04") }

	var lines []string
	section := func(title string, rows []string) {
		lines = append(lines, "**"+title+"**")
		if len(rows) == 0 {
			rows = []string{t("（无）", "(none)")}
		}
		lines = append(lines, rows...)
	}

	var running []string
	for _, r := range b.Running {
		head := "🔄 " + boardEscape(r.Bot)
		if r.Desc != "" {
			head += " · " + boardShort(r.Desc)
		} else if r.StartedAt.IsZero() {
			head += " · " + t("后台子 agent", "background sub-agents")
		}
		if !r.StartedAt.IsZero() {
			head += " · " + fmt.Sprintf(t("%s 开始", "started %s"), clock(r.StartedAt))
		}
		running = append(running, head)
		if r.Step != nil {
			if line := boardStepLine(*r.Step); line != "" {
				running = append(running, "　└ "+line)
			}
		}
		for _, s := range r.Subs {
			row := "　🔄 " + boardShort(boardFirstNonEmpty(s.Description, s.Name, s.ID))
			if s.Step != "" {
				row += " · " + boardShort(s.Step)
			}
			running = append(running, row)
		}
	}
	section(t("在做的", "In progress"), running)

	var queued []string
	for _, q := range b.Queued {
		icon := "💬"
		if q.Kind == "cron" || q.Kind == "timer" {
			icon = "⏰"
		}
		row := icon + " " + boardEscape(q.Bot)
		if q.Desc != "" {
			row += " · " + boardShort(q.Desc)
		}
		if !q.At.IsZero() {
			row += " · " + clock(q.At)
		}
		queued = append(queued, row)
	}
	section(t("排着队的", "Queued"), queued)

	var done []string
	for _, d := range b.Done {
		icon := "✅"
		switch d.Outcome {
		case core.BoardDoneFailed:
			icon = "❌"
		case core.BoardDoneStopped:
			icon = "⏹️"
		}
		row := icon + " " + boardEscape(d.Bot)
		if d.Desc != "" {
			row += " · " + boardShort(d.Desc)
		}
		row += " · " + clock(d.EndedAt)
		done = append(done, row)
	}
	section(t("今天做完的", "Done today"), done)

	body := strings.Join(lines, "\n")
	if r := []rune(body); len(r) > channelBoardMaxRunes {
		body = string(r[:channelBoardMaxRunes-1]) + "…"
	}
	// Same colors as Discord: blue while working, green when idle.
	template := "green"
	if len(b.Running) > 0 {
		template = "blue"
	}
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{"wide_screen_mode": true, "update_multi": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": t("频道任务看板", "Channel tasks")},
			"template": template,
		},
		"body": map[string]any{"elements": []map[string]any{
			{"tag": "markdown", "content": body},
			{"tag": "markdown", "content": "<font color='grey'>" + channelBoardMarker + "</font>", "text_size": "notation"},
		}},
	}
	out, _ := json.Marshal(card)
	return string(out)
}

// boardStepLine is the progress card's newest item in one line.
func boardStepLine(e core.ProgressCardEntry) string {
	text := boardShort(e.Text)
	switch e.Kind {
	case core.ProgressEntryThinking:
		return "💭 " + text
	case core.ProgressEntryToolUse, core.ProgressEntryToolResult:
		tool := strings.TrimSpace(e.Tool)
		if tool == "" {
			tool = "Tool"
		}
		if text == "" {
			return "🔧 " + boardEscape(tool)
		}
		return "🔧 " + boardEscape(tool) + " · " + text
	case core.ProgressEntryError:
		return "⚠️ " + text
	default:
		return text
	}
}

// boardShort is s on one line, at most channelBoardLineRunes runes, escaped.
func boardShort(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > channelBoardLineRunes {
		s = string(r[:channelBoardLineRunes-1]) + "…"
	}
	return boardEscape(s)
}

// boardEscaper keeps user text from turning into card markdown (bold, links,
// <at> tags that would notify someone).
var boardEscaper = strings.NewReplacer("*", "\\*", "_", "\\_", "~", "\\~", "`", "\\`", "[", "\\[", "]", "\\]", "<", "&lt;", ">", "&gt;")

func boardEscape(s string) string { return boardEscaper.Replace(s) }

func boardFirstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
