package cloudweb

import (
	"context"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: the gateway gets the same sub-agent table as Discord
// (platform/discord/subtasks.go): on with the card-style progress, sent as a
// preview message and edited in place.
func TestSubTaskTableLikeDiscord(t *testing.T) {
	var pl core.Platform = mustNew(t, wsOpts(nil))
	s, ok := pl.(core.SubTaskTablePayloadSupport)
	if !ok || !s.SupportsSubTaskTablePayload() {
		t.Fatalf("card style must send the sub-agent table, ok=%v", ok)
	}
	legacy := mustNew(t, wsOpts(map[string]any{"progress_style": "legacy"}))
	if legacy.SupportsSubTaskTablePayload() {
		t.Fatal("legacy style has no edit-in-place card, so no table (same as Discord)")
	}
}

func TestSubTaskTableUsesPreview(t *testing.T) {
	ft := &ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	table := core.BuildSubTaskTablePayload(core.LangChinese, []core.SubTask{{
		ID: "a1", Description: "查代码", Status: core.SubTaskRunning, StartedAt: time.Now(),
	}})
	h, err := p.SendPreviewStart(context.Background(), replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}, table)
	if err != nil {
		t.Fatalf("table preview: %v", err)
	}
	if rc := h.(replyContext); rc.ReplyCtx != "hub-42" {
		t.Fatalf("handle = %#v", rc)
	}
}

// The progress card's "等子 agent：…" line is refreshed on the card's edit
// interval (core/engine.go subWaitTick needs cp.minUpdateInterval > 0); without
// a throttler the line never shows. Same 2s as Discord (discord.go ProgressUpdateInterval).
func TestProgressUpdateIntervalLikeDiscord(t *testing.T) {
	var pl core.Platform = mustNew(t, wsOpts(nil))
	th, ok := pl.(core.ProgressUpdateThrottler)
	if !ok || th.ProgressUpdateInterval() != 2*time.Second {
		t.Fatalf("want ProgressUpdateThrottler with 2s, ok=%v", ok)
	}
}

// A gateway that does not declare subtask_table (a hub older than the table)
// gets no table: it would show the raw payload as a message (review fix 1).
func TestSubTaskTableNeedsGatewayCapability(t *testing.T) {
	old := &Platform{name: "cloud_web", progressStyle: "card", replyCtxs: map[string]string{},
		tp: &ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message"})}}
	if old.SupportsSubTaskTablePayload() {
		t.Fatal("gateway without subtask_table must not get the table")
	}
	cur := &Platform{name: "cloud_web", progressStyle: "card", replyCtxs: map[string]string{},
		tp: &ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message", "subtask_table"})}}
	if !cur.SupportsSubTaskTablePayload() {
		t.Fatal("gateway declaring subtask_table gets the table")
	}
}
