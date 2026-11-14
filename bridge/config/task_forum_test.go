package config

import (
	"github.com/BurntSushi/toml"
	"testing"
)

func TestProjectTaskForumDefaultAndSwitch(t *testing.T) {
	var cfg Config
	_, err := toml.Decode(`[[projects]]
name = "default"
[[projects]]
name = "off"
task_forum = false
[[projects]]
name = "on"
task_forum = true
`, &cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Projects[0].TaskForumEnabled() || cfg.Projects[1].TaskForumEnabled() || !cfg.Projects[2].TaskForumEnabled() {
		t.Fatal("forum default/switch changed")
	}
}
