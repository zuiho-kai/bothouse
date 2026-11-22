package feishu

// Cron and timer runs with thread_isolation on: each run gets a topic of its own, the Feishu
// counterpart of Discord's fresh thread per run (core.CronReplyTargetResolver).

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.CronReplyTargetResolver = (*Platform)(nil)

// ResolveCronReplyTarget posts the run title as a new message in the job's group and returns the
// topic session of that message, so the run answers inside the topic and a user who replies there
// continues the same session (makeSessionKey gives inbound topic messages the same key). A job
// made inside a topic gets its new topic in the group, not nested in the old one.
//
// thread_isolation off, or a private chat (makeSessionKey never isolates those): ErrNotSupported,
// and core replies in the job's own session.
func (p *Platform) ResolveCronReplyTarget(sessionKey string, title string) (string, any, error) {
	if !p.threadIsolation {
		return "", nil, core.ErrNotSupported
	}
	parts := strings.SplitN(sessionKey, ":", 3)
	if len(parts) < 2 || parts[0] != p.platformName || parts[1] == "" {
		return "", nil, fmt.Errorf("%s: invalid session key %q", p.tag(), sessionKey)
	}
	chatID := parts[1]
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var mode string
	err := p.withFreshTenantAccessTokenRetry(ctx, "cron get chat", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		resp, err := client.Im.Chat.Get(ctx, larkim.NewGetChatReqBuilder().ChatId(chatID).Build(), options...)
		if err != nil {
			return fmt.Errorf("%s: cron get chat %s: %w", p.tag(), chatID, err)
		}
		if !resp.Success() {
			return fmt.Errorf("%s: cron get chat %s: code=%d msg=%s", p.tag(), chatID, resp.Code, resp.Msg)
		}
		if resp.Data != nil {
			mode = stringValue(resp.Data.ChatMode)
		}
		return nil
	})
	if err != nil {
		return "", nil, err
	}
	if mode == "p2p" {
		return "", nil, core.ErrNotSupported
	}

	text := strings.Join(strings.Fields(title), " ")
	if text == "" {
		text = "cron"
	}
	body, _ := json.Marshal(map[string]string{"text": text})
	// The uuid only de-duplicates retries of this one call; every run posts its own message.
	uuid := feishuUUID("cron-topic", sessionKey, strconv.FormatInt(time.Now().UnixNano(), 10))
	rootID, err := p.createMessageID(ctx, chatID, larkim.MsgTypeText, string(body), uuid)
	if err != nil {
		return "", nil, fmt.Errorf("%s: start cron topic in chat %s: %w", p.tag(), chatID, err)
	}
	key := fmt.Sprintf("%s:%s:root:%s", p.tag(), chatID, rootID)
	return key, replyContext{chatID: chatID, messageID: rootID, sessionKey: key}, nil
}
