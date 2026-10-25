package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

// #587: a project without team_status_dir that the setup wizard made part of a multi-role team
// gets <data_dir>/team, its wizard name and, for the fallback role, the lead flag; anything set
// in config.toml wins, and a single-role install keeps no team status.
func TestProjectTeamStatus(t *testing.T) {
	dataDir := t.TempDir()
	state := `{"platform":"discord","fallback_role":"lead","team":[{"project":"lead","name":"C酱"},{"project":"sub","name":"小助"}]}`
	if err := os.WriteFile(filepath.Join(dataDir, "conest-setup.json"), []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
	team := filepath.Join(dataDir, "team")
	for _, tc := range []struct {
		name       string
		proj       config.ProjectConfig
		dir, tname string
		inject     bool
	}{
		{"wizard lead", config.ProjectConfig{Name: "lead"}, team, "C酱", true},
		{"wizard sub", config.ProjectConfig{Name: "sub"}, team, "小助", false},
		{"team_name kept", config.ProjectConfig{Name: "sub", TeamName: "Z"}, team, "Z", false},
		{"configured wins", config.ProjectConfig{Name: "sub", TeamStatusDir: "/x", TeamStatusInject: true}, "/x", "", true},
		{"not in team", config.ProjectConfig{Name: "solo"}, "", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir, name, inject := projectTeamStatus(dataDir, tc.proj)
			if dir != tc.dir || name != tc.tname || inject != tc.inject {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)", dir, name, inject, tc.dir, tc.tname, tc.inject)
			}
		})
	}
	if dir, _, _ := projectTeamStatus(t.TempDir(), config.ProjectConfig{Name: "lead"}); dir != "" {
		t.Fatalf("no wizard state: dir = %q, want none", dir)
	}
}
