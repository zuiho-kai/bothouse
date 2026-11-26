package config

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

// TeamRemoteConfig selects which roles use one Linux development directory.
type TeamRemoteConfig struct {
	Enabled    bool     `toml:"enabled" json:"enabled"`
	RemoteHost string   `toml:"remote_host" json:"remote_host"`
	RelayHost  string   `toml:"relay_host,omitempty" json:"relay_host"`
	WorkDir    string   `toml:"work_dir" json:"work_dir"`
	SSHArgs    []string `toml:"ssh_args,omitempty" json:"ssh_args,omitempty"`
	Projects   []string `toml:"projects,omitempty" json:"projects,omitempty"`
}

func (r TeamRemoteConfig) validate(projects []ProjectConfig) error {
	if r.Enabled && (strings.TrimSpace(r.RemoteHost) == "" || strings.TrimSpace(r.WorkDir) == "") {
		return fmt.Errorf("team_remote requires remote_host and work_dir when enabled")
	}
	for _, p := range projects {
		if r.AppliesTo(p) && p.RunAsUser != "" {
			return fmt.Errorf("team_remote: project %q uses local run_as_user", p.Name)
		}
	}
	return nil
}

func (r TeamRemoteConfig) AppliesTo(p ProjectConfig) bool {
	return r.Enabled && core.SupportsRemoteDevelopment(p.Agent.Type) && slices.Contains(r.Projects, p.Name)
}

// Apply supplies runtime options while preserving the project's own settings on disk.
func (r TeamRemoteConfig) Apply(p ProjectConfig) ProjectConfig {
	if !r.AppliesTo(p) {
		return p
	}
	opts := make(map[string]any, len(p.Agent.Options)+4)
	maps.Copy(opts, p.Agent.Options)
	opts["remote_host"] = strings.TrimSpace(r.RemoteHost)
	opts["relay_host"] = strings.TrimSpace(r.RelayHost)
	opts["work_dir"] = strings.TrimSpace(r.WorkDir)
	opts["ssh_args"] = slices.Clone(r.SSHArgs)
	p.Agent.Options = opts
	return p
}
