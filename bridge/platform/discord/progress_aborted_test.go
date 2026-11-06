package discord

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #1129: the aborted card says 已打断 and never sends the reader to an error in the next message.
func TestDiscordProgressAbortedCard(t *testing.T) {
	for _, lang := range []string{"zh", "en"} {
		title, _, footer := discordProgressStateMeta(core.ProgressCardStateAborted, lang, "CC")
		if lang == "zh" && (!strings.Contains(title, "已打断") || strings.Contains(title, "失败")) {
			t.Fatalf("zh title = %q", title)
		}
		for _, bad := range []string{"失败", "错误", "下一条", "failed", "next message", "details"} {
			if strings.Contains(footer, bad) {
				t.Fatalf("%s footer %q contains %q", lang, footer, bad)
			}
		}
	}
}
