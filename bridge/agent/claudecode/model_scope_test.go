package claudecode

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestSessionModelContextOverridesProviderLocally(t *testing.T) {
	bin, err := exec.LookPath("true")
	if err != nil {
		t.Skip("true is unavailable")
	}
	a := &Agent{cmd: bin, workDir: t.TempDir(), model: "configured", reasoningEffort: "medium", providers: []core.ProviderConfig{{Name: "fixture", Model: "provider-default"}}, activeIdx: 0}
	for _, tc := range []struct {
		settings      core.SessionSettings
		model, effort string
	}{
		{core.SessionSettings{Model: "channel-sol", ReasoningEffort: "high"}, "channel-sol", "high"},
		{core.SessionSettings{}, "provider-default", "medium"},
	} {
		s, err := a.StartSession(core.WithSessionSettings(context.Background(), tc.settings), "original")
		if err != nil {
			t.Fatal(err)
		}
		args := strings.Join(s.(*claudeSession).cmd.Args, " |||| ")
		for _, want := range []string{"--model |||| " + tc.model, "--effort |||| " + tc.effort, "--resume |||| original"} {
			if !strings.Contains(args, want) {
				t.Errorf("args %s missing %s", args, want)
			}
		}
		_ = s.Close()
	}
	if a.model != "configured" || a.reasoningEffort != "medium" || a.providers[0].Model != "provider-default" {
		t.Fatal("changed shared defaults")
	}
}
