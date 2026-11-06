package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		{&Message{Platform: "qq", UserID: "1234567890"}, "qq-1234567890"},
		{&Message{Platform: "telegram", UserID: "-1001"}, "telegram--1001"},
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

// The turn's sender goes to the gate's /context, so ctxsvc pushes that person's 懂你 page and no one else's.
func TestTurnContextSendsSender(t *testing.T) {
	got := make(chan string, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		got <- req["sender"]
		wiki := []map[string]string{}
		if req["sender"] == "discord-42" {
			wiki = append(wiki, map[string]string{"path": "【懂你 zzzx0757 abc123】", "desc": "zzzx0757 的画像"})
		}
		b, _ := json.Marshal(map[string]any{"wiki": wiki})
		_, _ = w.Write(b)
	}))
	defer srv.Close()
	e := NewEngine("test", &stubAgent{}, []Platform{&stubPlatformEngine{n: "x"}}, "", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "reply")
	sess := &Session{AgentSessionID: "a1"}
	msg := &Message{Platform: "discord", UserID: "42", UserName: "zzzx0757"}
	out := e.withTurnBlocksRef(sess, "discord:c1", "hi", personKey(msg), "hi", true, nil)
	if s := <-got; s != "discord-42" {
		t.Fatalf("sender = %q", s)
	}
	if !strings.Contains(out, "zzzx0757 的画像") {
		t.Fatalf("turn content:\n%s", out)
	}
	_ = e.withTurnBlocksRef(&Session{AgentSessionID: "a2"}, "discord:c1", "tick", personKey(&Message{Platform: "discord", UserID: "cron"}), "tick", true, nil)
	if s := <-got; s != "" {
		t.Fatalf("cron turn sender = %q", s)
	}
}
