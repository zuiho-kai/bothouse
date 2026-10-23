package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	lark "github.com/larksuite/oapi-sdk-go/v3"

	"github.com/chenhg5/cc-connect/core"
)

// fakeFeishuWorkspace is a mock Feishu open API; no real request leaves the test.
type fakeFeishuWorkspace struct {
	mu         sync.Mutex
	createBody map[string]any
	createQ    string
	createCode int // HTTP status for POST im/v1/chats (0 = 200)
	notices    []string
}

func (f *fakeFeishuWorkspace) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ok := func(data map[string]any) { writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": data}) }
		switch {
		case r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal":
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "expire": 7200, "tenant_access_token": "tenant-token"})
		case r.Method == http.MethodGet && r.URL.Path == "/open-apis/im/v1/chats/oc_chat":
			ok(map[string]any{"name": "量化群", "chat_mode": "group", "group_message_type": "chat"})
		case r.Method == http.MethodGet && r.URL.Path == "/open-apis/im/v1/chats/oc_p2p":
			ok(map[string]any{"chat_mode": "p2p"})
		case r.Method == http.MethodGet && r.URL.Path == "/open-apis/im/v1/chats/oc_topic":
			ok(map[string]any{"name": "话题群", "chat_mode": "group", "group_message_type": "thread"})
		case r.Method == http.MethodGet && r.URL.Path == "/open-apis/im/v1/chats":
			if r.URL.Query().Get("page_token") == "" {
				ok(map[string]any{"items": []map[string]any{{"chat_id": "oc_chat", "name": "量化群"}, {"chat_id": "oc_ws1", "name": "工作区1"}}, "has_more": true, "page_token": "p2"})
			} else {
				ok(map[string]any{"items": []map[string]any{{"chat_id": "oc_other", "name": "闲聊"}}, "has_more": false})
			}
		case r.Method == http.MethodGet && r.URL.Path == "/open-apis/im/v1/chats/oc_chat/members":
			ok(map[string]any{"items": []map[string]any{{"member_id": "ou_a", "name": "A"}, {"member_id": "ou_b", "name": "B"}}, "has_more": false})
		case r.Method == http.MethodPost && r.URL.Path == "/open-apis/im/v1/chats":
			raw, _ := io.ReadAll(r.Body)
			f.mu.Lock()
			_ = json.Unmarshal(raw, &f.createBody)
			f.createQ = r.URL.RawQuery
			code := f.createCode
			f.mu.Unlock()
			if code != 0 {
				w.WriteHeader(code)
				writeJSON(t, w, map[string]any{"code": 99991672, "msg": "Access denied. One of the following scopes is required: [im:chat]"})
				return
			}
			ok(map[string]any{"chat_id": "oc_new", "name": "工作区2"})
		case r.Method == http.MethodPost && r.URL.Path == "/open-apis/im/v1/messages":
			raw, _ := io.ReadAll(r.Body)
			f.mu.Lock()
			f.notices = append(f.notices, string(raw))
			f.mu.Unlock()
			ok(map[string]any{"message_id": "om_1"})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

func newFeishuWorkspacePlatform(t *testing.T, f *fakeFeishuWorkspace) *Platform {
	t.Helper()
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	return &Platform{
		platformName: "feishu",
		domain:       srv.URL,
		appID:        "cli_lead",
		appSecret:    "secret",
		peerBots:     map[string]string{"cli_dragon": "龙娘", "cli_whale": "鲸鱼娘", "cli_lead": "橘"},
		client:       lark.NewClient("cli_lead", "secret", lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
	}
}

func TestFeishuTeamWorkspaceListAndCreate(t *testing.T) {
	f := &fakeFeishuWorkspace{}
	p := newFeishuWorkspacePlatform(t, f)
	ctx := context.Background()

	self, all, err := p.TeamGuildChannels(ctx, "oc_chat")
	if err != nil {
		t.Fatal(err)
	}
	if self.ID != "oc_chat" || self.Name != "量化群" || self.ParentID != "" {
		t.Fatalf("self = %+v", self)
	}
	var ids []string
	for _, c := range all {
		ids = append(ids, c.ID+"="+c.Name)
	}
	if got := strings.Join(ids, ","); got != "oc_chat=量化群,oc_ws1=工作区1,oc_other=闲聊" {
		t.Fatalf("all = %s", got)
	}

	c, err := p.CreateTeamWorkspaceChannel(ctx, "oc_chat", "工作区2")
	if err != nil || c.ID != "oc_new" || c.Name != "工作区2" {
		t.Fatalf("create = %+v %v", c, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createBody["name"] != "工作区2" || f.createBody["owner_id"] != nil {
		t.Fatalf("create body = %v (want name, no owner_id so the bot owns it)", f.createBody)
	}
	if got, _ := json.Marshal(f.createBody["user_id_list"]); string(got) != `["ou_a","ou_b"]` {
		t.Fatalf("user_id_list = %s", got)
	}
	if got, _ := json.Marshal(f.createBody["bot_id_list"]); string(got) != `["cli_dragon","cli_whale"]` {
		t.Fatalf("bot_id_list = %s (team bots, not itself)", got)
	}
	if !strings.Contains(f.createQ, "user_id_type=open_id") || !strings.Contains(f.createQ, "uuid=") {
		t.Fatalf("create query = %s", f.createQ)
	}
	if len(f.notices) != 0 {
		t.Fatalf("notices = %v, want none", f.notices)
	}
}

func TestFeishuTeamWorkspaceNotTeamChannel(t *testing.T) {
	p := newFeishuWorkspacePlatform(t, &fakeFeishuWorkspace{})
	for _, id := range []string{"oc_p2p", "oc_topic"} {
		if _, _, err := p.TeamGuildChannels(context.Background(), id); !errors.Is(err, core.ErrNotTeamChannel) {
			t.Fatalf("%s: %v, want ErrNotTeamChannel", id, err)
		}
	}
}

func TestFeishuTeamWorkspaceNoPermissionPermanentWithNotice(t *testing.T) {
	f := &fakeFeishuWorkspace{createCode: http.StatusBadRequest}
	p := newFeishuWorkspacePlatform(t, f)
	_, err := p.CreateTeamWorkspaceChannel(context.Background(), "oc_chat", "工作区1")
	if !errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatalf("err = %v, want ErrTeamWorkspacePermanent", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.notices) != 1 || !strings.Contains(f.notices[0], "im:chat") || !strings.Contains(f.notices[0], "oc_chat") {
		t.Fatalf("notices = %v, want one note in the chat group naming im:chat", f.notices)
	}
}

func TestFeishuTeamWorkspaceServerErrorRetryable(t *testing.T) {
	p := newFeishuWorkspacePlatform(t, &fakeFeishuWorkspace{})
	if err := p.workspaceErr("create chat", nil, 1, "x"); errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatal("no HTTP status: must stay retryable")
	}
}
