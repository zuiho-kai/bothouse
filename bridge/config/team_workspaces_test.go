package config

import (
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

// team_workspaces: unset = on (user 2026-10-24 00:50「默认给我们频道建立工作区1」); false opts out.
func TestTeamWorkspacesEnabledDefaultsOn(t *testing.T) {
	for raw, want := range map[string]bool{
		``:                        true,
		`team_workspaces = true`:  true,
		`team_workspaces = false`: false,
	} {
		var p ProjectConfig
		if _, err := toml.Decode(raw, &p); err != nil {
			t.Fatalf("decode %q: %v", raw, err)
		}
		if got := p.TeamWorkspacesEnabled(); got != want {
			t.Errorf("%q: TeamWorkspacesEnabled() = %v, want %v", raw, got, want)
		}
	}
}

// dispatch_mode: solo / team / mixed, empty = mixed in the engine; anything else is rejected.
func TestDispatchModeValidated(t *testing.T) {
	for mode, ok := range map[string]bool{"": true, "solo": true, "team": true, "mixed": true, "hybrid": false} {
		c := &Config{Projects: []ProjectConfig{{Name: "p", Agent: AgentConfig{Type: "claudecode"}, DispatchMode: mode}}}
		err := c.validate()
		if got := err == nil || !strings.Contains(err.Error(), "dispatch_mode"); got != ok {
			t.Errorf("dispatch_mode %q: err = %v", mode, err)
		}
	}
}
