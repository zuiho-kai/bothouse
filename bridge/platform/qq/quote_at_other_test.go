package qq

import (
	"testing"
)

// #983: a member quotes another member's message and asks that member a
// question — QQ clients emit a reply segment plus an @ of the quoted author.
// Neither flag was set before, so the gate's routing model received a message
// plainly directed at someone else and let this bot answer as itself. The
// message must reach the engine as AddressedOther (context only, core
// addresseeOf "@真人"/"回复别人"), never Mentioned.
func TestGroupReplyAndAtMember_AddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, textSegment("我先说一句")))
	first := awaitMessage(t, msgs)

	// 三秋 quoting 橘娘 and asking her "是opus吗" was the reported miss.
	f.push(groupMessage(111, 2002, 2, replySegment(first.MessageID), atSegment("2001"), textSegment(" 是opus吗")))
	m := awaitMessage(t, msgs)

	if m.Mentioned {
		t.Error("Mentioned = true, want false: the reply and @ target another member")
	}
	if !m.AddressedOther {
		t.Error("AddressedOther = false, want true: the message calls the quoted member, not this bot")
	}
}

// Replying to one's own message is a continuation, not a call to someone else
// (discord callsOther excludes it too).
func TestGroupReplyToOwn_NotAddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, textSegment("我先说一句")))
	first := awaitMessage(t, msgs)

	f.push(groupMessage(111, 2001, 2, replySegment(first.MessageID), textSegment(" 补充一下")))
	m := awaitMessage(t, msgs)

	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: the reply targets the sender's own message")
	}
}

// @-ing oneself calls nobody in particular.
func TestGroupAtSelf_NotAddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, atSegment("2001"), textSegment(" 打卡")))
	m := awaitMessage(t, msgs)

	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: the sender @-ed themselves")
	}
}

// @all calls everyone, not "someone else"; the gate still decides as before.
func TestGroupAtAll_NotAddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, atSegment("all"), textSegment(" 通知")))
	m := awaitMessage(t, msgs)

	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: @all calls everyone including this bot")
	}
}

// Quoting a member while @-ing this bot still calls this bot: Mentioned wins
// over AddressedOther.
func TestGroupReplyMemberAtBot_MentionedWins(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, textSegment("我先说一句")))
	first := awaitMessage(t, msgs)

	f.push(groupMessage(111, 2002, 2, replySegment(first.MessageID), atSegment("10000"), textSegment(" 肥鱼看看")))
	m := awaitMessage(t, msgs)

	if !m.Mentioned {
		t.Error("Mentioned = false, want true: the bot itself was @-ed")
	}
	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: an explicit @ of the bot decides the recipient")
	}
}

// A private chat is always addressed to this bot (Direct); an at segment in a
// DM does not make it someone else's call.
func TestPrivateAt_NotAddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)

	f.push(privateMessage(2001, 1, atSegment("3003"), textSegment(" 你看看")))
	m := awaitMessage(t, msgs)

	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: a DM is always addressed to the bot")
	}
	if !m.Direct {
		t.Error("Direct = false, want true")
	}
}

// A quote that cannot be resolved marks nothing: the gate decides as before.
func TestGroupReplyUnknownQuote_NotAddressedOther(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("get_msg", func(map[string]any) map[string]any { return map[string]any{"retcode": 100} })
	_, msgs := startTestPlatform(t, f)

	f.push(groupMessage(111, 2001, 1, replySegment("4242"), textSegment(" 看看这条")))
	m := awaitMessage(t, msgs)

	if m.AddressedOther {
		t.Error("AddressedOther = true, want false: the quoted author is unknown")
	}
}
