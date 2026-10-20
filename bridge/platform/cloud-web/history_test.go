package cloudweb

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: channel backfill on the hub (the Discord ChannelHistoryReader, discord.go
// ChannelHistory). The hub's page API GET /api/rooms/{room}/messages?before=&limit= is read
// over HTTP, so a turn's history read never waits on the websocket read loop that delivered it.

type recTransport struct {
	mu   sync.Mutex
	sent []map[string]any
}

func (f *recTransport) Start(context.Context, inboundHandler) error { return nil }
func (f *recTransport) Stop() error                                 { return nil }
func (f *recTransport) Capabilities() map[string]bool               { return defaultCapabilities() }
func (f *recTransport) Send(_ context.Context, msg map[string]any) error {
	f.mu.Lock()
	f.sent = append(f.sent, msg)
	f.mu.Unlock()
	return nil
}

func TestChannelHistoryReadsHubPage(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotAuth = r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{"has_more": false, "messages": []map[string]any{
			{"id": 3, "author_kind": "user", "author": "user", "name": "用户", "text": "掉线时说的第一句", "created_at": 1760000000.5, "card": nil},
			{"id": 4, "author_kind": "system", "author": "system", "name": "系统", "text": "频道改名", "created_at": 1760000001.0},
			{"id": 5, "author_kind": "role", "author": "tju", "name": "橘", "text": "卡片正文", "created_at": 1760000002.0, "card": `{"state":"completed"}`},
			{"id": 6, "author_kind": "role", "author": "tju", "name": "橘", "text": "我在会话里写的", "created_at": 1760000003.0, "from_turn": 1},
			{"id": 7, "author_kind": "role", "author": "tju", "name": "橘", "text": "定时任务输出", "created_at": 1760000004.0, "from_turn": nil},
			{"id": 8, "author_kind": "role", "author": "tln", "name": "龙娘", "text": "队友说的", "created_at": 1760000005.0, "from_turn": 1},
		}})
	}))
	defer srv.Close()
	ws := "ws" + strings.TrimPrefix(srv.URL, "http") + "/cloud-web/ws?bot=tju&name=%E6%A9%98&mention_id=111"
	p := mustNew(t, map[string]any{"token": "bot-token", "transport": "websocket", "ws_url": ws})

	r, ok := core.Platform(p).(core.ChannelHistoryReader)
	if !ok {
		t.Fatal("cloud_web must implement core.ChannelHistoryReader")
	}
	got, err := r.ChannelHistory("room-2", "hub-10", 50)
	if err != nil {
		t.Fatalf("ChannelHistory: %v", err)
	}
	if gotPath != "/api/rooms/2/messages" || gotQuery != "before=10&limit=50" || gotAuth != "Bearer bot-token" {
		t.Fatalf("request = %s?%s auth=%q", gotPath, gotQuery, gotAuth)
	}
	type row struct {
		ID, Author, Content     string
		IsBot, IsSelf, FromTurn bool
	}
	var rows []row
	for _, m := range got {
		rows = append(rows, row{m.ID, m.Author, m.Content, m.IsBot, m.IsSelf, m.FromTurn})
	}
	want := []row{
		{"hub-3", "用户", "掉线时说的第一句", false, false, false},
		// system (not sent to bots live either, rh/cloudweb.py on_new) and progress card (like
		// Discord's embeds-only posts) are left out
		{"hub-6", "橘", "我在会话里写的", true, true, true},
		{"hub-7", "橘", "定时任务输出", true, true, false},
		{"hub-8", "龙娘", "队友说的", true, false, false}, // from_turn of a teammate is hers, not ours
	}
	if len(rows) != len(want) {
		t.Fatalf("got %+v\nwant %+v", rows, want)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, rows[i], want[i])
		}
	}
	if !got[0].Time.Equal(time.Unix(1760000000, 5e8)) {
		t.Fatalf("time = %v", got[0].Time)
	}

	// cron backfill reads up to the newest post: no before
	if _, err := r.ChannelHistory("room-2", "", 50); err != nil || gotQuery != "limit=50" {
		t.Fatalf("newest page: query=%q err=%v", gotQuery, err)
	}
}

func TestChannelHistoryErrorsFallBack(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized) // a hub that does not let bots read
	}))
	defer srv.Close()
	ws := "ws" + strings.TrimPrefix(srv.URL, "http") + "/cloud-web/ws?bot=tju"
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": ws})
	if _, err := p.ChannelHistory("room-2", "hub-3", 50); err == nil {
		t.Fatal("HTTP error must be an error (core falls back to the gate buffer)")
	}
	if _, err := p.ChannelHistory("general", "hub-3", 50); err == nil {
		t.Fatal("a channel that is not room-<id> must be an error")
	}
	if _, err := p.ChannelHistory("room-2", "cw-123", 50); err == nil {
		t.Fatal("a before id that is not hub-<id> must be an error")
	}
}

func TestAgentReplyIsMarkedOnTheWire(t *testing.T) {
	p := mustNew(t, wsOpts(nil))
	tp := &recTransport{}
	p.tp = tp
	rc := replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}
	m, ok := core.Platform(p).(core.AgentReplyMarker)
	if !ok {
		t.Fatal("cloud_web must implement core.AgentReplyMarker")
	}
	if err := p.Reply(context.Background(), m.MarkAgentReply(rc), "agent text"); err != nil {
		t.Fatal(err)
	}
	if err := p.Reply(context.Background(), rc, "↪ 已插入"); err != nil {
		t.Fatal(err)
	}
	if tp.sent[0]["agent"] != true {
		t.Fatalf("agent reply frame = %v, want agent=true", tp.sent[0])
	}
	if _, has := tp.sent[1]["agent"]; has {
		t.Fatalf("status reply frame = %v, want no agent flag", tp.sent[1])
	}
}
