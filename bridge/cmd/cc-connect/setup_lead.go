package main

import (
	"encoding/json"
	"flag"
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
	result, err := core.InstallLeadTools(data, work, *agent)
	if err != nil {
		fail(err)
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "result": result})
}
