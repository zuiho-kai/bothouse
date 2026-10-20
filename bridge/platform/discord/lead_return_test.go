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

// Which turns are the lead's to get back: the lead @-ing this sub, and (issue #182) a person's
// message that @-s this sub and the lead together — the sub answers, the lead checks when @-ed back.
func TestDispatchedBy(t *testing.T) {
	p := &Platform{botID: "S", teamLead: "L"}
	cases := []struct {
		name               string
		fromBot, mentioned bool
		author, content    string
		want               string
	}{
		{"lead @ sub", true, true, "L", "你来写", "L"},
		{"lead not @ sub", true, false, "L", "我看看", ""},
		{"other bot @ sub", true, true, "J", "你来", ""},
		{"person @ sub", false, true, "U", "你来", ""},
		{"person @ sub and lead", false, true, "U", "<@L> 帮我算 17×23，龙娘算，橘核对", "L"},
		{"person @ sub and lead (nick form)", false, true, "U", "<@!L> 帮我算", "L"},
		{"person @ lead only", false, false, "U", "<@L> 你看看", ""},
		{"other bot @ sub and lead", true, true, "J", "<@L> 你来", ""},
	}
	for _, c := range cases {
		if got := p.dispatchedBy(c.fromBot, c.mentioned, c.author, c.content); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	lead := &Platform{botID: "L", teamLead: "L"}
	if got := lead.dispatchedBy(false, true, "U", "<@L> <@S> 你们看看"); got != "" {
		t.Errorf("the lead itself never returns to itself: %q", got)
	}
}

// Issue #184: Discord lets a person @ a bot through its managed role (<@&roleID>, gate.jsonl
// 2026-10-13/16). A teammate's role mention reads as its user mention, so "@ the lead and this sub
// together" is recognised either way (and the gate sees <@id> too).
func TestDispatchedBy_LeadRoleMention(t *testing.T) {
	lead := &Platform{botID: "L"}
	lead.botRoleIDs.Store("g", "RL")
	sub := &Platform{botID: "S", teamLead: "L"}
	sub.botRoleIDs.Store("g", "RS")
	teamPlatforms.Store("L", lead)
	teamPlatforms.Store("S", sub)
	t.Cleanup(func() { teamPlatforms.Delete("L"); teamPlatforms.Delete("S") })

	content := teamRoleMentions("<@&RL> 帮我算 17×23，龙娘算，橘核对", "g", "S")
	if content != "<@L> 帮我算 17×23，龙娘算，橘核对" {
		t.Fatalf("lead's role mention not turned into its user mention: %q", content)
	}
	if got := sub.dispatchedBy(false, true, "user", content); got != "L" {
		t.Fatalf("dispatchedBy = %q, want L", got)
	}
	// its own role is left to the existing strip / markSelfMention; other guilds and plain text untouched
	if got := teamRoleMentions("<@&RS> <@&RL>", "g", "S"); got != "<@&RS> <@L>" {
		t.Fatalf("got %q", got)
	}
	if got := teamRoleMentions("<@&RL> hi", "other", "S"); got != "<@&RL> hi" {
		t.Fatalf("other guild: %q", got)
	}
}
