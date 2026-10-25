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
			return unrecoverableErr(err)
		}
		slog.Info("feishu: task card deleted, posting it again", "task_id", task.ID, "chat", task.ChannelID, "message", task.MessageID)
		// A new uuid: the old one would return the deleted message. Keep
		// task.MessageID until the create succeeds: a failed repost then retries
		// with this same repost uuid, never the original one.
		uuid = feishuUUID("task-repost", task.ID, task.MessageID)
	}
	id, err := p.createMessageID(ctx, task.ChannelID, "interactive", cardJSON, uuid)
	if err != nil {
		return unrecoverableErr(err)
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
		if isFeishuMessageGone(err) || isFeishuIMPermanent(err) {
			return fmt.Errorf("%w: %w", core.ErrTaskFactUndeliverable, unrecoverableErr(err))
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
			p.repinBoard(ctx, chat, messageID)
			return messageID, nil
		}
		if !isFeishuMessageGone(err) {
			return messageID, fmt.Errorf("feishu: edit board: %w", unrecoverableErr(err))
		}
	}
	id, err := p.createMessageID(ctx, chat, "interactive", cardJSON, "")
	if err != nil {
		return "", fmt.Errorf("feishu: send board: %w", unrecoverableErr(err))
	}
	if err := p.pinMessage(ctx, id); err != nil {
		return id, fmt.Errorf("feishu: pin board: %w", err)
	}
	p.boardPinned.Store(id, struct{}{})
	return id, nil
}

// repinBoard pins an edited board this process has not seen pinned yet (a pin
// refused earlier, e.g. scope granted later, or a board from before a restart),
// like discord/board.go re-pins after an edit. The edit already shows the new
// content, so a pin failure is only logged: returning it would make core retry
// the same edit forever.
func (p *Platform) repinBoard(ctx context.Context, chat, messageID string) {
	if _, ok := p.boardPinned.Load(messageID); ok {
		return
	}
	if err := p.pinMessage(ctx, messageID); err != nil {
		slog.Warn("feishu: board: re-pin after edit failed", "chat", chat, "message", messageID, "error", err)
		return
	}
	p.boardPinned.Store(messageID, struct{}{})
}

// feishuMessageWithdrawnCode: the message was withdrawn/deleted (same code
// isMessageWithdrawnCode uses).
const feishuMessageWithdrawnCode = 230011

// feishuBotNotInChatCode: the bot is not in the chat (removed, or the chat was
// disbanded). SPEC unverified against the Feishu error code list; such
// requests also come back as HTTP 400, which feishuPermanent already covers.
const feishuBotNotInChatCode = 230002

// feishuIMError keeps the Feishu response code and HTTP status of a refused IM
// call, so callers decide by code instead of by error text. The text keeps
// the old "<op> code=N msg=..." shape that existing log/retry checks read.
type feishuIMError struct {
	Tag, Op string
	Status  int
	Code    int
	Msg     string
}

func (e *feishuIMError) Error() string {
	return fmt.Sprintf("%s: %s code=%d msg=%s", e.Tag, e.Op, e.Code, e.Msg)
}

func (p *Platform) imAPIErr(op string, resp *larkcore.ApiResp, code int, msg string) error {
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	return &feishuIMError{Tag: p.tag(), Op: op, Status: status, Code: code, Msg: msg}
}

// isFeishuMessageGone: the card itself was deleted, so it can be posted again.
// Chat-level errors (bot removed, chat gone) are not this: reposting there
// fails too.
func isFeishuMessageGone(err error) bool {
	var e *feishuIMError
	return errors.As(err, &e) && e.Code == feishuMessageWithdrawnCode
}

// isFeishuIMPermanent uses the workspaceErr rule (missing scope, HTTP 4xx other
// than 429) plus the bot-not-in-chat code.
func isFeishuIMPermanent(err error) bool {
	var e *feishuIMError
	return errors.As(err, &e) && (e.Code == feishuBotNotInChatCode || feishuPermanent(e.Status, e.Code))
}

// unrecoverableErr wraps a permanent refusal with core.ErrDeliveryUnrecoverable
// so core stops retrying it (same role as discord/unrecoverable.go).
func unrecoverableErr(err error) error {
	if err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) || !isFeishuIMPermanent(err) {
		return err
	}
	return fmt.Errorf("%w: %w", core.ErrDeliveryUnrecoverable, err)
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
				return p.imAPIErr("create card failed", resp.ApiResp, resp.Code, resp.Msg)
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
				return p.imAPIErr("reply task fact failed", resp.ApiResp, resp.Code, resp.Msg)
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
				return p.imAPIErr("pin message failed", resp.ApiResp, resp.Code, resp.Msg)
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
