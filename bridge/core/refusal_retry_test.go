package core

import (
	"strings"
	"testing"
)

// Claude Code's text for the refusals seen on agentm 2026-11-10 (#1414).
const refusalText = "API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations."

func TestRefusal_FreshSessionRerunsOnce(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e, a := newTooLongEngine(t, p, "refuse", "second")

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "你好", ReplyCtx: "ctx"})
	waitFor(t, "re-run reply", func() bool { return strings.Contains(joined(p), "reply:second") })

	sent, by, starts := a.snapshot()
	if len(sent) != 2 || by[0] != "s1" || by[1] != "s2" || starts[1] != "" {
		t.Fatalf("sends = %q on %q starts %q, want 你好 on s1 then once more on a fresh s2", sent, by, starts)
	}
	if !strings.HasSuffix(sent[1], "你好") || !strings.Contains(sent[1], handoffHead+" s1") {
		t.Fatalf("re-run prompt lacks the message or the handoff:\n%s", sent[1])
	}
	out := joined(p)
	if strings.Contains(out, "safeguards") {
		t.Fatalf("refusal text reached the channel:\n%s", out)
	}
	if strings.Count(out, "♻️") != 1 {
		t.Fatalf("want one ♻️ notice:\n%s", out)
	}
	s := e.sessions.GetOrCreateActive("test:c1")
	waitFor(t, "session released", func() bool { return !s.Busy() })
	if id := s.GetAgentSessionID(); id != "s2" {
		t.Fatalf("agent session = %q, want s2", id)
	}
}

func TestRefusal_RerunRefusedAgainNoLoop(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e, a := newTooLongEngine(t, p, "refuse", "refuse", "never")

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "error after re-run", func() bool { return strings.Contains(joined(p), "safeguards") })
	waitFor(t, "session released", func() bool { return !e.sessions.GetOrCreateActive("test:c1").Busy() })

	if sent, _, starts := a.snapshot(); len(sent) != 2 || len(starts) != 2 {
		t.Fatalf("sends = %d, starts = %d; want 2 and 2 (one re-run only)", len(sent), len(starts))
	}
	if out := joined(p); strings.Count(out, "♻️") != 1 || strings.Count(out, "safeguards") != 1 {
		t.Fatalf("want one ♻️ notice and one error:\n%s", out)
	}
}

func TestRefusal_QueuedMessageRerun(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e, a := newTooLongEngine(t, p, "hold:a", "refuse", "b", "c")

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "msgA", ReplyCtx: "ctx"})
	waitFor(t, "A sent", func() bool { sent, _, _ := a.snapshot(); return len(sent) == 1 })
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "msgB", ReplyCtx: "ctx"})
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u2", UserName: "u2", Content: "msgC", ReplyCtx: "ctx"})
	close(a.release)
	waitFor(t, "C answered", func() bool { return strings.Contains(joined(p), "reply:c") })

	sent, by, _ := a.snapshot()
	if len(sent) != 4 || !strings.HasSuffix(sent[2], "msgB") || by[2] != "s2" || !strings.HasSuffix(sent[3], "msgC") || by[3] != "s2" {
		t.Fatalf("sends = %q on %q, want A, B on s1, then B and C on s2", sent, by)
	}
	if strings.Contains(joined(p), "safeguards") {
		t.Fatalf("refusal text reached the channel:\n%s", joined(p))
	}
}

func TestRefusal_DetectedWithoutErrorFlag(t *testing.T) {
	e := &Engine{}
	st := &interactiveState{}
	if !e.takeRefusalResult(st, nil, Event{Content: refusalText}, nil) || st.refused == "" {
		t.Fatal("refusal text without is_error not taken")
	}
	st = &interactiveState{}
	if e.takeRefusalResult(st, nil, Event{Content: "上游回了：" + refusalText}, nil) {
		t.Fatal("a normal reply quoting the refusal must not be taken")
	}
}

func TestIsSafeguardRefusal(t *testing.T) {
	if !isSafeguardRefusal(refusalText) || isSafeguardRefusal("API Error: 400 bad request") {
		t.Fatal("isSafeguardRefusal mismatch")
	}
}
