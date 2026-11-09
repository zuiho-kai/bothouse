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
	if !e.NoteStopBlocked(key, draft) {
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
