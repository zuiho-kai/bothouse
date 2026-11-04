package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type qq137RepeatPlatform struct {
	stubPlatformEngine
	failFirst bool
	failAt    int // 1-based send number that fails; 0 = never
	sends     int
}

func (*qq137RepeatPlatform) SuppressRepeatedReplyText() bool { return true }
func (p *qq137RepeatPlatform) Send(ctx context.Context, r any, s string) error {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	p.sends++
	if p.failAt != 0 && p.sends == p.failAt {
		return errors.New("fixture send failed")
	}
	if p.failFirst {
		p.failFirst = false
		return errors.New("fixture send failed")
	}
	return p.stubPlatformEngine.Send(ctx, r, s)
}

type qq137FixtureSession struct{ *controllableAgentSession }

// The fixture owns the event channel, including the preclosed-stream scenario.
func (*qq137FixtureSession) Close() error { return nil }

func qq137RunRepeatedTurn(t *testing.T, p Platform, first, last string, closeOnly bool) {
	t.Helper()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	key := "test:qq137-repeat"
	session := e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("qq137-repeat")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	// Replay the real DSH sequence: whitespace/read, narration/bash, same narration/end.
	a.events <- Event{Type: EventText, Content: "  "}
	a.events <- Event{Type: EventToolUse, ToolName: "read"}
	a.events <- Event{Type: EventText, Content: first}
	a.events <- Event{Type: EventToolUse, ToolName: "bash"}
	a.events <- Event{Type: EventText, Content: last}
	if closeOnly {
		close(a.events)
	} else {
		a.events <- Event{Type: EventResult, Done: true}
	}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
}
func TestQQ137RepeatedTurnText(t *testing.T) {
	const body = "手滑了…  把心里想的打出来了"
	for _, closeOnly := range []bool{false, true} {
		p := &qq137RepeatPlatform{}
		qq137RunRepeatedTurn(t, p, "   "+body+"  ", "   "+body, closeOnly)
		if got := strings.Count(strings.Join(p.getSent(), "\n"), body); got != 1 {
			t.Fatalf("same-turn text sent %d times: %q", got, p.getSent())
		}
	}
}
func TestQQ137RepeatedPrefixKeepsNewText(t *testing.T) {
	p := &qq137RepeatPlatform{}
	qq137RunRepeatedTurn(t, p, "已处理。", "已处理。\n新消息", false)
	got := strings.Join(p.getSent(), "\n")
	if strings.Count(got, "已处理。") != 1 || !strings.Contains(got, "新消息") {
		t.Fatalf("repeat or lost suffix: %q", got)
	}
}
func TestQQ137RepeatDoesNotChangeOtherPlatforms(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	qq137RunRepeatedTurn(t, p, "same", "same", false)
	if got := strings.Count(strings.Join(p.getSent(), "\n"), "same"); got != 2 {
		t.Fatalf("non-capable platform changed: %q", p.getSent())
	}
}
func TestQQ137RepeatDoesNotHideNextTurnOrFailedSend(t *testing.T) {
	p := &qq137RepeatPlatform{}
	qq137RunRepeatedTurn(t, p, "same", "same", false)
	qq137RunRepeatedTurn(t, p, "same", "same", false)
	if got := strings.Count(strings.Join(p.getSent(), "\n"), "same"); got != 2 {
		t.Fatalf("next turn hidden or duplicates: %q", p.getSent())
	}
	failed := &qq137RepeatPlatform{failFirst: true}
	qq137RunRepeatedTurn(t, failed, "same", "same", false)
	if got := strings.Count(strings.Join(failed.getSent(), "\n"), "same"); got != 1 {
		t.Fatalf("failed send swallowed retry: %q", failed.getSent())
	}
}

func TestQQ137PartialChunkFailureStillSuppressesDeliveredChunk(t *testing.T) {
	// Two lines that together exceed maxPlatformMessageLen, so the narration
	// splits into two chunks; the second chunk's first delivery fails.
	lineA := strings.Repeat("甲", maxPlatformMessageLen-100)
	lineB := strings.Repeat("乙", 200)
	body := lineA + "\n" + lineB
	p := &qq137RepeatPlatform{failAt: 2}
	qq137RunRepeatedTurn(t, p, body, body, false)
	got := strings.Join(p.getSent(), "\n")
	if n := strings.Count(got, lineA); n != 1 {
		t.Fatalf("delivered chunk resent %d times", n)
	}
	if n := strings.Count(got, lineB); n != 1 {
		t.Fatalf("failed chunk not retried exactly once: %d", n)
	}
}
