package feishu

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// Feishu shows the public task card as one interactive card message in the
// session's chat, edited in place (same send/patch path as the turn progress
// card). Facts go into the card's reply thread, like the Discord task thread.
// The pinned team board (BoardPoster) is one card message pinned in the chat.
var (
	_ core.TaskCardPublisher = (*Platform)(nil)
	_ core.BoardPoster       = (*Platform)(nil)
)

// TaskCardDestination is the session's chat ID.
func (p *Platform) TaskCardDestination(sessionKey string) (string, error) {
	rc, err := p.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return "", err
	}
	chat := rc.(replyContext).chatID
	if chat == "" {
		return "", fmt.Errorf("%s: no chat in session key %q", p.tag(), sessionKey)
	}
	return chat, nil
}

// EnsureTaskCard posts the card once, then patches it. The create carries a
// uuid derived from the task ID: Feishu de-duplicates sends with the same uuid,
// so a retry after a lost response returns the same card instead of posting a
// second one. A card deleted by hand is posted again.
func (p *Platform) EnsureTaskCard(ctx context.Context, task *core.Task, lang core.Language) error {
	if task == nil {
		return errors.New("feishu: nil task")
	}
	cardJSON := renderFeishuTaskCard(task, lang)
	uuid := feishuUUID("task", task.ID)
	if task.MessageID != "" {
		err := p.patchCardMessage(ctx, task.MessageID, cardJSON)
		if err == nil || !isFeishuMessageGone(err) {
			return err
		}
		slog.Info("feishu: task card deleted, posting it again", "task_id", task.ID, "chat", task.ChannelID, "message", task.MessageID)
		// A new uuid: the old one would return the deleted message.
		uuid = feishuUUID("task-repost", task.ID, task.MessageID)
		task.MessageID = ""
	}
	id, err := p.createMessageID(ctx, task.ChannelID, "interactive", cardJSON, uuid)
	if err != nil {
		return err
	}
	task.MessageID = id
	return nil
}

// PublishTaskFact replies to the card in its thread, one reply per event. The
// reply carries a uuid from the event, so a retry does not post it twice.
func (p *Platform) PublishTaskFact(ctx context.Context, task *core.Task, ev core.TaskEvent, lang core.Language) error {
	if task == nil || task.MessageID == "" {
		return errors.New("feishu: task card not posted yet")
	}
	text := ev.ThreadText()
	if strings.TrimSpace(text) == "" {
		text = string(ev.State)
	}
	msgType, body := buildReplyContent(text)
	uuid := feishuUUID("fact", task.ID, ev.ID, fmt.Sprint(ev.Seq))
	if err := p.replyInThread(ctx, task.MessageID, msgType, body, uuid); err != nil {
		if isFeishuMessageGone(err) {
			return fmt.Errorf("%w: %w", core.ErrTaskFactUndeliverable, err)
		}
		return err
	}
	return nil
}

// UpsertBoard edits the pinned board card or posts and pins a new one. As on
// Discord, a pin refused after a successful send returns the new ID with the
// error, so the next round edits that card instead of posting another.
func (p *Platform) UpsertBoard(ctx context.Context, sessionKey, messageID, content string) (string, error) {
	chat, err := p.TaskCardDestination(sessionKey)
	if err != nil {
		return "", err
	}
	cardJSON := buildFeishuBoardCard(content)
	if messageID != "" {
		err := p.patchCardMessage(ctx, messageID, cardJSON)
		if err == nil {
			return messageID, nil
		}
		if !isFeishuMessageGone(err) {
			return messageID, fmt.Errorf("feishu: edit board: %w", err)
		}
	}
	id, err := p.createMessageID(ctx, chat, "interactive", cardJSON, "")
	if err != nil {
		return "", fmt.Errorf("feishu: send board: %w", err)
	}
	if err := p.pinMessage(ctx, id); err != nil {
		return id, fmt.Errorf("feishu: pin board: %w", err)
	}
	return id, nil
}

func isFeishuMessageGone(err error) bool {
	if err == nil {
		return false
	}
	// 230011: message withdrawn (same code isMessageWithdrawnCode uses).
	return strings.Contains(err.Error(), "code=230011") || isMessageWithdrawnError(err)
}

// feishuUUID is a stable send de-dup key. SPEC (Feishu send/reply message API):
// uuid is at most 50 characters, so keep "cc-" + 32 hex chars.
func feishuUUID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "cc-" + hex.EncodeToString(sum[:16])
}

// createMessageID sends a message to a chat and returns its message ID.
func (p *Platform) createMessageID(ctx context.Context, chatID, msgType, content, uuid string) (string, error) {
	body := larkim.NewCreateMessageReqBodyBuilder().ReceiveId(chatID).MsgType(msgType).Content(content)
	if uuid != "" {
		body = body.Uuid(uuid)
	}
	req := larkim.NewCreateMessageReqBuilder().ReceiveIdType(larkim.ReceiveIdTypeChatId).Body(body.Build()).Build()
	var id string
	err := p.withTransientRetry(ctx, "create card", func() error {
		return p.withFreshTenantAccessTokenRetry(ctx, "create card", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			resp, err := client.Im.Message.Create(ctx, req, options...)
			if err != nil {
				return fmt.Errorf("%s: create card api call: %w", p.tag(), err)
			}
			if !resp.Success() {
				return fmt.Errorf("%s: create card failed code=%d msg=%s", p.tag(), resp.Code, resp.Msg)
			}
			if resp.Data == nil || resp.Data.MessageId == nil || *resp.Data.MessageId == "" {
				return fmt.Errorf("%s: create card: no message id in response", p.tag())
			}
			id = *resp.Data.MessageId
			return nil
		})
	})
	return id, err
}

func (p *Platform) replyInThread(ctx context.Context, rootID, msgType, content, uuid string) error {
	req := larkim.NewReplyMessageReqBuilder().
		MessageId(rootID).
		Body(larkim.NewReplyMessageReqBodyBuilder().MsgType(msgType).Content(content).ReplyInThread(true).Uuid(uuid).Build()).
		Build()
	return p.withTransientRetry(ctx, "reply task fact", func() error {
		return p.withFreshTenantAccessTokenRetry(ctx, "reply task fact", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			resp, err := client.Im.Message.Reply(ctx, req, options...)
			if err != nil {
				return fmt.Errorf("%s: reply task fact api call: %w", p.tag(), err)
			}
			if !resp.Success() {
				return fmt.Errorf("%s: reply task fact failed code=%d msg=%s", p.tag(), resp.Code, resp.Msg)
			}
			return nil
		})
	})
}

func (p *Platform) pinMessage(ctx context.Context, messageID string) error {
	req := larkim.NewCreatePinReqBuilder().Body(larkim.NewCreatePinReqBodyBuilder().MessageId(messageID).Build()).Build()
	return p.withTransientRetry(ctx, "pin message", func() error {
		return p.withFreshTenantAccessTokenRetry(ctx, "pin message", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			resp, err := client.Im.Pin.Create(ctx, req, options...)
			if err != nil {
				return fmt.Errorf("%s: pin message api call: %w", p.tag(), err)
			}
			if !resp.Success() {
				return fmt.Errorf("%s: pin message failed code=%d msg=%s", p.tag(), resp.Code, resp.Msg)
			}
			return nil
		})
	})
}

// renderFeishuTaskCard draws the task card with the progress-card renderer:
// a title/state row, the latest progress, then one row per member (same rows
// as the cloud_web task card).
func renderFeishuTaskCard(task *core.Task, lang core.Language) string {
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = task.ID
	}
	items := []core.ProgressCardEntry{{Kind: core.ProgressEntryInfo, Text: fmt.Sprintf("📋 %s · %s", title, task.State)}}
	if s := strings.TrimSpace(task.LatestProgress); s != "" {
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: s})
	}
	for _, m := range task.Members {
		line := m.Name
		if m.Title != "" {
			line += "：" + m.Title
		}
		if m.Status != "" {
			line += "（" + m.Status + "）"
		}
		if m.Summary != "" {
			line += " " + m.Summary
		}
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: line})
	}
	payload := &core.ProgressCardPayload{Items: items, Agent: "📋 " + title, Lang: string(lang), State: feishuTaskCardState(task.State)}
	return buildProgressCardJSONFromPayload(payload)
}

func feishuTaskCardState(s core.TaskState) core.ProgressCardState {
	switch s {
	case core.TaskStateCompleted, core.TaskStateResultReady:
		return core.ProgressCardStateCompleted
	case core.TaskStateFailed, core.TaskStateCancelled:
		return core.ProgressCardStateFailed
	}
	return core.ProgressCardStateRunning
}

// buildFeishuBoardCard puts the board's first line in the header and the rest
// in a markdown body, like the Discord board embed.
func buildFeishuBoardCard(content string) string {
	title, body, _ := strings.Cut(content, "\n")
	title = strings.Trim(strings.TrimSpace(title), "*")
	if strings.TrimSpace(body) == "" {
		body = " "
	}
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": title},
			"template": "blue",
		},
		"body": map[string]any{"elements": []map[string]any{{"tag": "markdown", "content": body}}},
	}
	b, _ := json.Marshal(card)
	return string(b)
}
