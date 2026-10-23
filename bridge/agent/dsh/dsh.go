// Package dsh integrates DeepSeek Harness (DSH, npm @deepseek-ai/dsh) as a cc-connect agent.
//
// DSH speaks the Agent Client Protocol over stdio when booted with its acp profile
// (`dsh --profile acp`), so this is a thin wrapper over agent/acp, done the same way as
// agent/devin: it registers `type = "dsh"`, fills the default command / args / display
// name, and reports Name() = "dsh" so the wizard, hooks (core.AgentHookCLIs) and the wiki
// tell a DSH role apart from any other ACP agent. Every ACP option (cmd, args, env,
// work_dir, mode, …) can still be set in the project config.
//
// cc-connect does not install, pin or patch DSH: it runs the dsh the user already has,
// with the user's own DSH_HOME (login, models, settings).
package dsh

import (
	"strings"

	"github.com/chenhg5/cc-connect/agent/acp"
	"github.com/chenhg5/cc-connect/core"
)

func init() {
	core.RegisterAgent("dsh", New)
}

// Agent embeds *acp.Agent; only Name() differs.
type Agent struct {
	*acp.Agent
}

// Name is the agent type in config, session keys and logs.
func (a *Agent) Name() string { return "dsh" }

// New builds a DSH agent from project options.
func New(opts map[string]any) (core.Agent, error) {
	a, err := acp.New(applyDSHDefaults(opts))
	if err != nil {
		return nil, err
	}
	base, ok := a.(*acp.Agent)
	if !ok {
		return a, nil
	}
	return &Agent{Agent: base}, nil
}

// applyDSHDefaults fills cmd "dsh", args ["--profile", "acp"] (dsh --help: the profile under
// $DSH_HOME/profiles to boot; acp is DSH's shipped ACP profile) and display name "DSH" when unset.
func applyDSHDefaults(opts map[string]any) map[string]any {
	if opts == nil {
		opts = make(map[string]any)
	}
	cmd, _ := opts["cmd"].(string)
	command, _ := opts["command"].(string)
	if strings.TrimSpace(cmd) == "" && strings.TrimSpace(command) == "" {
		opts["cmd"] = "dsh"
	}
	if _, ok := opts["args"]; !ok {
		opts["args"] = []string{"--profile", "acp"}
	}
	if s, _ := opts["display_name"].(string); strings.TrimSpace(s) == "" {
		opts["display_name"] = "DSH"
	}
	return opts
}

// SetSessionEnv preserves the session across DSH's subprocess KEY/TOKEN filter.
func (a *Agent) SetSessionEnv(env []string) {
	a.Agent.SetSessionEnv(dshSessionEnv(env))
}

func dshSessionEnv(env []string) []string {
	copied := append([]string(nil), env...)
	for _, value := range env {
		if strings.HasPrefix(value, "CC_SESSION_KEY=") {
			copied = core.MergeEnv(copied, []string{"CC_SESSION=" + strings.TrimPrefix(value, "CC_SESSION_KEY=")})
			break
		}
	}
	return copied
}
