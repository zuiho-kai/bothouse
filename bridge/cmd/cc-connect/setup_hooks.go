package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

func init() { core.AgentHookFS = ccconnect.AgentHookFiles }

const setupHooksUsage = `Usage: cc-connect setup hooks on|off|status --work-dir <dir> [flags]

Tool hooks for one role (the role's work_dir). Claude Code reads them from <dir>/.claude/settings.json.
DSH reads them through @deepseek-ai/dsh-hooks-claude-code, which "on --cli dsh" mounts in the role's own
overlay (dsh --patch, <data_dir>/dsh/<role>.patch.yml) with <dir>/.claude/conest-dsh-hooks.json; the user's
$DSH_HOME is not written. Those hooks run only in the roles set up with --cli dsh (listed in
<data_dir>/hooks/dsh-roles.json). "off --cli dsh" with no hook left removes that block again. Restart DSH (for cc-connect's roles: restart cc-connect) after on/off --cli dsh. The scripts are installed into <data_dir>/hooks; the persona file
(CLAUDE.md for claudecode, AGENTS.md for dsh) gets a block between <!-- conest:hooks --> markers that
tells the model the rules of the hooks that are on. "off" removes the hooks and that block (or, with
--only, just those hooks and their lines); other hooks and the rest of both files are left as they are.

To pause hooks without uninstalling them, the user tells the bot in chat ("turn the checks off"): the
persona block makes it run <data_dir>/hooks/run.py --role <dir> off|on [hook…], which writes
<dir>/.claude/conest-hooks.json ({"off": ["bash-guard"]} or {"off": ["all"]}; editing it by hand works too).
"status" shows both.

Hooks: %s

Flags:
`

// runSetupHooks: cc-connect setup hooks on|off|status. JSON out, like the other setup subcommands.
func runSetupHooks(args []string) {
	action := ""
	var rest []string
	for _, a := range args {
		if action == "" && (a == "on" || a == "off" || a == "status") {
			action = a
			continue
		}
		rest = append(rest, a)
	}
	fs := flag.NewFlagSet("setup hooks", flag.ExitOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), setupHooksUsage, strings.Join(core.AgentHookNames(), ", "))
		fs.PrintDefaults()
	}
	workDir := fs.String("work-dir", "", "the role's work_dir (REQUIRED)")
	cli := fs.String("cli", "claudecode", "the role's CLI: claudecode | dsh")
	only := fs.String("only", "", "comma-separated hooks to switch on/off (default: all)")
	lang := fs.String("lang", "", "language of the persona block: zh | en (default: the persona's reply language, else system)")
	dshHome := fs.String("dsh-home", "", "DSH home for --cli dsh (default: $DSH_HOME, else ~/.dsh)")
	dshBridge := fs.String("dsh-bridge", "", "--cli dsh: lib/index.js of @deepseek-ai/dsh-hooks-claude-code (default: found next to the dsh on PATH)")
	configFile := fs.String("config", "", "path to config file (for its data_dir)")
	_ = fs.Parse(rest)
	if action == "" || *workDir == "" {
		fs.Usage()
		os.Exit(2)
	}
	wd, err := filepath.Abs(expandHome(*workDir))
	if err != nil {
		fail(err)
	}
	initConfigPath(*configFile)
	dataDir := defaultDataDir()
	if _, err := os.Stat(config.ConfigPath); err == nil {
		if cfg, err := config.LoadForSetup(config.ConfigPath); err == nil && cfg.DataDir != "" {
			dataDir = cfg.DataDir
		}
	}
	var names []string
	if *only != "" {
		names = strings.Split(*only, ",")
	}
	o := core.AgentHookOptions{DataDir: dataDir, WorkDir: wd, CLI: *cli, Lang: *lang, Only: names, DSHHome: expandHome(*dshHome), DSHBridge: expandHome(*dshBridge)}
	var res any
	switch action {
	case "on":
		res, err = core.EnableAgentHooks(o)
	case "off":
		res, err = core.DisableAgentHooks(o)
	default:
		var on []string
		on, err = core.AgentHooksEnabled(wd)
		res = map[string]any{"enabled": on, "settings_file": core.AgentHookSettingsPath(wd), "hooks": core.AgentHookNames(),
			"switched_off": core.AgentHooksSwitchedOff(wd), "switch_file": core.AgentHookSwitchFile(wd)}
	}
	if err != nil {
		fail(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	_ = enc.Encode(map[string]any{"ok": true, "result": res})
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}
