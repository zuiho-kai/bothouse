package config

import (
	"errors"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestRemoveProjectReasons(t *testing.T) {
	writeTestConfig(t, `
[[projects]]
name = "alpha"
[projects.agent]
type = "claudecode"

[[projects]]
name = "beta"
[projects.agent]
type = "claudecode"
`)
	if err := RemoveProject("gamma"); !errors.Is(err, core.ErrProjectNotFound) {
		t.Fatalf("unknown name: err = %v, want ErrProjectNotFound", err)
	}
	if err := RemoveProject("beta"); err != nil {
		t.Fatalf("remove beta: %v", err)
	}
	cfg := readTestConfig(t)
	if len(cfg.Projects) != 1 || cfg.Projects[0].Name != "alpha" {
		t.Fatalf("projects after removing beta = %+v", cfg.Projects)
	}
	if err := RemoveProject("alpha"); !errors.Is(err, core.ErrLastProject) {
		t.Fatalf("last project: err = %v, want ErrLastProject", err)
	}
	if cfg := readTestConfig(t); len(cfg.Projects) != 1 {
		t.Fatal("the last project was removed")
	}
}
