package core

import "testing"

// #1270: the engine joins a turn's text events with no separator, so a Codex progress message
// glued before "[report]" hid the marker (bothouse.log 11-07 20:35 discord:1559012353142689843,
// 龙娘 #1181). The adapter's last message is read first.
func TestExitReplyTextPrefersLastReply(t *testing.T) {
	full := "我先核对交接再交回[report] #1181 背景：验收四条 PR"
	last := "[report] #1181 背景：验收四条 PR"
	if _, _, ok := parseExitKindTurn(full); ok {
		t.Fatalf("precondition: the glued turn should not parse")
	}
	ev := Event{Type: EventResult, Metadata: map[string]any{MetaLastReply: last}}
	if got := exitReplyText(ev, full); got != last {
		t.Fatalf("exitReplyText = %q, want the last reply", got)
	}
	// Claude Code: Content is the last message
	if got := exitReplyText(Event{Type: EventResult, Content: last}, full); got != last {
		t.Fatalf("exitReplyText(Content) = %q, want Content", got)
	}
	// no marker in the last message: the whole turn is checked as before
	progress := "还在跑，下一轮交 [report]。"
	if got := exitReplyText(Event{Type: EventResult, Content: progress}, progress); got != progress {
		t.Fatalf("exitReplyText fallback = %q", got)
	}
}

func TestWatchIsHandbackAfterProgress(t *testing.T) {
	if !watchIsHandback("核完了，下面是交回。\n\n[report] #12 背景：x\n做了 y") {
		t.Fatalf("a [report] after a progress line is a handback")
	}
	if watchIsHandback("还没做完，这轮不交 [report]。") {
		t.Fatalf("a mention inside a sentence is not a handback")
	}
}
