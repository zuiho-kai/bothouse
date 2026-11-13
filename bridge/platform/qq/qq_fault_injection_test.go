package qq

// Issue #819 的隔离故障注入：慢响应、断连、限流、取消、发送者隔离、纯媒体输出。
//
// 每个注入点都落在真实的 OneBot WebSocket 适配器上（不是手写剧本）：本地假
// NapCat 按场景决定读/写/回执的行为，平台侧只用公开的 Send/SendImage 入口，
// 不碰生产、不连真实 QQ。红→绿证据见各测试注释里的命令与前后输出。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// faultUpstream 是可控的假 OneBot：socket 行为、回执行为和断连时机都由用例决定。
type faultUpstream struct {
	t  *testing.T
	ts *httptest.Server

	mu       sync.Mutex
	conns    []*websocket.Conn
	attempts map[string]int // action -> 到达上游的次数
	sent     map[string][]map[string]any
	writeMu  sync.Mutex
	done     chan struct{}
	handlers sync.WaitGroup

	// respond 决定给这个 action 回什么；nil 表示回成功。
	respond func(action string, n int) map[string]any
	// dropAfterRead 在读到第 n 次发送后直接关掉这条 socket，不回执（断连注入）。
	dropAfterRead func(action string, n int) bool
	// holdReceipt 扣住回执但继续读后续请求，不把慢回执混同于慢写。
	holdReceipt func(action string, n int) bool
	// stallAfterLogin：读完登录请求后不再读，模拟上游饱和/慢响应。
	stallAfterLogin bool
}

func newFaultUpstream(t *testing.T) *faultUpstream {
	t.Helper()
	f := &faultUpstream{t: t, attempts: map[string]int{}, sent: map[string][]map[string]any{}, done: make(chan struct{})}
	upgrader := websocket.Upgrader{}
	f.ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.handlers.Add(1)
		defer f.handlers.Done()
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		f.mu.Lock()
		f.conns = append(f.conns, c)
		stall := f.stallAfterLogin
		f.mu.Unlock()
		for {
			var req map[string]any
			if c.ReadJSON(&req) != nil {
				return
			}
			action, _ := req["action"].(string)
			if action == "get_login_info" {
				_ = f.write(c, map[string]any{"status": "ok", "retcode": 0, "echo": req["echo"],
					"data": map[string]any{"user_id": botUserID, "nickname": "FaultBot"}})
				if stall {
					<-f.done // 不再读；清理时仍能退出。
					return
				}
				continue
			}
			f.mu.Lock()
			f.attempts[action]++
			params, _ := req["params"].(map[string]any)
			f.sent[action] = append(f.sent[action], params)
			n := f.attempts[action]
			respond := f.respond
			drop := f.dropAfterRead
			f.mu.Unlock()
			if drop != nil && drop(action, n) {
				_ = c.Close()
				return
			}
			if f.holdReceipt != nil && f.holdReceipt(action, n) {
				continue
			}
			resp := map[string]any{"status": "ok", "retcode": 0, "echo": req["echo"],
				"data": map[string]any{"message_id": 7000 + n}}
			if respond != nil {
				if custom := respond(action, n); custom != nil {
					resp = custom
					resp["echo"] = req["echo"]
				}
			}
			if f.write(c, resp) != nil {
				return
			}
		}
	}))
	t.Cleanup(func() {
		close(f.done)
		f.ts.Close()
		f.closeConnections()
		f.handlers.Wait()
	})
	return f
}

func (f *faultUpstream) write(c *websocket.Conn, value any) error {
	f.writeMu.Lock()
	defer f.writeMu.Unlock()
	return c.WriteJSON(value)
}

func (f *faultUpstream) push(event map[string]any) {
	f.t.Helper()
	f.mu.Lock()
	c := f.conns[len(f.conns)-1]
	f.mu.Unlock()
	if err := f.write(c, event); err != nil {
		f.t.Fatal(err)
	}
}

func (f *faultUpstream) closeConnections() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.conns {
		_ = c.Close()
	}
}

func (f *faultUpstream) start(t *testing.T) *Platform {
	t.Helper()
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	if err := p.Start(func(core.Platform, *core.Message) {}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	return p
}

func (f *faultUpstream) count(action string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.attempts[action]
}

// ── 慢响应 ───────────────────────────────────────────────────────────
//
// 上游饱和（读端停止读）时，一帧大消息会把 socket 缓冲写满。修复前这条写是
// 在共享连接的互斥锁里无限等下去的：别的会话哪怕自带 700ms 期限，也排在锁后
// 拿不到自己的期限，整条桥的发送被一个慢对象拖死。修复后每次写在 ctx 期限内
// 收口，别的会话按自己的期限返回错误。
func TestSlowUpstreamWriteDoesNotStallOtherConversations(t *testing.T) {
	f := newFaultUpstream(t)
	f.stallAfterLogin = true
	p := f.start(t)

	// 一帧 8MB 足以填满本机回环缓冲。
	big := strings.Repeat("x", 8<<20)
	slowCtx, stopSlow := context.WithTimeout(context.Background(), 10*time.Second)
	slowDone := make(chan struct{})
	go func() {
		defer close(slowDone)
		_ = p.Send(slowCtx, &replyContext{messageType: "group", groupID: 1}, big)
	}()
	t.Cleanup(func() {
		stopSlow()
		f.closeConnections()
		select {
		case <-slowDone:
		case <-time.After(3 * time.Second):
			t.Error("slow sender did not exit after connection close")
		}
	})
	time.Sleep(300 * time.Millisecond) // 让慢写先拿住锁

	ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		defer close(done)
		done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 2}, "short")
	}()
	t.Cleanup(func() {
		cancel()
		f.closeConnections()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("second sender did not exit after connection close")
		}
	})
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("stalled upstream: second conversation reported success")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("second conversation waited past its own 700ms deadline: one stalled write holds every other sender")
	}
}

func TestSlowReceiptDoesNotBlockOtherConversations(t *testing.T) {
	f := newFaultUpstream(t)
	firstSeen := make(chan struct{})
	f.holdReceipt = func(action string, n int) bool {
		if action == "send_group_msg" && n == 1 {
			close(firstSeen)
			return true
		}
		return false
	}
	p := f.start(t)
	ctx, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		defer close(firstDone)
		firstDone <- p.Send(ctx, &replyContext{messageType: "group", groupID: 1}, "A")
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-firstDone:
		case <-time.After(3 * time.Second):
			t.Error("first sender did not exit after cancellation")
		}
	})
	select {
	case <-firstSeen:
	case <-time.After(3 * time.Second):
		t.Fatal("A was not written")
	}
	secondCtx, stopSecond := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer stopSecond()
	if err := p.Send(secondCtx, &replyContext{messageType: "group", groupID: 2}, "B"); err != nil {
		t.Fatalf("B could not send while A's receipt was held: %v", err)
	}
	if got := f.count("send_group_msg"); got != 2 {
		t.Fatalf("upstream received %d sends, want both A and B exactly once", got)
	}
	select {
	case err := <-firstDone:
		t.Fatalf("A finished before its withheld receipt or cancellation: %v", err)
	default:
	}
}

// ── 断连 ─────────────────────────────────────────────────────────────
//
// 上游在收到请求后直接断链、不回执：发送必须以错误收场（不能当成功），且同一
// 条消息不会被重放第二次；重连之后新的发送要能正常出去。
func TestDisconnectDuringReceiptFailsWithoutReplay(t *testing.T) {
	f := newFaultUpstream(t)
	f.dropAfterRead = func(action string, n int) bool { return action == "send_group_msg" && n == 1 }
	p := f.start(t)

	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	err := p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "one message")
	if err == nil {
		t.Fatal("Send = nil after the upstream dropped the socket, want an error")
	}
	// The disconnected request now fails immediately, so wait for actual
	// recovery rather than relying on time spent waiting for its old receipt.
	deadline := time.Now().Add(5 * time.Second)
	for {
		p.mu.Lock()
		connected := p.conn != nil
		p.mu.Unlock()
		if connected && p.outageStart.Load() == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("OneBot did not reconnect")
		}
		time.Sleep(time.Millisecond)
	}
	if got := f.count("send_group_msg"); got != 1 {
		t.Fatalf("send attempts = %d, want 1 (a dropped socket must not be replayed)", got)
	}
	if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 42}, "after reconnect"); err != nil {
		t.Fatalf("send after reconnect = %v, want success", err)
	}
}

// ── 限流 ─────────────────────────────────────────────────────────────
//
// NapCat 的限流回执是 status=failed + retcode（4.18.42 实测 1200 为风控/频繁）。
// 适配器只能把这一次失败如实交回上层：不重试、不重放，也不把连接弄坏。
func TestRateLimitedSendIsSurfacedOnceWithoutReplay(t *testing.T) {
	f := newFaultUpstream(t)
	f.respond = func(action string, n int) map[string]any {
		if action == "send_group_msg" && n == 1 {
			return map[string]any{"status": "failed", "retcode": 1200, "data": map[string]any{}}
		}
		return nil
	}
	p := f.start(t)

	err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 42}, "first")
	if err == nil || !strings.Contains(err.Error(), "retcode=1200") {
		t.Fatalf("Send = %v, want the upstream retcode=1200 surfaced", err)
	}
	if got := f.count("send_group_msg"); got != 1 {
		t.Fatalf("send attempts = %d, want 1 (rate-limit must not be retried by the adapter)", got)
	}
	// 限流是一次性拒绝，不是连接坏了：下一条要能正常出去。
	if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 42}, "second"); err != nil {
		t.Fatalf("send after rate limit = %v, want success (rejection must not poison the socket)", err)
	}
}

// ── 取消 ─────────────────────────────────────────────────────────────
//
// 一段回复拆成多个气泡时，取消发生在第一个气泡之后：剩下的气泡不能再发出去，
// 也不能留下等回执的 waiter。
func TestCancelledMultiPartSendStopsRemainingBubbles(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	p.splitReplyBubbles = true
	release := f.hold("send_group_msg")
	defer release()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "第一段\n\n第二段\n\n第三段")
	}()
	f.awaitAction("send_group_msg")
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Send = %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled multi-part send did not return")
	}
	f.mu.Lock()
	got := len(f.sent["send_group_msg"])
	f.mu.Unlock()
	if got != 1 {
		t.Fatalf("bubbles sent = %d, want 1 (cancellation must stop the remaining parts)", got)
	}
	p.echoCh.Range(func(_, _ any) bool { t.Error("receipt waiter leaked after cancellation"); return true })
}

// ── 发送者隔离 ───────────────────────────────────────────────────────
//
// 纯图片的发送必须落到它自己那条会话：同一平台两个对象同时发图，不能串到
// 对方，也不能互相顶掉。
func TestMediaStaysInItsOwnConversation(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	img := core.ImageAttachment{MimeType: "image/png", Data: []byte("synthetic-image")}

	var wg sync.WaitGroup
	for _, rc := range []*replyContext{
		{messageType: "group", groupID: 111},
		{messageType: "private", userID: 222},
	} {
		wg.Add(1)
		go func(rctx *replyContext) {
			defer wg.Done()
			_ = p.SendImage(context.Background(), rctx, img)
		}(rc)
	}
	wg.Wait()

	f.mu.Lock()
	defer f.mu.Unlock()
	if got := len(f.sent["send_group_msg"]); got != 1 {
		t.Fatalf("group image sends = %d, want 1", got)
	}
	if got := len(f.sent["send_private_msg"]); got != 1 {
		t.Fatalf("private image sends = %d, want 1", got)
	}
	if gid := jsonInt64(f.sent["send_group_msg"][0], "group_id"); gid != 111 {
		t.Fatalf("group image went to group_id=%d, want 111", gid)
	}
	if uid := jsonInt64(f.sent["send_private_msg"][0], "user_id"); uid != 222 {
		t.Fatalf("private image went to user_id=%d, want 222", uid)
	}
}

// ── 纯媒体输出 ───────────────────────────────────────────────────────
//
// 一轮只有图片、没有正文：只能有一个图片气泡，不能先发一条空白文字再发图。
func TestMediaOnlyTurnSendsNoEmptyBubble(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	rctx := &replyContext{messageType: "group", groupID: 42}
	if err := p.Send(context.Background(), rctx, " \n\t"); err != nil {
		t.Fatalf("blank text = %v", err)
	}
	if err := p.SendImage(context.Background(), rctx, core.ImageAttachment{MimeType: "image/png", Data: []byte("synthetic-image")}); err != nil {
		t.Fatalf("SendImage = %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	calls := f.sent["send_group_msg"]
	if len(calls) != 1 {
		t.Fatalf("sends = %d, want 1 (blank text must not become a bubble)", len(calls))
	}
	raw, _ := json.Marshal(calls[0]["message"])
	if !strings.Contains(string(raw), `"type":"image"`) {
		t.Fatalf("the only send is not the image: %s", raw)
	}
}
