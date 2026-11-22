package feishu

// `bothouse send --channel <name>` (core/send_channel.go) on Feishu. Feishu has no server that
// groups channels, so the name is looked up among every group the bot is in.

import (
	"context"
	"fmt"
	"strings"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.GuildChannelLister = (*Platform)(nil)
var _ core.ChannelNameResolver = (*Platform)(nil)

// GuildMessageChannels returns every named group the bot is in (no categories on Feishu; a group
// without a name cannot be asked for by name). The chat the caller is in does not narrow the
// list: it may be a private chat, and groups have no parent.
func (p *Platform) GuildMessageChannels(ctx context.Context, _ string) ([]core.NamedChannel, error) {
	chats, err := p.listBotChats(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]core.NamedChannel, 0, len(chats))
	for _, c := range chats {
		if c.Name != "" {
			out = append(out, core.NamedChannel{ID: c.ID, Name: c.Name})
		}
	}
	return out, nil
}

// ResolveChannelName returns the name of a chat (GET im/v1/chats/:chat_id, cached with the
// inbound chat names). A chat without a name (a private chat) answers its ID, like Discord.
// Core may pass the channel key of a topic (dispatchCoreMessage: "<chat_id>:topic:<root>"); the
// name is that of its group.
func (p *Platform) ResolveChannelName(chatID string) (string, error) {
	chatID, _, _ = strings.Cut(chatID, ":topic:")
	if cached, ok := p.chatNameCache.Load(chatID); ok {
		return cached.(string), nil
	}
	if p.client == nil {
		return chatID, fmt.Errorf("%s: resolve chat name: client not initialized", p.tag())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var name string
	err := p.withFreshTenantAccessTokenRetry(ctx, "resolve chat name", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		resp, err := client.Im.Chat.Get(ctx, larkim.NewGetChatReqBuilder().ChatId(chatID).Build(), options...)
		if err != nil {
			return fmt.Errorf("%s: resolve chat name %s: %w", p.tag(), chatID, err)
		}
		if !resp.Success() {
			return fmt.Errorf("%s: resolve chat name %s: code=%d msg=%s", p.tag(), chatID, resp.Code, resp.Msg)
		}
		if resp.Data != nil {
			name = stringValue(resp.Data.Name)
		}
		return nil
	})
	if err != nil {
		return chatID, err
	}
	if name == "" {
		return chatID, nil
	}
	p.chatNameCache.Store(chatID, name)
	return name, nil
}
