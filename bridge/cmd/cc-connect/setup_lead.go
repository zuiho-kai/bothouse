package main

import (
	"encoding/json"
	"flag"
	"fmt"
	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
	"os"
	"path/filepath"
)

func init() { core.LeadToolFS = ccconnect.LeadToolFiles }

// runSetupLead exposes the same explicit role-scoped installation model as setup tools.
func runSetupLead(args []string) {
	fs := flag.NewFlagSet("setup lead install", flag.ExitOnError)
	wd := fs.String("work-dir", "", "role work directory (required)")
	agent := fs.String("agent", "claudecode", "role agent type")
	cfgPath := fs.String("config", "", "config path (for data_dir)")
	force := fs.Bool("force", false, "overwrite installed tools that differ from the bundled version")
	if len(args) == 0 || args[0] != "install" {
		fs.Usage()
		os.Exit(2)
	}
	_ = fs.Parse(args[1:])
	if *wd == "" {
		fs.Usage()
		os.Exit(2)
	}
	work, err := filepath.Abs(expandUserHome(*wd))
	if err != nil {
		fail(err)
		return
	}
	initConfigPath(*cfgPath)
	data := defaultDataDir()
	if cfg, err := config.LoadForSetup(config.ConfigPath); err == nil && cfg.DataDir != "" {
		data = cfg.DataDir
	}
	result, skipped, err := core.InstallLeadTools(data, work, *agent, *force)
	if err != nil {
		fail(err)
		return
	}
	if len(skipped) > 0 {
		fmt.Fprintf(os.Stderr, "skipped %d locally modified file(s) under %s (re-run with --force to overwrite):\n", len(skipped), filepath.Dir(result["tools_dir"]))
		for _, f := range skipped {
			fmt.Fprintf(os.Stderr, "  %s\n", f)
		}
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "result": result, "skipped": skipped})
}
