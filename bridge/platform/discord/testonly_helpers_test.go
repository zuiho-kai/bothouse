package discord

import (
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func buildDiscordProgressEmbed(payload *core.ProgressCardPayload) *discordgo.MessageEmbed {
	return buildDiscordProgressEmbedView(payload, cardViewDetail)
}

func buildDiscordProgressDescription(payload *core.ProgressCardPayload) string {
	if payload == nil {
		return " "
	}
	items := discordProgressItems(payload)
	if payload.LineLen > 0 {
		return buildDiscordProgressList(payload, items)
	}
	if payload.Steps > 0 || payload.ElapsedSec > 0 {
		return buildDiscordProgressBarLine(payload, items)
	}
	lines := make([]string, 0, len(items)+1)
	if payload.Truncated {
		lines = append(lines, "ℹ️ "+discordProgressLatestOnlyText(payload.Lang))
	}
	for _, item := range items {
		if line := buildDiscordProgressLine(item, payload.Lang); line != "" {
			lines = append(lines, line)
		}
	}
	desc := strings.Join(lines, "\n")
	desc = trimDiscordRunes(desc, maxDiscordProgressDescLen)
	if strings.TrimSpace(desc) == "" {
		return " "
	}
	return desc
}

func buildDiscordPreviewMessage(content string) *discordgo.MessageSend {
	return buildDiscordPreviewMessageView(content, cardViewDetail)
}

func buildDiscordPreviewEdit(channelID, messageID, content string) *discordgo.MessageEdit {
	return buildDiscordPreviewEditView(channelID, messageID, content, cardViewDetail)
}

func renderTaskMembers(members []core.TaskMember, lang string) string {
	return renderTaskMembersView(members, lang, false)
}

// buildDiscordProgressList — maomao fork: the step/time head plus the recent
// steps, one per line. Unlike the one-line bar it stays after the turn ends,
// so words said mid-run are not wiped.
func buildDiscordProgressList(payload *core.ProgressCardPayload, items []core.ProgressCardEntry) string {
	lines := []string{buildDiscordProgressBarLine(&core.ProgressCardPayload{
		Lang: payload.Lang, Steps: payload.Steps, ElapsedSec: payload.ElapsedSec,
	}, nil)}
	for _, item := range items {
		if line := buildDiscordProgressLineN(item, payload.Lang, payload.LineLen); line != "" {
			lines = append(lines, line)
		}
	}
	desc := trimDiscordRunes(strings.Join(lines, "\n"), maxDiscordProgressDescLen)
	if strings.TrimSpace(desc) == "" {
		return " "
	}
	return desc
}

// buildDiscordPreviewEditView renders a progress card or sub-agent table in
// the turn's chosen view. Every progress card edit carries the buttons, so
// they never drop off; a table edit clears any old buttons it had.
func buildDiscordPreviewEditView(channelID, messageID, content string, view cardView) *discordgo.MessageEdit {
	return buildDiscordPreviewEditViewPage(channelID, messageID, content, view, -1)
}
