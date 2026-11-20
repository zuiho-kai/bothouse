package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// janitorOptions is the janitor setup of cfg: its places, the task boards that protect dirs, and
// the language of what it writes. Shared by the running bridge and `bothouse cleanup`.
func janitorOptions(cfg *config.Config, projs []config.ProjectConfig) core.JanitorOptions {
	o := core.JanitorOptions{DataDir: cfg.DataDir, Dirs: cfg.Cleanup.Dirs}
	if strings.HasPrefix(cfg.Language, "zh") || cfg.Language == "chinese" {
		o.Lang = "zh"
	}
	seen := map[string]bool{}
	for _, p := range projs {
		if dir, _, _ := projectTeamStatus(cfg.DataDir, p); dir != "" && !seen[dir] {
			seen[dir] = true
			o.BoardDirs = append(o.BoardDirs, dir)
		}
	}
	return o
}

// newJanitor is the bridge's janitor, or nil when [cleanup] enabled = false. The low-space
// notice goes to the owner's private chat of the first project that can open one.
func newJanitor(cfg *config.Config, projs []config.ProjectConfig, engines []*core.Engine) *core.Janitor {
	if cfg.Cleanup.Enabled != nil && !*cfg.Cleanup.Enabled {
		return nil
	}
	o := janitorOptions(cfg, projs)
	o.Notify = func(text string) error {
		var last error = fmt.Errorf("no project can message the owner privately (admin_from not set)")
		for _, e := range engines {
			key, err := e.OpenDMSession()
			if err != nil {
				last = err
				continue
			}
			if err := e.SendToSession(key, text); err != nil {
				last = err
				continue
			}
			return nil
		}
		return last
	}
	return core.NewJanitor(o)
}

// runCleanup is `bothouse cleanup [--dry-run]`: one clean now, printing what went and what stayed.
func runCleanup(args []string) {
	dry := false
	cfgPath := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dry-run", "-n":
			dry = true
		case "--config":
			if i+1 < len(args) {
				i++
				cfgPath = args[i]
			}
		case "--help", "-h", "help":
			fmt.Println(`Usage: bothouse cleanup [--dry-run] [--config <config.toml>]

Removes what nobody touched for a week from the bridge's own places (bgrun runs,
iso-check test dirs, walkthrough runs) and from [cleanup] dirs in config.toml.
Kept: dirs an open task board item or a skill names, git repositories, worktrees
with uncommitted or unpushed work. The bridge runs this every hour by itself;
records go to <data_dir>/cleanup/<YYYY-MM>.log.

  --dry-run   only list what would go`)
			return
		default:
			fmt.Fprintf(os.Stderr, "cleanup: unknown argument %q (see bothouse cleanup --help)\n", args[i])
			os.Exit(2)
		}
	}
	cfg, err := config.Load(resolveConfigPath(cfgPath))
	if err != nil {
		fmt.Fprintf(os.Stderr, "cleanup: cannot read config: %v\n", err)
		os.Exit(1)
	}
	j := core.NewJanitor(janitorOptions(cfg, cfg.Projects))
	res := j.Run(dry)
	fmt.Print(j.FormatResult(res, time.Now(), dry))
	if len(res.Errors) > 0 {
		os.Exit(1)
	}
}
