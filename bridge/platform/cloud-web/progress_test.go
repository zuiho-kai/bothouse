package cloudweb

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func wsOpts(extra map[string]any) map[string]any {
	opts := map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws"}
	for k, v := range extra {
		opts[k] = v
	}
	return opts
}

// maomao fork: the gateway gets the same progress card as Discord (card style,
// latest 6 steps, kept after the turn) without extra config.
func TestProgressCardDefaultsLikeDiscord(t *testing.T) {
	var pl core.Platform = mustNew(t, wsOpts(nil))
	sp, ok := pl.(core.ProgressStyleProvider)
	if !ok || sp.ProgressStyle() != "card" {
		t.Fatalf("want progress style card by default, got ok=%v", ok)
	}
	if ps, ok := pl.(core.ProgressCardPayloadSupport); !ok || !ps.SupportsProgressCardPayload() {
		t.Fatal("card style must send the structured payload (gateway renders it)")
	}
	sz, ok := pl.(core.ProgressCardSizer)
	if !ok {
		t.Fatal("cloud_web must implement ProgressCardSizer")
	}
	if sz.ProgressCardEntries() != 6 || sz.ProgressCardLineLen() != 200 || sz.ProgressCardHideThinking() {
		t.Fatalf("defaults = %d/%d/%v, want 6/200/false", sz.ProgressCardEntries(), sz.ProgressCardLineLen(), sz.ProgressCardHideThinking())
	}
}

func TestProgressCardOptions(t *testing.T) {
	var pl core.Platform = mustNew(t, wsOpts(map[string]any{
		"progress_style": "legacy", "progress_card_entries": int64(3), "progress_line_len": int64(50), "progress_hide_thinking": true,
	}))
	if s := pl.(core.ProgressStyleProvider).ProgressStyle(); s != "legacy" {
		t.Fatalf("style = %q", s)
	}
	if pl.(core.ProgressCardPayloadSupport).SupportsProgressCardPayload() {
		t.Fatal("legacy style must not send the payload")
	}
	sz := pl.(core.ProgressCardSizer)
	if sz.ProgressCardEntries() != 3 || sz.ProgressCardLineLen() != 50 || !sz.ProgressCardHideThinking() {
		t.Fatalf("got %d/%d/%v", sz.ProgressCardEntries(), sz.ProgressCardLineLen(), sz.ProgressCardHideThinking())
	}
	if _, err := New(wsOpts(map[string]any{"progress_style": "fancy"})); err == nil {
		t.Fatal("unknown progress_style must be rejected")
	}
}

// ackingTransport answers preview_start inside Send, before Send returns — a gateway on
// localhost can be that fast. The ack only reaches a waiter registered before it arrives.
type ackingTransport struct {
	mu      sync.Mutex
	waiters map[string]chan string
	caps    map[string]bool
}

func (f *ackingTransport) Start(context.Context, inboundHandler) error { return nil }
func (f *ackingTransport) Stop() error                                 { return nil }
func (f *ackingTransport) Capabilities() map[string]bool               { return f.caps }
func (f *ackingTransport) Send(_ context.Context, msg map[string]any) error {
	if msg["type"] != "preview_start" {
		return nil
	}
	ref := fmt.Sprint(msg["ref_id"])
	f.mu.Lock()
	ch := f.waiters[ref]
	delete(f.waiters, ref)
	f.mu.Unlock()
	if ch != nil {
		ch <- "hub-42"
	}
	return nil
}

// old interface: registers only when waiting starts
func (f *ackingTransport) waitPreviewAck(refID string, timeout time.Duration) (string, error) {
	return f.expectPreviewAck(refID)(timeout)
}

func (f *ackingTransport) expectPreviewAck(refID string) func(time.Duration) (string, error) {
	ch := make(chan string, 1)
	f.mu.Lock()
	f.waiters[refID] = ch
	f.mu.Unlock()
	return func(timeout time.Duration) (string, error) {
		select {
		case h := <-ch:
			return h, nil
		case <-time.After(timeout):
			return "", fmt.Errorf("timeout")
		}
	}
}

func TestPreviewAckArrivingDuringSendIsNotLost(t *testing.T) {
	ft := &ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	start := time.Now()
	card := core.BuildProgressCardPayloadV2([]core.ProgressCardEntry{{Kind: core.ProgressEntryInfo, Text: "x"}}, false, "CC", core.LangChinese, core.ProgressCardStateRunning)
	h, err := p.SendPreviewStart(context.Background(), replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}, card)
	if err != nil {
		t.Fatalf("SendPreviewStart: %v (after %s)", err, time.Since(start))
	}
	if rc := h.(replyContext); rc.ReplyCtx != "hub-42" || rc.SessionKey != "cloud_web:room-2" {
		t.Fatalf("handle = %#v", rc)
	}
}

// Only progress cards use preview messages (review fix 1): a streaming text preview would leave
// interim text as an un-relayed, 2000-char-capped preview in the gateway; with ErrNotSupported
// core degrades the stream preview and sends each segment as a normal reply.
func TestPreviewOnlyForProgressCards(t *testing.T) {
	ft := &ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	rc := replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}
	if _, err := p.SendPreviewStart(context.Background(), rc, "streaming text"); err != core.ErrNotSupported {
		t.Fatalf("plain preview: err = %v, want ErrNotSupported", err)
	}
	card := core.BuildProgressCardPayloadV2([]core.ProgressCardEntry{{Kind: core.ProgressEntryToolUse, Text: "ls", Tool: "Bash"}}, false, "CC", core.LangChinese, core.ProgressCardStateRunning)
	if _, err := p.SendPreviewStart(context.Background(), rc, card); err != nil {
		t.Fatalf("card preview: %v", err)
	}
}

// An empty handle means the gateway did not create the message (archived room etc.): report it,
// so core falls back instead of editing a card that does not exist (review fix 5).
func TestEmptyPreviewHandleIsAnError(t *testing.T) {
	ft := &emptyAckTransport{ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	card := core.BuildProgressCardPayloadV2([]core.ProgressCardEntry{{Kind: core.ProgressEntryInfo, Text: "x"}}, false, "CC", core.LangChinese, core.ProgressCardStateRunning)
	if h, err := p.SendPreviewStart(context.Background(), replyContext{SessionKey: "s", ReplyCtx: "room-9"}, card); err == nil {
		t.Fatalf("want error for empty handle, got %#v", h)
	}
}

type emptyAckTransport struct{ ackingTransport }

func (f *emptyAckTransport) Send(_ context.Context, msg map[string]any) error {
	ref := fmt.Sprint(msg["ref_id"])
	f.mu.Lock()
	ch := f.waiters[ref]
	f.mu.Unlock()
	if ch != nil {
		ch <- ""
	}
	return nil
}
