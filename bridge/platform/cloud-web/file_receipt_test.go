package cloudweb

import (
	"context"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

type fileReceiptTransport struct {
	ackingTransport
	handle string
	frame  map[string]any
}

func (f *fileReceiptTransport) Send(_ context.Context, frame map[string]any) error {
	f.frame = frame
	if ref, ok := frame["ref_id"].(string); ok {
		f.mu.Lock()
		ch := f.waiters[ref]
		f.mu.Unlock()
		if ch != nil {
			ch <- f.handle
		}
	}
	return nil
}

func TestSendFileWaitsForAdvertisedReceipt(t *testing.T) {
	for _, tc := range []struct {
		name    string
		receipt bool
		handle  string
		wantErr string
	}{
		{name: "posted", receipt: true, handle: "42"},
		{name: "rejected", receipt: true, wantErr: "gateway rejected file"},
		{name: "older gateway"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			caps := []string{"file"}
			if tc.receipt {
				caps = append(caps, "file_receipt")
			}
			tp := &fileReceiptTransport{
				ackingTransport: ackingTransport{caps: capabilitySet(caps), waiters: map[string]chan string{}},
				handle:          tc.handle,
			}
			p := &Platform{tp: tp}
			rc := replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}
			err := p.SendFile(context.Background(), rc, core.FileAttachment{
				FileName: "full briefing.md", MimeType: "text/markdown", Data: []byte("note"),
			})
			if tc.wantErr == "" && err != nil {
				t.Fatalf("send: %v", err)
			}
			if tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)) {
				t.Fatalf("send error = %v, want %q", err, tc.wantErr)
			}
			if _, ok := tp.frame["ref_id"]; ok != tc.receipt {
				t.Fatalf("receipt requested = %v, want %v", ok, tc.receipt)
			}
			if tp.frame["type"] != "file" || tp.frame["reply_ctx"] != "room-2" ||
				tp.frame["file_name"] != "full briefing.md" || tp.frame["data"] != "bm90ZQ==" {
				t.Fatalf("incorrect file frame: %#v", tp.frame)
			}
		})
	}
}
