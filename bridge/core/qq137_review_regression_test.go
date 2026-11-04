package core

import (
	"strings"
	"testing"
	"time"
)

func TestQQ137ReviewUnicodeTrailing(t *testing.T) {
	for _, ws := range []string{"\v", "\u0085", "\u00a0", "\u2003", "\u2028", "\u2029", "\u3000"} {
		input := "已处理\nNO_REPLY。" + ws
		got, ok := stripTrailingSilent(input)
		if !ok || got != "已处理" {
			t.Errorf("input=%q got=%q stripped=%v", input, got, ok)
		}
	}
}
func TestQQ137ReviewBoundaryThenAnswer(t *testing.T) {
	for _, mode := range []string{"compact", "full", "quiet"} {
		for _, kind := range []EventType{EventToolUse, EventThinking} {
			t.Run(mode+"/"+string(kind), func(t *testing.T) {
				p := &stubPlatformEngine{n: "test"}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDisplayConfig(DisplayCfg{Mode: mode, ToolMessages: mode == "full", ThinkingMessages: mode == "full"})
				key := "test:review137-boundary"
				session := e.sessions.GetOrCreateActive(key)
				a := newControllableSession("review137")
				state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
				e.interactiveStates[key] = state
				a.events <- Event{Type: EventText, Content: "NO_REPLY。"}
				a.events <- Event{Type: kind, ToolName: "Bash", ToolInput: "true", Content: "checking"}
				a.events <- Event{Type: EventText, Content: "正常答复"}
				a.events <- Event{Type: EventResult, Content: "正常答复", Done: true}
				e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
				for _, sent := range p.getSent() {
					if strings.Contains(sent, "NO_REPLY") {
						t.Errorf("marker reached platform: %q", sent)
					}
				}
			})
		}
	}
}
func TestQQ137ReviewChunkedRichMarker(t *testing.T) {
	for _, marker := range []string{"NO_REPLY。", "NO_REPLY.", "\u0085NO_REPLY！\u0085", "　NO_REPLY。　"} {
		split := strings.Index(marker, "NO_") + 3
		chunks := []string{marker[:split], marker[split:]}
		starts, streams, updates, deletes := runRichCardSilentScenario(t, "review137", chunks, marker)
		if len(starts)+len(streams)+len(updates)+deletes != 0 {
			t.Errorf("input=%q visible=%q/%q/%q deletes=%d", marker, starts, streams, updates, deletes)
		}
	}
}

func TestQQ137ReviewPreviewBoundary(t *testing.T) {
	for _, kind := range []EventType{EventToolUse, EventThinking, EventPermissionRequest} {
		for _, marker := range []string{"NO_REPLY。", "已处理\nNO_REPLY。"} {
			t.Run(string(kind)+"/"+marker, func(t *testing.T) {
				p := &stubRichCardSilentPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
				key := "test:review137-preview"
				session := e.sessions.GetOrCreateActive(key)
				a := newControllableSession("review137-preview")
				state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
				e.interactiveStates[key] = state
				a.events <- Event{Type: EventText, Content: marker}
				a.events <- Event{Type: kind, ToolName: "Bash", ToolInput: "true", Content: "checking", RequestID: "review137-request"}
				a.events <- Event{Type: EventResult, Content: "正常答复", Done: true}
				done := make(chan struct{})
				go func() {
					defer close(done)
					e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
				}()
				if kind == EventPermissionRequest {
					deadline := time.After(time.Second)
					ticker := time.NewTicker(time.Millisecond)
					defer ticker.Stop()
					waiting := true
					for waiting {
						select {
						case <-deadline:
							t.Fatal("permission fixture not reached")
						case <-ticker.C:
							state.mu.Lock()
							pending := state.pending
							state.mu.Unlock()
							if pending != nil {
								pending.resolve()
								waiting = false
							}
						}
					}
				}
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Fatal("event loop not finished")
				}
				starts, _, updates, _ := p.snapshot()
				for _, edit := range updates {
					if strings.Contains(edit, "NO_REPLY") {
						t.Errorf("frozen preview leaked marker: starts=%q updates=%q sent=%q", starts, updates, p.getSent())
						break
					}
				}
				for _, sent := range p.getSent() {
					if strings.Contains(sent, "NO_REPLY") {
						t.Errorf("send leaked marker: %q", sent)
					}
				}
			})
		}
	}
}
func TestQQ137ReviewUnicodeTrailingPlatform(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	key := "test:review137-unicode"
	session := e.sessions.GetOrCreateActive(key)
	a := newControllableSession("review137-unicode")
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	a.events <- Event{Type: EventResult, Content: "已处理\nNO_REPLY。\u0085", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	for _, sent := range p.getSent() {
		if strings.Contains(sent, "NO_REPLY") {
			t.Errorf("marker reached platform: %q", sent)
		}
	}
}
