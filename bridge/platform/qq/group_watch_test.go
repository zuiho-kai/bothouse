package qq

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func watchTestOptions(t *testing.T, f *fakeOneBot, endpoint, interval string) map[string]any {
	t.Helper()
	dir := t.TempDir()
	cfg := groupWatchConfig{Groups: []int64{111}, Owner: 900, Interval: interval, BaseURL: endpoint, Model: "test-flash", Effort: "medium", Keywords: []string{"福利", "元"}}
	raw, _ := json.Marshal(cfg)
	path := filepath.Join(dir, "watch.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return map[string]any{"group_watch_config": path, "cc_data_dir": dir, "cc_project": "qqtest", "allow_from": "222", "ws_url": "ws" + strings.TrimPrefix(f.ts.URL, "http")}
}

func watchTestPlatform(t *testing.T, opts map[string]any) (*Platform, *atomic.Int64) {
	t.Helper()
	raw, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	p := raw.(*Platform)
	called := &atomic.Int64{}
	if err := p.Start(func(core.Platform, *core.Message) { called.Add(1) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := p.Stop(); err != nil {
			t.Error(err)
		}
	})
	return p, called
}

func watchEvent(t *testing.T, id int64, role, text string) map[string]any {
	t.Helper()
	event := groupMessage(111, 333, id, textSegment(text))
	event["sender"].(map[string]any)["role"] = role
	// Match the wire's []any and float64 values even for synchronous calls.
	raw, _ := json.Marshal(event)
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatal(err)
	}
	return event
}

func TestGroupWatchSilentCollectionAtWebSocketEntry(t *testing.T) {
	f := newFakeOneBot(t)
	p, conversations := watchTestPlatform(t, watchTestOptions(t, f, "http://unused.invalid/v1", "2h"))
	f.push(watchEvent(t, 1, "member", "哈哈"))
	f.push(watchEvent(t, 2, "member", "福利 9元，今晚截止"))
	f.push(watchEvent(t, 3, "member", "福利 9元，今晚截止"))
	f.push(watchEvent(t, 4, "owner", "大家好"))
	f.push(watchEvent(t, 5, "owner", "大家好"))
	image := watchEvent(t, 6, "owner", "")
	image["message"] = []any{map[string]any{"type": "image", "data": map[string]any{"url": "http://never-fetch.invalid/福利.jpg"}}}
	f.push(image)
	f.push(watchEvent(t, 7, "owner", "/model"))
	image["message_id"] = float64(8)
	image["sender"].(map[string]any)["role"] = "member"
	f.push(image)
	deadline := time.Now().Add(3 * time.Second)
	var count int
	for time.Now().Before(deadline) {
		if err := p.groupWatch.db.QueryRow("SELECT COUNT(*) FROM messages").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 5 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if count != 5 {
		t.Fatalf("retained %d, want one benefit and all four owner messages", count)
	}
	if conversations.Load() != 0 {
		t.Fatal("watched messages entered conversation")
	}
	for action := range f.record() {
		if action != "get_login_info" {
			t.Fatalf("collection invoked OneBot action %s", action)
		}
	}
	var raw string
	if err := p.groupWatch.db.QueryRow("SELECT raw FROM messages WHERE message_id=6").Scan(&raw); err != nil || !strings.Contains(raw, "never-fetch.invalid") {
		t.Fatalf("owner media not preserved: %q %v", raw, err)
	}
	t.Logf("websocket collection: retained=%d conversations=%d group replies=0", count, conversations.Load())
}

func TestGroupWatchBatchPrivateDeliveryQuietUsageAndPersistence(t *testing.T) {
	var calls atomic.Int64
	var quiet atomic.Bool
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		var request struct {
			Effort   string `json:"reasoning_effort"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if request.Effort != "medium" {
			t.Errorf("reasoning effort = %q, want medium", request.Effort)
		}
		var input struct {
			Messages []watchMessage `json:"messages"`
		}
		if err := json.Unmarshal([]byte(request.Messages[1].Content), &input); err != nil {
			t.Error(err)
			return
		}
		items := []watchItem{}
		if !quiet.Load() {
			items = append(items, watchItem{Source: input.Messages[0].ID, What: "限时福利", Price: "9元", Deadline: "今晚"})
		}
		content, _ := json.Marshal(map[string]any{"items": items})
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}}, "usage": map[string]int{"prompt_tokens": 123, "completion_tokens": 45}})
	}))
	defer model.Close()
	f := newFakeOneBot(t)
	f.on("get_group_info", func(map[string]any) map[string]any { return map[string]any{"group_name": "测试群"} })
	f.on("send_private_msg", func(map[string]any) map[string]any { return map[string]any{"message_id": 456} })
	opts := watchTestOptions(t, f, model.URL+"/v1", "2h")
	p, conversations := watchTestPlatform(t, opts)
	p.handleMessage(watchEvent(t, 11, "member", "福利 9元，今晚截止"))
	p.handleMessage(watchEvent(t, 12, "owner", "补充说明"))
	if err := p.groupWatch.flush(context.Background(), p, time.Now()); err != nil {
		t.Fatal(err)
	}
	params := f.paramsOf("send_private_msg", 0)
	if params["user_id"] != float64(900) || params["auto_escape"] != true {
		t.Fatalf("unsafe destination/encoding: %v", params)
	}
	for _, text := range []string{"限时福利", "9元", "今晚", "测试群", "333"} {
		if !strings.Contains(params["message"].(string), text) {
			t.Errorf("summary missing %s", text)
		}
	}
	var state, usage, receipt string
	if err := p.groupWatch.db.QueryRow("SELECT state,usage,receipt FROM batches WHERE id=1").Scan(&state, &usage, &receipt); err != nil {
		t.Fatal(err)
	}
	if state != "sent" || !strings.Contains(usage, "123") || !strings.Contains(receipt, "456") {
		t.Fatalf("receipt=%s %s %s", state, usage, receipt)
	}
	quiet.Store(true)
	p.handleMessage(watchEvent(t, 13, "owner", "晚上好"))
	if err := p.groupWatch.flush(context.Background(), p, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := p.groupWatch.flush(context.Background(), p, time.Now()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || len(f.record()["send_private_msg"]) != 1 || len(f.record()["send_group_msg"]) != 0 || conversations.Load() != 0 {
		t.Fatalf("calls=%d OneBot=%v conversations=%d", calls.Load(), f.record(), conversations.Load())
	}
	if err := p.groupWatch.db.QueryRow("SELECT state FROM batches WHERE id=2").Scan(&state); err != nil || state != "quiet" {
		t.Fatalf("quiet=%s %v", state, err)
	}
	// A second process view sees the persisted events and cannot requeue replay.
	reopened, err := newGroupWatch(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.close()
	if err := reopened.collect(watchEvent(t, 11, "member", "福利 9元，今晚截止"), time.Now()); err != nil {
		t.Fatal(err)
	}
	var pending int
	if err := reopened.db.QueryRow("SELECT COUNT(*) FROM messages WHERE batch_id IS NULL").Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("pending=%d %v", pending, err)
	}
	t.Logf("useful batch: model calls=1 usage=%s private sends=1; quiet batch: model calls=1 private sends=0; empty batch: calls=0; persisted replay pending=%d", usage, pending)
}

func TestGroupWatchTimerAndOtherConversations(t *testing.T) {
	var calls atomic.Int64
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"items":[]}`}}}})
	}))
	defer model.Close()
	f := newFakeOneBot(t)
	p, conversations := watchTestPlatform(t, watchTestOptions(t, f, model.URL, "20ms"))
	p.handleMessage(watchEvent(t, 21, "owner", "大家好"))
	deadline := time.Now().Add(3 * time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if calls.Load() != 1 {
		t.Fatalf("timer model calls=%d", calls.Load())
	}
	other := watchEvent(t, 22, "member", "你好")
	other["group_id"], other["user_id"] = float64(112), float64(222)
	p.handleMessage(other)
	private := watchEvent(t, 23, "member", "你好")
	private["message_type"], private["user_id"] = "private", float64(222)
	p.handleMessage(private)
	if conversations.Load() != 2 {
		t.Fatalf("ordinary group/private messages dispatched=%d", conversations.Load())
	}
	// Unauthorized traffic in an unwatched group is still rejected.
	other["message_id"], other["user_id"] = float64(24), float64(333)
	p.handleMessage(other)
	if conversations.Load() != 2 {
		t.Fatal("watch relaxed ordinary permission checks")
	}
}

func TestGroupWatchModelFailureIsRetainedWithoutReplay(t *testing.T) {
	var calls atomic.Int64
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusBadGateway) }))
	defer model.Close()
	f := newFakeOneBot(t)
	p, _ := watchTestPlatform(t, watchTestOptions(t, f, model.URL, "2h"))
	p.handleMessage(watchEvent(t, 31, "owner", "福利"))
	if err := p.groupWatch.flush(context.Background(), p, time.Now()); err == nil {
		t.Fatal("expected API error")
	}
	if err := p.groupWatch.flush(context.Background(), p, time.Now()); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := p.groupWatch.db.QueryRow("SELECT state FROM batches").Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "model_error" || calls.Load() != 1 || len(f.record()["send_private_msg"]) != 0 {
		t.Fatalf("state=%s calls=%d", state, calls.Load())
	}
}
