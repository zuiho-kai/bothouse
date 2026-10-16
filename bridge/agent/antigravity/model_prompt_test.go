package antigravity

import (
	"strings"
	"testing"
)

func TestPreparePromptIncludesModelSkill(t *testing.T) {
	s := &antigravitySession{workDir: t.TempDir()}
	got, files := s.preparePrompt("hello", nil, nil)
	if !strings.Contains(got, "model list --json") || !strings.HasSuffix(got, "hello") || len(files) != 0 {
		t.Fatalf("default stream/print prompt missing model skill: %s", got)
	}
}
