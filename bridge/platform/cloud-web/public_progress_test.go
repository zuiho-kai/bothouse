package cloudweb

import (
	"context"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #119: Channels sessions get a public task card: created once, then edited in place.
func TestTaskCardCreatedThenEdited(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	var _ core.TaskCardPublisher = p
	if _, err := p.TaskCardDestination("cloud_web:room-2"); err == nil {
		t.Fatal("destination without a known room must fail")
	}
	p.storeReplyCtx("cloud_web:room-2", "room-2")
	ch, err := p.TaskCardDestination("cloud_web:room-2")
	if err != nil || ch != "room-2" {
		t.Fatalf("destination = %q, %v", ch, err)
	}
	task := &core.Task{ID: "task-1", Title: "整理日志", SessionKey: "cloud_web:room-2", ChannelID: ch, State: core.TaskState("running"), LatestProgress: "开始"}
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatalf("create: %v", err)
	}
	first := ft.frames[0]
	if first["type"] != "preview_start" || first["ref_id"] != "taskcard-task-1" || first["reply_ctx"] != "room-2" || !strings.Contains(first["content"].(string), "整理日志") {
		t.Fatalf("create frame = %#v", first)
	}
	if !strings.HasPrefix(first["content"].(string), core.ProgressCardPayloadPrefix) {
		t.Fatalf("task card must use the progress-card payload so the gateway keeps it across reconnects: %q", first["content"])
	}
	if task.MessageID != "hub-42" {
		t.Fatalf("MessageID = %q", task.MessageID)
	}
	task.LatestProgress = "完成一半"
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatalf("update: %v", err)
	}
	last := ft.frames[len(ft.frames)-1]
	if len(ft.frames) != 2 || last["type"] != "update_message" || last["preview_handle"] != "hub-42" || !strings.Contains(last["content"].(string), "完成一半") {
		t.Fatalf("frames = %#v", ft.frames)
	}
}

// A gateway that cannot edit messages gets no card rather than a stream of new ones.
func TestTaskCardNeedsEditableMessages(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	p.storeReplyCtx("cloud_web:room-2", "room-2")
	if _, err := p.TaskCardDestination("cloud_web:room-2"); err != core.ErrNotSupported {
		t.Fatalf("err = %v, want ErrNotSupported", err)
	}
}
