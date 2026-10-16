package acp

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Opt-in, isolated synthetic conversation. Does not connect to Discord or use
// production project/session bindings. The CLI uses its existing login.
func TestStrictResumeRealACP(t *testing.T) {
	command := os.Getenv("CONEST_ACP_SMOKE_CMD")
	if command == "" {
		t.Skip("set CONEST_ACP_SMOKE_CMD and CONEST_ACP_SMOKE_ARGS for an isolated live-model check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	cfg := acpSessionConfig{command: command, args: strings.Fields(os.Getenv("CONEST_ACP_SMOKE_ARGS")), workDir: t.TempDir()}
	first, err := newACPSession(ctx, cfg)
	if err != nil {
		t.Fatal("initial ACP session failed", err)
	}
	closed := false
	defer func() {
		if !closed {
			_ = first.Close()
		}
	}()
	marker := "CoNest-" + time.Now().Format("150405.000000")
	request := func(s *acpSession, prompt string, strict bool) string {
		t.Helper()
		done := make(chan error, 1)
		go func() {
			if strict {
				done <- s.SendResumed(prompt, "smoke", nil, nil, cfg.resumeSessionID)
			} else {
				done <- s.Send(prompt, "smoke", nil, nil)
			}
		}()
		var answer strings.Builder
		for {
			select {
			case <-ctx.Done():
				t.Fatal("live ACP check timed out")
				return ""
			case event := <-s.Events():
				if event.Type == core.EventText {
					answer.WriteString(event.Content)
				}
				if event.Type == core.EventPermissionRequest {
					t.Fatal("synthetic conversation unexpectedly requested a tool")
				}
				if event.Type == core.EventError {
					t.Fatal("live ACP returned an error (details intentionally omitted)")
				}
			case err := <-done:
				if err != nil {
					t.Fatal("live ACP prompt failed (details intentionally omitted)")
				}
				for len(s.events) > 0 {
					ev := <-s.events
					if ev.Type == core.EventText {
						answer.WriteString(ev.Content)
					}
				}
				return answer.String()
			}
		}
	}
	seed := request(first, "这是独立语音验收。记住测试词："+marker+"。只回复这个测试词，不要使用工具、文件或网络。", false)
	if !strings.Contains(seed, marker) {
		t.Fatal("seed answer did not acknowledge synthetic marker")
	}
	cfg.resumeSessionID = first.CurrentSessionID()
	_ = first.Close()
	closed = true
	cfg.strictResume = true
	resumed, err := newACPSession(ctx, cfg)
	if err != nil {
		t.Fatal("strict live session/load failed", err)
	}
	defer resumed.Close()
	if err = resumed.PrepareResumed(cfg.resumeSessionID); err != nil {
		t.Fatal(err)
	}
	answer := request(resumed, "我上一轮让你记住的测试词是什么？只回复测试词，不要使用工具。", true)
	if !strings.Contains(answer, marker) {
		t.Fatal("strict resumed answer did not remember the synthetic marker")
	}
	t.Log("isolated seed -> process closed -> strict load -> remembered marker; original ID preserved")
}
