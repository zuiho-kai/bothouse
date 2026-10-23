package feishu

// Team mode E (Feishu): a workspace is a new group the bot creates (POST im/v1/chats, the bot
// is owner) with the chat group's members and the team bots in it. Naming, n+1 and backfill
// are in core/team_workspace.go; this file only lists and creates groups.
//
// Source: user 2026-10-24 01:26「应该支持我们现有的dsh，discord，飞书，自建平台」; API
// https://open.feishu.cn/document/server-docs/group/chat/create.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.TeamWorkspaceChannels = (*Platform)(nil)

const (
	workspaceMaxUsers = 50  // SPEC: create-chat doc, user_id_list at most 50
	workspaceMaxBots  = 5   // SPEC: create-chat doc, bot_id_list at most 5
	workspacePageSize = 100 // 沿用已有配置: fetchChatMembers PageSize(100)
)

// feishuNoPermissionCode = 99991672 is Feishu's "app has no permission (scope)" code (SPEC:
// Feishu server error code list), returned when im:chat is not granted.
const feishuNoPermissionCode = 99991672 // SPEC: Feishu error code "no permission"

// workspaceErr marks errors retrying will not fix (HTTP 4xx other than 429, missing scope) as
// core.ErrTeamWorkspacePermanent; network errors, 429 and 5xx stay retryable (same rule as
// discord/workspaces.go).
func (p *Platform) workspaceErr(op string, resp *larkcore.ApiResp, code int, msg string) error {
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	err := fmt.Errorf("%s: workspace %s: HTTP %d code=%d msg=%s", p.tag(), op, status, code, msg)
	if code == feishuNoPermissionCode || (status >= http.StatusBadRequest && status < http.StatusInternalServerError && status != http.StatusTooManyRequests) {
		return fmt.Errorf("%w: %w", core.ErrTeamWorkspacePermanent, err)
	}
	return err
}

// TeamGuildChannels returns the chat group and every group the bot is in (Feishu has no
// categories: ParentID is empty). Private chats and topic groups cannot have workspaces.
func (p *Platform) TeamGuildChannels(ctx context.Context, chatID string) (core.TeamChannel, []core.TeamChannel, error) {
	if p.client == nil {
		return core.TeamChannel{}, nil, fmt.Errorf("%s: workspace: client not initialized", p.tag())
	}
	var self core.TeamChannel
	err := p.withFreshTenantAccessTokenRetry(ctx, "workspace get chat", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		resp, err := client.Im.Chat.Get(ctx, larkim.NewGetChatReqBuilder().ChatId(chatID).Build(), options...)
		if err != nil {
			return fmt.Errorf("%s: workspace get chat: %w", p.tag(), err)
		}
		if !resp.Success() {
			return p.workspaceErr("get chat", resp.ApiResp, resp.Code, resp.Msg)
		}
		if resp.Data == nil {
			return fmt.Errorf("%s: workspace get chat %s: no data", p.tag(), chatID)
		}
		mode, msgType := stringValue(resp.Data.ChatMode), stringValue(resp.Data.GroupMessageType)
		if mode == "p2p" || mode == "topic" || msgType == "thread" {
			return fmt.Errorf("%s: chat %s (mode %s): %w", p.tag(), chatID, mode, core.ErrNotTeamChannel)
		}
		self = core.TeamChannel{ID: chatID, Name: stringValue(resp.Data.Name)}
		return nil
	})
	if err != nil {
		return core.TeamChannel{}, nil, err
	}

	all := []core.TeamChannel{self}
	var pageToken string
	for {
		var items []*larkim.ListChat
		var more bool
		err := p.withFreshTenantAccessTokenRetry(ctx, "workspace list chats", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			b := larkim.NewListChatReqBuilder().PageSize(workspacePageSize)
			if pageToken != "" {
				b.PageToken(pageToken)
			}
			resp, err := client.Im.Chat.List(ctx, b.Build(), options...)
			if err != nil {
				return fmt.Errorf("%s: workspace list chats: %w", p.tag(), err)
			}
			if !resp.Success() {
				return p.workspaceErr("list chats", resp.ApiResp, resp.Code, resp.Msg)
			}
			if resp.Data != nil {
				items = resp.Data.Items
				more = resp.Data.HasMore != nil && *resp.Data.HasMore
				pageToken = stringValue(resp.Data.PageToken)
			}
			return nil
		})
		if err != nil {
			return core.TeamChannel{}, nil, err
		}
		for _, c := range items {
			if id := stringValue(c.ChatId); id != "" && id != chatID {
				all = append(all, core.TeamChannel{ID: id, Name: stringValue(c.Name)})
			}
		}
		if !more || pageToken == "" {
			break
		}
	}
	return self, all, nil
}

// CreateTeamWorkspaceChannel creates the group name with the members of besideChatID and the
// team bots (peer_bots). On a permanent failure (e.g. no im:chat scope) it says so in
// besideChatID; core then stops retrying that chat until restart, so the note goes out once.
func (p *Platform) CreateTeamWorkspaceChannel(ctx context.Context, besideChatID, name string) (core.TeamChannel, error) {
	if p.client == nil {
		return core.TeamChannel{}, fmt.Errorf("%s: workspace: client not initialized", p.tag())
	}
	c, err := p.createWorkspaceGroup(ctx, besideChatID, name)
	if errors.Is(err, core.ErrTeamWorkspacePermanent) {
		note := fmt.Sprintf("建工作区群「%s」失败：飞书应用可能缺少建群权限（im:chat）或没开机器人能力，开通后重启桥再试。原因：%v", name, err)
		content, _ := json.Marshal(map[string]string{"text": note})
		if serr := p.createMessage(ctx, besideChatID, larkim.MsgTypeText, string(content), "workspace notice"); serr != nil {
			slog.Warn(p.tag()+": workspace: notice failed", "chat_id", besideChatID, "error", serr)
		}
	}
	return c, err
}

func (p *Platform) createWorkspaceGroup(ctx context.Context, besideChatID, name string) (core.TeamChannel, error) {
	users, err := p.workspaceMembers(ctx, besideChatID)
	if err != nil {
		return core.TeamChannel{}, err
	}
	if len(users) > workspaceMaxUsers {
		slog.Warn(p.tag()+": workspace: chat has more members than one create can add; adding the first ones",
			"chat_id", besideChatID, "members", len(users), "limit", workspaceMaxUsers)
		users = users[:workspaceMaxUsers]
	}
	var bots []string
	for appID := range p.peerBots {
		if appID != p.appID {
			bots = append(bots, appID)
		}
	}
	sort.Strings(bots)
	if len(bots) > workspaceMaxBots {
		slog.Warn(p.tag()+": workspace: more team bots than one create can add", "bots", len(bots), "limit", workspaceMaxBots)
		bots = bots[:workspaceMaxBots]
	}
	// Same chat + name → same uuid, so a retry inside Feishu's uuid dedup window (SPEC:
	// create-chat doc) does not create a second group.
	sum := sha256.Sum256([]byte(besideChatID + "\x00" + name))
	body := larkim.NewCreateChatReqBodyBuilder().Name(name).ChatMode("group").ChatType("private")
	if len(users) > 0 {
		body.UserIdList(users)
	}
	if len(bots) > 0 {
		body.BotIdList(bots)
	}
	h := hex.EncodeToString(sum[:16])
	uuid := h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:] // UUID form, as in the doc's example
	req := larkim.NewCreateChatReqBuilder().UserIdType("open_id").Uuid(uuid).Body(body.Build()).Build()
	var out core.TeamChannel
	err = p.withFreshTenantAccessTokenRetry(ctx, "workspace create chat", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		resp, err := client.Im.Chat.Create(ctx, req, options...)
		if err != nil {
			return fmt.Errorf("%s: workspace create chat: %w", p.tag(), err)
		}
		if !resp.Success() {
			return p.workspaceErr("create chat", resp.ApiResp, resp.Code, resp.Msg)
		}
		if resp.Data == nil || stringValue(resp.Data.ChatId) == "" {
			return fmt.Errorf("%s: workspace create chat: no chat_id", p.tag())
		}
		out = core.TeamChannel{ID: stringValue(resp.Data.ChatId), Name: stringValue(resp.Data.Name)}
		if out.Name == "" {
			out.Name = name
		}
		return nil
	})
	return out, err
}

// workspaceMembers lists the open_ids of the users in chatID (Feishu does not list bots).
func (p *Platform) workspaceMembers(ctx context.Context, chatID string) ([]string, error) {
	var ids []string
	var pageToken string
	for {
		var more bool
		err := p.withFreshTenantAccessTokenRetry(ctx, "workspace list members", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			b := larkim.NewGetChatMembersReqBuilder().ChatId(chatID).MemberIdType("open_id").PageSize(workspacePageSize)
			if pageToken != "" {
				b.PageToken(pageToken)
			}
			resp, err := client.Im.ChatMembers.Get(ctx, b.Build(), options...)
			if err != nil {
				return fmt.Errorf("%s: workspace list members: %w", p.tag(), err)
			}
			if !resp.Success() {
				return p.workspaceErr("list members", resp.ApiResp, resp.Code, resp.Msg)
			}
			if resp.Data != nil {
				for _, m := range resp.Data.Items {
					if id := stringValue(m.MemberId); id != "" {
						ids = append(ids, id)
					}
				}
				more = resp.Data.HasMore != nil && *resp.Data.HasMore
				pageToken = stringValue(resp.Data.PageToken)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		if !more || pageToken == "" {
			return ids, nil
		}
	}
}
