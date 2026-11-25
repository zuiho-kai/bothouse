package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestLeadingAndMidTurnNoReplyStripped2228(t *testing.T) {
	cases := []struct {
		name         string
		content      string
		scheduled    bool
		wantSilent   bool
		wantContains string
	}{
		{
			name:         "leading standalone marker before handoff ack (user)",
			content:      "NO_REPLY\n【接】已把任务交给工作区7去跑了。",
			scheduled:    false,
			wantSilent:   false,
			wantContains: "【接】已把任务交给工作区7去跑了。",
		},
		{
			name:         "leading standalone marker before handoff ack (scheduled)",
			content:      "NO_REPLY\n【接】已把任务交给工作区7去跑了。",
			scheduled:    true,
			wantSilent:   false,
			wantContains: "【接】已把任务交给工作区7去跑了。",
		},
		{
			name:         "mid-turn standalone marker between replies",
			content:      "老板你点个头！\nNO_REPLY\n【接】已经交给工作区2开工了。",
			scheduled:    false,
			wantSilent:   false,
			wantContains: "老板你点个头！\n【接】已经交给工作区2开工了。",
		},
		{
			name:       "repeated standalone markers stay silent on user turn",
			content:    "NO_REPLY\nNO_REPLY",
			scheduled:  false,
			wantSilent: true,
		},
		{
			name:       "scheduled plan with trailing marker still swallowed (#1188)",
			content:    "我会先核对任务板。\nNO_REPLY",
			scheduled:  true,
			wantSilent: true,
		},
		{
			name:         "inline backtick NO_REPLY preserved",
			content:      "【接】`NO_REPLY` 本来是内部暗号。",
			scheduled:    false,
			wantSilent:   false,
			wantContains: "`NO_REPLY` 本来是内部暗号。",
		},
		{
			name:         "inline NO_REPLY followed by words preserved",
			content:      "NO_REPLY then more",
			scheduled:    false,
			wantSilent:   false,
			wantContains: "NO_REPLY then more",
		},
		{
			name:         "inline sentence NO_REPLY preserved (#2021)",
			content:      "没漏洞只回 NO_REPLY",
			scheduled:    true,
			wantSilent:   false,
			wantContains: "没漏洞只回 NO_REPLY",
		},
		{
			name:         "fenced code block standalone NO_REPLY preserved",
			content:      "示例：\n```\nNO_REPLY\n```\n结束。",
			scheduled:    false,
			wantSilent:   false,
			wantContains: "```\nNO_REPLY\n```",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, streamed := range []bool{false, true} {
				sub := "result"
				if streamed {
					sub = "stream"
				}
				t.Run(sub, func(t *testing.T) {
					p := &stubPlatformEngine{n: "test"}
					e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
					e.SetDisplayConfig(DisplayCfg{Mode: "quiet"})
					key := "test:2228-" + tc.name
					session := e.sessions.GetOrCreateActive(key)
					agent := newControllableSession("2228")
					state := &interactiveState{
						agentSession:  agent,
						platform:      p,
						replyCtx:      "ctx",
						turnScheduled: tc.scheduled,
					}
					e.interactiveStates[key] = state
					if streamed {
						agent.events <- Event{Type: EventText, Content: tc.content}
						agent.events <- Event{Type: EventResult, Done: true}
					} else {
						agent.events <- Event{Type: EventResult, Content: tc.content, Done: true}
					}
					e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
					got := strings.Join(p.getSent(), "\n")
					if tc.wantSilent {
						if strings.TrimSpace(got) != "" {
							t.Fatalf("expected silent turn, but delivered %q", got)
						}
						return
					}
					if !strings.Contains(got, tc.wantContains) {
						t.Fatalf("delivered %q, want substring %q", got, tc.wantContains)
					}
					if !strings.Contains(tc.wantContains, "NO_REPLY") && strings.Contains(strings.ToUpper(got), "NO_REPLY") {
						t.Fatalf("standalone NO_REPLY leaked into platform output: %q", got)
					}
				})
			}
		})
	}
}

func TestStreamPreviewHoldsAndStripsStandaloneNoReply2228(t *testing.T) {
	t.Run("chunked repeated NO_REPLY never opens preview", func(t *testing.T) {
		mp := &mockUpdaterPlatform{}
		p := &stubPlatformEngine{n: "test"}
		_ = mp
		cfg := StreamPreviewCfg{
			Enabled:       true,
			IntervalMs:    10,
			MinDeltaChars: 1,
			MaxChars:      500,
		}
		e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
		e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
		e.SetStreamPreviewCfg(cfg)

		// Verify hold predicate directly across incremental chunks.
		for _, prefix := range []string{"NO_REPLY", "NO_REPLY\n", "NO_REPLY\nNO_", "NO_REPLY\nNO_REPLY"} {
			if !couldBeSilentPrefix(prefix) {
				t.Fatalf("couldBeSilentPrefix(%q) = false, want true so preview stays held", prefix)
			}
		}
		if couldBeSilentPrefix("NO_REPLY\n【接】") {
			t.Fatal("couldBeSilentPrefix(\"NO_REPLY\\n【接】\") = true, want false")
		}

		// Verify streamPreview strips leading standalone NO_REPLY before sending preview.
		sp := newStreamPreview(cfg, mp, "ctx", context.Background(), nil)
		sp.appendText("NO_REPLY\n【接】已转交")
		time.Sleep(40 * time.Millisecond)
		for _, m := range mp.getMessages() {
			if strings.Contains(m, "NO_REPLY") {
				t.Fatalf("preview message leaked NO_REPLY: %q", m)
			}
		}
		sp.finish("NO_REPLY\n【接】已转交", "")
		for _, m := range mp.getMessages() {
			if strings.Contains(m, "NO_REPLY") {
				t.Fatalf("finalized preview leaked NO_REPLY: %q", m)
			}
		}
	})
}

func TestProgressCardNarrationStripsStandaloneNoReply2228(t *testing.T) {
	for _, tc := range []struct {
		name      string
		preTool   string
		wantCard  string
		forbidNR  bool
	}{
		{"only repeated markers", "NO_REPLY\nNO_REPLY", "", true},
		{"leading marker then narration", "NO_REPLY\n先查一下日志", "先查一下日志", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &previewCapturePlatform{}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
			key := "test:2228-card-" + tc.name
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("2228-card")
			replyCtx := progressHintReplyCtx{style: progressStyleCard, payload: true}
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: replyCtx}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventText, Content: tc.preTool}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "true"}
			agent.events <- Event{Type: EventText, Content: "完成"}
			agent.events <- Event{Type: EventResult, Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)

			allCards := append(append([]string(nil), p.started...), p.updated...)
			for _, msg := range allCards {
				if tc.forbidNR && strings.Contains(msg, "NO_REPLY") {
					t.Fatalf("progress card leaked NO_REPLY: %q", msg)
				}
			}
			if tc.wantCard != "" {
				joined := strings.Join(allCards, "\n")
				if !strings.Contains(joined, tc.wantCard) {
					t.Fatalf("expected card narration %q, got %q", tc.wantCard, joined)
				}
			}
		})
	}
}

func TestPostToolRemainderAndIsSilentReply2228(t *testing.T) {
	if !IsSilentReply("NO_REPLY\nNO_REPLY") {
		t.Fatal("IsSilentReply(\"NO_REPLY\\nNO_REPLY\") = false, want true")
	}

	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "full", ToolMessages: true})
	key := "test:2228-posttool"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("2228-posttool")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	agent.events <- Event{Type: EventText, Content: "开始处理"}
	agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "true"}
	agent.events <- Event{Type: EventText, Content: "NO_REPLY\n【接】后续收尾"}
	agent.events <- Event{Type: EventResult, Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	got := strings.Join(p.getSent(), "\n")
	if strings.Contains(got, "NO_REPLY") {
		t.Fatalf("post-tool remainder leaked NO_REPLY: %q", got)
	}
	if !strings.Contains(got, "【接】后续收尾") {
		t.Fatalf("expected post-tool text, got %q", got)
	}
}
