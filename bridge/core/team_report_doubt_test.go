package core

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #1350: a doubted report is not released on the lead's own reasoning; a quote of what the user
// really said (people record) releases it.
func TestDoubtedReportPassNeedsUserWords(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_SESSIONS_DIR", dir)
	if err := os.MkdirAll(filepath.Join(dir, "people"), 0o700); err != nil {
		t.Fatal(err)
	}
	rec := `{"v":1,"ts":"2026-11-10T05:00:00.000Z","channel":"discord:chat1","text":"可以，只测这个入口\n就行","speaker":"zuiho_kai","speaker_id":"u1"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "people", "discord-u1.jsonl"), []byte(rec), 0o600); err != nil {
		t.Fatal(err)
	}
	e, p, store, item := heldFixture(t)
	holdForTest(t, e, p, item, "测的是另一个入口")
	if jobs := store.List(); len(jobs) != 1 || !strings.Contains(jobs[0].Prompt, doubtPassRule) {
		t.Fatalf("lead prompt does not say how a doubt is cleared")
	}
	for _, v := range []string{
		"逐条：我核过了，另一个入口和这个入口走同一段代码，所以等价",
		"逐条：用户说过「这个入口和那个等价」，所以放行", // not something the user said
		"逐条：用户说「可以」，其余各项都做到了，放行",  // too short to count
	} {
		w := verdictCall(t, e, 46, "pass", v)
		if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "ws-forward") || !strings.Contains(w.Body.String(), "问用户") {
			t.Fatalf("pass on %q = %d %s", v, w.Code, w.Body)
		}
	}
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("doubted report posted on reasoning: %q", got)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：疑点用户已答「只测这个入口 就行」，其余做到"); w.Code != http.StatusOK {
		t.Fatalf("pass with the user's words = %d %s", w.Code, w.Body)
	}
	if n := len(p.sentTo("discord:chat1")); n != 1 {
		t.Fatalf("posted %d times", n)
	}
}
