//go:build agye2e

package antigravity

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// TestE2EMidTurnAfterAnswer replays 2026-11-26 20:34 (discord 1561556710097952888): a person asks
// a question, then asks it again while the model is already writing its answer, so the second
// message reaches the turn through the Stop hook. Before the fix the turn answered it a second
// time and the bridge sent both answers as one reply.
//
//	go test -tags 'no_web agye2e' -run TestE2EMidTurnAfterAnswer ./agent/antigravity -v
//	(real agy; AGY_E2E_BH=<built bothouse>, AGY_E2E_CMD=<agy>, AGY_E2E_WD=<scratch dir>, AGY_E2E_HOME=<home with agy login>, AGY_E2E_MODEL)
func TestE2EMidTurnAfterAnswer(t *testing.T) {
	bh := os.Getenv("AGY_E2E_BH")
	if bh == "" {
		t.Skip("AGY_E2E_BH unset")
	}
	inboxHookExe = func() (string, error) { return bh, nil }
	ag, err := New(map[string]any{"cmd": os.Getenv("AGY_E2E_CMD"), "mode": "yolo", "work_dir": os.Getenv("AGY_E2E_WD"), "model": os.Getenv("AGY_E2E_MODEL"), "stream_json": true})
	if err != nil {
		t.Fatal(err)
	}
	ag.(*Agent).SetSessionEnv([]string{"HOME=" + os.Getenv("AGY_E2E_HOME")}) // the test sandbox's HOME has no agy login
	s, err := ag.StartSession(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first := "（最新，回这条）\n（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）\n" +
		"HuggingFace 上一个受限数据集（OpenOneRec/OpenOneRec-RecIF）下载报没授权。我要怎么弄？告诉我网址和要点哪里。直接回答，不要调用任何工具。"
	again := "[bothouse sender_id=1 sender_name=\"user\" platform=discord]\n（最新，回这条）\n" +
		"（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）\n给我网址和操作流程"
	if err := s.Send(first, "m1", nil, nil); err != nil {
		t.Fatal(err)
	}
	var final string
	sent := false
	for ev := range s.Events() {
		switch ev.Type {
		case core.EventText:
			final += ev.Content
			// The model is already writing: its model call began before this message, so the
			// message reaches it at Stop, as in the incident.
			if !sent && strings.TrimSpace(final) != "" {
				sent = true
				if err := s.(core.MidTurnSender).SendMidTurn(again, "m2", nil, nil); err != nil {
					t.Fatalf("SendMidTurn: %v", err)
				}
			}
		case core.EventResult:
			final += ev.Content
			n := strings.Count(final, "huggingface.co/settings/tokens")
			t.Logf("FINAL (%d runes, settings/tokens x%d):\n%s", len([]rune(final)), n, final)
			if n > 1 {
				t.Fatalf("the turn answered the same question twice in one reply")
			}
			return
		case core.EventError:
			t.Fatal(ev.Error)
		}
	}
}
