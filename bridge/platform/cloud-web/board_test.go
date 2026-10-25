package cloudweb

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// boardHub mimics the Channels gateway (dsh/collab cloudweb.mjs) for board
// frames: preview_start creates a row keyed by ref_id (a repeated ref, even of
// a deleted row, returns that row), update_message edits a live row,
// delete_message marks it deleted, and a room that does not exist acks "".
type boardHub struct {
	mu      sync.Mutex
	rooms   map[string]bool
	byRef   map[string]int
	text    map[int]string
	deleted map[int]bool
	creates int
	dropAck bool // swallow the next ack (lost ack)
	waiters map[string]chan string
	caps    map[string]bool
}

func newBoardHub(rooms ...string) *boardHub {
	h := &boardHub{rooms: map[string]bool{}, byRef: map[string]int{}, text: map[int]string{}, deleted: map[int]bool{},
		waiters: map[string]chan string{}, caps: capabilitySet([]string{"text", "preview", "update_message", "delete_message"})}
	for _, r := range rooms {
		h.rooms[r] = true
	}
	return h
}

func (h *boardHub) Start(context.Context, inboundHandler) error { return nil }
func (h *boardHub) Stop() error                                 { return nil }
func (h *boardHub) Capabilities() map[string]bool               { return h.caps }

func (h *boardHub) expectPreviewAck(refID string) func(time.Duration) (string, error) {
	ch := make(chan string, 1)
	h.mu.Lock()
	h.waiters[refID] = ch
	h.mu.Unlock()
	return func(timeout time.Duration) (string, error) {
		select {
		case v := <-ch:
			return v, nil
		case <-time.After(timeout):
			h.mu.Lock()
			delete(h.waiters, refID)
			h.mu.Unlock()
			return "", errors.New("preview_ack timeout")
		}
	}
}

func (h *boardHub) Send(_ context.Context, msg map[string]any) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch msg["type"] {
	case "preview_start":
		ref := fmt.Sprint(msg["ref_id"])
		handle := ""
		if h.rooms[fmt.Sprint(msg["reply_ctx"])] {
			id, ok := h.byRef[ref]
			if !ok {
				h.creates++
				id = 100 + h.creates
				h.byRef[ref] = id
				h.text[id] = fmt.Sprint(msg["content"])
			}
			handle = fmt.Sprint(id)
		}
		ch := h.waiters[ref]
		delete(h.waiters, ref)
		if h.dropAck {
			h.dropAck = false
			return nil
		}
		if ch != nil {
			ch <- handle
		}
	case "update_message", "delete_message":
		var id int
		fmt.Sscan(fmt.Sprint(msg["preview_handle"]), &id)
		if _, ok := h.text[id]; !ok || h.deleted[id] {
			return nil
		}
		if msg["type"] == "delete_message" {
			h.deleted[id] = true
		} else {
			h.text[id] = fmt.Sprint(msg["content"])
		}
	}
	return nil
}

func (h *boardHub) live() map[int]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[int]string{}
	for id, s := range h.text {
		if !h.deleted[id] {
			out[id] = s
		}
	}
	return out
}

func TestTeamBoardPostsThenEditsInPlace(t *testing.T) {
	hub := newBoardHub("room-2")
	p := &Platform{name: "cloud_web", tp: hub, replyCtxs: map[string]string{}}
	ctx := context.Background()
	id, err := p.UpsertBoard(ctx, "cloud_web:room-2", "", "**谁在干啥**\n龙娘：写代码（进行中）")
	if err != nil || id == "" {
		t.Fatalf("post: id=%q err=%v", id, err)
	}
	if got := hub.live()[101]; !strings.HasPrefix(got, core.ProgressCardPayloadPrefix) || !strings.Contains(got, "龙娘：写代码") || strings.Contains(got, "**") {
		t.Fatalf("board payload = %q", got)
	}
	id2, err := p.UpsertBoard(ctx, "cloud_web:room-2", id, "**谁在干啥**\n龙娘：写代码（已完成）")
	if err != nil || id2 != id {
		t.Fatalf("edit: id=%q err=%v, want %q", id2, err, id)
	}
	live := hub.live()
	if len(live) != 1 || !strings.Contains(live[101], "已完成") {
		t.Fatalf("want one edited board, rows = %#v", live)
	}
}

// After the board was removed (or otherwise gone and the caller cleared its
// id), the next post must create a new message, not resolve to the deleted row.
func TestTeamBoardRepostsAfterDelete(t *testing.T) {
	hub := newBoardHub("room-2")
	p := &Platform{name: "cloud_web", tp: hub, replyCtxs: map[string]string{}}
	ctx := context.Background()
	id, err := p.UpsertBoard(ctx, "cloud_web:room-2", "", "**谁在干啥**\n甲")
	if err != nil {
		t.Fatal(err)
	}
	if err := p.RemoveBoard(ctx, "cloud_web:room-2", id); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if len(hub.live()) != 0 {
		t.Fatalf("board not deleted: %#v", hub.live())
	}
	if err := p.RemoveBoard(ctx, "cloud_web:room-2", id); err != nil {
		t.Fatalf("removing a gone board must count as removed: %v", err)
	}
	id2, err := p.UpsertBoard(ctx, "cloud_web:room-2", "", "**谁在干啥**\n乙")
	if err != nil || id2 == "" || id2 == id {
		t.Fatalf("repost: id=%q err=%v (old %q)", id2, err, id)
	}
	if live := hub.live(); len(live) != 1 || !strings.Contains(live[102], "乙") {
		t.Fatalf("want one new board, rows = %#v", live)
	}
}

// A create whose ack was lost is retried with the same ref, so the gateway
// returns the first message instead of a second board.
func TestTeamBoardLostAckDoesNotDuplicate(t *testing.T) {
	hub := newBoardHub("room-2")
	hub.dropAck = true
	p := &Platform{name: "cloud_web", tp: hub, replyCtxs: map[string]string{}}
	ctx := context.Background()
	if _, err := p.UpsertBoard(ctx, "cloud_web:room-2", "", "**谁在干啥**\n甲"); err == nil {
		t.Fatal("lost ack must fail")
	}
	id, err := p.UpsertBoard(ctx, "cloud_web:room-2", "", "**谁在干啥**\n甲")
	if err != nil || id != "101" || hub.creates != 1 {
		t.Fatalf("retry: id=%q err=%v creates=%d", id, err, hub.creates)
	}
}

// A room the gateway cannot post to is unrecoverable, so the board does not
// retry it every tick.
func TestTeamBoardRoomGoneIsUnrecoverable(t *testing.T) {
	hub := newBoardHub()
	p := &Platform{name: "cloud_web", tp: hub, replyCtxs: map[string]string{}}
	_, err := p.UpsertBoard(context.Background(), "cloud_web:room-9", "", "**谁在干啥**\n甲")
	if !errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("err = %v, want ErrDeliveryUnrecoverable", err)
	}
}

func TestTeamBoardNeedsEditableMessages(t *testing.T) {
	hub := newBoardHub("room-2")
	hub.caps = capabilitySet([]string{"text"})
	p := &Platform{name: "cloud_web", tp: hub, replyCtxs: map[string]string{}}
	if _, err := p.UpsertBoard(context.Background(), "cloud_web:room-2", "", "x"); !errors.Is(err, core.ErrNotSupported) || !errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("err = %v, want ErrNotSupported marked unrecoverable", err)
	}
}

func TestTeamBoardStateFollowsLiveWork(t *testing.T) {
	for content, want := range map[string]string{
		"**谁在干啥**\n**橘**　💤 空闲":                           `"state":"completed"`,
		"**谁在干啥**\n**橘**　💤 空闲\n\n**任务板**\n#1 修登录｜橘｜在做｜x": `"state":"running"`,
		"**谁在干啥**\n**橘**　💤 空闲\n\n**任务板**\n现在没有进行中的事。\n\n**暂停**\n#2 x｜橘\n\n**今天做完**\n- 橘：修登录": `"state":"completed"`,
		"**谁在干啥**\n**橘**　🔧 修登录（03:00 起）": `"state":"running"`,
	} {
		if got := renderBoardText(content); !strings.Contains(got, want) {
			t.Errorf("renderBoardText(%q) = %s, want %s", content, got, want)
		}
	}
}
