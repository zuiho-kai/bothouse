package core

import (
	"os"
	"path/filepath"
	"testing"
)

func leadFixture(t *testing.T) string {
	dir := t.TempDir()
	team := `{"lead": {"name": "主管", "aliases": ["Claude"], "project": "boss", "id": "111"},
	 "subs": {"coder": {"name": "码农", "aliases": ["Codex"], "id": "222"}, "writer": {"name": "笔杆", "aliases": [], "id": "333"}}}`
	if err := os.WriteFile(filepath.Join(dir, gateTeamFile), []byte(team), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestParseLeadSwitch(t *testing.T) {
	tm, ok := loadLeadTeam(leadFixture(t))
	if !ok {
		t.Fatal("team not loaded")
	}
	for _, c := range []struct {
		text      string
		mentioned bool
		fromBot   bool
		want      string
	}{
		{"码农，你当主", false, false, "coder"},
		{"让笔杆当主角色", false, false, "writer"},
		{"换回主管", false, false, "boss"},
		{"Codex 来兜底", false, false, "coder"},
		{"<@333> 你来当主", false, false, "writer"},
		{"你当主吧", true, false, "self"},
		{"码农能不能当主？", false, false, ""},  // a question
		{"你做主吧", true, false, ""},          // "you decide", not a switch
		{"码农，你当主", false, true, ""},       // a bot said it
		{"这个主意不错", false, false, ""},
	} {
		if got := ParseLeadSwitch(tm, c.text, c.mentioned, c.fromBot, "self"); got != c.want {
			t.Errorf("%q: got %q, want %q", c.text, got, c.want)
		}
	}
}

// Default config without a running gate: one sentence switches the lead; the fallback and identity follow it.
func TestLeadSwitchWithoutGate(t *testing.T) {
	dir := leadFixture(t)
	boss, coder := &Engine{dataDir: dir, name: "boss"}, &Engine{dataDir: dir, name: "coder"}
	if got := boss.leadFallback(false, "reply"); got != "reply" {
		t.Fatalf("before any switch the wizard's fallback stays: %s", got)
	}
	msg := &Message{Content: "码农，你当主"}
	if h, mine := boss.leadSwitchFor(msg); !h || mine {
		t.Fatalf("boss: handled=%v mine=%v", h, mine)
	}
	if h, mine := coder.leadSwitchFor(msg); !h || !mine {
		t.Fatalf("coder: handled=%v mine=%v", h, mine)
	}
	if s, _ := CurrentLead(dir); s.Lead != "coder" || s.At == "" {
		t.Fatalf("state: %+v", s)
	}
	if boss.leadFallback(false, "reply") != "context" || coder.leadFallback(false, "context") != "reply" {
		t.Fatal("fallback does not follow the new lead")
	}
	if boss.leadFallback(true, "reply") != "reply" {
		t.Fatal("an @-mentioned bot still replies")
	}
	s := &Session{}
	if coder.leadIdentity(s) == "" || coder.leadIdentity(s) != "" {
		t.Fatal("identity note once per switch per session")
	}
}
