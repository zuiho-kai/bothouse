package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Only the external server is simulated: Engine ingress, ACP subprocess and
// JSON-RPC transport, footer, threshold, durable history and handoff are real.
func TestContextUsageACPProcess(t *testing.T) {
	record := os.Getenv("ACP_CONTEXT_RECORD")
	if record == "" {
		t.Skip("helper process")
	}
	f, err := os.OpenFile(record, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		os.Exit(2)
	}
	defer f.Close()
	dec, enc := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	for {
		var req struct {
			ID     json.RawMessage
			Method string
			Params struct {
				SessionID string
				Prompt    []struct{ Type, Text string }
			}
		}
		if dec.Decode(&req) != nil {
			os.Exit(0)
		}
		if len(req.ID) == 0 {
			continue
		}
		_, _ = fmt.Fprintln(f, req.Method, req.Params.SessionID)
		var result any = map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": true, "sessionCapabilities": map[string]any{"close": map[string]any{}}}}
		case "session/new":
			b, _ := os.ReadFile(record + ".new")
			n, _ := strconv.Atoi(string(b))
			n++
			_ = os.WriteFile(record+".new", []byte(strconv.Itoa(n)), 0o600)
			result = map[string]any{"sessionId": fmt.Sprintf("ctx-native-%d", n)}
		case "session/prompt":
			b, _ := os.ReadFile(record + ".turns")
			n, _ := strconv.Atoi(string(b))
			n++
			_ = os.WriteFile(record+".turns", []byte(strconv.Itoa(n)), 0o600)
			used, text := 11418, "stored original-context"
			if n == 2 {
				// Existing window cap: 70% of the actual 262000-token window.
				used, text = 262000*7/10, "reached existing threshold"
			}
			if n == 3 {
				text = "missing conversation handoff"
				for _, block := range req.Params.Prompt {
					if strings.Contains(block.Text, "original-context") && strings.Contains(block.Text, "reached existing threshold") {
						text = "carried original-context"
					}
				}
			}
			_ = enc.Encode(inputUpdate(req.Params.SessionID, text))
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
				"sessionId": req.Params.SessionID, "update": map[string]any{"sessionUpdate": "usage_update", "used": used, "size": 262000},
			}})
			result = map[string]any{"stopReason": "end_turn"}
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
}

func TestCUJ_ACP1_ContextFooterAndAutomaticRotationPreserveHistory(t *testing.T) {
	record := filepath.Join(t.TempDir(), "requests.log")
	a := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestContextUsageACPProcess$"}, workDir: t.TempDir(), extraEnv: []string{"ACP_CONTEXT_RECORD=" + record}}
	p := &ordinaryLoadPlatform{replies: make(chan string, 64)}
	e := core.NewEngine("context-rotation", a, []core.Platform{p}, filepath.Join(t.TempDir(), "sessions.json"), core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	// Existing default max; actual reported window caps it at 183400.
	e.SetColdCacheFresh(true, time.Hour, 80000, 300000)
	e.SetReplyFooterEnabled(true)
	e.SetShowContextIndicator(true)
	key := "test:context:u1"
	send := func(id, text string) {
		e.ReceiveMessage(p, &core.Message{Platform: p.Name(), SessionKey: key, MessageID: id, UserID: "u1", Content: text, ReplyCtx: "ctx", Mentioned: true})
	}
	answer := func(want, ctx string) {
		t.Helper()
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case got := <-p.replies:
				if strings.Contains(got, want) {
					if ctx != "" && !strings.Contains(got, ctx) {
						t.Fatalf("reply lacks authoritative context %q: %s", ctx, got)
					}
					t.Logf("platform reply: %s", got)
					return
				}
			case <-timer.C:
				t.Fatalf("no reply containing %q", want)
			}
		}
	}
	waitClosed := func(count int) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			b, _ := os.ReadFile(record)
			if strings.Count(string(b), "session/close") == count {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("ACP turn did not close")
	}
	send("first", "remember original-context")
	answer("stored original-context", "[ctx: ~4%]")
	waitClosed(1)
	send("second", "continue until existing threshold")
	answer("reached existing threshold", "[ctx: ~70%]")
	waitClosed(2)
	send("third", "carry on")
	answer("carried original-context", "[ctx: ~4%]")
	waitClosed(3)
	send("history", "/history")
	answer("remember original-context", "")
	b, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(b), "session/new ") != 2 || strings.Count(string(b), "session/load ctx-native-1") != 1 || !strings.Contains(string(b), "session/prompt ctx-native-2") {
		t.Fatalf("expected old -> resume old -> threshold -> new, got:\n%s", b)
	}
	t.Logf("simulated occupancy, real ingress: 11418/262000 -> 183400/262000; ctx-native-1 -> ctx-native-2, no /new; history retained\n%s", b)
}

var _ core.Platform = (*ordinaryLoadPlatform)(nil)
