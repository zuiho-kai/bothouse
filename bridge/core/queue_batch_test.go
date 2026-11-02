package core

import (
	"os"
	"strings"
	"testing"
)

func TestTakeQueuedBatchLocked(t *testing.T) {
	st := &interactiveState{pendingMessages: []queuedMessage{
		{userID: "u1", msgSessionKey: "d:1", content: "一", messageID: "m1", userMessageTimeMs: 1793460000000},
		{userID: "u1", msgSessionKey: "d:1", content: "二", messageID: "m2", images: []ImageAttachment{{}}},
		{userID: "u1", msgSessionKey: "d:1", content: "三", messageID: "m3"},
		{userID: "u2", msgSessionKey: "d:1", content: "别人", messageID: "m4"},
		{userID: "cron", msgSessionKey: "d:1", content: "定时", messageID: "m5"},
	}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "m3" || len(q.images) != 1 || !strings.Contains(q.content, "连发了 3 条") ||
		strings.Index(q.content, "一") > strings.Index(q.content, "二") || strings.Index(q.content, "二") > strings.Index(q.content, "三") {
		t.Fatalf("batch = %+v", q)
	}
	t.Logf("merged turn:\n%s", q.content)
	if q = takeQueuedBatchLocked(st); q.messageID != "m4" || q.content != "别人" {
		t.Fatalf("other sender = %+v", q)
	}
	if q = takeQueuedBatchLocked(st); q.messageID != "m5" || len(st.pendingMessages) != 0 {
		t.Fatalf("cron = %+v", q)
	}
}

func TestTruncateRelayMore(t *testing.T) {
	dir := t.TempDir()
	long := strings.Repeat("字", 2500)
	out := truncateRelayMore(dir, "relay-task/x", long, 2000)
	i := strings.Index(out, "全文：")
	if i < 0 {
		t.Fatalf("no pointer: %s", out[len(out)-120:])
	}
	path := strings.Fields(out[i+len("全文："):])[0]
	b, err := os.ReadFile(path)
	if err != nil || string(b) != long {
		t.Fatalf("full text at %s: %v", path, err)
	}
	t.Logf("tail: %s", out[len(out)-160:])
	if truncateRelayMore(dir, "k", "短", 2000) != "短" {
		t.Fatal("short text changed")
	}
}

// A busy QQ group: every sender's queued message runs as one turn, each part names its sender,
// the newest is marked; a bot or cron turn still waits for its own (user 2026-11-02).
func TestTakeQueuedBatchLocked_GroupChatAllSenders(t *testing.T) {
	g := func(id, user, name, content string, mentioned bool) queuedMessage {
		return queuedMessage{userID: user, userName: name, msgPlatform: "qq", msgSessionKey: "qq:g:1", content: content, messageID: id, mentioned: mentioned}
	}
	st := &interactiveState{pendingMessages: []queuedMessage{
		g("m1", "u1", "司空晔", "你呢", false),
		g("m2", "u2", "石英", "你也说说", false),
		g("m3", "u3", "三秋", "@肥鱼 在吗", true),
		g("m4", "u1", "司空晔", "人呢", false),
		{userID: "b1", msgPlatform: "qq", msgSessionKey: "qq:g:1", content: "队友", messageID: "m5", fromBot: true},
	}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "m4" || !q.mentioned || !strings.Contains(q.content, "你忙时收到的 4 条") ||
		!strings.Contains(q.content, "三秋（@你）：") || !strings.Contains(q.content, "（最新）\n[4] 司空晔：\n人呢") ||
		strings.Index(q.content, "你呢") > strings.Index(q.content, "你也说说") {
		t.Fatalf("batch = %+v", q)
	}
	t.Logf("merged turn:\n%s", q.content)
	if len(st.pendingMessages) != 1 || st.pendingMessages[0].messageID != "m5" {
		t.Fatalf("left = %+v", st.pendingMessages)
	}
	// A QQ private chat keeps one sender per turn (there is only one), Discord keeps one sender per turn.
	d := &interactiveState{pendingMessages: []queuedMessage{
		{userID: "u1", msgPlatform: "discord", msgSessionKey: "d:1", content: "一", messageID: "d1"},
		{userID: "u2", msgPlatform: "discord", msgSessionKey: "d:1", content: "二", messageID: "d2"},
	}}
	if q = takeQueuedBatchLocked(d); q.messageID != "d1" || len(d.pendingMessages) != 1 {
		t.Fatalf("discord = %+v", q)
	}
}

// A full QQ group queue never says "queue full": the oldest un-@-ed message gives up its place but
// stays queued as context, an @ is queued even over the cap, and an un-@-ed message with no room
// is queued as context itself. The next turn carries all of them, in order, replying to the newest
// message that held a place.
func TestGroupQueueFull_MakesRoom(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	as := newResultAgentSession("unused")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 2
	e.gate = &gateState{buf: map[string][]string{}}

	key := "qq:g:1"
	_, state := busySessionWithLiveState(t, e, p, key, as)
	msg := func(id, user, content string, mentioned bool) *Message {
		return &Message{SessionKey: key, Platform: "qq", MessageID: id, UserID: user, UserName: user, Content: content, Mentioned: mentioned, ReplyCtx: "r"}
	}
	ids := func() (s []string) {
		for _, q := range state.pendingMessages {
			id := q.messageID
			if q.overflow {
				id += "*"
			}
			s = append(s, id)
		}
		return strings.Split(strings.Join(s, ","), ",")
	}
	for _, m := range []*Message{msg("m1", "u1", "最早", false), msg("m2", "u2", "@她", true),
		msg("m3", "u3", "第三条", false), // m1 gives its place
		msg("m4", "u4", "@她 二", true), // m3 gives its place
		msg("m5", "u5", "@她 三", true), // nothing to give: over the cap
		msg("m6", "u6", "路过", false),  // no room: context itself
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatalf("%s not queued", m.MessageID)
		}
	}
	if got := strings.Join(ids(), ","); got != "m1*,m2,m3*,m4,m5,m6*" {
		t.Fatalf("queue = %s", got)
	}
	if countQueuedLocked(state) != 3 || len(e.gate.buf[key]) != 0 {
		t.Fatalf("depth = %d, gate buffer = %q", countQueuedLocked(state), e.gate.buf[key])
	}
	q := takeQueuedBatchLocked(state)
	if q.messageID != "m5" || !q.mentioned || len(state.pendingMessages) != 0 {
		t.Fatalf("batch = %+v left %d", q, len(state.pendingMessages))
	}
	order := []string{"最早", "@她\n", "第三条", "@她 二", "（回这条）\n[5] u5（@你）：\n@她 三", "路过"}
	at := -1
	for _, w := range order {
		j := strings.Index(q.content, w)
		if j <= at {
			t.Fatalf("%q out of order in:\n%s", w, q.content)
		}
		at = j
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, s := range p.sent {
		if strings.Contains(s, "queue") || strings.Contains(s, "队列") {
			t.Fatalf("queue-full notice sent: %q", p.sent)
		}
	}
}

// Context-only messages of a busy group never get a turn of their own: with a cron turn queued
// between them and the next message holding a place, or sent as voice, they ride with that message.
func TestGroupBatch_ContextRidesWithNextHolder(t *testing.T) {
	g := func(id, content string, overflow, voice bool) queuedMessage {
		return queuedMessage{userID: "u-" + id, userName: id, msgPlatform: "qq", msgSessionKey: "qq:g:1", messageID: id, content: content, overflow: overflow, fromVoice: voice}
	}
	cron := queuedMessage{userID: "cron", msgPlatform: "qq", msgSessionKey: "qq:g:1", messageID: "cron", content: "定时"}
	st := &interactiveState{pendingMessages: []queuedMessage{g("a", "旁听一", true, false), cron, g("b", "旁听二", true, true), g("c", "提问", false, false)}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "c" || !strings.Contains(q.content, "旁听一") || !strings.Contains(q.content, "旁听二") ||
		strings.Index(q.content, "旁听一") > strings.Index(q.content, "提问") {
		t.Fatalf("batch = %+v", q)
	}
	if len(st.pendingMessages) != 1 || st.pendingMessages[0].messageID != "cron" {
		t.Fatalf("left = %+v", st.pendingMessages)
	}
}
