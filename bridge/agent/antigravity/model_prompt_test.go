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

func TestPreparePromptIncludesTaskLifecycleGuidance(t *testing.T) {
	s := &antigravitySession{workDir: t.TempDir()}
	got, _ := s.preparePrompt("read a file", nil, nil)
	for _, want := range []string{"manage_task", "DONE", "Do not kill", "latest task status"} {
		if !strings.Contains(got, want) {
			t.Errorf("task lifecycle guidance missing %q", want)
		}
	}
}

func TestPreparePromptPreservesPublicProgress(t *testing.T) {
	s := &antigravitySession{workDir: t.TempDir()}
	for _, run := range []string{"fresh", "renewed"} {
		input := "[Public progress channel] cc-connect progress --run " + run + " --seq 1 --kind start\n检查绑定"
		got, _ := s.preparePrompt(input, nil, nil)
		if !strings.HasSuffix(got, input) {
			t.Fatal("public progress instructions lost by stream/print prompt preparation")
		}
	}
}
