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
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/agent/acp"
	"github.com/chenhg5/cc-connect/core"
)

func init() {
	core.RegisterAgent("dsh", New)
}

// Agent embeds *acp.Agent; Name() differs, and it reads DSH's session logs
// (handoff.go).
type Agent struct {
	*acp.Agent
	home string // DSH_HOME, where the session logs are
}

// Name is the agent type in config, session keys and logs.
func (a *Agent) Name() string { return "dsh" }

// New builds a DSH agent from project options.
func New(opts map[string]any) (core.Agent, error) {
	opts = applyDSHDefaults(opts)
	opts = withNoAutoCompact(opts)
	a, err := acp.New(opts)
	if err != nil {
		return nil, err
	}
	base, ok := a.(*acp.Agent)
	if !ok {
		return a, nil
	}
	return &Agent{Agent: base, home: defaultDSHHome(opts)}, nil
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

// noAutoCompactPatch turns DSH's automatic compaction off (compaction-basic README:
// "auto: false" = manual-only, no auto condensation and no overflow recovery). A session
// that grows large gets a fresh context with a handoff from the bridge instead
// (core.freshOnContextSize); /compact still works.
const noAutoCompactPatch = "# written by bothouse: no in-place auto compaction, the bridge starts a fresh session instead\n" +
	"- id: compaction-basic\n  config:\n    auto: false\n"

// withNoAutoCompact writes noAutoCompactPatch under the bridge data dir and adds it to
// DSH's args as a --patch layer right after the profile name, so patches the user lists
// later still apply on top of it.
func withNoAutoCompact(opts map[string]any) map[string]any {
	dir, _ := opts["cc_data_dir"].(string)
	if strings.TrimSpace(dir) == "" {
		d, err := os.UserCacheDir()
		if err != nil {
			return opts
		}
		dir = filepath.Join(d, "bothouse")
	}
	path := filepath.Join(dir, "dsh", "no-auto-compact.patch.yml")
	if err := writeIfChanged(path, noAutoCompactPatch); err != nil {
		slog.Warn("dsh: cannot write no-auto-compact patch; DSH keeps its own auto compaction", "path", path, "err", err)
		return opts
	}
	opts["args"] = insertPatchArg(argStrings(opts["args"]), path)
	return opts
}

func writeIfChanged(path, content string) error {
	if b, err := os.ReadFile(path); err == nil && string(b) == content {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func argStrings(v any) []string {
	switch x := v.(type) {
	case []string:
		return append([]string(nil), x...)
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// insertPatchArg puts "--patch path" right after "--profile <name>" (dsh --help:
// options come before the app's own args); without --profile it goes last.
func insertPatchArg(args []string, path string) []string {
	for i, a := range args {
		if a == "--patch" && i+1 < len(args) && args[i+1] == path {
			return args
		}
	}
	at := len(args)
	for i, a := range args {
		if a == "--profile" && i+1 < len(args) {
			at = i + 2
			break
		}
		if strings.HasPrefix(a, "--profile=") {
			at = i + 1
			break
		}
	}
	out := append([]string(nil), args[:at]...)
	out = append(out, "--patch", path)
	return append(out, args[at:]...)
}
