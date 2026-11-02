package qq

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/chenhg5/cc-connect/core"
)

// Issue #842: every QQ outbound send must leave one structured receipt, so an
// inbound message_id can be matched to the message_id NapCat returned for the
// send that answered it. Before the fix there is no such log at all, so these
// tests fail on the pre-fix code.
//
// The expected message strings are pinned here rather than imported from qq.go
// so these tests still build against the pre-fix code (a runtime red, not a
// compile error).
const (
	wantOutboundMessage = "qq: outbound message"
	wantOutboundFailed  = "qq: outbound message failed"
)

// slogCapture records every slog record as msg -> attrs so a test can assert
// the receipt fields without parsing text output.
type slogCapture struct {
	mu      sync.Mutex
	records []map[string]any
}

func (c *slogCapture) Enabled(context.Context, slog.Level) bool { return true }

func (c *slogCapture) Handle(_ context.Context, r slog.Record) error {
	rec := map[string]any{"msg": r.Message, "level": r.Level.String()}
	r.Attrs(func(a slog.Attr) bool {
		rec[a.Key] = a.Value.Any()
		return true
	})
	c.mu.Lock()
	c.records = append(c.records, rec)
	c.mu.Unlock()
	return nil
}

func (c *slogCapture) WithAttrs([]slog.Attr) slog.Handler { return c }
func (c *slogCapture) WithGroup(string) slog.Handler      { return c }

func captureSlog(t *testing.T) *slogCapture {
	t.Helper()
	c := &slogCapture{}
	prev := slog.Default()
	slog.SetDefault(slog.New(c))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return c
}

// find waits for one receipt for sessionKey and returns it.
func (c *slogCapture) find(t *testing.T, msg, sessionKey string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if rec := c.lookup(msg, sessionKey); rec != nil {
			return rec
		}
		time.Sleep(10 * time.Millisecond)
	}
	c.mu.Lock()
	seen := make([]string, 0, len(c.records))
	for _, r := range c.records {
		seen = append(seen, fmt.Sprintf("%v/%v", r["msg"], r["session_key"]))
	}
	c.mu.Unlock()
	t.Fatalf("no %q receipt for session %q within 3s; captured %v", msg, sessionKey, seen)
	return nil
}

func (c *slogCapture) lookup(msg, sessionKey string) map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range c.records {
		if r["msg"] == msg && r["session_key"] == sessionKey {
			return r
		}
	}
	return nil
}

func assertReceiptField(t *testing.T, rec map[string]any, key string, want any) {
	t.Helper()
	if got := rec[key]; got != want {
		t.Errorf("receipt[%q] = %v (%T), want %v (%T)", key, got, got, want, want)
	}
}

// newReceiptPlatform builds a started platform through the public factory, so
// the test also pins that the cc_project wiring reaches the platform.
func newReceiptPlatform(t *testing.T, f *fakeOneBot, project string) (*Platform, chan *core.Message) {
	t.Helper()
	msgs := make(chan *core.Message, 16)
	opts := map[string]any{
		"ws_url":                   "ws" + strings.TrimPrefix(f.ts.URL, "http"),
		"allow_from":               "*",
		"share_session_in_channel": true,
	}
	if project != "" {
		opts["cc_project"] = project
	}
	raw, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	p, ok := raw.(*Platform)
	if !ok {
		t.Fatalf("New returned %T, want *Platform", raw)
	}
	if err := p.Start(func(_ core.Platform, m *core.Message) { msgs <- m }); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	return p, msgs
}

func TestOutboundReceipt_GroupSendCarriesInboundAndOutboundIDs(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9001}
	})
	f.push(groupMessage(111, 222, 5555, textSegment("你好")))
	m := awaitMessage(t, msgs)

	if err := p.Send(context.Background(), m.ReplyCtx, "回复正文"); err != nil {
		t.Fatalf("Send: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:111")
	assertReceiptField(t, rec, "pid", int64(os.Getpid()))
	assertReceiptField(t, rec, "project", "qqtest")
	assertReceiptField(t, rec, "session_key", "qq:g:111")
	assertReceiptField(t, rec, "in_message_id", "5555")
	assertReceiptField(t, rec, "out_message_id", "9001")
	assertReceiptField(t, rec, "action", "send_group_msg")
	assertReceiptField(t, rec, "content", "回复正文")
	assertReceiptField(t, rec, "content_len", int64(utf8.RuneCountInString("回复正文")))
}

func TestOutboundReceipt_PrivateSendUsesPrivateSessionKey(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_private_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9002}
	})
	f.push(privateMessage(222, 6666, textSegment("hi")))
	m := awaitMessage(t, msgs)

	if err := p.Send(context.Background(), m.ReplyCtx, "ok"); err != nil {
		t.Fatalf("Send: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:222")
	assertReceiptField(t, rec, "in_message_id", "6666")
	assertReceiptField(t, rec, "out_message_id", "9002")
	assertReceiptField(t, rec, "action", "send_private_msg")
}

func TestOutboundReceipt_ReplyWithAtCarriesAction(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9003}
	})
	f.push(groupMessage(111, 222, 5555, textSegment("hi")))
	m := awaitMessage(t, msgs)

	if err := p.ReplyWithAt(context.Background(), m.ReplyCtx, "内容", []string{"222"}, false); err != nil {
		t.Fatalf("ReplyWithAt: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:111")
	assertReceiptField(t, rec, "action", "send_group_msg")
	assertReceiptField(t, rec, "in_message_id", "5555")
	assertReceiptField(t, rec, "out_message_id", "9003")
}

func TestOutboundReceipt_SendImageRecordsOutboundID(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9004}
	})
	f.push(groupMessage(111, 222, 5555, textSegment("看图")))
	m := awaitMessage(t, msgs)

	img := core.ImageAttachment{MimeType: "image/png", Data: []byte{1, 2, 3}}
	if err := p.SendImage(context.Background(), m.ReplyCtx, img); err != nil {
		t.Fatalf("SendImage: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:111")
	assertReceiptField(t, rec, "action", "send_group_msg")
	assertReceiptField(t, rec, "in_message_id", "5555")
	assertReceiptField(t, rec, "out_message_id", "9004")
	if content, _ := rec["content"].(string); !strings.Contains(content, "image") {
		t.Errorf("receipt content = %q, want it to name the image payload", content)
	}
}

func TestOutboundReceipt_SendAudioRecordsOutboundID(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9005}
	})
	f.push(groupMessage(111, 222, 5555, textSegment("语音")))
	m := awaitMessage(t, msgs)

	if err := p.SendAudio(context.Background(), m.ReplyCtx, []byte{1, 2, 3, 4}, "mp3"); err != nil {
		t.Fatalf("SendAudio: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:111")
	assertReceiptField(t, rec, "action", "send_group_msg")
	assertReceiptField(t, rec, "in_message_id", "5555")
	assertReceiptField(t, rec, "out_message_id", "9005")
	if content, _ := rec["content"].(string); !strings.Contains(content, "voice") {
		t.Errorf("receipt content = %q, want it to name the voice payload", content)
	}
}

func TestOutboundReceipt_SendFilePrivateRecordsOutboundID(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_private_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9006}
	})
	f.push(privateMessage(222, 6666, textSegment("文件")))
	m := awaitMessage(t, msgs)

	file := core.FileAttachment{FileName: "a.txt", Data: []byte("abc")}
	if err := p.SendFile(context.Background(), m.ReplyCtx, file); err != nil {
		t.Fatalf("SendFile: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:222")
	assertReceiptField(t, rec, "action", "send_private_msg")
	assertReceiptField(t, rec, "in_message_id", "6666")
	assertReceiptField(t, rec, "out_message_id", "9006")
}

func TestOutboundReceipt_ProactiveSendHasEmptyInboundID(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, _ := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9007}
	})
	rc, err := p.ReconstructReplyCtx("qq:g:777")
	if err != nil {
		t.Fatalf("ReconstructReplyCtx: %v", err)
	}
	if err := p.Send(context.Background(), rc, "主动消息"); err != nil {
		t.Fatalf("Send: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:777")
	assertReceiptField(t, rec, "project", "qqtest")
	assertReceiptField(t, rec, "in_message_id", "")
	assertReceiptField(t, rec, "out_message_id", "9007")
}

func TestOutboundReceipt_FailedSendStillLogsReceipt(t *testing.T) {
	caps := captureSlog(t)

	// No Start(): the WebSocket is nil, so the send must fail before reaching
	// NapCat. The receipt must still record the attempt, the reason, and no
	// out message_id.
	raw, err := New(map[string]any{"cc_project": "qqtest"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	p := raw.(*Platform)
	rc, err := p.ReconstructReplyCtx("qq:g:778")
	if err != nil {
		t.Fatalf("ReconstructReplyCtx: %v", err)
	}
	if err := p.Send(context.Background(), rc, "hi"); err == nil {
		t.Fatal("Send without a connection should fail")
	}

	rec := caps.find(t, wantOutboundFailed, "qq:g:778")
	assertReceiptField(t, rec, "project", "qqtest")
	assertReceiptField(t, rec, "session_key", "qq:g:778")
	assertReceiptField(t, rec, "in_message_id", "")
	assertReceiptField(t, rec, "out_message_id", "")
	if rec["error"] == nil {
		t.Error("failed receipt should carry the send error")
	}
}

func TestOutboundReceipt_ContentSummaryReusesQuoteTruncation(t *testing.T) {
	f := newFakeOneBot(t)
	caps := captureSlog(t)
	p, msgs := newReceiptPlatform(t, f, "qqtest")

	f.on("send_group_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 9009}
	})
	f.push(groupMessage(111, 222, 5555, textSegment("hi")))
	m := awaitMessage(t, msgs)

	long := strings.Repeat("字", quotedTextMaxRunes+50)
	if err := p.Send(context.Background(), m.ReplyCtx, long); err != nil {
		t.Fatalf("Send: %v", err)
	}

	rec := caps.find(t, wantOutboundMessage, "qq:g:111")
	assertReceiptField(t, rec, "content_len", int64(utf8.RuneCountInString(long)))
	content, _ := rec["content"].(string)
	if got := utf8.RuneCountInString(content); got != quotedTextMaxRunes {
		t.Errorf("truncated content has %d runes, want %d", got, quotedTextMaxRunes)
	}
}
