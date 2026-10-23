package discord

import (
	"fmt"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// RenderTaskCardEmbed converts a core.Task into a structured Discord MessageEmbed.
func RenderTaskCardEmbed(task *core.Task, lang string) *discordgo.MessageEmbed {
	if task == nil {
		return &discordgo.MessageEmbed{Description: " "}
	}

	title := fmt.Sprintf("📋 %s ｜ %s", task.ID, task.Title)
	color := discordTaskColor(task.State)
	agentLabel := discordProgressAgentLabel(task.Agent)
	stateLabel := formatTaskFullState(task.State, task.FactStage, lang)

	fields := []*discordgo.MessageEmbedField{
		{
			Name:   discordTaskFieldLabel("executor", lang),
			Value:  trimDiscordRunes(agentLabel, 100),
			Inline: true,
		},
		{
			Name:   discordTaskFieldLabel("status", lang),
			Value:  trimDiscordRunes(stateLabel, 100),
			Inline: true,
		},
	}
	if len(task.Members) > 0 {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:  discordTaskFieldLabel("members", lang),
			Value: renderTaskMembers(task.Members, lang),
		})
	}

	if summary := strings.TrimSpace(task.RequiredSummary); summary != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("required_summary", lang),
			Value:  trimDiscordRunes(summary, 500),
			Inline: false,
		})
	}

	if prog := strings.TrimSpace(task.LatestProgress); prog != "" && prog != task.ResultSummary {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("latest_progress", lang),
			Value:  trimDiscordRunes(prog, 500),
			Inline: false,
		})
	}

	if res := strings.TrimSpace(task.ResultSummary); res != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("result_summary", lang),
			Value:  trimDiscordRunes(res, 800),
			Inline: false,
		})
	}

	if ver := strings.TrimSpace(task.VerificationResult); ver != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("verification", lang),
			Value:  trimDiscordRunes(ver, 500),
			Inline: false,
		})
	}

	if del := strings.TrimSpace(task.DeliverableURL); del != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("deliverable", lang),
			Value:  trimDiscordRunes(del, 300),
			Inline: false,
		})
	}

	if next := strings.TrimSpace(task.NextSteps); next != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   discordTaskFieldLabel("next_steps", lang),
			Value:  trimDiscordRunes(next, 500),
			Inline: false,
		})
	}

	footerText := fmt.Sprintf("ID: %s · %s · %s",
		task.ID,
		task.UpdatedAt.Format("15:04:05"),
		task.Origin,
	)

	return &discordgo.MessageEmbed{
		Title:  trimDiscordRunes(title, maxDiscordEmbedTitleLen),
		Color:  color,
		Fields: fields,
		Footer: &discordgo.MessageEmbedFooter{
			Text: trimDiscordRunes(footerText, maxDiscordProgressFooterLen),
		},
	}
}

func renderTaskMembers(members []core.TaskMember, lang string) string {
	i18n := core.NewI18n(core.Language(lang))
	names := make(map[string]string, len(members))
	for _, m := range members {
		names[m.ID] = m.Name
	}
	rows := make([]string, 0, len(members))
	for _, m := range members {
		icon := "🔄"
		switch m.Status {
		case "queued":
			icon = "🕓"
		case "waiting":
			icon = "⏳"
		case "completed":
			icon = "✅"
		case "failed":
			icon = "❌"
		case "cancelled":
			icon = "⏹️"
		case "interrupted":
			icon = "⚠️"
		}
		name := m.Name
		if parent := names[m.ParentID]; parent != "" {
			name = parent + " / " + name
		}
		row := icon + " " + compactDiscordProgressText(name) + "｜" + compactDiscordProgressText(m.Title)
		switch {
		case m.Status == "interrupted":
			row += "｜" + i18n.T("task_member_interrupted")
		case m.Status == "queued":
			row += "｜" + i18n.T("task_member_queued")
		case !m.StartedAt.IsZero() && !m.EndedAt.IsZero():
			row += "｜" + i18n.Tf("task_member_duration", discordDuration(int(m.EndedAt.Sub(m.StartedAt).Seconds()), normalizeDiscordProgressLang(lang) == "zh"))
		case !m.StartedAt.IsZero():
			row += "｜" + i18n.Tf("task_member_started", fmt.Sprintf("<t:%d:R>", m.StartedAt.Unix()))
		}
		if m.Live() && !m.UpdatedAt.IsZero() && m.Status != "queued" {
			row += " · " + i18n.Tf("task_member_updated", fmt.Sprintf("<t:%d:R>", m.UpdatedAt.Unix()))
		}
		if m.Summary != "" {
			row += "\n　└ " + trimDiscordRunes(compactDiscordProgressText(m.Summary), maxDiscordProgressLineLen)
		}
		// Source: Discord embed fields allow 1024 characters. Reserve the exact
		// localized overflow footer so rows and relative timestamps stay whole.
		candidate := strings.Join(append(rows, row), "\n")
		remaining := len(members) - len(rows) - 1
		if remaining > 0 {
			candidate += "\n" + i18n.Tf("task_member_more", remaining)
		}
		if len([]rune(candidate)) > 1024 {
			rows = append(rows, i18n.Tf("task_member_more", len(members)-len(rows)))
			break
		}
		rows = append(rows, row)
	}
	return strings.Join(rows, "\n")
}

func discordTaskColor(state core.TaskState) int {
	switch state {
	case core.TaskStateCompleted:
		return 0x57F287 // Green
	case core.TaskStateFailed:
		return 0xED4245 // Red
	case core.TaskStateWaitingUser, core.TaskStateResultReady:
		return 0xFEE75C // Warm Yellow
	case core.TaskStateCancelled:
		return 0x95A5A6 // Grey
	default:
		return 0x5865F2 // Blurple
	}
}

func formatTaskFullState(state core.TaskState, stage core.FactStage, lang string) string {
	stText := discordTaskStateLabel(state, lang)
	if stage == "" || stage == core.FactStageReceived {
		return stText
	}
	sgText := discordFactStageLabel(stage, lang)
	return fmt.Sprintf("%s · %s", stText, sgText)
}

func discordTaskStateLabel(state core.TaskState, lang string) string {
	if state == core.TaskStateResultReady {
		return core.NewI18n(core.Language(lang)).T(core.MsgTaskResultReady)
	}
	return core.NewI18n(core.Language(lang)).T(core.MsgKey("task_" + string(state)))
}
func discordFactStageLabel(stage core.FactStage, lang string) string {
	return core.NewI18n(core.Language(lang)).T(core.MsgKey("task_" + string(stage)))
}
func discordTaskFieldLabel(key, lang string) string {
	return core.NewI18n(core.Language(lang)).T(core.MsgKey("task_" + key))
}
