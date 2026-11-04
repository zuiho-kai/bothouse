package claudecode

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestClaudeUsageProbeWaitsForCompleteWeek(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY shell fixture requires Unix")
	}
	dir := t.TempDir()
	// Reproduce the production missing-week-percentage error through the real
	// PTY/poll loop: leave a partial panel stable longer than its settle window.
	script := "#!/bin/sh\nprintf 'Current session\\r\\n10%% used\\r\\nResets 3pm\\r\\nCurrent week\\r\\n'\nsleep 1\nprintf '\\033[2J\\033[HCurrent session\\r\\n10%% used\\r\\nResets 3pm\\r\\nCurrent week\\r\\n61%% used\\r\\nResets Nov 5, 3pm\\r\\n'\nsleep 1\n"
	if err := os.WriteFile(filepath.Join(dir, "claude"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	a := &Agent{ccDataDir: dir}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	report, err := a.GetUsage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := report.Buckets[0].Windows[1].UsedPercent; got != 61 {
		t.Fatalf("week=%d", got)
	}
}

func TestClaudeUsageReadyRejectsPartialWeek(t *testing.T) {
	partial := "Current session\n10% used\nResets 3pm\nCurrent week\nResets Nov 5, 3pm"
	_, err := parseClaudeUsageReport(partial, time.Now())
	if err == nil || err.Error() != "claudecode: missing usage percentage in Current week block" {
		t.Fatalf("expected the production probe error, got %v", err)
	}
	if usageReady(partial) {
		t.Fatal("incomplete week was frozen as a ready usage panel")
	}
	complete := strings.Replace(partial, "Current week\n", "Current week\n61% used\n", 1)
	if !usageReady(complete) {
		t.Fatal("completed week should be accepted")
	}
}

func TestClaudeUsageReadyDoesNotBorrowNextWindowPercentage(t *testing.T) {
	partial := "Current session\nCurrent week\n61% used\nResets Nov 5, 3pm"
	if usageReady(partial) {
		t.Fatal("missing session percentage borrowed week measurement")
	}
	_, err := parseClaudeUsageReport(partial, time.Now())
	if err == nil || !strings.Contains(err.Error(), "Current session") {
		t.Fatalf("err=%v", err)
	}
}

func TestClaudeUsageTerminalFragmentedControlSequence(t *testing.T) {
	raw := "Quick safety check:\r\n❯ No, exit\r\n\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\nEnter to confirm"
	for split := 1; split < len(raw); split++ {
		terminal := newClaudeUsageTerminal()
		terminal.Write([]byte(raw[:split]))
		terminal.Write([]byte(raw[split:]))
		rendered := normalizeClaudeUsageText(terminal.String())
		if !strings.Contains(rendered, "Yes, I trust this folder") {
			t.Fatalf("split %d corrupted screen: %q", split, rendered)
		}
	}
}

func TestClaudeUsageTerminalFragmentedUTF8AndOSC(t *testing.T) {
	raw := "\x1b]8;;https://example.invalid\x1b\\用量❯\x1b]8;;\a\r\nCurrent session\r\n10% used"
	want := "用量❯\nCurrent session\n10% used"
	for split := 1; split < len(raw); split++ {
		terminal := newClaudeUsageTerminal()
		terminal.Write([]byte(raw[:split]))
		terminal.Write([]byte(raw[split:]))
		if got := normalizeClaudeUsageText(terminal.String()); got != want {
			t.Fatalf("split %d: %q != %q", split, got, want)
		}
	}
	terminal := newClaudeUsageTerminal()
	for _, b := range []byte(raw) {
		terminal.Write([]byte{b})
	}
	if got := normalizeClaudeUsageText(terminal.String()); got != want {
		t.Fatal(got)
	}
}

func TestClaudeUsageUnknownDialogIsNeverConfirmed(t *testing.T) {
	screen := "Unrecognised setting\n❯ Enable everything\nEnter to confirm"
	if got := promptActionForScreen(screen); got != "" {
		t.Fatalf("unknown dialog action: %q", got)
	}
	if got := nextClaudeUsageProbeAction(screen, &claudeUsageProbeState{}, time.Now()); got != "" {
		t.Fatalf("probe typed into unknown dialog: %q", got)
	}
}
