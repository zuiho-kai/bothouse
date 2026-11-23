package antigravity

import (
	"strings"
	"testing"
)

// #1903: the task lifecycle and model-control instructions are the Agent's TurnPreamble, sent by
// the engine once per agent context; preparePrompt no longer puts them before every prompt.
func TestTurnPreambleCarriesModelSkillAndLifecycle(t *testing.T) {
	a := &Agent{activeIdx: -1}
	got := a.TurnPreamble()
	for _, want := range []string{"model list --json", "manage_task", "DONE", "Do not kill", "latest task status"} {
		if !strings.Contains(got, want) {
			t.Errorf("preamble missing %q", want)
		}
	}
}

func TestPreparePromptSendsOnlyTheMessage(t *testing.T) {
	s := &antigravitySession{workDir: t.TempDir()}
	for _, input := range []string{"hello", "[Public progress channel] bothouse progress --run fresh --seq 1 --kind start\n检查绑定"} {
		got, files := s.preparePrompt(input, nil, nil)
		if got != input || len(files) != 0 {
			t.Fatalf("preparePrompt(%q) = %q, want the message alone", input, got)
		}
	}
}
