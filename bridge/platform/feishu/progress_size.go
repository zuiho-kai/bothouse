package feishu

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/core/model"
)

// Keep the turn's progress history by default and fit visible details into the card.
const (
	feishuProgressKeepAllEntries = 1 << 20
	feishuProgressDetailBytes    = maxRichCardJSONBytes - 4000
	feishuProgressDetailElements = 100
	feishuProgressBriefRunes     = 80
)

var (
	_ core.ProgressCardSizer       = (*Platform)(nil)
	_ core.ProgressUpdateThrottler = (*Platform)(nil)
)

// feishuProgressUpdateInterval paces progress card edits. SPEC: one message
// takes at most 5 edits a second (「更新应用发送的消息卡片」使用限制,
// https://open.feishu.cn/document/server-docs/im-v1/message-card/patch); the
// card's patch path has no rate-limit handling of its own, so a burst of tool
// events got 230020 back.
const feishuProgressUpdateInterval = time.Second / 5

func (p *Platform) ProgressUpdateInterval() time.Duration { return feishuProgressUpdateInterval }
func (p *Platform) ProgressCardEntries() int              { return p.cardEntries }
func (p *Platform) ProgressCardLineLen() int              { return p.cardLineLen }
func (p *Platform) ProgressCardHideThinking() bool        { return p.cardHideThinking }

type progressDetailEntry struct {
	entry  model.ProgressCardEntry
	result *model.ProgressCardEntry
}

func progressDetailEntries(items []model.ProgressCardEntry) []progressDetailEntry {
	details := make([]progressDetailEntry, 0, len(items))
	openCalls := make(map[string][]int)
	for i, item := range items {
		tool := strings.ToLower(strings.TrimSpace(item.Tool))
		switch item.Kind {
		case model.ProgressEntryToolUse:
			openCalls[tool] = append(openCalls[tool], len(details))
		case model.ProgressEntryToolResult:
			if calls := openCalls[tool]; len(calls) > 0 {
				details[calls[len(calls)-1]].result = &items[i]
				openCalls[tool] = calls[:len(calls)-1]
				continue
			}
		}
		details = append(details, progressDetailEntry{entry: item})
	}
	return details
}

func (detail progressDetailEntry) render(lang string, lineLen int) map[string]any {
	items := []model.ProgressCardEntry{detail.entry}
	if detail.result != nil {
		items = append(items, *detail.result)
	}
	items = cutProgressLines(items, lineLen)
	row := renderProgressEntryElement(items[0], lang)
	if detail.entry.Kind != model.ProgressEntryToolUse {
		return row
	}
	rows := []map[string]any{row}
	if len(items) > 1 {
		rows = append(rows, renderProgressEntryElement(items[1], lang))
	}
	return buildProgressPanel(buildToolDisplay(items[0].Tool, items[0].Text).Title, false, rows)
}

func buildProgressViews(items []model.ProgressCardEntry, lang string) (brief, details map[string]any, clipped bool) {
	latest := items[len(items)-1]
	for i := len(items) - 1; i >= 0; i-- {
		kind := items[i].Kind
		if kind == model.ProgressEntryToolUse || kind == model.ProgressEntryToolResult || kind == model.ProgressEntryError {
			latest = items[i]
			break
		}
	}
	brief = renderProgressEntryElement(cutProgressLines([]model.ProgressCardEntry{latest}, feishuProgressBriefRunes)[0], lang)

	entries := progressDetailEntries(items)
	elements := make([]map[string]any, 0, min(len(entries), feishuProgressDetailElements))
	remaining := feishuProgressDetailBytes
	for i := len(entries) - 1; i >= 0 && len(elements) < feishuProgressDetailElements; i-- {
		element := entries[i].render(lang, 0)
		data, _ := json.Marshal(element)
		if len(data)+1 > min(remaining, feishuProgressDetailBytes/2) {
			element = entries[i].render(lang, feishuProgressBriefRunes)
			data, _ = json.Marshal(element)
		}
		if len(data)+1 > remaining {
			break
		}
		elements = append(elements, element)
		remaining -= len(data) + 1
	}
	slices.Reverse(elements)
	label := "Details"
	if isZhLikeProgressLang(lang) {
		label = "细节"
	}
	return brief, buildProgressPanel(label, false, elements), len(elements) < len(entries)
}

// progressIntOpt reads a TOML integer option (int64 from the decoder; int in
// tests); anything else, or a negative number, is 0 (unset).
func progressIntOpt(v any) int {
	n, err := coerceMilliseconds(v)
	if err != nil || n < 0 {
		return 0
	}
	return int(n)
}

// cutProgressLines caps each step's text at lineLen runes (core passes the
// bot's progress_line_len as the payload's LineLen); 0 leaves them whole.
func cutProgressLines(items []model.ProgressCardEntry, lineLen int) []model.ProgressCardEntry {
	if lineLen <= 0 {
		return items
	}
	out := make([]model.ProgressCardEntry, len(items))
	for i, it := range items {
		text := strings.Join(strings.Fields(it.Text), " ")
		if r := []rune(text); len(r) > lineLen {
			text = string(r[:lineLen-1]) + "…"
		}
		it.Text = text
		out[i] = it
	}
	return out
}
