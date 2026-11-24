package core

import (
	"strings"
	"testing"
	"time"
)

// 11-08 00:54 DM: draft streamed, Stop hook blocked it, model set a timer and
// rewrote the reply. Only the rewrite may reach the channel.
func TestStopBlockedDraftIsWithdrawn(t *testing.T) {
	draft := "现在在等你回话啊，刚过零点五十。"
	rewrite := "现在都快一点了，刚顺手定了个闹钟，到点回来看。"
	p := &mockReplierPlatform{}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	e.SetStreamPreviewCfg(replierCfg())
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ThinkingMessages: true})
	key := "test:dm"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("dm")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	if !e.NoteStopBlocked(key, draft, false, "") {
		t.Fatal("running turn not found")
	}
	agent.events <- Event{Type: EventText, Content: draft}
	agent.events <- Event{Type: EventThinking, Content: "set the timer"}
	agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "bothouse timer add"}
	agent.events <- Event{Type: EventText, Content: rewrite}
	agent.events <- Event{Type: EventResult, Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)

	commits, deleted := p.state()
	out := strings.Join(append(append([]string{}, commits...), p.getMessages()...), "\n")
	for _, s := range p.sent {
		out += "\n" + s
	}
	if strings.Contains(out, "零点五十") && len(deleted) == 0 {
		t.Fatalf("blocked draft stayed in the channel: %s", out)
	}
	for _, c := range commits {
		if strings.Contains(c, "零点五十") {
			t.Fatalf("blocked draft committed as a reply: %q", c)
		}
	}
	if !strings.Contains(out, "快一点了") {
		t.Fatalf("rewrite not delivered: %s", out)
	}
	t.Logf("commits=%q deleted=%v msgs=%q sent=%q", commits, deleted, p.getMessages(), p.sent)
}

func TestMergeStopBlockedReplyAddendum(t *testing.T) {
	pre := strings.Repeat("长", 40)
	if got := MergeStopBlockedReply(pre, "补一句"); got != pre+"\n\n补一句" {
		t.Fatalf("addendum: %q", got)
	}
	if got := MergeStopBlockedReply(pre, ""); got != pre {
		t.Fatalf("empty: %q", got)
	}
}

// #1907: the copy gate blocked a reply without its reference lines. A short
// rewrite must not bring the blocked draft back in front of it.
func TestStopWithheldDraftNeverMergedBack(t *testing.T) {
	draft := "仓库简介改成这样：住在你群聊里的 AI 团队，自己分活、自己验收，再也不用你盯。"
	short := "文案检查没过，草稿没发出。"
	p := &mockReplierPlatform{}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	e.SetStreamPreviewCfg(replierCfg())
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ThinkingMessages: true})
	key := "test:dm"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("dm")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	if !e.NoteStopBlocked(key, draft, true, "") {
		t.Fatal("running turn not found")
	}
	agent.events <- Event{Type: EventText, Content: draft}
	agent.events <- Event{Type: EventText, Content: short}
	agent.events <- Event{Type: EventResult, Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	commits, _ := p.state()
	for _, c := range append(append([]string{}, commits...), p.sent...) {
		if strings.Contains(c, "自己分活") {
			t.Fatalf("withheld draft reached the channel: %q", c)
		}
	}
	out := strings.Join(append(append(commits, p.getMessages()...), p.sent...), "\n")
	if !strings.Contains(out, "草稿没发出") {
		t.Fatalf("short rewrite not delivered: %s", out)
	}
}

// #1907: blocked once, the model sent the same copy again; the hook lets the turn
// end and asks for a replacement. The draft is swapped for the replacement line.
func TestStopReplaceSwapsFinalDraft(t *testing.T) {
	draft := "仓库简介改成这样：住在你群聊里的 AI 团队，自己分活、自己验收。"
	p := &mockUpdaterPlatform{} // plain send at the end (the preview was withdrawn)
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	e.SetStreamPreviewCfg(replierCfg())
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ThinkingMessages: true})
	key := "test:dm"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("dm")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	agent.events <- Event{Type: EventText, Content: draft}
	if !e.NoteStopBlocked(key, draft, true, "文案检查没过，草稿没发出。") {
		t.Fatal("running turn not found")
	}
	agent.events <- Event{Type: EventResult, Content: draft, Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	final := strings.Join(append(p.getMessages(), p.sent...), "\n")
	if !strings.Contains(final, "草稿没发出") {
		t.Fatalf("replacement not delivered: %s", final)
	}
	for _, c := range p.sent {
		if strings.Contains(c, "自己分活") {
			t.Fatalf("draft reached the channel: %q", c)
		}
	}
	t.Logf("msgs=%q sent=%q", p.getMessages(), p.sent)
}
