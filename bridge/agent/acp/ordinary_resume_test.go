package acp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// The ordinary Engine ingress must restore a loadSession-only ACP server whose
// standard load response is {}. The helper uses a real subprocess/transport,
// with only the external ACP server and chat platform replaced.
func TestOrdinaryLoadACPProcess(t *testing.T) {
	record := os.Getenv("ACP_ORDINARY_LOAD_RECORD")
	if record == "" {
		t.Skip("helper process")
	}
	f, err := os.OpenFile(record, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		os.Exit(2)
	}
	dec, enc := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	loaded := false
	for {
		var req inputRPCRequest
		if dec.Decode(&req) != nil {
			os.Exit(0)
		}
		if len(req.ID) == 0 {
			continue
		}
		_, _ = f.WriteString(req.Method + " " + req.Params.SessionID + "\n")
		var result any = map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": true, "sessionCapabilities": map[string]any{"close": map[string]any{}}}}
		case "session/new":
			result = map[string]any{"sessionId": "ordinary-native"}
		case "session/load":
			loaded = req.Params.SessionID == "ordinary-native"
			// Same replay volume as TestStrictLoadNeverCreatesNewSession, above
			// the adapter's event buffer: ordinary restoration must not buffer it.
			for i := 0; i < 160; i++ {
				_ = enc.Encode(inputUpdate(req.Params.SessionID, "old history"))
			}
		case "session/prompt":
			text := "stored"
			if loaded {
				memory, _ := os.ReadFile(record + ".memory")
				text = "remembered " + string(memory)
			} else {
				_ = os.WriteFile(record+".memory", []byte("original-context"), 0o600)
			}
			_ = enc.Encode(inputUpdate(req.Params.SessionID, text))
			result = map[string]any{"stopReason": "end_turn"}
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
}

type ordinaryLoadPlatform struct{ replies chan string }

func (*ordinaryLoadPlatform) Name() string                    { return "test" }
func (*ordinaryLoadPlatform) Start(core.MessageHandler) error { return nil }
func (p *ordinaryLoadPlatform) Reply(_ context.Context, _ any, s string) error {
	p.replies <- s
	return nil
}
func (p *ordinaryLoadPlatform) Send(ctx context.Context, r any, s string) error {
	return p.Reply(ctx, r, s)
}
func (*ordinaryLoadPlatform) Stop() error { return nil }

func TestOrdinaryLoad_TwoMessagesResumeAfterTurnClose(t *testing.T) {
	record := filepath.Join(t.TempDir(), "requests.log")
	agent := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestOrdinaryLoadACPProcess$"}, workDir: t.TempDir(), extraEnv: []string{"ACP_ORDINARY_LOAD_RECORD=" + record}}
	p := &ordinaryLoadPlatform{replies: make(chan string, 32)}
	e := core.NewEngine("ordinary-load", agent, []core.Platform{p}, filepath.Join(t.TempDir(), "sessions.json"), core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:ordinary:u1"
	send := func(id, text string) {
		e.ReceiveMessage(p, &core.Message{Platform: p.Name(), SessionKey: key, MessageID: id, UserID: "u1", Content: text, ReplyCtx: "ctx", Mentioned: true})
	}
	answer := func(want string) {
		t.Helper()
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case got := <-p.replies:
				if strings.Contains(got, want) {
					return
				}
				if strings.Contains(got, "stored") {
					t.Fatalf("ordinary resume started a new conversation: %s", got)
				}
			case <-timer.C:
				t.Fatalf("no ordinary chat answer containing %q", want)
			}
		}
	}
	// Observe the durable-close RPC before sending the next ordinary message;
	// the Engine must then wait for actual process exit and restore the same ID.
	waitClosed := func(count int) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			b, _ := os.ReadFile(record)
			if strings.Count(string(b), "session/close ordinary-native") == count {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("ordinary turn did not close its ACP process")
	}
	send("first", "remember original-context")
	answer("stored")
	waitClosed(1)
	send("second", "what did I ask you to remember?")
	answer("remembered original-context")
	waitClosed(2)
	b, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(b), "session/new ") != 1 || strings.Count(string(b), "session/load ordinary-native") != 1 {
		t.Fatalf("ordinary starts silently replaced the native conversation:\n%s", b)
	}
	t.Logf("ordinary ingress: new -> prompt -> close -> load {} -> remembered original-context -> close\n%s", b)
}
