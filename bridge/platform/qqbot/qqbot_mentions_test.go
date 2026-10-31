package qqbot

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/chenhg5/cc-connect/core"
)

type mentionRequest struct {
	Path string
	Body struct {
		Content  string `json:"content"`
		MsgType  int    `json:"msg_type"`
		MsgID    string `json:"msg_id"`
		MsgSeq   int    `json:"msg_seq"`
		Markdown *struct {
			Content string `json:"content"`
		} `json:"markdown"`
	}
}

func mockMentionAPI(t *testing.T, status int) (*Platform, <-chan mentionRequest) {
	t.Helper()
	requests := make(chan mentionRequest, 20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := mentionRequest{Path: r.URL.Path}
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "QQBot test-token" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&request.Body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requests <- request
		w.WriteHeader(status)
		if status >= 300 {
			fmt.Fprint(w, `{"code":400,"message":"mention quota exceeded"}`)
		} else {
			fmt.Fprint(w, `{"id":"sent-message"}`)
		}
	}))
	originalAPI := apiBaseProduction
	apiBaseProduction = server.URL
	t.Cleanup(func() {
		server.Close()
		apiBaseProduction = originalAPI
	})
	return &Platform{token: "test-token", tokenExpiry: time.Now().Add(time.Hour)}, requests
}

func mentionSender(t *testing.T, p *Platform) core.AtMentionSender {
	t.Helper()
	sender, ok := any(p).(core.AtMentionSender)
	if !ok {
		t.Fatal("QQBot does not implement core.AtMentionSender; the engine silently drops mentions")
	}
	return sender
}

func TestReplyWithAt_Request(t *testing.T) {
	for _, tc := range []struct {
		name, messageType, want string
		markdown, all           bool
		users                   []string
	}{
		{"users", "group", `<qqbot-at-user id="MEMBER_A" /> <qqbot-at-user id="MEMBER_B" />` + "\n任务完成", true, false, []string{"MEMBER_A", "MEMBER_B"}},
		{"everyone text", "group", "<qqbot-at-everyone />\n任务完成", false, true, nil},
		{"everyone markdown", "group", "<qqbot-at-everyone />\n任务完成", true, true, nil},
		{"both", "group", `<qqbot-at-everyone /> <qqbot-at-user id="MEMBER_A" />` + "\n任务完成", true, true, []string{"MEMBER_A"}},
		{"plain group unchanged", "group", "任务完成", false, false, nil},
		{"plain private unchanged", "c2c", "任务完成", false, false, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, requests := mockMentionAPI(t, http.StatusOK)
			p.markdownSupport = tc.markdown
			rctx := &replyContext{messageType: tc.messageType, groupOpenID: "group-1", userOpenID: "user-1", eventMsgID: "incoming"}
			if err := mentionSender(t, p).ReplyWithAt(context.Background(), rctx, "任务完成", tc.users, tc.all); err != nil {
				t.Fatal(err)
			}
			request := <-requests
			wantPath := "/v2/groups/group-1/messages"
			if tc.messageType == "c2c" {
				wantPath = "/v2/users/user-1/messages"
			}
			if request.Path != wantPath || request.Body.MsgID != "incoming" || request.Body.MsgSeq != 1 {
				t.Errorf("wrong routing or passive reply fields: %+v", request)
			}
			got := request.Body.Content
			if tc.markdown {
				if request.Body.Markdown == nil || request.Body.MsgType != 2 || got != "" {
					t.Fatalf("wrong markdown envelope: %+v", request.Body)
				}
				got = request.Body.Markdown.Content
			} else if request.Body.Markdown != nil || request.Body.MsgType != 0 {
				t.Errorf("wrong text envelope: %+v", request.Body)
			}
			if got != tc.want {
				t.Errorf("content = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReplyWithAt_RejectsBeforeSending(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		rctx       any
		markdown   bool
		users      []string
		all        bool
	}{
		{"invalid context", "invalid reply context", "bad", true, []string{"A"}, false},
		{"private user", "group", &replyContext{messageType: "c2c"}, true, []string{"A"}, false},
		{"private everyone", "group", &replyContext{messageType: "c2c"}, true, nil, true},
		{"text user", "markdown_support", &replyContext{messageType: "group"}, false, []string{"A"}, false},
		{"empty ID", "member_openid", &replyContext{messageType: "group"}, true, []string{""}, false},
		{"tag in ID", "member_openid", &replyContext{messageType: "group"}, true, []string{`A" /><qqbot-at-everyone /><!--`}, false},
		{"space in ID", "member_openid", &replyContext{messageType: "group"}, true, []string{"A\nB"}, false},
		{"oversized prefix", "too long", &replyContext{messageType: "group"}, true, []string{strings.Repeat("A", messageMaxLen)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, requests := mockMentionAPI(t, http.StatusOK)
			p.markdownSupport = tc.markdown
			err := mentionSender(t, p).ReplyWithAt(context.Background(), tc.rctx, "任务完成", tc.users, tc.all)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want %q", err, tc.want)
			}
			if len(requests) != 0 {
				t.Fatal("invalid mention request reached QQ API")
			}
		})
	}
}

func TestReplyWithAt_LongReplyMentionsOnce(t *testing.T) {
	p, requests := mockMentionAPI(t, http.StatusOK)
	p.markdownSupport = true
	rctx := &replyContext{messageType: "group", groupOpenID: "group-1", eventMsgID: "incoming"}
	content := "```text\n" + strings.Repeat("中", messageMaxLen*2) + "\n```"
	if err := mentionSender(t, p).ReplyWithAt(context.Background(), rctx, content, []string{"MEMBER_A"}, true); err != nil {
		t.Fatal(err)
	}
	count := len(requests)
	if count < 2 {
		t.Fatalf("expected split response, got %d requests", count)
	}
	var joined strings.Builder
	for i := 0; i < count; i++ {
		request := <-requests
		if request.Body.Markdown == nil {
			t.Fatal("missing markdown")
		}
		chunk := request.Body.Markdown.Content
		if utf8.RuneCountInString(chunk) > messageMaxLen || request.Body.MsgSeq != i+1 || request.Body.MsgID != "incoming" {
			t.Errorf("invalid chunk length/sequence: length=%d seq=%d", utf8.RuneCountInString(chunk), request.Body.MsgSeq)
		}
		if strings.Count(chunk, "```")%2 != 0 {
			t.Errorf("unbalanced code fence: chunk %d", i)
		}
		joined.WriteString(chunk)
	}
	for _, tag := range []string{`<qqbot-at-user id="MEMBER_A" />`, "<qqbot-at-everyone />"} {
		if strings.Count(joined.String(), tag) != 1 {
			t.Errorf("mention missing, repeated or split: %s", tag)
		}
	}
	if strings.Count(joined.String(), "中") != messageMaxLen*2 {
		t.Error("split response lost body content")
	}
}

func TestReplyWithAt_PropagatesQQError(t *testing.T) {
	p, requests := mockMentionAPI(t, http.StatusForbidden)
	err := mentionSender(t, p).ReplyWithAt(context.Background(), &replyContext{messageType: "group", groupOpenID: "group-1"}, "通知", nil, true)
	if err == nil || !strings.Contains(err.Error(), "mention quota exceeded") {
		t.Fatalf("API error was lost: %v", err)
	}
	if len(requests) != 1 {
		t.Fatalf("failed mention retried/fell back: %d requests", len(requests))
	}
}
