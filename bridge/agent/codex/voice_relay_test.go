package codex

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestVoiceRelayCodexFreshAndResumeStrictTerminal(t *testing.T) {
	for _, id := range []string{"", inputThreadID} {
		for _, scenario := range []string{"ok", "early", "failed", "interrupted", "other-thread", "other-turn"} {
			t.Run(id+scenario, func(t *testing.T) {
				a, log := fakeAppServerAgent(t, scenario)
				a.sessionEnv = []string{"CC_SESSION_KEY=work", "RETAINED=ok"}
				s, err := a.StartVoiceRelay(context.Background(), id, []string{"CC_SESSION_KEY=voice"})
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				as := s.(*appServerSession)
				if getenvFromList(as.extraEnv, "CC_SESSION_KEY") != "voice" || a.sessionEnv[0] != "CC_SESSION_KEY=work" {
					t.Fatal("shared channel environment mutated")
				}
				if err := as.SendResumed("hello", "r", nil, nil, as.CurrentSessionID()); err != nil {
					t.Fatal(err)
				}
				ev, _ := inputReadTerminal(t, s)
				want := core.EventError
				if scenario == "ok" || scenario == "early" {
					want = core.EventResult
				}
				if ev.Type != want {
					t.Fatalf("terminal=%+v want=%v", ev, want)
				}
				b, _ := os.ReadFile(log)
				if id != "" && strings.Contains(string(b), "thread/start") {
					t.Fatal("resume fell back to a new thread")
				}
			})
		}
	}
}

func TestVoiceRelayCodexRefusesLostOrChangedIdentity(t *testing.T) {
	a, _ := fakeAppServerAgent(t, "resume-mismatch")
	for _, id := range []string{inputThreadID, "missing", core.ContinueSession} {
		if s, err := a.StartVoiceRelay(context.Background(), id, nil); err == nil {
			s.Close()
			t.Fatalf("accepted %q", id)
		}
	}
}
