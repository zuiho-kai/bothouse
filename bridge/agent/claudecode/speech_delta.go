package claudecode

import (
	"github.com/chenhg5/cc-connect/core"
	"math"
)

// Activated by voice_stream, which passes --include-partial-messages to Claude.
// The full assistant message still drives normal chat/history; this separate
// event is consumed only by explicitly opted-in local voice requests.
func (cs *claudeSession) handleSpeechDelta(raw map[string]any) {
	sid, _ := raw["session_id"].(string)
	if sid == "" {
		return
	}
	ev, _ := raw["event"].(map[string]any)
	typ, _ := ev["type"].(string)
	index, validIndex := ev["index"].(float64)
	if typ == "content_block_start" || typ == "content_block_delta" || typ == "content_block_stop" {
		if !validIndex || math.IsNaN(index) || index < 0 || index > 4095 || math.Trunc(index) != index {
			return
		}
	}
	var text string
	switch typ {
	case "message_start":
		cs.speechBlocks = make(map[int]bool)
	case "content_block_start":
		block, _ := ev["content_block"].(map[string]any)
		if cs.speechBlocks == nil {
			cs.speechBlocks = make(map[int]bool)
		}
		cs.speechBlocks[int(index)] = block["type"] == "text"
		if cs.speechBlocks[int(index)] {
			text, _ = block["text"].(string)
		}
	case "content_block_delta":
		delta, _ := ev["delta"].(map[string]any)
		if cs.speechBlocks[int(index)] && delta["type"] == "text_delta" {
			text, _ = delta["text"].(string)
		}
	case "content_block_stop":
		delete(cs.speechBlocks, int(index))
	case "message_stop":
		cs.speechBlocks = nil
	}
	if text == "" {
		return
	}
	select {
	case cs.events <- core.Event{Type: core.EventSpeechText, SessionID: sid, Content: text}:
	case <-cs.ctx.Done():
	}
}
