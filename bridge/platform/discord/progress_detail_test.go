package discord

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressCardDetailOption(t *testing.T) {
	cases := []struct {
		opts map[string]any
		want string
	}{
		{map[string]any{"token": "x"}, "brief"},
		{map[string]any{"token": "x", "progress_card_detail": "full"}, "full"},
		{map[string]any{"token": "x", "progress_card_detail": "bogus"}, "brief"},
	}
	for _, c := range cases {
		pl, err := New(c.opts)
		if err != nil {
			t.Fatalf("New(%v): %v", c.opts, err)
		}
		dp, ok := pl.(core.ProgressCardDetailProvider)
		if !ok {
			t.Fatalf("discord must implement ProgressCardDetailProvider")
		}
		if got := dp.ProgressCardDetail(); got != c.want {
			t.Fatalf("progress_card_detail=%v → %q, want %q", c.opts["progress_card_detail"], got, c.want)
		}
	}
}

func TestDiscordProgressStoppedCardIsNeutral(t *testing.T) {
	for lang, want := range map[string]string{"zh": "cc · 已停止", "en": "cc · Stopped", "ja": "cc · 停止", "es": "cc · Detenido"} {
		title, color, footer := discordProgressStateMeta(core.ProgressCardStateStopped, lang, "cc")
		if title != want || color != 0x99AAB5 || footer == "" {
			t.Errorf("%s stopped card = %q %#x %q, want %q in grey with a footer", lang, title, color, footer, want)
		}
	}
}

func TestDiscordHeartbeatLineUsesCardLanguage(t *testing.T) {
	desc := buildDiscordProgressDescription(&core.ProgressCardPayload{
		Lang: "ja", State: core.ProgressCardStateRunning, Steps: 2, ElapsedSec: 75,
		Heartbeat: true, IdleSec: 30, Current: "Bash",
		Items: []core.ProgressCardEntry{{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: `{"command":"make build"}`}},
	})
	for _, want := range []string{"実行中", "経過 1分15秒", "最終イベント 30秒前", "コマンド実行 · make build"} {
		if !strings.Contains(desc, want) {
			t.Errorf("ja card description missing %q:\n%s", want, desc)
		}
	}
}
