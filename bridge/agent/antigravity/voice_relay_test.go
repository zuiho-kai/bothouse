package antigravity

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

func TestVoiceRelayAgyProcess(t *testing.T) {
	if os.Getenv("CONEST_VOICE_AGY_TEST") != "1" {
		return
	}
	log := os.Getenv("CONEST_VOICE_TEST_LOG")
	_ = os.WriteFile(log, []byte(os.Getenv("CC_PROJECT")+"|"+os.Getenv("CC_SESSION_KEY")+"\n"+strings.Join(os.Args, " ")), 0600)
	id := "voice-id"
	if os.Getenv("CONEST_VOICE_WRONG_ID") == "1" {
		id = "different"
	}
	raw, _ := json.Marshal(map[string]any{"event": "init", "conversation_id": id})
	fmt.Println(string(raw))
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		fmt.Printf("{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\",\"conversation_id\":%q,\"response\":\"answer\"}}\n", id)
	}
	os.Exit(0)
}

func TestVoiceRelayAgy_IdentityBeforeSendAndPerStartEnvironment(t *testing.T) {
	for _, tc := range []struct {
		id    string
		wrong bool
	}{{"", false}, {"voice-id", false}, {"voice-id", true}} {
		t.Run(fmt.Sprintf("%s-%v", tc.id, tc.wrong), func(t *testing.T) {
			log := filepath.Join(t.TempDir(), "child")
			a := &Agent{cmd: os.Args[0], cliExtraArgs: []string{"-test.run=^TestVoiceRelayAgyProcess$", "--"}, workDir: t.TempDir(), mode: "default", streamJSON: true, activeIdx: -1,
				configEnv: []string{"CONEST_VOICE_AGY_TEST=1", "CONEST_VOICE_TEST_LOG=" + log}, sessionEnv: []string{"CC_PROJECT=wrong", "CC_SESSION_KEY=wrong:channel"}}
			if tc.wrong {
				a.configEnv = append(a.configEnv, "CONEST_VOICE_WRONG_ID=1")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			s, err := a.StartVoiceRelay(ctx, tc.id, []string{"CC_PROJECT=target", "CC_SESSION_KEY=test:voice"})
			if tc.wrong {
				if err == nil {
					_ = s.Close()
					t.Fatal("wrong native init accepted")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if s.CurrentSessionID() != "voice-id" {
					t.Fatal("init not awaited")
				}
				_ = s.Close()
			}
			data, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(string(data), "target|test:voice\n") {
				t.Fatal("wrong environment")
			}
			if tc.id != "" && !strings.Contains(string(data), "--conversation voice-id") {
				t.Fatal("missing native resume flag")
			}
			if a.sessionEnv[0] != "CC_PROJECT=wrong" {
				t.Fatal("shared environment changed")
			}
		})
	}
	a := &Agent{}
	if _, err := a.StartVoiceRelay(context.Background(), "", nil); err == nil {
		t.Fatal("legacy transport accepted")
	}
	a.streamJSON = true
	if _, err := a.StartVoiceRelay(context.Background(), core.ContinueSession, nil); err == nil {
		t.Fatal("ambiguous continue accepted")
	}
}
