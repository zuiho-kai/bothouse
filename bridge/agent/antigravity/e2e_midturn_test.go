//go:build agye2e

package antigravity

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// go test -tags 'no_web agye2e' -run TestE2EMidTurn ./agent/antigravity -v  (real agy, AGY_E2E_BH=<built bh>)
func TestE2EMidTurn(t *testing.T) {
	bh := os.Getenv("AGY_E2E_BH")
	if bh == "" {
		t.Skip("AGY_E2E_BH unset")
	}
	inboxHookExe = func() (string, error) { return bh, nil }
	wd := os.Getenv("AGY_E2E_WD")
	ag, err := New(map[string]any{"cmd": "/Users/zuiho/.local/bin/agy", "mode": "yolo", "work_dir": wd, "model": "gemini-3.8-flash-high"})
	if err != nil {
		t.Fatal(err)
	}
	ag.(*Agent).SetSessionEnv([]string{"HOME=" + os.Getenv("AGY_E2E_HOME")})
	if !ag.(*Agent).SupportsMidTurnInput() {
		t.Fatal("no mid-turn")
	}
	s, err := ag.StartSession(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Send("用 shell 跑 `sleep 25 && echo done1`，在前台等它跑完，然后用一句话回答：你现在知道的暗号是什么？没有暗号就说没有。", "m1", nil, nil); err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(10 * time.Second)
		err := s.(core.MidTurnSender).SendMidTurn("补充：暗号是 BANANA42。请在你这一轮的回答里说出暗号。", "m2", nil, nil)
		t.Logf("SendMidTurn err=%v", err)
	}()
	var final string
	for ev := range s.Events() {
		if ev.Type == core.EventText {
			final += ev.Content
		}
		if ev.Type == core.EventResult {
			final += ev.Content
			break
		}
		if ev.Type == core.EventError {
			t.Fatal(ev.Error)
		}
	}
	t.Logf("FINAL: %q", final)
	if !strings.Contains(final, "BANANA42") {
		t.Fatal("injected message not answered in the same turn")
	}
	// After the turn ended, a mid-turn send is refused (core queues it).
	time.Sleep(time.Second)
	if err := s.(core.MidTurnSender).SendMidTurn("太晚", "m3", nil, nil); err == nil {
		t.Fatal("send after end accepted")
	} else {
		t.Logf("after end: %v", err)
	}
}
