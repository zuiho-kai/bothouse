package config

import (
	"testing"

	"github.com/BurntSushi/toml"
)

// team_board: unset = on for the lead, so an upgraded config without the line gets the
// pinned board; team_board = false keeps it off. Same pattern as team_workspaces.
func TestTeamBoardEnabledDefaultsOn(t *testing.T) {
	for raw, want := range map[string]bool{
		``:                   true,
		`team_board = true`:  true,
		`team_board = false`: false,
	} {
		var p ProjectConfig
		if _, err := toml.Decode(raw, &p); err != nil {
			t.Fatalf("decode %q: %v", raw, err)
		}
		if got := p.TeamBoardEnabled(); got != want {
			t.Errorf("%q: TeamBoardEnabled() = %v, want %v", raw, got, want)
		}
	}
}
