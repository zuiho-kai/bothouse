package discord

import "testing"

func TestReturnToLeadPrependsOncePerTrigger(t *testing.T) {
	p := &Platform{}
	rc := replyContext{channelID: "c", messageID: "m1", final: true, lead: "L"}
	if got := p.returnToLead(rc, "已完成，交橘验收"); got != "<@L> 已完成，交橘验收" {
		t.Fatalf("first post: %q", got)
	}
	if got := p.returnToLead(rc, "第二段"); got != "第二段" {
		t.Fatalf("second post of same turn must not ping again: %q", got)
	}
	rc2 := rc
	rc2.messageID = "m2"
	if got := p.returnToLead(rc2, "新的活"); got != "<@L> 新的活" {
		t.Fatalf("new dispatch: %q", got)
	}
}

func TestReturnToLeadSkips(t *testing.T) {
	p := &Platform{}
	cases := []struct {
		name string
		rc   replyContext
		in   string
	}{
		{"interim post", replyContext{messageID: "a", agent: true, lead: "L"}, "我先看看"},
		{"not dispatched by lead", replyContext{messageID: "b", final: true}, "hi"},
		{"already mentions lead", replyContext{messageID: "c", final: true, lead: "L"}, "<@L> 好了"},
		{"already mentions lead (nick form)", replyContext{messageID: "d", final: true, lead: "L"}, "<@!L> 好了"},
		{"empty", replyContext{messageID: "e", final: true, lead: "L"}, "  "},
	}
	for _, c := range cases {
		if got := p.returnToLead(c.rc, c.in); got != c.in {
			t.Errorf("%s: got %q", c.name, got)
		}
	}
	// a turn that already @-ed the lead does not get a second ping later
	if got := p.returnToLead(replyContext{messageID: "c", final: true, lead: "L"}, "补充"); got != "补充" {
		t.Errorf("after explicit @: %q", got)
	}
}

func TestKeepLeadAcrossBurst(t *testing.T) {
	first := replyContext{channelID: "c", messageID: "m1", lead: "L"}
	second := replyContext{channelID: "c", messageID: "m2"}
	got, _ := keepLead(first, second).(replyContext)
	if got.lead != "L" || got.messageID != "m2" {
		t.Fatalf("burst lost lead: %+v", got)
	}
	if got, _ := keepLead(second, replyContext{messageID: "m3"}).(replyContext); got.lead != "" {
		t.Fatalf("lead invented: %+v", got)
	}
}

func TestMarkFinalReply(t *testing.T) {
	p := &Platform{}
	rc, _ := p.MarkFinalReply(replyContext{messageID: "m", lead: "L"}).(replyContext)
	if !rc.final || !rc.agent {
		t.Fatalf("not marked: %+v", rc)
	}
	if got := p.returnToLead(rc, "完成"); got != "<@L> 完成" {
		t.Fatalf("final not routed: %q", got)
	}
}

// A lead's @ injected into a sub's running turn (core.InjectedReplyMerger): the turn keeps answering
// its own trigger, but its final answer now returns to the lead.
func TestMergeInjectedReplyKeepsLead(t *testing.T) {
	p := &Platform{}
	turn := replyContext{channelID: "c", messageID: "u1"}
	got, _ := p.MergeInjectedReply(turn, replyContext{channelID: "c", messageID: "l1", lead: "L"}).(replyContext)
	if got.messageID != "u1" || got.lead != "L" {
		t.Fatalf("merged=%+v, want trigger u1 with lead L", got)
	}
	if got, _ := p.MergeInjectedReply(turn, replyContext{channelID: "c", messageID: "u2"}).(replyContext); got.lead != "" {
		t.Fatalf("lead invented: %+v", got)
	}
	if again, _ := p.MergeInjectedReply(got, replyContext{channelID: "c", messageID: "u3"}).(replyContext); again.lead != "L" {
		t.Fatalf("a later person's insert dropped the lead: %+v", again)
	}
}
