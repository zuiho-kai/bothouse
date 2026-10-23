package cloudweb

import (
	"context"
	"sync"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// recordingTransport acks previews like ackingTransport and records every frame.
type recordingTransport struct {
	ackingTransport
	fmu    sync.Mutex
	frames []map[string]any
}

func (f *recordingTransport) Send(ctx context.Context, msg map[string]any) error {
	f.fmu.Lock()
	f.frames = append(f.frames, msg)
	f.fmu.Unlock()
	return f.ackingTransport.Send(ctx, msg)
}

// #121: a gateway declaring reply_in_place gets text stream previews, and the final
// answer goes out as a reply frame carrying the preview handle (relayed by the gateway).
func TestReplyInPlaceEnablesTextPreview(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message", "reply_in_place"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	rc := replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2", Agent: true}
	h, err := p.SendPreviewStart(context.Background(), rc, "streaming text")
	if err != nil {
		t.Fatalf("text preview with reply_in_place: %v", err)
	}
	var _ core.PreviewReplier = p
	if err := p.ReplyInPlace(context.Background(), h, rc, "full answer <@222>"); err != nil {
		t.Fatalf("ReplyInPlace: %v", err)
	}
	last := ft.frames[len(ft.frames)-1]
	if last["type"] != "reply" || last["preview_handle"] != "hub-42" || last["reply_ctx"] != "room-2" || last["content"] != "full answer <@222>" || last["agent"] != true {
		t.Fatalf("reply frame = %#v", last)
	}
}

// An older gateway (no reply_in_place) keeps the previous behaviour: no text preview,
// and ReplyInPlace reports ErrNotSupported so core falls back to a normal reply.
func TestNoReplyInPlaceKeepsOldBehaviour(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	rc := replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}
	if _, err := p.SendPreviewStart(context.Background(), rc, "streaming text"); err != core.ErrNotSupported {
		t.Fatalf("plain preview: err = %v, want ErrNotSupported", err)
	}
	if err := p.ReplyInPlace(context.Background(), replyContext{SessionKey: rc.SessionKey, ReplyCtx: "hub-42"}, rc, "x"); err != core.ErrNotSupported {
		t.Fatalf("ReplyInPlace: err = %v, want ErrNotSupported", err)
	}
	if len(ft.frames) != 0 {
		t.Fatalf("no frame expected, got %#v", ft.frames)
	}
}
