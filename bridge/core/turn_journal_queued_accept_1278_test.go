package core

import (
	"strings"
	"testing"
)

// #1278: a lead-accept wake queued behind a turn the restart cut off reached the
// resumed turn cut at 2000 runes, without its ws-pass / ws-forward lines, so the
// lead never released the report and it went out 「主角色未验收」 ten minutes later.
func TestTurnJournalQueuedAcceptKeepsInstructionsAcrossRestart(t *testing.T) {
	body := "[report] #1274 背景：做了，换了做法：没改 ParkTeamWorkspace，因为" + strings.Repeat("细", 3000)
	notes := "/n/handoff-1274.md"
	accept := leadAcceptPrompt(t.TempDir(), "<#1>", "橘", body, 1274, notes, "", "", "用户原话：……", 0)
	if n := len([]rune(accept)); n <= turnJournalMaxUserMessage {
		t.Fatalf("fixture too short to exercise the cut: %d runes", n)
	}
	path := TurnJournalPath(t.TempDir(), "maomao")
	j, _ := OpenTurnJournal(path)
	en, _ := j.Begin(TurnJournalEntry{InteractiveKey: "k", SessionKey: "k", AgentSessionID: "sid", LastUserMessage: "在做别的"})
	if err := j.SetQueued(en.TurnID, []string{accept}); err != nil {
		t.Fatal(err)
	}
	// Restart: a new process reads the file.
	re, _ := OpenTurnJournal(path)
	got := re.List()
	if len(got) != 1 {
		t.Fatalf("entries: %+v", got)
	}
	prompt := buildTurnResumePrompt(got[0], false)
	for _, want := range []string{leadAcceptMark, "ws-pass --id 1274", "ws-forward --id 1274", leadUncheckedMark} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("resume prompt lost %q", want)
		}
	}
	if got[0].QueuedMessages[0] != accept {
		t.Fatalf("accept wake under the queued cap was changed")
	}
}

func TestTruncateKeepEndsKeepsTail(t *testing.T) {
	s := "开头" + strings.Repeat("中", 30000) + "末尾：跑 ws-pass"
	out := truncateKeepEnds(s, turnJournalMaxQueuedMessage)
	if n := len([]rune(out)); n > turnJournalMaxQueuedMessage {
		t.Fatalf("over cap: %d", n)
	}
	if !strings.HasPrefix(out, "开头") || !strings.HasSuffix(out, "末尾：跑 ws-pass") || !strings.Contains(out, "中间略去") {
		t.Fatalf("ends not kept: %q…%q", string([]rune(out)[:10]), string([]rune(out)[len([]rune(out))-20:]))
	}
	if truncateKeepEnds("短", 10) != "短" {
		t.Fatal("short string changed")
	}
}
