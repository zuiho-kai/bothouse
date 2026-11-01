package claudecode

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSanitizeClaudeUsageOutput_RendersCursorMoves(t *testing.T) {
	raw := "" +
		"\x1b[?2026h\rSettings:\x1b[1CStatus\x1b[1CConfig\x1b[1CUsage (tab to cycle)\r\n" +
		"\x1b]8;;https://code.claude.com/docs/en/security\aSecurity guide\x1b]8;;\a\r\n" +
		"Current session\r\n" +
		"\x1b[32m1% used\x1b[0m\r\n"

	terminal := newClaudeUsageTerminal()
	terminal.Write([]byte(raw))
	got := normalizeClaudeUsageText(terminal.String())
	if strings.Contains(got, "\x1b") {
		t.Fatalf("sanitizeClaudeUsageOutput still contains escape codes: %q", got)
	}
	if !strings.Contains(got, "Settings: Status Config Usage (tab to cycle)") {
		t.Fatalf("sanitized output missing spaced header: %q", got)
	}
	if !strings.Contains(got, "Security guide") {
		t.Fatalf("sanitized output missing link text: %q", got)
	}
}

func TestParseClaudeUsageReport_Success(t *testing.T) {
	loc := mustLoadLocation(t, "Asia/Seoul")
	now := time.Date(2026, time.December, 22, 12, 0, 0, 0, loc)
	text := strings.TrimSpace(`
Current session
1% used
Resets 3:59pm (Asia/Seoul)

Current week (all models)
2% used
Resets Dec 23, 4:59pm (Asia/Seoul)

Extra usage
Extra usage not enabled
`)

	report, err := parseClaudeUsageReport(text, now)
	if err != nil {
		t.Fatalf("parseClaudeUsageReport returned error: %v", err)
	}
	if report.Provider != "claudecode" {
		t.Fatalf("Provider = %q, want claudecode", report.Provider)
	}
	if len(report.Buckets) != 1 {
		t.Fatalf("Buckets = %d, want 1", len(report.Buckets))
	}
	if len(report.Buckets[0].Windows) != 2 {
		t.Fatalf("Windows = %d, want 2", len(report.Buckets[0].Windows))
	}

	session := report.Buckets[0].Windows[0]
	if session.Name != "Current session" {
		t.Fatalf("session.Name = %q", session.Name)
	}
	if session.WindowSeconds != 18000 {
		t.Fatalf("session.WindowSeconds = %d, want 18000", session.WindowSeconds)
	}
	if session.UsedPercent != 1 {
		t.Fatalf("session.UsedPercent = %d, want 1", session.UsedPercent)
	}
	if session.ResetAfterSeconds != 14340 {
		t.Fatalf("session.ResetAfterSeconds = %d, want 14340", session.ResetAfterSeconds)
	}

	week := report.Buckets[0].Windows[1]
	if week.Name != "Current week" {
		t.Fatalf("week.Name = %q", week.Name)
	}
	if week.WindowSeconds != 604800 {
		t.Fatalf("week.WindowSeconds = %d, want 604800", week.WindowSeconds)
	}
	if week.UsedPercent != 2 {
		t.Fatalf("week.UsedPercent = %d, want 2", week.UsedPercent)
	}
	if week.ResetAfterSeconds != 104340 {
		t.Fatalf("week.ResetAfterSeconds = %d, want 104340", week.ResetAfterSeconds)
	}
}

func TestParseClaudeUsageReport_MissingOptionalFields(t *testing.T) {
	loc := mustLoadLocation(t, "Asia/Seoul")
	now := time.Date(2026, time.December, 22, 12, 0, 0, 0, loc)
	text := strings.TrimSpace(`
Current session
15% used
Resets 3:00pm (Asia/Seoul)

Current week
47% used
Resets Dec 23, 11:30am (Asia/Seoul)
`)

	report, err := parseClaudeUsageReport(text, now)
	if err != nil {
		t.Fatalf("parseClaudeUsageReport returned error: %v", err)
	}
	if report.Email != "" {
		t.Fatalf("Email = %q, want empty", report.Email)
	}
	if report.AccountID != "" {
		t.Fatalf("AccountID = %q, want empty", report.AccountID)
	}
	if report.UserID != "" {
		t.Fatalf("UserID = %q, want empty", report.UserID)
	}
	if report.Plan != "" {
		t.Fatalf("Plan = %q, want empty", report.Plan)
	}
	if len(report.Buckets) != 1 || len(report.Buckets[0].Windows) != 2 {
		t.Fatalf("unexpected bucket layout: %+v", report.Buckets)
	}
}

func TestParseClaudeUsageReport_UpgradeRequired(t *testing.T) {
	text := "Unknown command: /usage"
	_, err := parseClaudeUsageReport(text, time.Now())
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "upgrade") {
		t.Fatalf("err = %v, want upgrade guidance", err)
	}
}

func TestParseClaudeUsageReport_LoginRequired(t *testing.T) {
	text := "Please run `claude auth login` to continue."
	_, err := parseClaudeUsageReport(text, time.Now())
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "login") {
		t.Fatalf("err = %v, want login guidance", err)
	}
}

func TestParseClaudeUsageReport_MissingWindowFields(t *testing.T) {
	loc := mustLoadLocation(t, "Asia/Seoul")
	now := time.Date(2026, time.December, 22, 12, 0, 0, 0, loc)
	text := strings.TrimSpace(`
Current session
Resets 3:00pm (Asia/Seoul)

Current week
47% used
Resets Dec 23, 11:30am (Asia/Seoul)
`)

	_, err := parseClaudeUsageReport(text, now)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "current session") {
		t.Fatalf("err = %v, want current session parse error", err)
	}
}

func TestParseClaudeUsageReport_UnknownResetTimeDoesNotFail(t *testing.T) {
	loc := mustLoadLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.March, 30, 11, 0, 0, 0, loc)
	text := strings.TrimSpace(`
Current session
14% used
Resets later today somehow

Current week
33% used
Resets Apr 2, 4pm (America/Los_Angeles)
`)

	report, err := parseClaudeUsageReport(text, now)
	if err != nil {
		t.Fatalf("parseClaudeUsageReport returned error: %v", err)
	}
	if len(report.Buckets) != 1 || len(report.Buckets[0].Windows) != 2 {
		t.Fatalf("unexpected bucket layout: %+v", report.Buckets)
	}
	session := report.Buckets[0].Windows[0]
	if session.UsedPercent != 14 {
		t.Fatalf("session.UsedPercent = %d, want 14", session.UsedPercent)
	}
	if session.ResetAfterSeconds != 0 || session.ResetAtUnix != 0 {
		t.Fatalf("session reset should be unknown, got %+v", session)
	}
}

func TestParseClaudeUsageReport_MissingResetTimeDoesNotFail(t *testing.T) {
	loc := mustLoadLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.March, 30, 11, 0, 0, 0, loc)
	text := strings.TrimSpace(`
Current session
14% used

Current week
33% used
Resets Apr 2, 4pm (America/Los_Angeles)
`)

	report, err := parseClaudeUsageReport(text, now)
	if err != nil {
		t.Fatalf("parseClaudeUsageReport returned error: %v", err)
	}
	session := report.Buckets[0].Windows[0]
	if session.UsedPercent != 14 {
		t.Fatalf("session.UsedPercent = %d, want 14", session.UsedPercent)
	}
	if session.ResetAfterSeconds != 0 || session.ResetAtUnix != 0 {
		t.Fatalf("session reset should be absent, got %+v", session)
	}
}

func TestParseClaudeUsageResetTime_AllowsWholeHourWithTimezone(t *testing.T) {
	loc := mustLoadLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.March, 30, 11, 0, 0, 0, loc)

	resetAt, err := parseClaudeUsageResetTime("2pm (America/Los_Angeles)", now)
	if err != nil {
		t.Fatalf("parseClaudeUsageResetTime returned error: %v", err)
	}

	want := time.Date(2026, time.March, 30, 14, 0, 0, 0, loc)
	if !resetAt.Equal(want) {
		t.Fatalf("resetAt = %v, want %v", resetAt, want)
	}
}

func TestParseClaudeUsageResetTime_AllowsMonthDayWholeHour(t *testing.T) {
	loc := mustLoadLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.March, 30, 11, 0, 0, 0, loc)

	resetAt, err := parseClaudeUsageResetTime("Apr 2, 4pm (America/Los_Angeles)", now)
	if err != nil {
		t.Fatalf("parseClaudeUsageResetTime returned error: %v", err)
	}

	want := time.Date(2026, time.April, 2, 16, 0, 0, 0, loc)
	if !resetAt.Equal(want) {
		t.Fatalf("resetAt = %v, want %v", resetAt, want)
	}
}

func TestAgentGetUsageSmoke(t *testing.T) {
	if os.Getenv("CC_CONNECT_SMOKE_CLAUDE_USAGE") == "" {
		t.Skip("set CC_CONNECT_SMOKE_CLAUDE_USAGE=1 to run")
	}
	if _, err := os.Stat("/usr/bin/env"); err != nil {
		t.Skipf("environment not suitable: %v", err)
	}

	a := &Agent{workDir: ".", mode: "plan"}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	report, err := a.GetUsage(ctx)
	if err != nil {
		t.Fatalf("GetUsage returned error: %v", err)
	}
	if report == nil || len(report.Buckets) == 0 {
		t.Fatalf("unexpected empty report: %+v", report)
	}
}

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

// claudeTrustDialogScreen mirrors the folder-trust dialog captured from
// Claude Code 2.1.301 in a fresh temp dir (cursor defaults to "No, exit").
func claudeTrustDialogScreen(first, second string) string {
	return strings.Join([]string{
		"Accessing workspace:",
		"",
		"/private/tmp/bothouse-claude-usage-123",
		"",
		"Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
		"project, or work from your team). If not, take a moment to review what's in this folder first.",
		"",
		"Claude Code'll be able to read, edit, and execute files here.",
		"",
		"Security guide",
		"",
		first,
		second,
		"",
		"Enter to confirm · Esc to cancel",
	}, "\n")
}

func TestPromptActionForScreen_TrustDialogCursorOnNo(t *testing.T) {
	// Raw PTY bytes captured from Claude Code 2.1.301: words are placed with
	// CSI G (cursor horizontal absolute) instead of spaces.
	raw := "Quick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[30Ga\x1b[32Gproject\r\n" +
		"\r\n" +
		"\x1b[2Gyes\x1b[8Gexit\r\n" + // noise line, not an option
		"\x1b[2G❯\x1b[4GNo,\x1b[8Gexit\r\n" +
		"\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\n" +
		"\r\n" +
		"\x1b[2GEnter\x1b[8Gto\x1b[11Gconfirm\x1b[19G·\x1b[21GEsc\x1b[25Gto\x1b[28Gcancel\r\n"
	terminal := newClaudeUsageTerminal()
	terminal.Write([]byte(raw))
	rendered := normalizeClaudeUsageText(terminal.String())
	if !strings.Contains(rendered, "Quick safety check: Is this a project") || !strings.Contains(rendered, "❯ No, exit") {
		t.Fatalf("CSI G not rendered as column moves: %q", rendered)
	}

	for name, screen := range map[string]string{
		"fixture": claudeTrustDialogScreen("❯ No, exit", "Yes, I trust this folder"),
		"raw":     rendered,
	} {
		if got := promptActionForScreen(screen); got != "\x1b[B\r" {
			t.Fatalf("%s: promptActionForScreen = %q, want down+enter so Yes is chosen", name, got)
		}
	}
}

func TestPromptActionForScreen_TrustDialogCursorOnYes(t *testing.T) {
	screen := claudeTrustDialogScreen("❯ 1. Yes, I trust this folder", "2. No, exit")
	if got := promptActionForScreen(screen); got != "\r" {
		t.Fatalf("promptActionForScreen = %q, want plain enter", got)
	}
}

func TestPromptActionForScreen_TrustDialogNoBelowCursorOnNo(t *testing.T) {
	screen := claudeTrustDialogScreen("Yes, I trust this folder", "❯ No, exit")
	if got := promptActionForScreen(screen); got != "\x1b[A\r" {
		t.Fatalf("promptActionForScreen = %q, want up+enter", got)
	}
}

func TestPromptActionForScreen_TrustDialogNoCursorDefaultsToFirst(t *testing.T) {
	screen := claudeTrustDialogScreen("No, exit", "Yes, I trust this folder")
	if got := promptActionForScreen(screen); got != "\x1b[B\r" {
		t.Fatalf("promptActionForScreen = %q, want down+enter", got)
	}
}

func TestNextClaudeUsageProbeAction_WaitsForTrustDialogOptions(t *testing.T) {
	now := time.Now()
	state := &claudeUsageProbeState{}
	partial := "Quick safety check: Is this a project you created or one you trust?"
	if got := nextClaudeUsageProbeAction(partial, state, now); got != "" {
		t.Fatalf("action on half-rendered trust dialog = %q, want wait", got)
	}
	if state.sentWake || state.sentUsage {
		t.Fatalf("probe typed into trust dialog: %+v", state)
	}
}

func TestNextClaudeUsageProbeAction_NoWakeOnEmptyScreen(t *testing.T) {
	state := &claudeUsageProbeState{}
	if got := nextClaudeUsageProbeAction("", state, time.Now()); got != "" {
		t.Fatalf("action on empty screen = %q, want wait", got)
	}
	if got := nextClaudeUsageProbeAction("> ", state, time.Now().Add(time.Second)); got != "\r" {
		t.Fatalf("wake on rendered prompt = %q, want enter", got)
	}
}

func TestClaudeUsageProbeDir_IsStable(t *testing.T) {
	if got, want := claudeUsageProbeDir("/data/cc"), filepath.Join("/data/cc", "claude-usage-probe"); got != want {
		t.Fatalf("claudeUsageProbeDir = %q, want %q", got, want)
	}
	if a, b := claudeUsageProbeDir(""), claudeUsageProbeDir(""); a != b || a == "" {
		t.Fatalf("fallback probe dir not stable: %q vs %q", a, b)
	}
}

// The probe on 2026-11-01 captured the trust dialog as
// "Yes, IGtrust this folder": an extra character of unconfirmed origin
// appeared inside the option text. Exact matching missed it, the
// dialog was never answered, and each timed-out probe extended the quota
// cooldown for cjiang from 16:30 to 16:35 to 16:45.
func TestPromptActionForScreen_TrustDialogRenderedNoise(t *testing.T) {
	screen := claudeTrustDialogScreen("❯ No, exit", "Yes, IGtrust this folder")
	if !claudeTrustDialogVisible(screen) {
		t.Fatal("claudeTrustDialogVisible = false, want true for the noisy render")
	}
	if got := promptActionForScreen(screen); got != "\x1b[B\r" {
		t.Fatalf("promptActionForScreen = %q, want down+enter so Yes is chosen", got)
	}
}

func TestTrustDialogYesLineIgnoresPunctuation(t *testing.T) {
	for _, s := range []string{
		"Yes, I trust this folder",
		"Yes, IGtrust this folder",
		"❯ Yes, I trust this folder",
		"yes i trust this folder",
	} {
		if !trustDialogYesLine(s) {
			t.Fatalf("trustDialogYesLine(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"No, exit", "Enter to confirm · Esc to cancel", ""} {
		if trustDialogYesLine(s) {
			t.Fatalf("trustDialogYesLine(%q) = true, want false", s)
		}
	}
}

func TestPromptActionForScreen_TrustDialogTitleIsNotYes(t *testing.T) {
	screen := "Do you trust this folder?\n❯ No, exit\nEnter to confirm"
	if got := promptActionForScreen(screen); got != "" {
		t.Fatalf("action on title without affirmative option = %q, want wait", got)
	}
	if got := nextClaudeUsageProbeAction(screen, &claudeUsageProbeState{}, time.Now()); got != "" {
		t.Fatalf("probe action on incomplete trust dialog = %q, want wait", got)
	}
}

func TestPromptActionForScreen_TrustDialogRequiresKnownOptions(t *testing.T) {
	for _, tt := range []struct {
		name, options, want string
	}{
		{"title before default no", "Do you trust this folder?\n❯ No, exit\nYes, I trust this folder", "\x1b[B\r"},
		{"title before default yes", "Do you trust this folder?\n❯ Yes, I trust this folder\nNo, exit", "\r"},
		{"numbered noisy yes above no", "1. Yes, IGtrust this folder\n❯ 2. No, exit", "\x1b[A\r"},
		{"negative do not", "❯ No, exit\nI do not trust this folder", ""},
		{"negative contraction", "❯ No, exit\nI don't trust this folder", ""},
		{"selected negative statement", "❯ I don't trust this folder\nYes, I trust this folder", ""},
		{"yes with negation", "❯ No, exit\nYes, I don't trust this folder", ""},
		{"yes with extra words", "❯ No, exit\nYes, I trust this folder only after review", ""},
		{"missing yes", "❯ No, exit", ""},
		{"missing no", "❯ Yes, I trust this folder", ""},
		{"missing both", "Do you trust this folder?", ""},
		{"unknown cursor", "❯ Review files first\nNo, exit\nYes, I trust this folder", ""},
		{"extra option between known choices", "❯ No, exit\nReview files first\nYes, I trust this folder", ""},
		{"duplicated yes", "❯ No, exit\nYes, I trust this folder\nYes, I trust this folder", ""},
		{"duplicated no", "❯ No, exit\nNo, exit\nYes, I trust this folder", ""},
		{"two cursors", "❯ No, exit\n❯ Yes, I trust this folder", ""},
		{"fragmented cursor", "❯\nNo, exit\nYes, I trust this folder", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			screen := "Do you trust this folder?\n" + tt.options + "\nEnter to confirm · Esc to cancel"
			if got := promptActionForScreen(screen); got != tt.want {
				t.Errorf("prompt action = %q, want %q", got, tt.want)
			}
			if got := nextClaudeUsageProbeAction(screen, &claudeUsageProbeState{}, time.Now()); got != tt.want {
				t.Errorf("probe action = %q, want %q", got, tt.want)
			}
		})
	}
}
