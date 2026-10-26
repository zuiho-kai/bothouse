package cloudweb

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Channels (cloud_web) shows the team board ("who is doing what") as one room
// message that is edited in place, the same create/edit/delete frames as the
// public task card (public_progress.go). The web room has no pinning, so the
// board is just that message.
var (
	_ core.BoardPoster  = (*Platform)(nil)
	_ core.BoardRemover = (*Platform)(nil)
)

// boardState keeps, per session, the ref id of a board create whose ack never
// arrived, so the retry reuses it and the gateway (which keys the row on the
// ref) returns the same message instead of a second board. It is cleared once
// the board has a message id: the next create (after the board was removed or
// lost) needs a new ref, because the gateway also matches refs of deleted rows.
type boardState struct {
	mu      sync.Mutex
	pending map[string]string // sessionKey -> ref_id of an unacked create
	seq     int64
}

// nextSeq is a rising number for the gateway's stale-frame check (it skips an
// edit whose seq is not newer than the stored one). Milliseconds keep it rising
// across restarts and inside the JS safe-integer range.
func (b *boardState) nextSeq() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now().UnixMilli()
	if now <= b.seq {
		now = b.seq + 1
	}
	b.seq = now
	return now
}

// UpsertBoard edits the board message when messageID is set, otherwise posts a
// new one. A room the gateway can no longer post to (handle "") is reported as
// ErrDeliveryUnrecoverable, so the board stops retrying until new activity.
func (p *Platform) UpsertBoard(ctx context.Context, sessionKey, messageID, content string, live bool) (string, error) {
	room, err := p.TaskCardDestination(sessionKey)
	if errors.Is(err, core.ErrNotSupported) {
		// An older gateway that cannot edit messages: retrying cannot help.
		return messageID, fmt.Errorf("cloud_web: team board: %w: %w", core.ErrDeliveryUnrecoverable, err)
	}
	if err != nil {
		return messageID, err
	}
	b := &p.board
	text := renderBoardText(content, live)
	seq := b.nextSeq()
	if messageID != "" {
		return messageID, p.sendWire(ctx, map[string]any{
			"type":           "update_message",
			"session_key":    sessionKey,
			"preview_handle": messageID,
			"content":        text,
			"seq":            seq,
		})
	}
	waiter, ok := p.tp.(previewWaiter)
	if !ok {
		return "", fmt.Errorf("cloud_web: transport does not support preview_ack")
	}
	b.mu.Lock()
	refID := b.pending[sessionKey]
	if refID == "" {
		refID = fmt.Sprintf("teamboard-%s-%d", sessionKey, time.Now().UnixNano())
		if b.pending == nil {
			b.pending = map[string]string{}
		}
		b.pending[sessionKey] = refID
	}
	b.mu.Unlock()
	wait := waiter.expectPreviewAck(refID)
	if err := p.sendWire(ctx, map[string]any{
		"type":        "preview_start",
		"ref_id":      refID,
		"session_key": sessionKey,
		"reply_ctx":   room,
		"content":     text,
		"seq":         seq,
	}); err != nil {
		_, _ = wait(0)
		return "", err
	}
	handle, err := wait(taskCardAckTimeout)
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	if b.pending[sessionKey] == refID {
		delete(b.pending, sessionKey)
	}
	b.mu.Unlock()
	if handle == "" {
		return "", fmt.Errorf("cloud_web: gateway rejected team board: %w", core.ErrDeliveryUnrecoverable)
	}
	return handle, nil
}

// RemoveBoard deletes the board message. The gateway does not answer
// delete_message, and deleting a gone message is a no-op there.
func (p *Platform) RemoveBoard(ctx context.Context, sessionKey, messageID string) error {
	if !p.hasCap(capDeleteMessage) {
		return fmt.Errorf("cloud_web: gateway cannot delete messages: %w", core.ErrDeliveryUnrecoverable)
	}
	return p.sendWire(ctx, map[string]any{
		"type":           "delete_message",
		"session_key":    sessionKey,
		"preview_handle": messageID,
	})
}

// renderBoardText encodes the board as a progress-card payload, like the task
// card: the gateway stores it with a card, which keeps it out of the text-draft
// cleanup when the bot reconnects. The first line is the title; markdown bold
// markers are dropped because card rows are plain text. The card is Running
// while live (the caller's state of the same board, #597 G33), otherwise Done.
func renderBoardText(content string, live bool) string {
	lines := strings.Split(strings.ReplaceAll(content, "**", ""), "\n")
	title := strings.TrimSpace(lines[0])
	var items []core.ProgressCardEntry
	for _, line := range lines[1:] {
		if s := strings.TrimSpace(line); s != "" {
			items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: s})
		}
	}
	if len(items) == 0 {
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: title})
	}
	state := core.ProgressCardStateCompleted
	if live {
		state = core.ProgressCardStateRunning
	}
	return core.BuildProgressCardPayloadV2(items, false, "📋 "+title, "", state)
}
