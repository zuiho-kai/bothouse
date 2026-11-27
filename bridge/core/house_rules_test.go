package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeHouseRules(t *testing.T, dataDir, text string) {
	t.Helper()
	path := HouseRulesPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// houseTurn sends one channel message and returns the prompt the agent got.
func houseTurn(t *testing.T, e *Engine, a *inputTestAgent, p *exitTestPlatform, say string) string {
	t.Helper()
	session := e.sessions.GetOrCreateActive(exitWSKey)
	exitSay(e, p, exitWSKey, "ws1", say)
	got := inputPrompt(t, a)
	inputDone(a, "ok")
	inputWait(t, func() bool { return !session.Busy() })
	return got
}

// The house rules file rides after the team-mode rules once per context, and an edited file is
// sent again on the next turn of the same session (teamRulesOnce hashes the whole text).
func TestHouseRulesAppendedAndResentWhenEdited(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	writeHouseRules(t, e.dataDir, "第一版守则\n")

	first := houseTurn(t, e, a, p, "一")
	if !strings.Contains(first, rulesHead) || !strings.Contains(first, houseRulesHead+"\n第一版守则") {
		t.Fatalf("first turn lacks the house rules:\n%s", first)
	}
	if strings.Index(first, houseRulesHead) < strings.Index(first, rulesHead) {
		t.Fatalf("house rules must follow the team-mode rules:\n%s", first)
	}
	if got := houseTurn(t, e, a, p, "二"); strings.Contains(got, houseRulesHead) {
		t.Fatalf("unchanged house rules resent:\n%s", got)
	}

	writeHouseRules(t, e.dataDir, "第二版守则\n")
	third := houseTurn(t, e, a, p, "三")
	if !strings.Contains(third, "第二版守则") || strings.Contains(third, "第一版守则") {
		t.Fatalf("edited house rules not resent on the next turn:\n%s", third)
	}
}

// inject_team_rules off drops the team-mode rules but keeps the owner's house rules.
func TestHouseRulesKeptWithTeamRulesOff(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	e.SetTeamModeRulesEnabled(false)
	writeHouseRules(t, e.dataDir, "只有守则")

	got := houseTurn(t, e, a, p, "一")
	if strings.Contains(got, rulesHead) || !strings.Contains(got, houseRulesHead+"\n只有守则") {
		t.Fatalf("want house rules without team-mode rules:\n%s", got)
	}
}

func TestReadHouseRules(t *testing.T) {
	dir := t.TempDir()
	if got := readHouseRules(dir); got != "" {
		t.Fatalf("missing file: got %q", got)
	}
	if got := readHouseRules(""); got != "" {
		t.Fatalf("no data dir: got %q", got)
	}
	writeHouseRules(t, dir, " \n\t\n")
	if got := readHouseRules(dir); got != "" {
		t.Fatalf("blank file: got %q", got)
	}
	over := strings.Repeat("守则一条\n", HouseRulesWarnBytes/13+1)
	writeHouseRules(t, dir, over)
	if got := readHouseRules(dir); got != houseRulesHead+"\n"+strings.TrimSpace(over) {
		t.Fatalf("file over the warn line must be sent whole, got %d of %d bytes", len(got), len(over))
	}
	writeHouseRules(t, dir, strings.Repeat("x", HouseRulesWarnBytes))
	if got := readHouseRules(dir); got != houseRulesHead+"\n"+strings.Repeat("x", HouseRulesWarnBytes) {
		t.Fatalf("file at the line must be sent, got %d bytes", len(got))
	}
}

// A missing house file adds nothing to the delivery.
func TestHouseRulesMissingFileNotSent(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	if got := houseTurn(t, e, a, p, "一"); strings.Contains(got, houseRulesHead) || !strings.Contains(got, rulesHead) {
		t.Fatalf("missing house file changed the delivery:\n%s", got)
	}
}

func houseNotices(p *exitTestPlatform) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, s := range p.out {
		if strings.Contains(s.text, "📏") {
			n++
		}
	}
	return n
}

// A house file over the warn line still reaches the agent whole, and the chat a person wrote in
// is told once per file version (#2048: an over-size file used to be dropped and only logged).
func TestHouseRulesOverLineSentWholeAndNoticedOncePerVersion(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	big := strings.Repeat("一条很长的守则。\n", HouseRulesWarnBytes/25+1) + "最后一条\n"
	writeHouseRules(t, e.dataDir, big)

	first := houseTurn(t, e, a, p, "一")
	if !strings.Contains(first, "最后一条") {
		t.Fatalf("over-line house rules not sent whole:\n%s", first)
	}
	inputWait(t, func() bool { return houseNotices(p) == 1 })
	houseTurn(t, e, a, p, "二")
	writeHouseRules(t, e.dataDir, big+"又加一条\n")
	third := houseTurn(t, e, a, p, "三")
	if !strings.Contains(third, "又加一条") {
		t.Fatalf("edited over-line rules not resent whole:\n%s", third)
	}
	inputWait(t, func() bool { return houseNotices(p) == 2 })
	houseTurn(t, e, a, p, "四")
	if n := houseNotices(p); n != 2 {
		t.Fatalf("same version noticed again: %d notices", n)
	}
	writeHouseRules(t, e.dataDir, "短守则\n")
	houseTurn(t, e, a, p, "五")
	writeHouseRules(t, e.dataDir, big)
	houseTurn(t, e, a, p, "六")
	inputWait(t, func() bool { return houseNotices(p) == 3 })
}
