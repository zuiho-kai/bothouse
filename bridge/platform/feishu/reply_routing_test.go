package feishu

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func TestGroupCallsMatchDiscord(t *testing.T) {
	const appID = "cli_group_calls"
	for _, tc := range []struct {
		name, content, parentAuthor, parentKind string
		explicit, replyAll, want, topic         bool
	}{
		{name: "bare mention", content: "@_user_1", explicit: true, want: true},
		{name: "bare mention in topic", content: "@_user_1", explicit: true, want: true, topic: true},
		{name: "plain group chatter", content: "继续"},
		{name: "reply to this bot", content: "继续", parentAuthor: appID, parentKind: "app", want: true},
		{name: "reply to another bot", content: "继续", parentAuthor: "cli_other", parentKind: "app", replyAll: true},
		{name: "explicitly calls this bot in another bot's reply", content: "@_user_1 继续", parentAuthor: "cli_other", parentKind: "app", explicit: true, want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal":
					fmt.Fprint(w, `{"code":0,"tenant_access_token":"tenant-token","expire":7200}`)
				case r.URL.Path == "/open-apis/im/v1/messages/om_parent":
					fmt.Fprintf(w, `{"code":0,"data":{"items":[{"chat_id":"oc_chat","msg_type":"text","sender":{"id":%q,"sender_type":%q},"body":{"content":"{\"text\":\"the quoted reply\"}"}}]}}`, tc.parentAuthor, tc.parentKind)
				case strings.HasPrefix(r.URL.Path, "/open-apis/contact/v3/users/"), strings.HasPrefix(r.URL.Path, "/open-apis/im/v1/chats/"):
					fmt.Fprint(w, `{"code":0,"data":{}}`)
				default:
					http.NotFound(w, r)
					t.Errorf("unexpected API request %s", r.URL.Path)
				}
			}))
			defer srv.Close()

			delivered := make(chan *core.Message, 1)
			p := &Platform{
				platformName: "feishu", appID: appID, botOpenID: "ou_bot",
				groupReplyAll: tc.replyAll, threadIsolation: tc.topic, allowFrom: "ou_owner",
				dedup:   &core.MessageDedup{},
				client:  lark.NewClient(appID, "test-secret", lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
				handler: func(_ core.Platform, msg *core.Message) { delivered <- msg },
			}
			msg := &larkim.EventMessage{
				MessageId: strPtr("om_call"), ChatId: strPtr("oc_chat"), ChatType: strPtr("group"),
				MessageType: strPtr("text"), Content: strPtr(fmt.Sprintf(`{"text":%q}`, tc.content)),
				CreateTime: strPtr(strconv.FormatInt(time.Now().UnixMilli(), 10)),
			}
			if tc.explicit {
				msg.Mentions = []*larkim.MentionEvent{{Key: strPtr("@_user_1"), Id: &larkim.UserId{OpenId: strPtr("ou_bot")}}}
			}
			if tc.parentAuthor != "" {
				msg.ParentId = strPtr("om_parent")
			}
			err := p.onMessage(context.Background(), &larkim.P2MessageReceiveV1{
				Event: &larkim.P2MessageReceiveV1Data{Message: msg, Sender: &larkim.EventSender{
					SenderId: &larkim.UserId{OpenId: strPtr("ou_owner")}, SenderType: strPtr("user"),
				}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if !tc.want {
				select {
				case got := <-delivered:
					t.Fatalf("unexpected turn: %+v", got)
				case <-time.After(150 * time.Millisecond):
				}
				return
			}
			select {
			case got := <-delivered:
				wantBackfill := tc.parentAuthor == "" && !tc.topic
				if !got.Mentioned || got.BackfillOnCall != wantBackfill {
					t.Fatalf("incorrect call metadata: %+v", got)
				}
				if !tc.topic && got.ChannelID != "oc_chat" {
					t.Fatalf("history channel = %q", got.ChannelID)
				}
				if tc.parentAuthor == "" {
					if got.Content != core.MentionOnlyPrompt {
						t.Fatalf("bare mention = %q", got.Content)
					}
				} else if got.Content != "继续" || !strings.Contains(got.ExtraContent, "the quoted reply") || got.Reference == nil || got.Reference.ID != "om_parent" {
					t.Fatalf("reply did not preserve its body and quote: %+v", got)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("expected a call to this bot")
			}
		})
	}
}
