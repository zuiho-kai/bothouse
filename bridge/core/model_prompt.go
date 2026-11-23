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
	return strings.ReplaceAll(ModelSwitchPrompt, "bothouse model", quoted+" model")
}

// ModelSwitchInstructions is the model-control block for adapters without native
// system-prompt injection; they hand it to the engine as their TurnPreamble, which
// sends it once per agent context (inject.go, #1903).
func ModelSwitchInstructions() string {
	return modelControlHead + "\n" + modelSwitchPromptForExe() + "\n" + modelControlEnd
}

// PrependModelSwitchInstructions puts ModelSwitchInstructions before prompt (codex: its
// once-per-process preamble).
func PrependModelSwitchInstructions(prompt string) string {
	return ModelSwitchInstructions() + "\n\n" + prompt
}

// Markers of the block above; handoffs strip it from old user turns.
const (
	modelControlHead = "[bothouse model-control instructions]"
	modelControlEnd  = "[/bothouse model-control instructions]"
)
