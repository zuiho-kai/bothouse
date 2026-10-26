package qq

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

	"github.com/gorilla/websocket"
)

// botUserID is the fake QQ account bothouse runs as in these tests.
// 测试常量：只是一个假 QQ 号，不是产品参数。
const botUserID = 10000

// fakeOneBot is a minimal OneBot v11 forward-WebSocket server: it answers the
// actions bothouse sends and lets a test push message events to the client.
type fakeOneBot struct {
	t  *testing.T
	ts *httptest.Server

	mu       sync.Mutex
	conn     *websocket.Conn
	handlers map[string]func(params map[string]any) map[string]any
	gates    map[string]chan struct{}
	sent     map[string][]map[string]any // action -> params of every call

	writeMu sync.Mutex
	actions chan string
}

func newFakeOneBot(t *testing.T) *fakeOneBot {
	t.Helper()
	f := &fakeOneBot{
		t:        t,
		handlers: map[string]func(map[string]any) map[string]any{},
		gates:    map[string]chan struct{}{},
		sent:     map[string][]map[string]any{},
		actions:  make(chan string, 256),
	}
	f.handlers["get_login_info"] = func(map[string]any) map[string]any {
		return map[string]any{"user_id": botUserID, "nickname": "TestBot"}
	}
	f.ts = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.ts.Close)
	return f
}

func (f *fakeOneBot) serve(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	f.mu.Lock()
	f.conn = c
	f.mu.Unlock()

	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			return
		}
		var req map[string]any
		if json.Unmarshal(raw, &req) != nil {
			continue
		}
		action, _ := req["action"].(string)
		params, _ := req["params"].(map[string]any)
		f.mu.Lock()
		f.sent[action] = append(f.sent[action], params)
		f.mu.Unlock()
		select {
		case f.actions <- action:
		default:
		}
		go f.respond(req, action)
	}
}

func (f *fakeOneBot) respond(req map[string]any, action string) {
	if gate := f.gateFor(action); gate != nil {
		<-gate
	}
	f.mu.Lock()
	h := f.handlers[action]
	f.mu.Unlock()

	data := map[string]any{}
	if h != nil {
		params, _ := req["params"].(map[string]any)
		if d := h(params); d != nil {
			data = d
		}
	}
	f.write(map[string]any{
		"status":  "ok",
		"retcode": 0,
		"echo":    req["echo"],
		"data":    data,
	})
}

func (f *fakeOneBot) gateFor(action string) chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gates[action]
}

// hold makes the server wait for the returned release func before answering
// action, so a test can prove dispatch does not wait on that round trip.
func (f *fakeOneBot) hold(action string) (release func()) {
	gate := make(chan struct{})
	f.mu.Lock()
	f.gates[action] = gate
	f.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			f.mu.Lock()
			delete(f.gates, action)
			f.mu.Unlock()
			close(gate)
		})
	}
}

func (f *fakeOneBot) on(action string, h func(params map[string]any) map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.handlers[action] = h
}

// paramsOf returns the params of the n-th call of action (0-based).
func (f *fakeOneBot) paramsOf(action string, n int) map[string]any {
	f.t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	calls := f.sent[action]
	if len(calls) <= n {
		f.t.Fatalf("%s called %d times, want at least %d", action, len(calls), n+1)
	}
	return calls[n]
}

func (f *fakeOneBot) record() map[string][]map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string][]map[string]any, len(f.sent))
	for k, v := range f.sent {
		out[k] = append([]map[string]any(nil), v...)
	}
	return out
}

func (f *fakeOneBot) write(v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	f.mu.Lock()
	c := f.conn
	f.mu.Unlock()
	if c == nil {
		return
	}
	f.writeMu.Lock()
	defer f.writeMu.Unlock()
	_ = c.WriteMessage(websocket.TextMessage, raw)
}

func (f *fakeOneBot) push(event map[string]any) {
	f.write(event)
}

func (f *fakeOneBot) awaitAction(action string) {
	f.t.Helper()
	for {
		select {
		case got := <-f.actions:
			if got == action {
				return
			}
		case <-time.After(3 * time.Second):
			f.t.Fatalf("OneBot action %q was never sent", action)
		}
	}
}

// startTestPlatform connects a Platform to the fake server.
func startTestPlatform(t *testing.T, f *fakeOneBot) (*Platform, chan *core.Message) {
	t.Helper()
	msgs := make(chan *core.Message, 16)
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	if err := p.Start(func(_ core.Platform, m *core.Message) { msgs <- m }); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	return p, msgs
}

func awaitMessage(t *testing.T, msgs chan *core.Message) *core.Message {
	t.Helper()
	select {
	case m := <-msgs:
		return m
	case <-time.After(3 * time.Second):
		t.Fatal("no message dispatched to the engine within 3s")
		return nil
	}
}

func textSegment(s string) map[string]any {
	return map[string]any{"type": "text", "data": map[string]any{"text": s}}
}

func atSegment(qq string) map[string]any {
	return map[string]any{"type": "at", "data": map[string]any{"qq": qq}}
}

func replySegment(id string) map[string]any {
	return map[string]any{"type": "reply", "data": map[string]any{"id": id}}
}

func groupMessage(groupID, userID, messageID int64, segments ...map[string]any) map[string]any {
	return map[string]any{
		"post_type":    "message",
		"message_type": "group",
		"sub_type":     "normal",
		"time":         time.Now().Unix(),
		"self_id":      botUserID,
		"message_id":   messageID,
		"group_id":     groupID,
		"user_id":      userID,
		"sender":       map[string]any{"user_id": userID, "nickname": "成员", "card": ""},
		"message":      segments,
		"raw_message":  "",
	}
}

func privateMessage(userID, messageID int64, segments ...map[string]any) map[string]any {
	return map[string]any{
		"post_type":    "message",
		"message_type": "private",
		"sub_type":     "friend",
		"time":         time.Now().Unix(),
		"self_id":      botUserID,
		"message_id":   messageID,
		"user_id":      userID,
		"sender":       map[string]any{"user_id": userID, "nickname": "好友", "card": ""},
		"message":      segments,
		"raw_message":  "",
	}
}

// TestGroupAt_SetsMentionedAndStripsAt is the core of #344 part 2: a group @
// has to reach the engine as Message.Mentioned, otherwise team mode can never
// tell "called me" from background chatter (core/gate_local.go).
func TestGroupAt_SetsMentionedAndStripsAt(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, atSegment("10000"), textSegment(" 你好")))

	m := awaitMessage(t, msgs)
	if !m.Mentioned {
		t.Error("Mentioned = false, want true for a group @ of the bot")
	}
	if m.Content != "你好" {
		t.Errorf("Content = %q, want %q (the bot's own @ must not reach the model)", m.Content, "你好")
	}
	if m.Direct {
		t.Error("Direct = true, want false in a group chat")
	}
}

// A bare @ (a poke to start a turn) must not be dropped as an empty message.
func TestGroupBareAt_KeepsMessage(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 2, atSegment("10000")))

	m := awaitMessage(t, msgs)
	if !m.Mentioned {
		t.Error("Mentioned = false, want true for a bare @")
	}
	if strings.TrimSpace(m.Content) == "" {
		t.Error("Content is empty; a bare @ must still start a turn")
	}
}

// Someone else's @ stays in the text so the model knows who was addressed.
func TestGroupAtOther_NotMentioned(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	seg := atSegment("2002")
	seg["data"].(map[string]any)["name"] = "张三"
	f.push(groupMessage(111, 2001, 3, seg, textSegment(" 你看一下")))

	m := awaitMessage(t, msgs)
	if m.Mentioned {
		t.Error("Mentioned = true, want false when only another user is @-ed")
	}
	if m.Content != "@张三 你看一下" {
		t.Errorf("Content = %q, want %q", m.Content, "@张三 你看一下")
	}
}

// A private chat calls the bot by definition (core/gate_local.go Direct).
func TestPrivateMessage_SetsDirect(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(privateMessage(2001, 4, textSegment("在吗")))

	m := awaitMessage(t, msgs)
	if !m.Direct {
		t.Error("Direct = false, want true for a private chat")
	}
	if m.Mentioned {
		t.Error("Mentioned = true, want false (a DM is Direct, not an @)")
	}
	if m.SessionKey != "qq:2001" {
		t.Errorf("SessionKey = %q, want %q", m.SessionKey, "qq:2001")
	}
}

// Replying to the bot's own message counts like an @, and the quoted text has
// to reach the model as ExtraContent.
func TestGroupReplyToBot_SetsMentionedAndQuotes(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 4242}
	})
	p, msgs := startTestPlatform(t, f)

	if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 111}, "我之前的回复"); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	f.push(groupMessage(111, 2001, 5, replySegment("4242"), textSegment(" 继续")))

	m := awaitMessage(t, msgs)
	if !m.Mentioned {
		t.Error("Mentioned = false, want true when replying to the bot's own message")
	}
	if m.ExtraContent != "[引用消息]\n我之前的回复" {
		t.Errorf("ExtraContent = %q, want %q", m.ExtraContent, "[引用消息]\n我之前的回复")
	}
	if m.Content != "继续" {
		t.Errorf("Content = %q, want %q", m.Content, "继续")
	}
}

// A reply to somebody else is context, not a call.
func TestGroupReplyToOther_QuotesWithoutMention(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 6, textSegment("之前的讨论内容")))
	first := awaitMessage(t, msgs)
	if first.Mentioned {
		t.Fatal("precondition: a plain group message must not be Mentioned")
	}

	f.push(groupMessage(111, 2002, 7, replySegment(first.MessageID), textSegment(" 看看这个")))

	m := awaitMessage(t, msgs)
	if m.Mentioned {
		t.Error("Mentioned = true, want false when replying to another user")
	}
	if m.ExtraContent != "[引用消息]\n之前的讨论内容" {
		t.Errorf("ExtraContent = %q, want %q", m.ExtraContent, "[引用消息]\n之前的讨论内容")
	}
}

// The read loop must not run message handling itself: while one message is
// being handled, OneBot API responses (here a reply send) still have to be read.
func TestReadLoop_StaysResponsiveWhileHandlingMessage(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 1}
	})

	blocking := make(chan struct{})
	msgs := make(chan *core.Message, 16)
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	if err := p.Start(func(_ core.Platform, m *core.Message) {
		msgs <- m
		<-blocking // stand in for a slow engine call on the handling path
	}); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	t.Cleanup(func() {
		select {
		case <-blocking:
		default:
			close(blocking)
		}
	})

	f.push(groupMessage(111, 2001, 8, textSegment("卡住")))

	select {
	case <-msgs:
	case <-time.After(3 * time.Second):
		t.Fatal("handler was not called")
	}

	// The handler is now blocked; an API call must still complete promptly.
	done := make(chan error, 1)
	go func() {
		_, err := p.callAPI("get_login_info", nil)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("callAPI failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("callAPI did not complete while a message was being handled: the read loop is running user code")
	}
}

// Resolving a group name must not hold up dispatch: the name is cosmetic, but a
// get_group_info round trip takes 15s when the OneBot side does not answer, and
// every group message would wait for it.
func TestGroupName_DoesNotBlockDispatch(t *testing.T) {
	f := newFakeOneBot(t)
	release := f.hold("get_group_info")
	f.on("get_group_info", func(map[string]any) map[string]any {
		return map[string]any{"group_name": "测试群"}
	})
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 9, textSegment("第一句")))

	m := awaitMessage(t, msgs)
	if m.ChatName != "111" {
		t.Errorf("ChatName = %q, want the group id %q while the name is still unknown", m.ChatName, "111")
	}
	release()
	f.awaitAction("get_group_info")

	// Once the lookup lands, later messages carry the real name. A fresh
	// message id each round: dedup drops a repeated id for 60s.
	deadline := time.Now().Add(3 * time.Second)
	for id := int64(10); ; id++ {
		f.push(groupMessage(111, 2001, id, textSegment("第二句")))
		m = awaitMessage(t, msgs)
		if m.ChatName == "测试群" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ChatName = %q, want %q after the background lookup", m.ChatName, "测试群")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// CQ-string messages (message_format=string) must be classified the same way.
func TestGroupAt_CQStringMessage(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	event := groupMessage(111, 2001, 11)
	event["message"] = "[CQ:at,qq=10000] 你好"
	event["raw_message"] = "[CQ:at,qq=10000] 你好"
	f.push(event)

	m := awaitMessage(t, msgs)
	if !m.Mentioned {
		t.Error("Mentioned = false, want true for a CQ-string @")
	}
	if m.Content != "你好" {
		t.Errorf("Content = %q, want %q", m.Content, "你好")
	}
}

func TestReplyWithAt_SendsAtSegments(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 77}
	})
	p, _ := startTestPlatform(t, f)

	if err := p.ReplyWithAt(context.Background(), &replyContext{messageType: "group", groupID: 111},
		"看一下", []string{"2002"}, false); err != nil {
		t.Fatalf("ReplyWithAt failed: %v", err)
	}

	params := f.paramsOf("send_group_msg", 0)
	segments, ok := params["message"].([]any)
	if !ok {
		t.Fatalf("message = %#v, want an array of segments so the @ is a real mention", params["message"])
	}
	var got []string
	for _, raw := range segments {
		seg, _ := raw.(map[string]any)
		data, _ := seg["data"].(map[string]any)
		switch seg["type"] {
		case "at":
			got = append(got, "at:"+data["qq"].(string))
		case "text":
			got = append(got, "text:"+data["text"].(string))
		}
	}
	want := []string{"at:2002", "text: 看一下"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("segments = %v, want %v", got, want)
	}
}

func TestReplyWithAt_AtAllUsesAllSegment(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)

	if err := p.ReplyWithAt(context.Background(), &replyContext{messageType: "group", groupID: 111},
		"集合", nil, true); err != nil {
		t.Fatalf("ReplyWithAt failed: %v", err)
	}

	segments, _ := f.paramsOf("send_group_msg", 0)["message"].([]any)
	if len(segments) == 0 {
		t.Fatal("no message segments sent")
	}
	first, _ := segments[0].(map[string]any)
	data, _ := first["data"].(map[string]any)
	if first["type"] != "at" || data["qq"] != "all" {
		t.Errorf("first segment = %#v, want an at segment for qq=all", first)
	}
}

var _ core.AtMentionSender = (*Platform)(nil)
