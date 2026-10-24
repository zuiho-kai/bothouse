package cloudweb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
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
// The reply context is only known after an inbound message, so after a restart
// a turn that did not start from one (heartbeat, cron, relay) would get no
// card; a room session key ("<name>:room-<id>[:<user>]") names its room, so
// fall back to that.
func (p *Platform) TaskCardDestination(sessionKey string) (string, error) {
	if !p.hasCap(capPreview) || !p.hasCap(capUpdateMessage) {
		return "", core.ErrNotSupported
	}
	if replyCtx, ok := p.lookupReplyCtx(sessionKey); ok && replyCtx != "" {
		return replyCtx, nil
	}
	if room, ok := p.roomFromSessionKey(sessionKey); ok {
		return room, nil
	}
	return "", fmt.Errorf("cloud_web: no reply context for session %q", sessionKey)
}

// roomFromSessionKey returns "room-<id>" for this platform's room sessions.
func (p *Platform) roomFromSessionKey(sessionKey string) (string, bool) {
	rest, ok := strings.CutPrefix(sessionKey, p.name+":")
	if !ok {
		return "", false
	}
	chat, _, _ := strings.Cut(rest, ":")
	id, ok := strings.CutPrefix(chat, "room-")
	if !ok {
		return "", false
	}
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != id {
		return "", false
	}
	return chat, true
}

// EnsureTaskCard creates the card once and then edits it. The create frame uses
// a ref id derived from the task id: the gateway keys the row on it, so a retry
// after a lost ack returns the same message instead of a second card. Both
// frames carry task.Seq: the gateway keeps the highest seq it applied, skips an
// older frame instead of rolling the card back, and refreshes the row when a
// retried create finds it already there with older content.
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
			"seq":            task.Seq,
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
		"seq":         task.Seq,
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
	return withTaskMembers(core.BuildProgressCardPayloadV2(items, false, "📋 "+title, "", taskCardState(task.State)), task.Members)
}

// taskCardMember is one member row as the gateway reads it (dsh/collab tasks.mjs
// fromCard): a live member opens a task on the channel's task board, a finished
// one hands it back.
type taskCardMember struct {
	ReporterProject string `json:"reporter_project,omitempty"`
	ID              string `json:"id"`
	Name            string `json:"name"`
	Title           string `json:"title"`
	Status          string `json:"status"`
}

// withTaskMembers adds the structured member list to a progress-card payload
// as task_members; the text rows above stay for display.
func withTaskMembers(payload string, members []core.TaskMember) string {
	body, ok := strings.CutPrefix(payload, core.ProgressCardPayloadPrefix)
	if !ok || len(members) == 0 {
		return payload
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
		return payload
	}
	rows := make([]taskCardMember, 0, len(members))
	for _, m := range members {
		rows = append(rows, taskCardMember{ReporterProject: m.ReporterProject, ID: m.ID, Name: m.Name, Title: m.Title, Status: m.Status})
	}
	obj["task_members"] = rows
	out, err := json.Marshal(obj)
	if err != nil {
		return payload
	}
	return core.ProgressCardPayloadPrefix + string(out)
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
