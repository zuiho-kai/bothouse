package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// #700: one turn, two thinking steps, no tool call. The text before the second
// thinking step goes out as a segment; the turn end must send only the text
// after it, never the whole turn again (qq-bridge.log 2026-11-11 15:35:39/40,
// out 1644204566 then out 1486142858 = both halves glued together).
func runTurnTailResend(t *testing.T, p Platform, closeOnly bool) []string {
	t.Helper()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	key := "test:turn-tail-resend"
	session := e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("turn-tail-resend")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	a.events <- Event{Type: EventThinking, Content: "first thought"}
	a.events <- Event{Type: EventText, Content: "我投「吃」一票，肚子不饱谈什么爱"}
	a.events <- Event{Type: EventThinking, Content: "second thought"}
	a.events <- Event{Type: EventText, Content: "这 AI 好有生存欲"}
	if closeOnly {
		close(a.events)
	} else {
		a.events <- Event{Type: EventResult, Done: true} // ACP: empty Content
	}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	return p.(interface{ getSent() []string }).getSent()
}

func assertTurnSentOnce(t *testing.T, sent []string) {
	t.Helper()
	all := strings.Join(sent, "\n")
	if n := strings.Count(all, "肚子不饱谈什么爱"); n != 1 {
		t.Fatalf("first half sent %d times, want 1: %q", n, sent)
	}
	if n := strings.Count(all, "这 AI 好有生存欲"); n != 1 {
		t.Fatalf("second half sent %d times, want 1: %q", n, sent)
	}
}

func TestTurnTailNotResentAfterThinkingSegmentQQ(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &qq137RepeatPlatform{}, false))
}

func TestTurnTailNotResentAfterThinkingSegmentPlain(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &stubPlatformEngine{n: "plain"}, false))
}

func TestTurnTailNotResentAfterThinkingSegmentChannelClosed(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &qq137RepeatPlatform{}, true))
}

// Preview platforms (Discord, Telegram, Slack, Google Chat, cloud-web, Feishu
// outside rich-card mode): the thinking step freezes and detaches the first
// preview, so "A" stays in the chat as its own message. The turn end must put
// only "B" into the next preview, not "A+B".
type turnTailPreviewPlatform struct {
	stubPlatformEngine
	msgs []string // every chat message, last content wins for previews
}

func (p *turnTailPreviewPlatform) Send(_ context.Context, _ any, s string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.msgs = append(p.msgs, s)
	return nil
}

func (p *turnTailPreviewPlatform) SendPreviewStart(_ context.Context, _ any, s string) (any, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.msgs = append(p.msgs, s)
	return len(p.msgs) - 1, nil
}

func (p *turnTailPreviewPlatform) UpdateMessage(_ context.Context, h any, s string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.msgs[h.(int)] = s
	return nil
}

func (p *turnTailPreviewPlatform) getSent() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.msgs...)
}

func TestTurnTailNotResentAfterThinkingSegmentPreview(t *testing.T) {
	p := &turnTailPreviewPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	// Flush every chunk so the first half really is on screen before the thinking step.
	e.SetStreamPreviewCfg(StreamPreviewCfg{Enabled: true, MinDeltaChars: 1, MaxChars: 2000})
	key := "test:turn-tail-resend-preview"
	session := e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("turn-tail-resend-preview")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	a.events <- Event{Type: EventThinking, Content: "first thought"}
	a.events <- Event{Type: EventText, Content: "我投「吃」一票，肚子不饱谈什么爱"}
	a.events <- Event{Type: EventThinking, Content: "second thought"}
	a.events <- Event{Type: EventText, Content: "这 AI 好有生存欲"}
	a.events <- Event{Type: EventResult, Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	sent := p.getSent()
	if len(sent) < 2 {
		t.Fatalf("want the first half kept as its own message, got %q", sent)
	}
	assertTurnSentOnce(t, sent)
}

// Streaming-card platforms (DingTalk AI card, Slack streaming) aggregate the
// whole turn into one card; the card branch comes before the segment branch,
// so the turn end finalizes the card with the full text once.
type turnTailCard struct {
	mu    sync.Mutex
	final string
}

func (c *turnTailCard) Update(context.Context, string) error { return nil }
func (c *turnTailCard) Finalize(_ context.Context, s string) error {
	c.mu.Lock()
	c.final = s
	c.mu.Unlock()
	return nil
}
func (c *turnTailCard) Failed() bool { return false }

type turnTailCardPlatform struct {
	stubPlatformEngine
	card *turnTailCard
}

func (p *turnTailCardPlatform) CreateStreamingCard(context.Context, any) (StreamingCard, error) {
	return p.card, nil
}

func TestTurnTailNotResentAfterThinkingSegmentStreamingCard(t *testing.T) {
	p := &turnTailCardPlatform{stubPlatformEngine: stubPlatformEngine{n: "dingtalk"}, card: &turnTailCard{}}
	sent := runTurnTailResend(t, p, false)
	p.card.mu.Lock()
	final := p.card.final
	p.card.mu.Unlock()
	assertTurnSentOnce(t, append(sent, final))
}

// #703: Result.Content can be the only source of the final answer/error
// (Claude Code synthesizes an API-error result without an EventText).
func TestTurnTailTerminalContent(t *testing.T) {
	for _, mode := range []string{"compact", "quiet"} {
		for _, kind := range []string{"plain", "preview", "card"} {
			for _, result := range []string{"answer", "error", "stop-rewrite"} {
				t.Run(mode+"/"+kind+"/"+result, func(t *testing.T) {
					var p Platform = &stubPlatformEngine{n: "plain"}
					if kind == "preview" {
						p = &turnTailPreviewPlatform{stubPlatformEngine: stubPlatformEngine{n: "preview"}}
					} else if kind == "card" {
						p = &turnTailCardPlatform{stubPlatformEngine: stubPlatformEngine{n: "card"}, card: &turnTailCard{}}
					}
					e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
					e.SetDisplayConfig(DisplayCfg{Mode: mode})
					e.SetStreamPreviewCfg(StreamPreviewCfg{Enabled: true, MinDeltaChars: 1, MaxChars: 2000})
					key := "test:terminal-content"
					session := e.sessions.GetOrCreateActive(key)
					a := &qq137FixtureSession{newControllableSession("terminal-content")}
					state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
					e.interactiveStates[key] = state
					a.events <- Event{Type: EventText, Content: "already streamed intro"}
					a.events <- Event{Type: EventThinking, Content: "continue"}
					if result != "error" {
						a.events <- Event{Type: EventText, Content: "provisional tail"}
					}
					terminal := Event{Type: EventResult, Content: "terminal-only " + result, Done: true}
					if result == "error" {
						terminal.Metadata = map[string]any{MetaResultIsError: true}
					} else if result == "stop-rewrite" {
						terminal.Metadata = map[string]any{MetaStopBlockedReply: true}
					}
					a.events <- terminal
					e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
					sent := p.(interface{ getSent() []string }).getSent()
					if cp, ok := p.(*turnTailCardPlatform); ok {
						if len(sent) != 0 {
							t.Fatalf("card answer also sent as plain text: %q", sent)
						}
						sent = append(sent, cp.card.final)
					}
					out := strings.Join(sent, "\n")
					if n := strings.Count(out, terminal.Content); n != 1 {
						t.Fatalf("terminal content delivered %d times, want once: %q", n, sent)
					}
					if n := strings.Count(out, "already streamed intro"); n > 1 {
						t.Fatalf("intro repeated %d times: %q", n, sent)
					}
				})
			}
		}
	}
}
