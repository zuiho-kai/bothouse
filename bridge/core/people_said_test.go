package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersonKey(t *testing.T) {
	for _, c := range []struct {
		msg  *Message
		want string
	}{
		{&Message{Platform: "discord", UserID: "1498889779377602672"}, "discord-1498889779377602672"},
		{&Message{Platform: "feishu", UserID: "ou_ab/c"}, "feishu-ou_ab-c"},
		{&Message{Platform: "discord", UserID: "1", FromBot: true}, ""},
		{&Message{Platform: "discord", UserID: "cron"}, ""},
		{&Message{Platform: "discord"}, ""},
	} {
		if got := personKey(c.msg); got != c.want {
			t.Errorf("personKey(%+v) = %q, want %q", c.msg, got, c.want)
		}
	}
}

func TestRecordPersonSaid(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_SESSIONS_DIR", dir)
	e := &Engine{name: "maomao"}
	e.recordPersonSaid(&Message{Platform: "discord", UserID: "42", UserName: "zzzx0757", SessionKey: "discord:9", Content: "声音不是很自然"})
	e.recordPersonSaid(&Message{Platform: "discord", UserID: "7", FromBot: true, Content: "bot words"})
	b, err := os.ReadFile(filepath.Join(dir, "people", "discord-42.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var rec map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(b))), &rec); err != nil {
		t.Fatal(err)
	}
	if rec["speaker_id"] != "42" || rec["text"] != "声音不是很自然" || rec["channel"] != "discord:9" || rec["project"] != "maomao" {
		t.Fatalf("record = %v", rec)
	}
	if _, err := os.Stat(filepath.Join(dir, "people", "discord-7.jsonl")); err == nil {
		t.Fatal("a bot's message was recorded")
	}
}
