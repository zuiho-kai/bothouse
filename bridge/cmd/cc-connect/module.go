package main

// bothouse module list | add <platform> | disable <platform> (#812): platforms as optional
// modules. Only the platform sections of config.toml change; personas, wiki, sessions and
// scheduled tasks are other files and stay as they are.

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// moduleOrder is the order `module list` shows; "dsh" is not a config.toml platform but a plugin
// installed into DSH (core/setup_dsh_platform.go).
var moduleOrder = []string{"qq", "discord", "feishu", "dsh", "cloud_web"}

var moduleLabels = map[string]string{
	"qq": "QQ", "discord": "Discord", "feishu": "飞书 / Lark", "dsh": "DSH", "cloud_web": "自建平台",
}

func printModuleUsage() {
	fmt.Println(`Usage: bothouse module <command> [--config <path>]

Platforms are optional modules: only the ones in config.toml start.

  list                  Each platform: enabled / disabled / not configured, and which roles use it
  add <platform>        Turn a disabled platform back on; one never configured: how to add it
  disable <platform>    Stop a platform; its settings stay in config.toml (add turns it back on)

Platforms: qq, discord, feishu, dsh, cloud_web (自建平台).
Personas, wiki, sessions and scheduled tasks are not touched. Restart bothouse to apply.`)
}

func runModule(args []string) {
	if len(args) == 0 || isHelpArg(args[0]) {
		printModuleUsage()
		if len(args) == 0 {
			os.Exit(1)
		}
		return
	}
	fs := flag.NewFlagSet("module "+args[0], flag.ExitOnError)
	configPath := fs.String("config", "", "path to config file (default: auto-detect)")
	_ = fs.Parse(args[1:])
	mod := strings.ToLower(strings.TrimSpace(fs.Arg(0)))
	if fs.NArg() > 1 { // flags after the platform: `module disable qq --config x`
		_ = fs.Parse(fs.Args()[1:])
	}
	config.ConfigPath = resolveConfigPath(*configPath)
	if mod == "lark" {
		mod = "feishu"
	}

	switch args[0] {
	case "list", "ls":
		if err := moduleList(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	case "add", "enable", "disable":
	default:
		fmt.Fprintf(os.Stderr, "Unknown module subcommand: %s\n", args[0])
		printModuleUsage()
		os.Exit(1)
	}
	if _, ok := moduleLabels[mod]; !ok {
		fmt.Fprintf(os.Stderr, "Error: give a platform: %s\n", strings.Join(moduleOrder, ", "))
		os.Exit(1)
	}
	if mod == "dsh" {
		moduleDSH(args[0])
		return
	}
	disable := args[0] == "disable"
	changed, backup, err := config.SetModuleDisabled(mod, disable)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	if len(changed) > 0 {
		verb := "enabled"
		if disable {
			verb = "disabled"
		}
		fmt.Printf("%s %s for: %s\n", moduleLabels[mod], verb, strings.Join(changed, ", "))
		fmt.Printf("Previous config saved to %s. Restart bothouse to apply (bothouse daemon restart).\n", backup)
		return
	}
	// nothing to flip: already in that state, or never configured
	cfg, err := loadModuleConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	if _, configured := config.ModuleStates(cfg)[mod]; configured {
		fmt.Printf("%s is already %s.\n", moduleLabels[mod], map[bool]string{true: "disabled", false: "enabled"}[disable])
		return
	}
	if disable {
		fmt.Printf("%s is not configured; nothing to disable.\n", moduleLabels[mod])
		return
	}
	fmt.Printf("%s is not configured yet. Add it with the setup wizard: run `bothouse web` and open\n"+
		"  Add platform (/setup?add=1&platform=%s)\n"+
		"or without a browser: bothouse setup apply -h (\"platform\": %q, with \"append_only\": true).\n",
		moduleLabels[mod], mod, mod)
}

// loadModuleConfig: no config file yet (fresh install) = nothing configured.
func loadModuleConfig() (*config.Config, error) {
	if _, err := os.Stat(config.ConfigPath); errors.Is(err, fs.ErrNotExist) {
		return &config.Config{}, nil
	}
	return config.LoadForSetup(config.ConfigPath)
}

func moduleList() error {
	cfg, err := loadModuleConfig()
	if err != nil {
		return err
	}
	states := config.ModuleStates(cfg)
	for _, mod := range moduleOrder {
		label := fmt.Sprintf("%-12s", mod)
		if mod == "dsh" {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			st := core.GetDSHStatus(ctx)
			cancel()
			switch {
			case st.PluginInstalled:
				fmt.Printf("%s installed (plugin in DSH profile %s)\n", label, st.Profile)
			default:
				fmt.Printf("%s not configured\n", label)
			}
			continue
		}
		st, ok := states[mod]
		if !ok {
			fmt.Printf("%s not configured\n", label)
			continue
		}
		var parts []string
		if len(st.Enabled) > 0 {
			parts = append(parts, "enabled: "+strings.Join(st.Enabled, ", "))
		}
		if len(st.Disabled) > 0 {
			parts = append(parts, "disabled: "+strings.Join(st.Disabled, ", "))
		}
		fmt.Printf("%s %s\n", label, strings.Join(parts, "; "))
	}
	return nil
}

// moduleDSH: DSH is not a config.toml platform; its plugin lives in a DSH profile.
func moduleDSH(cmd string) {
	if cmd == "disable" {
		fmt.Println("DSH is a plugin inside DSH, not a bothouse config section: remove it from the DSH profile in DSH itself.")
		return
	}
	fmt.Println("Install the DSH plugin with: bothouse setup dsh install (needs dsh, Node >= 22.12.0 and pnpm).")
}
