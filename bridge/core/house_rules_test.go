package core

import (
	"bytes"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func writeHouseRules(t *testing.T, dataDir, text string) {
	t.Helper()
	path := houseRulesPath(dataDir)
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
	resetHouseRulesOverWarn()
	t.Cleanup(resetHouseRulesOverWarn)

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
	// When a single line exceeds the cap, 0 body lines fit: return heading + notice only, never hard-cut.
	overBytes := houseRulesMaxBytes + 1
	writeHouseRules(t, dir, strings.Repeat("x", overBytes))
	gotOver := readHouseRules(dir)
	lines := strings.Split(gotOver, "\n")
	if len(lines) != 2 || lines[0] != houseRulesHead {
		t.Fatalf("single over-cap line must send only heading + notice, got:\n%s", gotOver)
	}
	for _, want := range []string{
		fmt.Sprintf("%d", overBytes),
		fmt.Sprintf("%d", houseRulesMaxBytes),
		"1 条",
		"由主角色精简到上限内",
		houseRulesPath(dir),
	} {
		if !strings.Contains(lines[1], want) {
			t.Fatalf("notice %q missing %q", lines[1], want)
		}
	}
	if strings.Contains(gotOver, "xxxx") {
		t.Fatalf("single over-cap line must not be byte-truncated:\n%s", gotOver)
	}

	writeHouseRules(t, dir, strings.Repeat("x", houseRulesMaxBytes))
	if got := readHouseRules(dir); got != houseRulesHead+"\n"+strings.Repeat("x", houseRulesMaxBytes) {
		t.Fatalf("file at the cap must be sent, got %d bytes", len(got))
	}
}

func TestHouseRulesOverflow_LineBoundaryAndUTF8(t *testing.T) {
	resetHouseRulesOverWarn()
	t.Cleanup(resetHouseRulesOverWarn)

	dir := t.TempDir()
	line1 := "- 第一条中文规则：" + strings.Repeat("甲", 600)
	line2 := "- 第二条中文规则：" + strings.Repeat("乙", 600)
	line3 := "- 第三条中文规则：不应发送" + strings.Repeat("丙", 200)
	line4 := "- 第四条中文规则：也不应发送"
	// Include a blank line in the dropped tail so only non-empty dropped lines are counted (2, not 3).
	raw := strings.Join([]string{line1, line2, line3, "", line4}, "\n") + "\n"
	if len(raw) <= houseRulesMaxBytes {
		t.Fatalf("test fixture must exceed cap: got %d bytes", len(raw))
	}
	writeHouseRules(t, dir, raw)

	got := readHouseRules(dir)
	if !utf8.ValidString(got) {
		t.Fatalf("truncated output is not valid UTF-8")
	}
	lines := strings.Split(got, "\n")
	if len(lines) != 4 {
		t.Fatalf("want heading + notice + 2 kept lines (4 lines), got %d:\n%s", len(lines), got)
	}
	if lines[0] != houseRulesHead {
		t.Fatalf("line 0 = %q, want %q", lines[0], houseRulesHead)
	}
	for _, want := range []string{
		fmt.Sprintf("%d", len(raw)),
		fmt.Sprintf("%d", houseRulesMaxBytes),
		"2 条",
		"由主角色精简到上限内",
		houseRulesPath(dir),
	} {
		if !strings.Contains(lines[1], want) {
			t.Fatalf("notice line %q missing %q", lines[1], want)
		}
	}
	if lines[2] != line1 || lines[3] != line2 {
		t.Fatalf("kept lines mismatch:\ngot[2]=%q\ngot[3]=%q", lines[2], lines[3])
	}
	bodyBytes := len(strings.Join(lines[2:], "\n"))
	if bodyBytes > houseRulesMaxBytes {
		t.Fatalf("kept body %d bytes exceeds cap %d", bodyBytes, houseRulesMaxBytes)
	}
	if strings.Contains(got, "第三条") || strings.Contains(got, "第四条") {
		t.Fatalf("dropped lines leaked into output:\n%s", got)
	}
}

func TestHouseRulesOverflow_WarnOncePerVersionAndResets(t *testing.T) {
	resetHouseRulesOverWarn()
	t.Cleanup(resetHouseRulesOverWarn)

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	countWarns := func() int {
		return strings.Count(buf.String(), "house rules: file over the cap")
	}

	dir := t.TempDir()
	overA := "- 守则A\n" + strings.Repeat("a", houseRulesMaxBytes)
	overB := "- 守则B\n" + strings.Repeat("b", houseRulesMaxBytes)

	writeHouseRules(t, dir, overA)
	_ = readHouseRules(dir)
	_ = readHouseRules(dir)
	if got := countWarns(); got != 1 {
		t.Fatalf("same over-cap version logged %d times, want 1\nlogs:\n%s", got, buf.String())
	}

	writeHouseRules(t, dir, overB)
	_ = readHouseRules(dir)
	if got := countWarns(); got != 2 {
		t.Fatalf("changed over-cap version should log again: got %d, want 2\nlogs:\n%s", got, buf.String())
	}

	writeHouseRules(t, dir, "- 正常守则\n")
	_ = readHouseRules(dir)
	if got := countWarns(); got != 2 {
		t.Fatalf("within-cap file must not warn: got %d, want 2\nlogs:\n%s", got, buf.String())
	}

	// Returning to the same over-cap content B after being fixed must warn again.
	writeHouseRules(t, dir, overB)
	_ = readHouseRules(dir)
	if got := countWarns(); got != 3 {
		t.Fatalf("re-overflow with same content after fix must warn again: got %d, want 3\nlogs:\n%s", got, buf.String())
	}
}

func TestHouseRulesOverflow_TurnInjectionAndRecovery(t *testing.T) {
	resetHouseRulesOverWarn()
	t.Cleanup(resetHouseRulesOverWarn)

	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)

	kept1 := "- 保留规则一：" + strings.Repeat("测", 650)
	kept2 := "- 保留规则二：" + strings.Repeat("试", 650)
	dropped := "- 被截规则三：不应出现在超限首轮，" + strings.Repeat("尾", 20)
	raw := strings.Join([]string{kept1, kept2, dropped}, "\n") + "\n"
	if len(raw) <= houseRulesMaxBytes {
		t.Fatalf("test fixture must exceed cap: got %d bytes", len(raw))
	}
	writeHouseRules(t, e.dataDir, raw)

	first := houseTurn(t, e, a, p, "一")
	for _, want := range []string{houseRulesHead, "由主角色精简到上限内", houseRulesPath(e.dataDir), kept1, kept2} {
		if !strings.Contains(first, want) {
			t.Fatalf("over-cap turn missing %q:\n%s", want, first)
		}
	}
	if strings.Contains(first, dropped) {
		t.Fatalf("over-cap turn must omit dropped line:\n%s", first)
	}
	if strings.Index(first, "由主角色精简到上限内") > strings.Index(first, kept1) {
		t.Fatalf("notice must appear before kept rules:\n%s", first)
	}

	writeHouseRules(t, e.dataDir, "- 精简后规则\n")
	second := houseTurn(t, e, a, p, "二")
	if !strings.Contains(second, houseRulesHead+"\n- 精简后规则") {
		t.Fatalf("recovered turn missing slimmed rules:\n%s", second)
	}
	if strings.Contains(second, "由主角色精简到上限内") {
		t.Fatalf("recovered turn must not carry overflow notice:\n%s", second)
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
