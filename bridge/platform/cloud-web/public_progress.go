package cloudweb

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Channels (cloud_web) shows the public task card as one room message that is
// edited in place. Without this the engine skipped the card for cloud_web
// sessions (core PublicProgress.begin needs a TaskCardPublisher), so a lead in
// Channels could never open a task card.
var _ core.TaskCardPublisher = (*Platform)(nil)

// taskCardAckTimeout matches SendPreviewStart's wait for preview_ack.
const taskCardAckTimeout = 10 * time.Second

// TaskCardDestination accepts a session the gateway can post to and edit in.
func (p *Platform) TaskCardDestination(sessionKey string) (string, error) {
	if !p.hasCap(capPreview) || !p.hasCap(capUpdateMessage) {
		return "", core.ErrNotSupported
	}
	replyCtx, ok := p.lookupReplyCtx(sessionKey)
	if !ok || replyCtx == "" {
		return "", fmt.Errorf("cloud_web: no reply context for session %q", sessionKey)
	}
	return replyCtx, nil
}

// EnsureTaskCard creates the card once and then edits it. The create frame uses
// a ref id derived from the task id: the gateway keys the row on it, so a retry
// after a lost ack returns the same message instead of a second card.
func (p *Platform) EnsureTaskCard(ctx context.Context, task *core.Task, lang core.Language) error {
	if task == nil {
		return errors.New("cloud_web: nil task")
	}
	text := renderTaskCardText(task)
	if task.MessageID != "" {
		return p.sendWire(ctx, map[string]any{
			"type":           "update_message",
			"session_key":    task.SessionKey,
			"preview_handle": task.MessageID,
			"content":        text,
		})
	}
	waiter, ok := p.tp.(previewWaiter)
	if !ok {
		return fmt.Errorf("cloud_web: transport does not support preview_ack")
	}
	refID := "taskcard-" + task.ID
	wait := waiter.expectPreviewAck(refID)
	if err := p.sendWire(ctx, map[string]any{
		"type":        "preview_start",
		"ref_id":      refID,
		"session_key": task.SessionKey,
		"reply_ctx":   task.ChannelID,
		"content":     text,
	}); err != nil {
		_, _ = wait(0)
		return err
	}
	handle, err := wait(taskCardAckTimeout)
	if err != nil {
		return err
	}
	if handle == "" {
		return fmt.Errorf("cloud_web: gateway rejected task card")
	}
	task.MessageID = handle
	return nil
}

// PublishTaskFact: the card itself carries the latest progress and member rows;
// Channels has no task thread to post facts into.
func (p *Platform) PublishTaskFact(context.Context, *core.Task, core.TaskEvent, core.Language) error {
	return nil
}

// renderTaskCardText encodes the card as a progress-card payload, the same
// path as the turn progress card (gateway body() -> progressCard()). The
// gateway then stores it with a card, which keeps it out of the text-draft
// cleanup that runs when a bot disconnects or registers again (#119 review):
// a plain-text preview would be dropped there and later edits would miss.
func renderTaskCardText(task *core.Task) string {
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = task.ID
	}
	items := []core.ProgressCardEntry{{Kind: core.ProgressEntryInfo, Text: fmt.Sprintf("📋 %s · %s", title, task.State)}}
	if s := strings.TrimSpace(task.LatestProgress); s != "" {
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: s})
	}
	for _, m := range task.Members {
		line := m.Name
		if m.Title != "" {
			line += "：" + m.Title
		}
		if m.Status != "" {
			line += "（" + m.Status + "）"
		}
		if m.Summary != "" {
			line += " " + m.Summary
		}
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: line})
	}
	return core.BuildProgressCardPayloadV2(items, false, "📋 "+title, "", taskCardState(task.State))
}

func taskCardState(s core.TaskState) core.ProgressCardState {
	switch s {
	case core.TaskStateCompleted, core.TaskStateResultReady:
		return core.ProgressCardStateCompleted
	case core.TaskStateFailed, core.TaskStateCancelled:
		return core.ProgressCardStateFailed
	}
	return core.ProgressCardStateRunning
}
