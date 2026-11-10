package core

import (
	"strings"
	"testing"
)

func TestVoiceNote1327ResumeDisplayKeepsMarksOnlyInOriginal(t *testing.T) {
	for _, tc := range []struct{ name, content, summary string }{
		{"voice", voiceNoteMark + "\nVOICE_PART", "VOICE_PART"},
		{"mixed", "TYPED_PART\n" + voiceNoteMark + "\nVOICE_PART", "TYPED_PART VOICE_PART"},
		{"typed", "TYPED_PART\nsecond line", "TYPED_PART second line"},
		{"typed_inline_quote", "quote: " + voiceNoteMark + "\ntext", turnResumeOneLine("quote: "+voiceNoteMark+"\ntext", turnResumeSummaryRunes)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestEngine()
			defer e.cancel()
			e.SetDataDir(t.TempDir())
			en, err := e.turnJournalStore().Begin(TurnJournalEntry{Project: "test", SessionKey: "test:resume", InteractiveKey: "test:resume", LastUserMessage: tc.content})
			if err != nil {
				t.Fatal(err)
			}
			for _, original := range []bool{false, true} {
				prompt := buildTurnResumePrompt(en, original)
				first, _, _ := strings.Cut(prompt, "\n")
				if want := "（桥重启打断了这一轮）重启前在做：" + tc.summary; first != want {
					t.Errorf("summary = %q, want %q", first, want)
				}
				if original {
					_, full, ok := strings.Cut(prompt, "原消息全文：\n")
					if !ok || full != tc.content {
						t.Errorf("original changed: %q", full)
					}
				}
			}
			delivered := false
			e.turnResumeHooks = turnResumeHooks{
				ready:  func(TurnJournalEntry) error { return nil },
				reap:   func(TurnJournalEntry) error { return nil },
				notify: func(TurnJournalEntry, string) error { return nil },
				deliver: func(_ TurnJournalEntry, job *TimerJob) error {
					delivered = true
					if job.Description != "续做："+tc.summary {
						t.Errorf("title = %q, want %q", job.Description, "续做："+tc.summary)
					}
					return nil
				},
			}
			e.deliverTurnResume(en)
			if !delivered {
				t.Fatal("resume was not delivered")
			}
		})
	}
}

func TestVoiceNote1327VoiceQueuedBehindAuthorizedTurnKeepsSource(t *testing.T) {
	mixed := "TYPED_PART\n" + voiceNoteMark + "\nVOICE_PART"
	for _, tc := range []struct {
		name, content, want string
		voice, marked       bool
	}{
		{"voice", "VOICE_PART", voiceNoteMark + "\nVOICE_PART", true, false},
		{"typed", "TYPED_PART", "TYPED_PART", false, false},
		{"mixed", mixed, mixed, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestEngine()
			defer e.cancel()
			dir := t.TempDir()
			e.SetDataDir(dir)
			const key = "test:authorized"
			ref := &AuthorizationTurn{Project: "test", TaskID: "task", DecisionID: "decision"}
			state := &interactiveState{authorization: ref}
			e.interactiveStates[key] = state
			p := &stubPlatformEngine{n: "test"}
			msg := &Message{SessionKey: key, Platform: "test", UserID: "human", Content: tc.content, FromVoice: tc.voice, voiceMarked: tc.marked}
			if got := e.enqueueForBusySession(p, msg, key, nil); got != queueAccepted {
				t.Fatalf("queue result = %v", got)
			}
			j, err := OpenTurnJournal(TurnJournalPath(dir, "test"))
			if err != nil {
				t.Fatal(err)
			}
			entries := j.Inherited()
			if len(entries) != 1 {
				t.Fatalf("want one durable queued turn, got %d", len(entries))
			}
			en := entries[0]
			if en.Authorization != nil || en.TurnID != state.pendingMessages[0].resumedFrom {
				t.Fatal("human input inherited authorization or lost its durable queue reference")
			}
			_, full, ok := strings.Cut(buildTurnResumePrompt(en, true), "原消息全文：\n")
			if !ok || full != tc.want {
				t.Fatalf("resumed human input = %q, want %q", full, tc.want)
			}
		})
	}
}
