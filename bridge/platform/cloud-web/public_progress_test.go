package cloudweb

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #119: Channels sessions get a public task card: created once, then edited in place.
func TestTaskCardCreatedThenEdited(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	var _ core.TaskCardPublisher = p
	if _, err := p.TaskCardDestination("cloud_web:dm-2"); err == nil {
		t.Fatal("destination without a known room must fail")
	}
	p.storeReplyCtx("cloud_web:room-2", "room-2")
	ch, err := p.TaskCardDestination("cloud_web:room-2")
	if err != nil || ch != "room-2" {
		t.Fatalf("destination = %q, %v", ch, err)
	}
	task := &core.Task{ID: "task-1", Title: "整理日志", SessionKey: "cloud_web:room-2", ChannelID: ch, State: core.TaskState("running"), LatestProgress: "开始", Seq: 1}
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
	if first["seq"] != int64(1) {
		t.Fatalf("create frame seq = %#v, want 1", first["seq"])
	}
	task.LatestProgress = "完成一半"
	task.Seq = 2
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatalf("update: %v", err)
	}
	last := ft.frames[len(ft.frames)-1]
	if len(ft.frames) != 2 || last["type"] != "update_message" || last["preview_handle"] != "hub-42" || !strings.Contains(last["content"].(string), "完成一半") {
		t.Fatalf("frames = %#v", ft.frames)
	}
	if last["seq"] != int64(2) {
		t.Fatalf("update frame seq = %#v, want 2 so the gateway can drop older frames", last["seq"])
	}
}

// After a restart no inbound message has filled the reply context yet; a turn
// started by a heartbeat or relay must still find its room from the session key.
func TestTaskCardDestinationAfterRestart(t *testing.T) {
	ft := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	for session, want := range map[string]string{"cloud_web:room-7": "room-7", "cloud_web:room-7:u1": "room-7"} {
		if ch, err := p.TaskCardDestination(session); err != nil || ch != want {
			t.Fatalf("TaskCardDestination(%q) = %q, %v; want %q", session, ch, err, want)
		}
	}
	for _, session := range []string{"other:room-7", "cloud_web:room-", "cloud_web:room-0", "cloud_web:room-07", "cloud_web:room-x", "cloud_web:c:u"} {
		if ch, err := p.TaskCardDestination(session); err == nil {
			t.Fatalf("TaskCardDestination(%q) = %q, want error", session, ch)
		}
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

func TestRenderTaskCardTextCarriesTaskMembers(t *testing.T) {
	task := &core.Task{ID: "t1", Title: "修 bug", State: core.TaskStateInProgress, Members: []core.TaskMember{
		{ReporterProject: "gpt", ID: "m1", Name: "龙娘", Title: "改登录", Status: "running", Summary: "进行中"},
	}}
	text := renderTaskCardText(task)
	body, ok := strings.CutPrefix(text, core.ProgressCardPayloadPrefix)
	if !ok {
		t.Fatalf("not a progress payload: %q", text)
	}
	var got struct {
		Items       []core.ProgressCardEntry `json:"items"`
		TaskMembers []taskCardMember         `json:"task_members"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	want := []taskCardMember{{ReporterProject: "gpt", ID: "m1", Name: "龙娘", Title: "改登录", Status: "running"}}
	if !reflect.DeepEqual(got.TaskMembers, want) {
		t.Fatalf("task_members = %+v, want %+v", got.TaskMembers, want)
	}
	if len(got.Items) != 2 {
		t.Fatalf("display rows changed: %+v", got.Items)
	}
	if plain := renderTaskCardText(&core.Task{ID: "t2", Title: "x"}); strings.Contains(plain, "task_members") {
		t.Fatalf("card without members gained task_members: %q", plain)
	}
}
