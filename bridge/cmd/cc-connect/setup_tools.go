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

func init() { core.AgentToolFS = ccconnect.AgentToolFiles }

const setupToolsUsage = `Usage: cc-connect setup tools on|off|status --work-dir <dir> [--agent <type>] [flags]

Small command-line tools for one role (the role's work_dir): %s.
"on" installs the scripts into <data_dir>/tools and adds a block between <!-- conest:tools --> markers to
the role's persona file (CLAUDE.md for claudecode, AGENTS.md for codex/acp/dsh, GEMINI.md for gemini, …)
saying what each tool is for and the exact command; the agent runs them with its own shell tool.
"off" removes those lines (or, with --only, just those tools); the rest of the persona is left as it is.
New roles from the setup wizard get all of them. The tools run with uv (https://docs.astral.sh/uv/);
watchvid also needs ffmpeg. See bridge/contrib/tools/README.md.

Flags:
`

// runSetupTools: cc-connect setup tools on|off|status. JSON out, like the other setup subcommands.
func runSetupTools(args []string) {
	action := ""
	var rest []string
	for _, a := range args {
		if action == "" && (a == "on" || a == "off" || a == "status") {
			action = a
			continue
		}
		rest = append(rest, a)
	}
	fs := flag.NewFlagSet("setup tools", flag.ExitOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), setupToolsUsage, strings.Join(core.AgentToolNames(), ", "))
		fs.PrintDefaults()
	}
	workDir := fs.String("work-dir", "", "the role's work_dir (REQUIRED)")
	agent := fs.String("agent", "claudecode", "the role's agent type, which picks the persona file: claudecode | codex | acp | gemini | …")
	only := fs.String("only", "", "comma-separated tools to switch on/off (default: all)")
	lang := fs.String("lang", "", "language of the persona block: zh | en (default: the persona's reply language, else system)")
	configFile := fs.String("config", "", "path to config file (for its data_dir)")
	_ = fs.Parse(rest)
	if action == "" || *workDir == "" {
		fs.Usage()
		os.Exit(2)
	}
	wd, err := filepath.Abs(expandUserHome(*workDir))
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
	o := core.AgentToolOptions{DataDir: dataDir, WorkDir: wd, AgentType: *agent, Lang: *lang, Only: names}
	var res any
	switch action {
	case "on":
		res, err = core.EnableAgentTools(o)
	case "off":
		res, err = core.DisableAgentTools(o)
	default:
		persona := core.PersonaFilePath(*agent, wd)
		var on []string
		on, err = core.AgentToolsEnabled(persona)
		res = map[string]any{"enabled": on, "persona_file": persona, "tools": core.AgentToolNames(),
			"tools_dir": core.AgentToolsDir(dataDir), "uv": core.FindUV()}
	}
	if err != nil {
		fail(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	_ = enc.Encode(map[string]any{"ok": true, "result": res})
}

// expandUserHome turns a leading ~ into the home directory.
func expandUserHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}

func init() { core.RoleWikiFS = ccconnect.RoleWikiFiles }
