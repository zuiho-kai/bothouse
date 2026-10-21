package claudecode

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestVoiceRelayClaudeStartupEnvironmentIsPerSession(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "capture")
	capture := filepath.Join(dir, "env")
	if err := os.WriteFile(script, []byte(`#!/bin/sh
printf '%s' "$CC_SESSION_KEY" > "$CAPTURE_ENV"
`), 0700); err != nil {
		t.Fatal(err)
	}
	agent, err := New(map[string]any{"work_dir": dir, "cmd": script, "cc_data_dir": dir, "env": map[string]string{"CAPTURE_ENV": capture}})
	if err != nil {
		t.Fatal(err)
	}
	a := agent.(*Agent)
	a.sessionEnv = []string{"CC_SESSION_KEY=work"}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := a.StartVoiceRelay(ctx, "", []string{"CC_SESSION_KEY=voice"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for range s.Events() {
	}
	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != "voice" || a.sessionEnv[0] != "CC_SESSION_KEY=work" {
		t.Fatal("voice environment not isolated")
	}
}

func TestVoiceRelayClaudeOnlyNormalCompletion(t *testing.T) {
	for _, tc := range []struct {
		sub, stop        string
		isError, success bool
	}{
		{"success", "end_turn", false, true}, {"success", "", false, true},
		{"success", "max_tokens", false, false}, {"success", "cancelled", false, false},
		{"error_max_turns", "", false, false}, {"success", "", true, false}, {"", "", false, false},
	} {
		t.Run(tc.sub+tc.stop, func(t *testing.T) {
			s := &claudeSession{ctx: context.Background(), events: make(chan core.Event, 4)}
			s.sessionID.Store("voice")
			s.voiceOnly.Store(true)
			s.handleResult(map[string]any{"subtype": tc.sub, "stop_reason": tc.stop, "is_error": tc.isError, "result": "answer", "session_id": "voice"})
			e := <-s.events
			if (e.Type == core.EventResult) != tc.success {
				t.Fatalf("unexpected terminal %+v", e)
			}
		})
	}
}

func TestVoiceRelayClaudeAPIErrorCannotBecomeSpeech(t *testing.T) {
	s := &claudeSession{ctx: context.Background(), events: make(chan core.Event, 4)}
	s.sessionID.Store("voice")
	s.voiceOnly.Store(true)
	s.armAPIErrorFallback(map[string]any{"error": "rate_limit"})
	if e := <-s.events; e.Type != core.EventError {
		t.Fatalf("API error became success: %+v", e)
	}
	if s.apiErrTimer != nil {
		t.Fatal("voice must not synthesize successful fallback")
	}
}

func TestVoiceRelayClaudeMissingResumeNeverCreates(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := &Agent{workDir: t.TempDir()}
	for _, id := range []string{core.ContinueSession, "missing"} {
		if _, err := a.StartVoiceRelay(context.Background(), id, nil); err == nil {
			t.Fatal("missing resume accepted")
		}
	}
}
