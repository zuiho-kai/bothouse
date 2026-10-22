package core

import (
	"os/exec"
	"strings"
	"testing"
)

func TestModelSwitchPromptShellQuotesExecutable(t *testing.T) {
	path := "/tmp/bot's tools/$(false)/bothouse"
	prompt := modelSwitchPromptForPath(path)
	start := strings.Index(prompt, "Run "+string(rune(96))) + len("Run ") + 1
	end := strings.Index(prompt[start:], string(rune(96))) + start
	command := prompt[start:end]
	// Parsing the documented command must yield the literal binary path and args.
	out, err := exec.Command("sh", "-c", "set -- "+command+"; printf '%s\n' "+string(rune(34))+"$@"+string(rune(34))).Output()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(out), path+"\nmodel\nlist\n--json\n"; got != want {
		t.Fatalf("shell argv = %q, want %q", got, want)
	}
}

func TestModelSwitchPromptPreservesUserContentAndNativeInstructions(t *testing.T) {
	const user = "请把模型换成列表里的另一个。"
	got := PrependModelSwitchInstructions(user)
	if !strings.HasSuffix(got, user) || strings.Count(got, "# Switching your own model") != 1 {
		t.Fatalf("bad prompt: %s", got)
	}
	if !strings.Contains(AgentSystemPrompt(), modelSwitchPromptForExe()) {
		t.Fatal("native system prompt lost the shared skill")
	}
}
