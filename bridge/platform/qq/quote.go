package qq

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// resolveQuote uses get_msg only for a cache miss. A received reply segment
// establishes the conversation when a standard OneBot response has no peer;
// an agent-selected outbound ID needs independent conversation evidence.
func (p *Platform) resolveQuote(ctx context.Context, id, chat string, inbound bool) (quoteEntry, error) {
	mid, err := strconv.ParseInt(id, 10, 64)
	if err != nil || mid == 0 {
		return quoteEntry{}, fmt.Errorf("qq: invalid quoted message ID %q", id)
	}
	if entry, ok := p.loadQuote(id); ok && (entry.chat == chat || inbound && entry.chat == "") {
		return entry, nil
	}
	result, err := p.callAPIContext(ctx, "get_msg", map[string]any{"message_id": mid})
	if err != nil {
		return quoteEntry{}, fmt.Errorf("qq: get quoted message: %w", err)
	}
	if jsonInt64(result, "message_id") != mid {
		return quoteEntry{}, fmt.Errorf("qq: get_msg returned a different message")
	}
	sender, _ := result["sender"].(map[string]any)
	authorID := jsonInt64(sender, "user_id")
	kind, _ := result["message_type"].(string)
	actualChat := ""
	switch kind {
	case "group":
		if gid := jsonInt64(result, "group_id"); gid != 0 {
			actualChat = fmt.Sprintf("g:%d", gid)
		}
	case "private":
		if authorID != 0 && authorID != p.selfID {
			actualChat = fmt.Sprintf("u:%d", authorID)
		}
	default:
		return quoteEntry{}, fmt.Errorf("qq: get_msg returned no message type")
	}
	if (kind == "group") != strings.HasPrefix(chat, "g:") || actualChat != "" && actualChat != chat {
		return quoteEntry{}, fmt.Errorf("qq: quoted message belongs to another conversation")
	}
	if actualChat == "" && !inbound {
		return quoteEntry{}, fmt.Errorf("qq: cannot verify quoted message belongs to this conversation")
	}
	name := segString(sender, "card")
	if name == "" {
		name = segString(sender, "nickname")
	}
	if name == "" && authorID != 0 {
		name = strconv.FormatInt(authorID, 10)
	}
	entry := quoteEntry{content: quoteText(result), name: name, self: authorID == p.selfID, at: time.Now(), chat: chat}
	if entry.content == "" {
		return quoteEntry{}, fmt.Errorf("qq: quoted message is empty")
	}
	p.storeQuote(id, entry.content, entry.name, entry.self, chat)
	return entry, nil
}

// Quote context describes media without downloading old attachments or
// executing nested reply/forward lookups. CQ decoding stays at the wire edge.
func quoteText(payload map[string]any) string {
	segments, ok := payload["message"].([]any)
	if !ok {
		raw := segString(payload, "message")
		if raw == "" {
			raw = segString(payload, "raw_message")
		}
		segments = parseCQString(raw)
	}
	var b strings.Builder
	for _, raw := range segments {
		seg, _ := raw.(map[string]any)
		data, _ := seg["data"].(map[string]any)
		switch seg["type"] {
		case "text":
			b.WriteString(segString(data, "text"))
		case "at":
			name := segString(data, "name")
			if name == "" {
				name = segString(data, "qq")
			}
			b.WriteString("@" + name)
		case "image":
			b.WriteString("[图片]")
		case "record":
			b.WriteString("[语音]")
		case "video":
			b.WriteString("[视频]")
		case "file":
			b.WriteString("[文件 " + segString(data, "name") + "]")
		case "forward":
			b.WriteString("[转发记录]")
		case "face":
			b.WriteString("[表情]")
		case "reply":
			b.WriteString("[引用消息 " + segString(data, "id") + "]")
		}
	}
	return truncateRunes(strings.TrimSpace(b.String()), quotedTextMaxRunes)
}
