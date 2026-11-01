package claudecode

import (
	"strings"
	"testing"
)

func TestClaudeUsageTerminalFragmentedControlSequence(t *testing.T) {
	raw := "Quick safety check:\r\n❯ No, exit\r\n\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\nEnter to confirm"
	for split := 1; split < len(raw); split++ {
		terminal := newClaudeUsageTerminal()
		terminal.Write([]byte(raw[:split]))
		terminal.Write([]byte(raw[split:]))
		rendered := normalizeClaudeUsageText(terminal.String())
		if !strings.Contains(rendered, "Yes, I trust this folder") {
			t.Fatalf("split %d corrupted screen: %q", split, rendered)
		}
	}
}
