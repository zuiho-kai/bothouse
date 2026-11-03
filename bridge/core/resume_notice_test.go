//go:build !windows

package core

import (
	"strings"
	"testing"
)

type noticeResumeAgent struct{ resumeAgent }

func (*noticeResumeAgent) ReadSessionHandoff(id string) (*SessionHandoff, error) {
	return &SessionHandoff{Path: "/fixture/" + id, Tail: []HistoryEntry{{Role: "user", Content: "earlier context"}}}, nil
}

// Only the external platform boundary reconstructs the persisted chat context.
type noticeResumePlatform struct{ quietGroupPlatform }

func (*noticeResumePlatform) ReconstructReplyCtx(key string) (any, error) {
	if strings.Contains(key, ":g:") {
		return "group", nil
	}
	return "private", nil
}

func TestTurnResume_RecoveryNoticePolicy(t *testing.T) {
	for _, path := range []string{"foreground", "chained", "drain", "journal"} {
		for _, chat := range []string{"quiet-group", "private", "without-quieter"} {
			t.Run(path+"/"+chat, func(t *testing.T) {
				base := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
				var p Platform = base
				outbound := &base.stubPlatformEngine
				if chat != "without-quieter" {
					quiet := &noticeResumePlatform{quietGroupPlatform{stubPlatformEngine{n: "qq"}}}
					p, outbound = quiet, &quiet.stubPlatformEngine
				}
				key, replyCtx := p.Name()+":g:42", "group"
				if chat == "private" {
					key, replyCtx = p.Name()+":42", "private"
				}
				script := []string{"err", "recovered"}
				if path == "chained" {
					script = []string{"hold", "err", "recovered"}
				} else if path == "drain" {
					script = []string{"seed", "err", "recovered"}
				}
				a := &noticeResumeAgent{resumeAgent{script: script}}
				dir := t.TempDir()
				e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
				t.Cleanup(func() { e.Stop() })
				session := e.sessions.GetOrCreateActive(key)
				session.SetAgentSessionID("old-sid", a.Name())
				message := func(content, fallback string) *Message {
					return &Message{SessionKey: key, Platform: p.Name(), UserID: "u", UserName: "u", Content: content, ReplyCtx: replyCtx, GroupChat: chat != "private", resumeFallback: fallback}
				}
				switch path {
				case "foreground":
					e.handleMessage(p, message("continue the interrupted turn", "original request"))
				case "journal":
					seedJournal(t, dir, []TurnJournalEntry{userEntry(key, "original request")}, func(_ int, en *TurnJournalEntry) {
						en.AgentSessionID, en.LastStep = "old-sid", "read existing artifact"
					})
					e.SetDataDir(dir)
					strayScanned.Store(dir, struct{}{})
					e.ResumeInterruptedTurns()
				case "chained":
					e.handleMessage(p, message("seed", ""))
					waitFor(t, "seed sent", func() bool { sent, _, _ := a.snapshot(); return len(sent) == 1 })
					e.handleMessage(p, message("continue the interrupted turn", "original request"))
					e.interactiveMu.Lock()
					state := e.interactiveStates[key]
					e.interactiveMu.Unlock()
					state.mu.Lock()
					as := state.agentSession.(*resumeAgentSession)
					state.mu.Unlock()
					as.events <- Event{Type: EventResult, Content: "reply:seed", Done: true, SessionID: "old-sid"}
				case "drain":
					e.handleMessage(p, message("seed", ""))
					waitFor(t, "seed released", func() bool { return strings.Contains(joined(outbound), "reply:seed") && !session.Busy() })
					if !session.TryLock() {
						t.Fatal("could not take queue ownership")
					}
					e.interactiveMu.Lock()
					state := e.interactiveStates[key]
					e.interactiveMu.Unlock()
					e.stopUnsolicitedReader(state)
					state.mu.Lock()
					state.pendingMessages = append(state.pendingMessages, queuedMessage{platform: p, replyCtx: replyCtx, content: "continue the interrupted turn", resumeFallback: "original request", userID: "u", userName: "u", msgPlatform: p.Name(), msgSessionKey: key})
					state.mu.Unlock()
					if !e.drainPendingMessages(state, session, e.sessions, key) {
						t.Fatal("recovery did not take over the queue lock")
					}
				}
				waitFor(t, "recovered and released", func() bool { return strings.Contains(joined(outbound), "reply:recovered") && !session.Busy() })
				sent, by, starts := a.snapshot()
				wantSends := 2
				if path == "chained" || path == "drain" {
					wantSends = 3
				}
				if len(sent) != wantSends || len(starts) != 2 || starts[0] != "old-sid" || starts[1] != "" || by[len(by)-1] != "s2" || session.GetAgentSessionID() != "s2" {
					t.Fatalf("prompts=%q sessions=%q starts=%q bound=%q; want one fresh retry", sent, by, starts, session.GetAgentSessionID())
				}
				last := sent[len(sent)-1]
				if !strings.HasSuffix(last, "original request") || !strings.Contains(last, handoffHead+" old-sid") || !strings.Contains(last, "earlier context") {
					t.Fatalf("lost original request or handoff: %s", last)
				}
				out := joined(outbound)
				if strings.Contains(out, "tool_use ids") {
					t.Fatalf("first provider error leaked: %s", out)
				}
				wantNotices := 1
				if chat == "quiet-group" {
					wantNotices = 0
				}
				if got := strings.Count(out, "♻️"); got != wantNotices {
					t.Fatalf("recovery notices=%d, want %d; outbound=%s", got, wantNotices, out)
				}
			})
		}
	}
}

func TestTurnResume_QuietRecoveryPreservesQueuedFollowup(t *testing.T) {
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	a := &noticeResumeAgent{resumeAgent{script: []string{"err", "recovered", "followup"}}}
	oldHook := testHookBeforePromptTooLongRecycle
	t.Cleanup(func() { testHookBeforePromptTooLongRecycle = oldHook })
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	session := e.sessions.GetOrCreateActive("qq:g:42")
	session.SetAgentSessionID("old-sid", a.Name())
	// Queue at the production recycle seam, after the failed turn has ended.
	testHookBeforePromptTooLongRecycle = func() {
		e.interactiveMu.Lock()
		state := e.interactiveStates["qq:g:42"]
		e.interactiveMu.Unlock()
		state.mu.Lock()
		state.pendingMessages = append(state.pendingMessages, queuedMessage{platform: p, replyCtx: "group", content: "queued followup", userID: "u", msgPlatform: "qq", msgSessionKey: "qq:g:42"})
		state.mu.Unlock()
	}
	e.handleMessage(p, &Message{SessionKey: "qq:g:42", Platform: "qq", UserID: "u", Content: "continue", ReplyCtx: "group", GroupChat: true, resumeFallback: "original request"})
	waitFor(t, "followup and released", func() bool {
		return strings.Contains(joined(&p.stubPlatformEngine), "reply:followup") && !session.Busy()
	})
	sent, by, starts := a.snapshot()
	if len(sent) != 3 || len(starts) != 2 || by[1] != "s2" || by[2] != "s2" || !strings.HasSuffix(sent[1], "original request") || !strings.HasSuffix(sent[2], "queued followup") {
		t.Fatalf("lost or reordered followup: prompts=%q sessions=%q starts=%q", sent, by, starts)
	}
	if out := joined(&p.stubPlatformEngine); strings.Contains(out, "♻️") || strings.Contains(out, "tool_use ids") {
		t.Fatalf("unexpected notice or initial error: %s", out)
	}
}

func TestTurnResume_QuietNoticeDoesNotHideRepeatedError(t *testing.T) {
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	a := &resumeAgent{script: []string{"err", "err", "never"}}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	session := e.sessions.GetOrCreateActive("qq:g:42")
	session.SetAgentSessionID("old-sid", a.Name())
	e.handleMessage(p, &Message{SessionKey: "qq:g:42", Platform: "qq", UserID: "u", Content: "continue", ReplyCtx: "group", GroupChat: true, resumeFallback: "original request"})
	waitFor(t, "second error and released", func() bool { return strings.Contains(joined(&p.stubPlatformEngine), "tool_use ids") && !session.Busy() })
	sent, _, starts := a.snapshot()
	if out := joined(&p.stubPlatformEngine); strings.Count(out, "tool_use ids") != 1 || strings.Contains(out, "♻️") || len(sent) != 2 || len(starts) != 2 {
		t.Fatalf("outbound=%q sends=%q starts=%q; want one visible repeated error and no loop", out, sent, starts)
	}
}
