package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type promptCaptureSession struct {
	events  chan Event
	mu      sync.Mutex
	prompts []string
}

func newPromptCaptureSession() *promptCaptureSession {
	return &promptCaptureSession{events: make(chan Event, 8)}
}

func (s *promptCaptureSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	s.events <- Event{Type: EventResult, Content: "好", Done: true}
	return nil
}

func (s *promptCaptureSession) sent() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.prompts...)
}

func (s *promptCaptureSession) RespondPermission(_ string, _ PermissionResult) error { return nil }
func (s *promptCaptureSession) Events() <-chan Event                                 { return s.events }
func (s *promptCaptureSession) CurrentSessionID() string                             { return "ambient-session" }
func (s *promptCaptureSession) Alive() bool                                          { return true }
func (s *promptCaptureSession) Close() error                                         { return nil }

func ambientGate(t *testing.T, action func(gateRequest) string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var req gateRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		_ = json.NewEncoder(w).Encode(gateResponse{Action: action(req)})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func ambientEngine(t *testing.T, srv *httptest.Server) (*Engine, *promptCaptureSession, *stubPlatformEngine) {
	t.Helper()
	p := &stubPlatformEngine{n: "test"}
	sess := newPromptCaptureSession()
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateBurstWindow(60_000) // the test hands the burst back itself
	return e, sess, p
}

func TestGateBurstReentryMergesAmbientChatOnce(t *testing.T) {
	srv := ambientGate(t, func(gateRequest) string { return "reply" })
	e, sess, p := ambientEngine(t, srv)

	const ambient = "[群里刚才的聊天]\n甲：在吗"
	msg := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u", UserName: "u", Content: "你好", Mentioned: true, ReplyCtx: "ctx",
		AmbientChat: ambient,
	}
	e.handleMessage(p, msg) // held for the burst
	h := releaseHeld(t, e, "test:c1")
	e.handleMessage(p, h) // what the burst timer does

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if n := strings.Count(got, ambient); n != 1 {
		t.Fatalf("ambient chat appears %d times, want once:\n%s", n, got)
	}
	if !strings.Contains(got, "你好") {
		t.Fatalf("prompt lost the user's words: %q", got)
	}
}

func TestGateSilentBufferDropsAmbientChat(t *testing.T) {
	srv := ambientGate(t, func(req gateRequest) string {
		if req.Mentioned {
			return "reply"
		}
		return "silent"
	})
	e, sess, p := ambientEngine(t, srv)

	quiet := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u", UserName: "u", Content: "他们聊什么呢", ReplyCtx: "ctx",
		AmbientChat: "[群里刚才的聊天]\n甲：旧背景不该进下一轮",
	}
	e.gate.released[quiet] = true
	e.handleMessage(p, quiet)

	call := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
		UserID: "u", UserName: "u", Content: "Assistant你呢", Mentioned: true, ReplyCtx: "ctx",
		AmbientChat: "[群里刚才的聊天]\n甲：新背景",
	}
	e.gate.released[call] = true
	e.handleMessage(p, call)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if strings.Contains(got, "旧背景不该进下一轮") {
		t.Fatalf("silent buffer kept the ambient chat of an earlier message:\n%s", got)
	}
	if !strings.Contains(got, "他们聊什么呢") {
		t.Fatalf("silent buffer lost the buffered message:\n%s", got)
	}
	if n := strings.Count(got, "[群里刚才的聊天]"); n != 1 {
		t.Fatalf("prompt has %d chat blocks, want just the current one:\n%s", n, got)
	}
}

func TestGateDigestKeepsSenderNameForNewestAndBuffered(t *testing.T) {
	srv := ambientGate(t, func(req gateRequest) string {
		if req.Mentioned {
			return "reply"
		}
		return "silent"
	})
	e, sess, p := ambientEngine(t, srv)

	quiet := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u2", UserName: "Bob", Content: "旧消息甲", ReplyCtx: "ctx",
		AmbientChat: "[群里刚才的聊天]\nBob：别的",
	}
	e.gate.released[quiet] = true
	e.handleMessage(p, quiet)

	ask := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
		UserID: "u1", UserName: "Alice", Content: "描述一下我的画像", Mentioned: true, ReplyCtx: "ctx",
		AmbientChat: "[群里刚才的聊天]\nBob：草",
	}
	e.gate.released[ask] = true
	e.handleMessage(p, ask)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if !strings.Contains(got, "Alice：描述一下我的画像") {
		t.Fatalf("newest message lost its sender label:\n%s", got)
	}
	if !strings.Contains(got, "Bob：旧消息甲") {
		t.Fatalf("buffered message lost its sender label:\n%s", got)
	}
	if n := strings.Count(got, "[群里刚才的聊天]"); n != 1 {
		t.Fatalf("prompt has %d chat blocks, want just the current one:\n%s", n, got)
	}
}

func TestBufferedTextDropsAmbientChatBeforeQuote(t *testing.T) {
	const ambient = "[群里刚才的聊天]\nBob：旧背景"
	msg := &Message{
		AmbientChat: ambient,
		Content:     "[引用消息]\n甲：被引用的话\n" + ambient + "\nAlice：正文",
	}
	got := bufferedText(msg)
	if strings.Contains(got, "[群里刚才的聊天]") {
		t.Fatalf("ambient chat leaked into the buffer:\n%s", got)
	}
	if !strings.Contains(got, "被引用的话") || !strings.Contains(got, "Alice：正文") {
		t.Fatalf("buffer lost the quote or the user's words:\n%s", got)
	}
}

func TestGateFallbackKeepsConfiguredAction(t *testing.T) {
	for _, action := range []string{"silent", "context", "reply", "insert"} {
		g := &gateState{fallback: action}
		if got := g.fallbackFor(gateRequest{}); got != action {
			t.Fatalf("non-@ gate failure fallback = %q, want configured %q", got, action)
		}
	}
	if got := (&gateState{fallback: "silent"}).fallbackFor(gateRequest{Mentioned: true}); got != "reply" {
		t.Fatalf("@ gate failure fallback = %q, want reply", got)
	}
}

func timeoutGate(t *testing.T, delay time.Duration) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		select {
		case <-r.Context().Done():
		case <-time.After(delay):
			_ = json.NewEncoder(w).Encode(gateResponse{Action: "silent"})
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func fallbackTestEngine(t *testing.T, url, fallback string) (*Engine, *stubPlatformEngine, *Session) {
	t.Helper()
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: newPromptCaptureSession()}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate(url, 40, fallback)
	e.SetGateBurstWindow(60_000)
	return e, p, e.sessions.GetOrCreateActive("qq:g:1")
}

func TestApplyGateSilentFallbackOnGateFailureDoesNotStartTurns(t *testing.T) {
	srv := timeoutGate(t, 200*time.Millisecond)
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	for name, url := range map[string]string{"timeout": srv.URL, "unreachable": deadURL} {
		t.Run(name, func(t *testing.T) {
			e, p, s := fallbackTestEngine(t, url, "silent")
			for i, text := range []string{"第一句闲聊", "第二句闲聊", "第三句闲聊"} {
				msg := &Message{SessionKey: "qq:g:1", GroupChat: true, UserName: "Bob",
					MessageID: strconv.Itoa(i + 1), Content: text, ReplyCtx: "ctx"}
				e.gate.released[msg] = true
				if !e.applyGate(p, msg, s, "k") {
					t.Fatalf("%s: non-mentioned message started a turn", name)
				}
			}
			if got := p.getSent(); len(got) != 0 {
				t.Fatalf("%s: gate failure replied to background chatter: %v", name, got)
			}
			e.gate.mu.Lock()
			buffered := append([]string(nil), e.gate.buf["k"]...)
			e.gate.mu.Unlock()
			if len(buffered) != 3 {
				t.Fatalf("%s: buffered = %v, want the three messages kept for the next reply", name, buffered)
			}
			// The configured silent fallback must not swallow them forever: the next
			// explicitly addressed message still receives the buffered context.
			call := &Message{SessionKey: "qq:g:1", GroupChat: true, UserName: "Alice",
				MessageID: "4", Content: "Assistant你在吗？", Mentioned: true, ReplyCtx: "ctx"}
			e.gate.released[call] = true
			if e.applyGate(p, call, s, "k") {
				t.Fatalf("%s: explicit call was swallowed", name)
			}
			if !strings.Contains(call.Content, "第一句闲聊") || !strings.Contains(call.Content, "Assistant你在吗？") {
				t.Fatalf("%s: buffered chatter did not reach the next reply:\n%s", name, call.Content)
			}
		})
	}
}

func TestApplyGateMentionedReplyOnGateFailureKeepsQuestion(t *testing.T) {
	srv := timeoutGate(t, 200*time.Millisecond)
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	for name, url := range map[string]string{"timeout": srv.URL, "unreachable": deadURL} {
		t.Run(name, func(t *testing.T) {
			e, p, s := fallbackTestEngine(t, url, "silent")
			msg := &Message{SessionKey: "qq:g:1", GroupChat: true, UserName: "Alice",
				MessageID: "1", Content: "Assistant你在吗？", Mentioned: true, ReplyCtx: "ctx"}
			e.gate.released[msg] = true
			if e.applyGate(p, msg, s, "k") {
				t.Fatalf("%s: an explicitly mentioned message was swallowed", name)
			}
			if !strings.Contains(msg.Content, "Assistant你在吗？") {
				t.Fatalf("%s: the question disappeared:\n%s", name, msg.Content)
			}
			if strings.Contains(msg.Content, insertNote) {
				t.Fatalf("%s: the question was labelled as non-question:\n%s", name, msg.Content)
			}
			if len(p.getSent()) != 0 {
				t.Fatalf("%s: applyGate should leave the reply to the normal turn: %v", name, p.getSent())
			}
		})
	}
}

func TestGateEmptyAmbientKeepsDistinctSenders(t *testing.T) {
	srv := ambientGate(t, func(req gateRequest) string {
		if req.Mentioned {
			return "reply"
		}
		return "silent"
	})
	e, sess, p := ambientEngine(t, srv)

	quiet := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u2", UserName: "Bob", GroupChat: true, Content: "旧消息甲", ReplyCtx: "ctx",
	}
	e.gate.released[quiet] = true
	e.handleMessage(p, quiet)

	ask := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
		UserID: "u1", UserName: "Alice", GroupChat: true, Content: "描述一下我的画像", Mentioned: true, ReplyCtx: "ctx",
	}
	e.gate.released[ask] = true
	e.handleMessage(p, ask)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if !strings.Contains(got, "Bob：旧消息甲") {
		t.Fatalf("buffered message lost its sender without ambient chat:\n%s", got)
	}
	if !strings.Contains(got, "Alice：描述一下我的画像") {
		t.Fatalf("newest message lost its sender without ambient chat:\n%s", got)
	}
	if strings.Count(got, "[群里刚才的聊天]") != 0 {
		t.Fatalf("unexpected ambient block in an empty-ambient case:\n%s", got)
	}
}

func TestGateEmptyAmbientBurstKeepsEachSender(t *testing.T) {
	srv := ambientGate(t, func(req gateRequest) string { return "reply" })
	e, sess, p := ambientEngine(t, srv)

	first := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u2", UserName: "Bob", GroupChat: true, Content: "第一句", ReplyCtx: "ctx",
	}
	e.handleMessage(p, first) // held for the burst
	second := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
		UserID: "u1", UserName: "Alice", GroupChat: true, Content: "第二句", ReplyCtx: "ctx",
	}
	e.handleMessage(p, second) // folds into the held burst
	e.handleMessage(p, releaseHeld(t, e, "test:c1"))

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if !strings.Contains(got, "Bob：第一句") || !strings.Contains(got, "Alice：第二句") {
		t.Fatalf("burst lost a sender without ambient chat:\n%s", got)
	}
}

func TestGateEmptyAmbientQuoteKeepsSpeakers(t *testing.T) {
	srv := ambientGate(t, func(gateRequest) string { return "reply" })
	e, sess, p := ambientEngine(t, srv)

	msg := &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
		UserID: "u1", UserName: "Alice", GroupChat: true, Content: "我的回答", Mentioned: true, ReplyCtx: "ctx",
		ExtraContent: "[引用消息]\nBob：被引用的话",
	}
	e.gate.released[msg] = true
	e.handleMessage(p, msg)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if !strings.Contains(got, "Bob：被引用的话") {
		t.Fatalf("quote lost the quoted speaker:\n%s", got)
	}
	if !strings.Contains(got, "Alice：我的回答") {
		t.Fatalf("current speaker lost their label next to a quote:\n%s", got)
	}
}

func TestSenderTextLeavesDMsAndCommandsAlone(t *testing.T) {
	cases := []struct {
		name string
		msg  *Message
		text string
		want string
	}{
		{"group", &Message{GroupChat: true, UserName: "Alice"}, "你好", "Alice：你好"},
		{"dm", &Message{GroupChat: true, Direct: true, UserName: "Alice"}, "你好", "你好"},
		{"slash", &Message{GroupChat: true, UserName: "Alice"}, "/new", "/new"},
		{"bang", &Message{GroupChat: true, UserName: "Alice"}, "!ls", "!ls"},
		{"bot", &Message{GroupChat: true, FromBot: true, UserName: "Helper"}, "汇报", "汇报"},
	}
	for _, c := range cases {
		if got := senderText(c.msg, c.text); got != c.want {
			t.Fatalf("%s: senderText = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestQueuedTurnKeepsItsOwnSender(t *testing.T) {
	_, e, a, p, s := inputFixture(t)
	e.SetInjectSender(true)
	send := func(id, uid, name, content string) {
		e.ReceiveMessage(p, &Message{
			SessionKey: inputTestKey, Platform: p.Name(), MessageID: id,
			UserID: uid, UserName: name, Content: content, Mentioned: true, ReplyCtx: "local",
		})
	}
	send("first", "u1", "Alice", "第一句")
	_ = inputPrompt(t, a) // the first turn is running and blocks the session
	send("second", "u2", "Bob", "第二句")
	inputDone(a, "first result")
	second := inputPrompt(t, a)
	if !strings.Contains(second, "sender_id=u2") || !strings.Contains(second, `sender_name="Bob"`) {
		t.Fatalf("queued turn lost its sender: %q", second)
	}
	if strings.Contains(second, `sender_name="Alice"`) {
		t.Fatalf("queued turn kept the previous sender: %q", second)
	}
	inputDone(a, "second result")
	inputWait(t, func() bool { return !s.Busy() })
}
