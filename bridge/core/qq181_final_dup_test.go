package core

import (
	"strings"
	"testing"
	"time"
)

// #181: after a script already posted text/stickers this turn
// (stickers.py -> bin/qq-bridge send), the turn's own final reply must not
// repeat the same sentence, and a bracketed receipt note the agent writes to
// itself must never reach the channel.

func qq181Turn(t *testing.T, e *Engine, p Platform, key string, state *interactiveState, parts []string, closeOnly bool) {
	t.Helper()
	a := state.agentSession.(*qq137FixtureSession)
	for i, part := range parts {
		// Alternate narration with a tool boundary, like a real script send.
		a.events <- Event{Type: EventText, Content: part}
		if i < len(parts)-1 {
			a.events <- Event{Type: EventToolUse, ToolName: "bash"}
		}
	}
	if closeOnly {
		close(a.events)
	} else {
		a.events <- Event{Type: EventResult, Done: true}
	}
	e.processInteractiveEvents(state, e.sessions.GetOrCreateActive(key), e.sessions, key, "m", time.Now(), nil, nil, nil)
}

func qq181NewFixture(t *testing.T, p Platform, key string) (*Engine, *interactiveState) {
	t.Helper()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("qq181")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	return e, state
}

// Two script sends in one turn: the final reply repeats the FIRST one, which
// sideText (last send only) cannot catch.
func TestQQ181FinalReplyRepeatingEarlierToolSend(t *testing.T) {
	const key = "test:qq181-multi"
	for _, closeOnly := range []bool{false, true} {
		p := &qq137RepeatPlatform{}
		e, state := qq181NewFixture(t, p, key)
		first, second := "那不一样 那个是原则问题", "这句我熟 JOJO梗是吧"
		if err := e.SendToSessionWithAttachments(key, "   "+first+"    ", nil, nil, nil, false); err != nil {
			t.Fatalf("script send: %v", err)
		}
		if err := e.SendToSessionWithAttachments(key, "     "+second+"      ", nil, nil, nil, false); err != nil {
			t.Fatalf("script send: %v", err)
		}
		qq181Turn(t, e, p, key, state, []string{"     " + first}, closeOnly)
		got := strings.Join(p.getSent(), "\n")
		if n := strings.Count(got, first); n != 1 {
			t.Fatalf("closeOnly=%v: first line sent %d times: %q", closeOnly, n, p.getSent())
		}
		if !strings.Contains(got, second) {
			t.Fatalf("closeOnly=%v: script send lost: %q", closeOnly, p.getSent())
		}
	}
}

// The whole reply is a bracketed receipt note: nothing may go out.
func TestQQ181MetaOnlyReplyIsNotSent(t *testing.T) {
	const key = "test:qq181-meta"
	for _, body := range []string{
		"(Already replied above with text + sticker.)",
		"  （已回复，配图已发）  ",
		"(Already replied above with text + sticker.)\n\n（表情包已发）",
	} {
		p := &qq137RepeatPlatform{}
		e, state := qq181NewFixture(t, p, key)
		qq181Turn(t, e, p, key, state, []string{"  ", "那不一样 那个是原则问题", body}, false)
		got := strings.Join(p.getSent(), "\n")
		if strings.Contains(got, "Already replied") || strings.Contains(got, "已回复") {
			t.Fatalf("meta note reached the channel: %q", p.getSent())
		}
	}
}

// A silent marker followed by a receipt note is still a silent turn.
func TestQQ181SilentMarkerWithMetaNoteStaysSilent(t *testing.T) {
	const key = "test:qq181-meta-silent"
	p := &qq137RepeatPlatform{}
	e, state := qq181NewFixture(t, p, key)
	a := state.agentSession.(*qq137FixtureSession)
	a.events <- Event{Type: EventText, Content: "NO_REPLY\n\n（已存好，标签「奶龙」）"}
	a.events <- Event{Type: EventResult, Content: "NO_REPLY\n\n（已存好，标签「奶龙」）", Done: true}
	e.processInteractiveEvents(state, e.sessions.GetOrCreateActive(key), e.sessions, key, "m", time.Now(), nil, nil, nil)
	if got := p.getSent(); len(got) != 0 {
		t.Fatalf("silent turn posted: %#v", got)
	}
}

// Space-padded prose is not code: it must stay deduplicable. Same padding on
// the reply and on the script send, exactly as the QQ bridge logged it.
func TestQQ181SpacePaddedProseStillDeduplicated(t *testing.T) {
	const key = "test:qq181-padding"
	p := &qq137RepeatPlatform{}
	e, state := qq181NewFixture(t, p, key)
	line := "     手滑打错了 当我没说      "
	if err := e.SendToSessionWithAttachments(key, line, nil, nil, nil, false); err != nil {
		t.Fatalf("script send: %v", err)
	}
	qq181Turn(t, e, p, key, state, []string{line}, false)
	if n := strings.Count(strings.Join(p.getSent(), "\n"), "手滑打错了 当我没说"); n != 1 {
		t.Fatalf("padded prose sent %d times: %q", n, p.getSent())
	}
}

// A genuinely indented code block is still protected from dedupe.
func TestQQ181IndentedCodeStillProtected(t *testing.T) {
	code := "看这个：\n\n    func main() {\n        run()\n    }"
	if !replyContainsCode(code) {
		t.Fatal("multi-line indented code must count as code")
	}
	if replyContainsCode("     手滑打错了 当我没说      ") {
		t.Fatal("single space-padded prose line must not count as code")
	}
	if replyContainsCode("```go\nx := 1\n```") != true {
		t.Fatal("fenced block must count as code")
	}
	if unsentReplyText(&qq137RepeatPlatform{}, code, []string{code}) != code {
		t.Fatal("code must never be deduplicated")
	}
}

// A note-shaped aside addressed to the reader stays: only self-directed
// receipts are dropped.
func TestQQ181UserFacingParentheticalSurvives(t *testing.T) {
	for _, text := range []string{"(已发你私聊了)", "（已发送给你了）", "(sent you a dm)"} {
		if isMetaOnlyReply(text) {
			t.Fatalf("user-facing aside dropped: %q", text)
		}
	}
	// A note is dropped from the tail when only a silent marker remains...
	if got, ok := stripTrailingMetaNotes("NO_REPLY\n\n（已存好，标签「奶龙」）"); !ok || got != "NO_REPLY" {
		t.Fatalf("silent marker + note = %q, ok=%v", got, ok)
	}
	// ...but real text never loses its tail.
	if _, ok := stripTrailingMetaNotes("好的（已存好）"); ok {
		t.Fatal("mid-line note must not be stripped")
	}
}

// Non-capable platforms keep the old behaviour: only the exact last-send echo
// is caught, an earlier script send repeated by the final reply still posts.
func TestQQ181OtherPlatformsUnchanged(t *testing.T) {
	const key = "test:qq181-other"
	first, second := "已发送文件给你。", "图也发了。"
	p := &stubPlatformEngine{n: "telegram"}
	e, state := qq181NewFixture(t, p, key)
	for _, text := range []string{first, second} {
		if err := e.SendToSessionWithAttachments(key, text, nil, nil, nil, false); err != nil {
			t.Fatalf("side send: %v", err)
		}
	}
	qq181Turn(t, e, p, key, state, []string{first}, false)
	if n := strings.Count(strings.Join(p.getSent(), "\n"), first); n != 2 {
		t.Fatalf("non-capable platform changed: %q", p.getSent())
	}
}

// Suppression is per turn: the next turn's genuine text still goes out.
func TestQQ181NextTurnNotSuppressed(t *testing.T) {
	const key = "test:qq181-next"
	p := &qq137RepeatPlatform{}
	e, state := qq181NewFixture(t, p, key)
	if err := e.SendToSessionWithAttachments(key, "同一句", nil, nil, nil, false); err != nil {
		t.Fatalf("script send: %v", err)
	}
	qq181Turn(t, e, p, key, state, []string{"同一句"}, false)
	// Second turn: fresh session channel, same session key, new text.
	a2 := &qq137FixtureSession{newControllableSession("qq181b")}
	state.agentSession = a2
	qq181Turn(t, e, p, key, state, []string{"换一句"}, false)
	got := strings.Join(p.getSent(), "\n")
	if !strings.Contains(got, "换一句") {
		t.Fatalf("next turn lost: %q", p.getSent())
	}
	if n := strings.Count(got, "同一句"); n != 1 {
		t.Fatalf("repeat leaked across turns: %q", p.getSent())
	}
}
