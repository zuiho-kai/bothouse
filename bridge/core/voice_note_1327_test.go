package core

import (
	"strings"
	"testing"
)

// Exercise the ordinary queue selector, including a mixed batch that was
// already marked by the group queue before it was queued again.
func TestVoiceNote1327OrdinaryQueueMarksEachPart(t *testing.T) {
	for _, nestedFirst := range []bool{true, false} {
		name := "nested_last"
		if nestedFirst {
			name = "nested_first"
		}
		t.Run(name, func(t *testing.T) {
			inner := mergeQueuedChat([]queuedMessage{
				{content: "INNER_TYPED", userID: "u"},
				{content: "INNER_VOICE", userID: "u", fromVoice: true},
			})
			raw := queuedMessage{content: "OUTER_VOICE", userID: "u", fromVoice: true}
			parts := []queuedMessage{raw, inner}
			if nestedFirst {
				parts = []queuedMessage{inner, raw}
			}
			state := &interactiveState{pendingMessages: parts}
			out := takeQueuedBatchLocked(state)
			prompt := withVoiceNote(out.content, out.fromVoice && !out.voiceMarked)
			if len(state.pendingMessages) != 0 || !out.voiceMarked {
				t.Errorf("batch must consume both parts and retain per-part marking")
			}
			if strings.Count(prompt, voiceNoteMark) != 2 ||
				!strings.Contains(prompt, voiceNoteMark+"\nINNER_VOICE") ||
				!strings.Contains(prompt, voiceNoteMark+"\nOUTER_VOICE") ||
				strings.HasPrefix(prompt, voiceNoteMark) ||
				strings.Contains(prompt, voiceNoteMark+"\nINNER_TYPED") {
				t.Fatalf("voice marks must belong only to the two transcripts:\n%s", prompt)
			}
		})
	}
}

// Read the journal from disk, as a restarted process does, rather than
// inspecting the live entry. Cover original, cold queued and chained turns.
func TestVoiceNote1327ResumeOriginalKeepsSource(t *testing.T) {
	mixed := "TYPED_PART\n" + voiceNoteMark + "\nVOICE_PART"
	for _, source := range []struct {
		name, content, want string
		voice, marked       bool
	}{
		{"typed", "TYPED_PART", "TYPED_PART", false, false},
		{"voice", "VOICE_PART", voiceNoteMark + "\nVOICE_PART", true, false},
		{"mixed_voice_reply", mixed, mixed, true, true},
		{"mixed_typed_reply", mixed, mixed, false, true},
	} {
		for _, entry := range []string{"original", "queued_cold", "queued_chained"} {
			t.Run(source.name+"/"+entry, func(t *testing.T) {
				e := newTestEngine()
				defer e.cancel()
				dir := t.TempDir()
				e.SetDataDir(dir)
				const key = "test:voice-resume"
				msg := &Message{SessionKey: key, Platform: "test", Content: source.content,
					FromVoice: source.voice, voiceMarked: source.marked}
				if entry == "original" {
					e.journalTurnBegin(msg, key, "", nil)
				} else {
					if entry == "queued_chained" {
						e.journalTurnBegin(&Message{SessionKey: key, Content: "previous"}, key, "", nil)
					}
					e.journalQueuedTurn(&queuedMessage{msgSessionKey: key, content: source.content,
						fromVoice: source.voice, voiceMarked: source.marked}, key, "", nil)
				}
				j, err := OpenTurnJournal(TurnJournalPath(dir, "test"))
				if err != nil {
					t.Fatal(err)
				}
				entries := j.Inherited()
				if len(entries) != 1 {
					t.Fatalf("want one persisted turn, got %d", len(entries))
				}
				prompt := buildTurnResumePrompt(entries[0], true)
				_, original, ok := strings.Cut(prompt, "原消息全文：\n")
				if !ok || original != source.want {
					t.Fatalf("resumed original lost source or double-wrapped: got %q, want %q", original, source.want)
				}
			})
		}
	}
}

func TestVoiceNote1327ResumePendingKeepsEachSource(t *testing.T) {
	e := newTestEngine()
	defer e.cancel()
	dir := t.TempDir()
	e.SetDataDir(dir)
	const key = "test:voice-pending"
	e.journalTurnBegin(&Message{SessionKey: key, Content: "working"}, key, "", nil)
	mixed := "MIXED_TYPED\n" + voiceNoteMark + "\nMIXED_VOICE"
	state := &interactiveState{pendingMessages: []queuedMessage{
		{content: "QUEUED_TYPED", contextBefore: []queuedMessage{
			{content: "FOLDED_VOICE", fromVoice: true},
			{content: "FOLDED_TYPED"},
			{content: mixed, fromVoice: true, voiceMarked: true},
		}},
		{content: "QUEUED_VOICE", fromVoice: true},
		{content: mixed, fromVoice: true, voiceMarked: true},
		{content: "SEPARATELY_RESUMED", resumedFrom: "old"},
	}}
	e.journalSyncQueued(state, key)
	j, err := OpenTurnJournal(TurnJournalPath(dir, "test"))
	if err != nil {
		t.Fatal(err)
	}
	entries := j.Inherited()
	if len(entries) != 1 {
		t.Fatalf("want one persisted turn, got %d", len(entries))
	}
	want := []string{voiceNoteMark + "\nFOLDED_VOICE", "FOLDED_TYPED", mixed,
		"QUEUED_TYPED", voiceNoteMark + "\nQUEUED_VOICE", mixed}
	if len(entries[0].QueuedMessages) != len(want) {
		t.Fatalf("persisted queue = %#v", entries[0].QueuedMessages)
	}
	for i, part := range want {
		if entries[0].QueuedMessages[i] != part {
			t.Errorf("persisted part %d = %q, want %q", i, entries[0].QueuedMessages[i], part)
		}
	}
	for _, withOriginal := range []bool{true, false} {
		prompt := buildTurnResumePrompt(entries[0], withOriginal)
		if strings.Count(prompt, voiceNoteMark) != 4 ||
			!strings.Contains(prompt, voiceNoteMark+"\nFOLDED_VOICE") ||
			!strings.Contains(prompt, voiceNoteMark+"\nQUEUED_VOICE") ||
			strings.Contains(prompt, "SEPARATELY_RESUMED") {
			t.Fatalf("resume must preserve pending parts and their source:\n%s", prompt)
		}
	}
}
