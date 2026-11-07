package qq

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/agent/dsh"
	"github.com/chenhg5/cc-connect/core"
)

// Synthetic external ACP peer. The actual DSH adapter and engine run in the
// parent; no model, credentials, production service or QQ account is used.
func TestQuoteACPProcess(t *testing.T) {
	if os.Getenv("QQ_QUOTE_ACP_HELPER") != "1" {
		return
	}
	scan := bufio.NewScanner(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	for scan.Scan() {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params struct {
				SessionID string `json:"sessionId"`
				Prompt    []struct {
					Text string `json:"text"`
				} `json:"prompt"`
			} `json:"params"`
		}
		if json.Unmarshal(scan.Bytes(), &req) != nil {
			os.Exit(2)
		}
		if len(req.ID) == 0 {
			continue
		}
		result := map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}}
		case "session/new":
			result = map[string]any{"sessionId": "quote-dsh-session"}
		case "session/prompt":
			var text strings.Builder
			for _, block := range req.Params.Prompt {
				text.WriteString(block.Text)
			}
			if err := os.WriteFile(os.Getenv("QQ_QUOTE_ACP_CAPTURE"), []byte(text.String()), 0600); err != nil {
				os.Exit(2)
			}
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": req.Params.SessionID, "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "NO_REPLY"}}}})
			result = map[string]any{"stopReason": "end_turn"}
		}
		if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result}); err != nil {
			os.Exit(2)
		}
	}
	os.Exit(0)
}

func TestQuoteReachesDSHACPWire(t *testing.T) {
	dir := t.TempDir()
	capture := filepath.Join(dir, "prompt.txt")
	cmd, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	a, err := dsh.New(map[string]any{"cmd": cmd, "args": []string{"-test.run=^TestQuoteACPProcess$", "--"}, "work_dir": dir, "cc_data_dir": dir, "env": map[string]any{"QQ_QUOTE_ACP_HELPER": "1", "QQ_QUOTE_ACP_CAPTURE": capture}})
	if err != nil {
		t.Fatal(err)
	}
	f := newFakeOneBot(t)
	f.on("get_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 4242, "message_type": "group", "group_id": 111, "sender": map[string]any{"user_id": 2003, "nickname": "原作者"}, "message": "重启前原文"}
	})
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	e := core.NewEngine("quote-test", a, []core.Platform{p}, filepath.Join(dir, "sessions.json"), core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	if err := p.Start(e.ReceiveMessage); err != nil {
		t.Fatal(err)
	}
	f.push(groupMessage(111, 2001, 104, replySegment("4242"), atSegment("10000"), textSegment("看看这条")))
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if body, err := os.ReadFile(capture); err == nil {
			for _, want := range []string{"原作者：重启前原文", "看看这条", "[Message IDs: current=104 reply_to=4242]", "bothouse send --reply-to"} {
				if !strings.Contains(string(body), want) {
					t.Fatalf("missing %q from DSH ACP wire payload: %s", want, body)
				}
			}
			t.Log("QQ WS -> get_msg -> real Engine -> real DSH adapter -> ACP session/prompt contains author, original, relation and send usage; external ACP peer is synthetic")
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("no DSH ACP prompt captured")
}
