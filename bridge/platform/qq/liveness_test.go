package qq

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// stallingOneBot reproduces 2026-11-16: NapCat kept the first client's TCP
// ESTABLISHED but stopped writing anything to it (no heartbeat, no event)
// while it went on receiving QQ messages; a new client got events at once.
type stallingOneBot struct {
	ts    *httptest.Server
	conns atomic.Int32
	// 测试用心跳间隔，真实 NapCat 是 30000ms（2026-11-16 22:43 实测）。
	intervalMs int
}

func (f *stallingOneBot) serve(w http.ResponseWriter, r *http.Request) {
	c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	n := f.conns.Add(1)
	var wmu sync.Mutex
	write := func(v any) {
		raw, _ := json.Marshal(v)
		wmu.Lock()
		defer wmu.Unlock()
		_ = c.WriteMessage(websocket.TextMessage, raw)
	}
	heartbeat := map[string]any{"post_type": "meta_event", "meta_event_type": "heartbeat",
		"self_id": fy69BotID, "interval": f.intervalMs, "status": map[string]any{"online": true, "good": true}}
	go func() {
		if n == 1 {
			// Two heartbeats, then silence on a socket that stays open.
			for i := 0; i < 2; i++ {
				write(heartbeat)
				time.Sleep(time.Duration(f.intervalMs) * time.Millisecond)
			}
			return
		}
		write(heartbeat)
		write(fy69Private(1335108150, 4242, "三秋", "你好"))
	}()
	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			return
		}
		var req map[string]any
		if json.Unmarshal(raw, &req) != nil {
			continue
		}
		data := map[string]any{}
		if req["action"] == "get_login_info" {
			data = map[string]any{"user_id": fy69BotID, "nickname": "肥鱼"}
		}
		if n == 1 && req["action"] != "get_login_info" {
			continue // the stalled socket answers nothing either
		}
		write(map[string]any{"status": "ok", "retcode": 0, "echo": req["echo"], "data": data})
	}
}

func TestSilentConnectionIsReplacedAndNewMessagesArrive(t *testing.T) {
	f := &stallingOneBot{intervalMs: 100}
	f.ts = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.ts.Close)

	msgs := make(chan *core.Message, 4)
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	if err := p.Start(func(_ core.Platform, m *core.Message) { msgs <- m }); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })

	// 等待上限：静默判定 2×100ms + reconnect 第一次退避 2s，留足余量。
	select {
	case m := <-msgs:
		if m.Content != "你好" {
			t.Fatalf("content = %q", m.Content)
		}
	case <-time.After(8 * time.Second):
		t.Fatalf("no message after the first socket went silent (connections=%d)", f.conns.Load())
	}
	if got := f.conns.Load(); got != 2 {
		t.Fatalf("connections = %d, want 2 (silent socket replaced once)", got)
	}
	if got := time.Duration(p.heartbeatInterval.Load()); got != 100*time.Millisecond {
		t.Fatalf("heartbeat interval = %v", got)
	}
}

// A server that never announces a heartbeat gives no liveness contract, so a
// quiet connection must be left alone rather than torn down on a guess.
func TestNoHeartbeatMeansNoDeadline(t *testing.T) {
	f := newFy69OneBot(t)
	p, _ := f.startPlatform(t)
	time.Sleep(300 * time.Millisecond)
	if p.heartbeatInterval.Load() != 0 {
		t.Fatal("interval learned without a heartbeat")
	}
	p.mu.Lock()
	alive := p.conn != nil
	p.mu.Unlock()
	if !alive {
		t.Fatal("quiet connection without heartbeat was dropped")
	}
}
