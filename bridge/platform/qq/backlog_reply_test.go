package qq

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// When one person's question is still in the backlog but another person wakes the
// bot, an ordinary final answer must not be attached to the earlier question by
// the sending layer. OneBot is fake; the QQ adapter, gate, engine and final send
// path are real.
func TestBacklogAnswerDoesNotQuoteEarlierAskerWhenAnotherAsks(t *testing.T) {
	gate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Mentioned bool `json:"mentioned"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		action := "silent"
		if req.Mentioned {
			action = "reply"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"action": action})
	}))
	defer gate.Close()

	f := newFakeOneBot(t)
	p, err := New(map[string]any{"ws_url": "ws" + f.ts.URL[len("http"):], "allow_from": "*", "share_session_in_channel": true})
	if err != nil {
		t.Fatal(err)
	}
	as := &outboundCaptureSession{prompts: make(chan string, 2), events: make(chan core.Event, 4)}
	e := core.NewEngine("fish", &outboundCaptureAgent{as}, []core.Platform{p}, "", core.LangChinese)
	defer func() { _ = e.Stop() }()
	e.SetGate(gate.URL, 2000, "reply")
	e.SetGateBurstWindow(1)
	if err := p.Start(e.ReceiveMessage); err != nil {
		t.Fatal(err)
	}

	f.push(groupMessage(111, 2001, 103, textSegment("我是直接从 main fork 吗")))
	time.Sleep(80 * time.Millisecond)
	f.push(groupMessage(111, 2002, 104, atSegment("10000"), textSegment(" 肥鱼")))

	var params map[string]any
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case action := <-f.actions:
			if action == "send_group_msg" {
				params = f.paramsOf(action, 0)
			}
		case <-time.After(50 * time.Millisecond):
		}
		if params != nil {
			break
		}
	}
	if params == nil {
		t.Fatal("final answer never reached fake OneBot")
	}
	if segments, ok := params["message"].([]any); ok {
		for _, segment := range segments {
			first, _ := segment.(map[string]any)
			data, _ := first["data"].(map[string]any)
			if first["type"] == "reply" && segString(data, "id") == "103" {
				t.Fatalf("final answer quoted backlog message 103 although another sender asked: %#v", segments)
			}
		}
	}
	text, ok := params["message"].(string)
	if !ok || text != "answer" {
		t.Fatalf("ordinary final answer = %#v, want the plain text answer without an automatic quote", params["message"])
	}

	select {
	case prompt := <-as.prompts:
		for _, want := range []string{"message_id=103", "sender_id=2001", "--reply-to", "--at-users"} {
			if !strings.Contains(prompt, want) {
				t.Fatalf("backlog prompt missing %s:\n%s", want, prompt)
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("backlog prompt never reached the capture session")
	}
}
