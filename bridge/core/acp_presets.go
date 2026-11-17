package core

import (
	_ "embed"
	"encoding/json"
	"os/exec"
)

// acp_presets.json lists agent CLIs that speak ACP and have no adapter of their own here.
// The setup wizard shows one card per entry, with the launch command filled in. Supporting
// one more CLI is one more entry in that file, no code. Any other ACP agent goes through the
// wizard's "custom agent" card, where the user types the command.
//
//go:embed acp_presets.json
var acpPresetsJSON []byte

type ACPPreset struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Cmd    string `json:"cmd"` // launch command with its arguments, as written into the agent's cmd
	NoteZH string `json:"note_zh,omitempty"`
	NoteEN string `json:"note_en,omitempty"`
	Found  bool   `json:"found"` // the command's executable is on this machine's PATH
}

// ACPPresets returns the entries of acp_presets.json, each marked with whether its command
// can be run on this machine as it stands.
func ACPPresets() []ACPPreset {
	var ps []ACPPreset
	if err := json.Unmarshal(acpPresetsJSON, &ps); err != nil {
		return nil
	}
	for i := range ps {
		if bin, _ := ParseCmdOpts(map[string]any{"cmd": ps[i].Cmd}, ""); bin != "" {
			_, err := exec.LookPath(bin)
			ps[i].Found = err == nil
		}
	}
	return ps
}
