package discord

import (
	"context"
	"fmt"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: the sub-agent table ("子进程表") — its own message, separate
// from the progress card. See core/subtasks.go.

// SupportsSubTaskTablePayload implements core.SubTaskTablePayloadSupport. The
// table rides on the same edit-in-place machinery as the card-style progress.
func (p *progressPlatform) SupportsSubTaskTablePayload() bool {
	return p.ProgressStyle() == "card"
}

var _ core.SubTaskTablePayloadSupport = (*progressPlatform)(nil)

// IsLatestMessage implements core.LatestMessageChecker: it asks Discord for
// the newest message in the handle's channel (one REST call; the engine only
// asks when a new sub-agent row is added) and compares IDs.
func (p *Platform) IsLatestMessage(ctx context.Context, previewHandle any) (bool, error) {
	h, ok := previewHandle.(*discordPreviewHandle)
	if !ok {
		return false, fmt.Errorf("discord: invalid preview handle type %T", previewHandle)
	}
	msgs, err := p.session.ChannelMessages(h.channelID, 1, "", "", "", discordgo.WithContext(ctx))
	if err != nil {
		return false, fmt.Errorf("discord: latest message: %w", err)
	}
	if len(msgs) == 0 {
		return false, nil
	}
	return msgs[0].ID == h.messageID, nil
}

var _ core.LatestMessageChecker = (*progressPlatform)(nil)

func buildDiscordSubTaskEmbed(payload *core.SubTaskTablePayload) *discordgo.MessageEmbed {
	return buildDiscordSubTaskEmbedView(payload, cardViewDetail)
}

func buildDiscordSubTaskEmbedView(payload *core.SubTaskTablePayload, view cardView) *discordgo.MessageEmbed {
	zh := normalizeDiscordProgressLang(payload.Lang) == "zh"
	title := "Sub-agents"
	if zh {
		title = "子进程表"
	}
	running, failed := 0, 0
	rows := make([]string, 0, len(payload.Tasks))
	for i, t := range payload.Tasks {
		if t.Live() {
			running++
		} else if t.Status == core.SubTaskFailed {
			failed++
		}
		if view == cardViewBrief {
			rows = append(rows, buildDiscordSubTaskBriefRow(t, i+1, zh))
		} else {
			rows = append(rows, buildDiscordSubTaskRow(t, zh))
		}
	}
	// Same colors as the progress card: running / completed / failed.
	color := 0x57F287
	switch {
	case running > 0:
		color = 0x5865F2
	case failed > 0:
		color = 0xED4245
	}
	desc := trimDiscordRunes(strings.Join(rows, "\n"), maxDiscordProgressDescLen)
	if desc == "" {
		desc = " "
	}
	return &discordgo.MessageEmbed{Title: title, Description: desc, Color: color}
}

// buildDiscordSubTaskRow renders one sub-agent as two lines:
//
//	🔄 前台 · <描述> · 开始于 <t:…:R>
//	　└ <当前那一步 / 结束总结第一句>
//
// A sub-agent waiting for its own background work shows ⏳ and
// "等自己的后台任务 — <它停下时说的话>"; its time still counts from the first start.
//
// A running row's time is a Discord timestamp (<t:unix:R>), which the client
// keeps counting by itself, so "跑了多久" moves without editing the message.
func buildDiscordSubTaskRow(t core.SubTask, zh bool) string {
	icon := discordSubTaskIcon(t)
	kind := "fg"
	if zh {
		kind = "前台"
	}
	if t.Background {
		kind = "bg"
		if zh {
			kind = "后台"
		}
	}
	if t.ModeUnknown {
		kind = "agent"
		if zh {
			kind = "子 Agent"
		}
	}
	when := discordSubTaskWhen(t, zh)
	head := icon + " " + kind + " · "
	if name := compactDiscordProgressText(t.Name); name != "" {
		head += trimDiscordRunes(name, maxDiscordProgressLineLen) + " · "
	}
	head += trimDiscordRunes(compactDiscordProgressText(t.Description), maxDiscordProgressLineLen)
	if when != "" {
		head += " · " + when
	}
	detail := t.Step
	if !t.Running() && t.Summary != "" {
		detail = t.Summary
	}
	if t.Status == core.SubTaskWaiting {
		wait := "waiting for its own background task"
		if zh {
			wait = "等自己的后台任务"
		}
		if t.ModeUnknown {
			wait = "waiting to continue"
			if zh {
				wait = "等待继续"
			}
		}
		if detail = compactDiscordProgressText(detail); detail != "" {
			wait += " — " + detail
		}
		detail = wait
	}
	if detail = compactDiscordProgressText(detail); detail != "" {
		head += "\n　└ " + trimDiscordRunes(detail, maxDiscordProgressLineLen)
	}
	return head
}

// buildDiscordSubTaskBriefRow is the 简略 view of one sub-agent: name, status
// and time on one line. A row without a name (Claude) is labelled by its
// position in this table (子任务 N; tasks keep their append order), so 简略
// never shows task text or the internal agent ID.
func buildDiscordSubTaskBriefRow(t core.SubTask, seq int, zh bool) string {
	name := compactDiscordProgressText(t.Name)
	if name == "" {
		name = fmt.Sprintf("Sub-task %d", seq)
		if zh {
			name = fmt.Sprintf("子任务 %d", seq)
		}
	}
	row := discordSubTaskIcon(t) + " " + trimDiscordRunes(name, maxDiscordProgressLineLen)
	if when := discordSubTaskWhen(t, zh); when != "" {
		row += " · " + when
	}
	return row
}

func discordSubTaskIcon(t core.SubTask) string {
	switch t.Status {
	case core.SubTaskCompleted:
		return "✅"
	case core.SubTaskFailed:
		return "❌"
	case core.SubTaskStopped:
		return "⏹️"
	case core.SubTaskWaiting:
		return "⏳"
	}
	return "🔄"
}

// discordSubTaskWhen is a live row's start (a Discord timestamp the client
// keeps counting) or a finished row's duration.
func discordSubTaskWhen(t core.SubTask, zh bool) string {
	switch {
	case t.Live() && !t.StartedAt.IsZero():
		if zh {
			return fmt.Sprintf("开始于 <t:%d:R>", t.StartedAt.Unix())
		}
		return fmt.Sprintf("started <t:%d:R>", t.StartedAt.Unix())
	case !t.StartedAt.IsZero() && !t.EndedAt.IsZero():
		when := discordDuration(int(t.EndedAt.Sub(t.StartedAt).Seconds()), zh)
		if zh {
			when = "用时 " + when
		}
		return when
	}
	return ""
}

// discordDuration formats seconds like the progress card head ("3分20秒" / "3m20s").
func discordDuration(sec int, zh bool) string {
	if sec < 0 {
		sec = 0
	}
	if zh {
		if sec >= 60 {
			return fmt.Sprintf("%d分%02d秒", sec/60, sec%60)
		}
		return fmt.Sprintf("%d秒", sec)
	}
	return fmt.Sprintf("%dm%02ds", sec/60, sec%60)
}
