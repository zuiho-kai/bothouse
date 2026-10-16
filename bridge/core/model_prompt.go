package core

import (
	_ "embed"
	"os"
	"strings"
)

// ModelSwitchPrompt is the single source of model-control instructions.
//
//go:embed skills/model-switch/SKILL.md
var ModelSwitchPrompt string

func modelSwitchPromptForExe() string {
	exe, err := os.Executable()
	if err != nil || exe == "" {
		return ModelSwitchPrompt
	}
	return modelSwitchPromptForPath(exe)
}

func modelSwitchPromptForPath(exe string) string {
	// Keep spaces and shell metacharacters literal, including embedded apostrophes.
	quoted := "'" + strings.ReplaceAll(exe, "'", "'\"'\"'") + "'"
	return strings.ReplaceAll(ModelSwitchPrompt, "cc-connect model", quoted+" model")
}

// PrependModelSwitchInstructions supplies tool instructions to adapters without
// native system-prompt injection. Send on each turn so resumed CLI sessions and
// workspace changes do not depend on instruction-file discovery or old history.
func PrependModelSwitchInstructions(prompt string) string {
	return "[cc-connect model-control instructions]\n" + modelSwitchPromptForExe() +
		"\n[/cc-connect model-control instructions]\n\n" + prompt
}
