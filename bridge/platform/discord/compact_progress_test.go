package discord

import "testing"

// Review 613-plan.md #3: a marked reply context gives both hints (compact style, no card
// payload); an unmarked one gives neither, so the platform's own style applies.
func TestMarkCompactProgressHints(t *testing.T) {
	p := &Platform{}
	plain := replyContext{channelID: "c1", messageID: "m1", agent: true}
	if _, ok := plain.ProgressStyleHint(); ok {
		t.Fatal("unmarked reply context overrides the style")
	}
	if _, ok := plain.ProgressCardPayloadHint(); ok {
		t.Fatal("unmarked reply context overrides the card payload")
	}
	marked, ok := p.MarkCompactProgress(plain).(replyContext)
	if !ok {
		t.Fatalf("marked type = %T", p.MarkCompactProgress(plain))
	}
	if style, ok := marked.ProgressStyleHint(); !ok || style != "compact" {
		t.Fatalf("style hint = %q, %v", style, ok)
	}
	if payload, ok := marked.ProgressCardPayloadHint(); !ok || payload {
		t.Fatalf("payload hint = %v, %v", payload, ok)
	}
	if marked.channelID != "c1" || marked.messageID != "m1" || !marked.agent {
		t.Fatalf("mark lost fields: %+v", marked)
	}

	ic := &interactionReplyCtx{channelID: "c2"}
	mi, ok := p.MarkCompactProgress(ic).(*interactionReplyCtx)
	if !ok || mi.parent != ic || mi.channelID != "c2" {
		t.Fatalf("interaction mark = %+v", mi)
	}
	if style, ok := mi.ProgressStyleHint(); !ok || style != "compact" {
		t.Fatalf("interaction style hint = %q, %v", style, ok)
	}
	if payload, ok := mi.ProgressCardPayloadHint(); !ok || payload {
		t.Fatalf("interaction payload hint = %v, %v", payload, ok)
	}
	if _, ok := ic.ProgressStyleHint(); ok {
		t.Fatal("the original interaction context was marked")
	}
}
