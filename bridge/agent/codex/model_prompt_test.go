package codex

import (
	"strings"
	"testing"
)

func TestDefaultPreambleIncludesModelSkill(t *testing.T) {
	got := prependCodexPromptPreamble("hello", buildCodexPromptPreamble("", ""))
	if !strings.Contains(got, "model list --json") || !strings.HasSuffix(got, "hello") {
		t.Fatalf("default CLI/app-server preamble missing model skill: %s", got)
	}
}
