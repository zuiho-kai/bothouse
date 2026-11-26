package feishu

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chenhg5/cc-connect/core/model"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: the sub-agent table ("子进程表"), its own card message next to the progress
// card, as on Discord (platform/discord/subtasks.go; core/subtasks.go). The table is edited in
// place; it is not posted again at the bottom when chat pushes it up (no LatestMessageChecker).

var _ core.SubTaskTablePayloadSupport = (*Platform)(nil)

// SupportsSubTaskTablePayload implements core.SubTaskTablePayloadSupport. The table rides on
// the card send/patch path of the card-style progress.
func (p *Platform) SupportsSubTaskTablePayload() bool {
	return p.useInteractiveCard && p.progressStyle == "card"
}

// feishuSubTaskTextLen cuts a row's name, task text and detail line.
const feishuSubTaskTextLen = 80 // 沿用已有配置：和 Discord 子进程表每行上限一致（maxDiscordProgressLineLen = 80）

// buildFeishuSubTaskCardJSON renders the table as one card: a header in the progress card's
// colours (running / failed / done) and one markdown block with two lines a sub-agent.
func buildFeishuSubTaskCardJSON(payload *core.SubTaskTablePayload) string {
	zh := isZhLikeProgressLang(payload.Lang)
	title := "Sub-agents"
	if zh {
		title = "子进程表"
	}
	running, failed := 0, 0
	rows := make([]string, 0, len(payload.Tasks))
	for _, t := range payload.Tasks {
		if t.Live() {
			running++
		} else if t.Status == model.SubTaskFailed {
			failed++
		}
		rows = append(rows, feishuSubTaskRow(t, zh))
	}
	template := "green"
	switch {
	case running > 0:
		template = "blue"
	case failed > 0:
		template = "red"
	}
	body := strings.Join(rows, "\n")
	if body == "" {
		body = " "
	}
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": title},
			"template": template,
		},
		"body": map[string]any{"elements": []map[string]any{{"tag": "markdown", "content": sanitizeCardMarkdownForCard(body)}}},
	}
	b, _ := json.Marshal(card)
	return string(b)
}

// feishuSubTaskRow renders one sub-agent as two lines:
//
//	🔄 前台 · <名字> · <描述> · 开始于 15:04
//	　└ <当前那一步 / 结束总结第一句>
func feishuSubTaskRow(t model.SubTask, zh bool) string {
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
	head := feishuSubTaskIcon(t) + " " + kind + " · "
	if name := feishuSubTaskText(t.Name); name != "" {
		head += name + " · "
	}
	head += feishuSubTaskText(t.Description)
	if when := feishuSubTaskWhen(t, zh); when != "" {
		head += " · " + when
	}
	detail := t.Step
	if !t.Running() && t.Summary != "" {
		detail = t.Summary
	}
	detail = feishuSubTaskText(detail)
	if t.Status == model.SubTaskWaiting {
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
		if detail != "" {
			wait += " — " + detail
		}
		detail = wait
	}
	if detail != "" {
		head += "\n　└ " + detail
	}
	return head
}

// feishuSubTaskText puts text on one line and cuts it.
func feishuSubTaskText(s string) string {
	return compactRichText(strings.Join(strings.Fields(s), " "), feishuSubTaskTextLen)
}

func feishuSubTaskIcon(t model.SubTask) string {
	switch t.Status {
	case model.SubTaskCompleted:
		return "✅"
	case model.SubTaskFailed:
		return "❌"
	case model.SubTaskStopped:
		return "⏹️"
	case model.SubTaskWaiting:
		return "⏳"
	}
	return "🔄"
}

// feishuSubTaskWhen is a live row's start time or a finished row's duration. A Feishu card has
// no self-counting timestamp, so a live row shows the clock time it started at.
func feishuSubTaskWhen(t model.SubTask, zh bool) string {
	switch {
	case t.Live() && !t.StartedAt.IsZero():
		at := t.StartedAt.Local().Format("15:04")
		if zh {
			return "开始于 " + at
		}
		return "started " + at
	case !t.StartedAt.IsZero() && !t.EndedAt.IsZero():
		sec := int(t.EndedAt.Sub(t.StartedAt).Seconds())
		if sec < 0 {
			sec = 0
		}
		if zh {
			if sec >= 60 {
				return fmt.Sprintf("用时 %d分%02d秒", sec/60, sec%60)
			}
			return fmt.Sprintf("用时 %d秒", sec)
		}
		return fmt.Sprintf("%dm%02ds", sec/60, sec%60)
	}
	return ""
}
