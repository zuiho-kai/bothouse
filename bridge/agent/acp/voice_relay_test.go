package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// This helper is an in-process-test executable speaking synthetic ACP. It
// never invokes an actual model or reads native conversations.
func TestVoiceRelayACPProcess(t *testing.T) {
	if os.Getenv("CONEST_VOICE_ACP_TEST") != "1" {
		return
	}
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		var r inputRPCRequest
		if json.Unmarshal(scan.Bytes(), &r) != nil {
			os.Exit(2)
		}
		f, err := os.OpenFile(os.Getenv("CONEST_VOICE_TEST_LOG"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(2)
		}
		fmt.Fprintln(f, r.Method+"|"+os.Getenv("CC_PROJECT")+"|"+os.Getenv("CC_SESSION_KEY"))
		_ = f.Close()
		var result any = map[string]any{}
		switch r.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": true}}
			if os.Getenv("CONEST_VOICE_TEST_CLOSE") == "1" {
				result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"sessionCapabilities": map[string]any{"close": map[string]any{}}}}
			}
		case "session/new":
			result = map[string]any{"sessionId": "voice-id"}
		case "session/prompt":
			_ = enc.Encode(inputUpdate(r.Params.SessionID, "synthetic public fragment"))
			result = map[string]any{"stopReason": os.Getenv("CONEST_VOICE_TEST_STOP")}
		case "session/load":
			if os.Getenv("CONEST_VOICE_TEST_FAIL") == "1" {
				_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": r.ID, "error": map[string]any{"code": -32000, "message": "synthetic rejection"}})
				continue
			}
			result = map[string]any{"sessionId": r.Params.SessionID}
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": r.ID, "result": result})
	}
	os.Exit(0)
}

func TestVoiceRelayACP_CloseCapabilityBeforeKill(t *testing.T) {
	for _, supported := range []string{"0", "1"} {
		log := filepath.Join(t.TempDir(), "calls")
		a := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestVoiceRelayACPProcess$"}, workDir: t.TempDir(),
			extraEnv: []string{"CONEST_VOICE_ACP_TEST=1", "CONEST_VOICE_TEST_LOG=" + log, "CONEST_VOICE_TEST_STOP=end_turn", "CONEST_VOICE_TEST_CLOSE=" + supported}}
		s, err := a.StartVoiceRelay(context.Background(), "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Send("synthetic voice", "test", nil, nil); err != nil {
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(log)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "session/close|") != (supported == "1") {
			t.Fatalf("close capability ignored: %s", data)
		}
	}
}

func TestVoiceRelayACP_EnvironmentAndStrictRestore(t *testing.T) {
	for _, id := range []string{"", "voice-id", "rejected-id"} {
		t.Run("id="+id, func(t *testing.T) {
			log := filepath.Join(t.TempDir(), "calls")
			a := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestVoiceRelayACPProcess$"}, workDir: t.TempDir(),
				extraEnv:   []string{"CONEST_VOICE_ACP_TEST=1", "CONEST_VOICE_TEST_LOG=" + log},
				sessionEnv: []string{"CC_PROJECT=wrong", "CC_SESSION_KEY=wrong:channel"}}
			if id == "rejected-id" {
				a.extraEnv = append(a.extraEnv, "CONEST_VOICE_TEST_FAIL=1")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			s, err := a.StartVoiceRelay(ctx, id, []string{"CC_PROJECT=target", "CC_SESSION_KEY=test:voice"})
			if id == "rejected-id" {
				if err == nil {
					_ = s.Close()
					t.Fatal("failed load became successful")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if s.CurrentSessionID() != "voice-id" {
					t.Fatal("wrong identity")
				}
				_ = s.Close()
			}
			data, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
				if !strings.HasSuffix(line, "|target|test:voice") {
					t.Fatal("environment leaked", line)
				}
			}
			if id != "" && strings.Contains(string(data), "session/new") {
				t.Fatal("restore fell back to new")
			}
			if a.sessionEnv[0] != "CC_PROJECT=wrong" {
				t.Fatal("shared session env changed")
			}
			if _, err = a.StartVoiceRelay(ctx, core.ContinueSession, nil); err == nil {
				t.Fatal("ambiguous resume accepted")
			}
		})
	}
}

// Exercise the native protocol, both the collector's strict path and the
// ordinary Send API exposed by a voice session. No real model is invoked.
func TestVoiceRelayACP_OnlyNormalCompletion(t *testing.T) {
	for _, id := range []string{"", "voice-id"} {
		for _, strict := range []bool{false, true} {
			for _, stop := range []string{"end_turn", "max_tokens", "cancelled", "refusal", "max_turn_requests", "", "future_reason"} {
				t.Run(fmt.Sprintf("id=%s/strict=%v/stop=%s", id, strict, stop), func(t *testing.T) {
					a := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestVoiceRelayACPProcess$"}, workDir: t.TempDir(),
						extraEnv: []string{"CONEST_VOICE_ACP_TEST=1", "CONEST_VOICE_TEST_LOG=" + filepath.Join(t.TempDir(), "calls"), "CONEST_VOICE_TEST_STOP=" + stop}}
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					s, err := a.StartVoiceRelay(ctx, id, nil)
					if err != nil {
						t.Fatal(err)
					}
					defer s.Close()
					if strict {
						ss := s.(core.StrictResumeSession)
						if err = ss.PrepareResumed(s.CurrentSessionID()); err != nil {
							t.Fatal(err)
						}
						err = ss.SendResumed("test prompt", "test-request", nil, nil, s.CurrentSessionID())
					} else {
						err = s.Send("test prompt", "test-request", nil, nil)
					}
					wantOK := stop == "end_turn"
					if (err == nil) != wantOK {
						t.Errorf("Send error=%v, want normal completion=%v", err, wantOK)
					}
					complete := false
					for len(s.(*acpSession).events) > 0 {
						ev := <-s.Events()
						if ev.Type == core.EventResult && ev.Done {
							complete = true
						}
					}
					if complete != wantOK {
						t.Fatalf("completed=%v, stop=%q", complete, stop)
					}
				})
			}
		}
	}
}
