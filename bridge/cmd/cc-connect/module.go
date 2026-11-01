package main

// bothouse module list | add <platform> | disable <platform> (#812): platforms as optional
// modules. Only the platform sections of config.toml change; personas, wiki, sessions and
// scheduled tasks are other files and stay as they are.
//
// `module add <platform>` with the platform's own flags configures it without the wizard, for
// setup by an AI agent: it builds the core.WizardRequest `setup apply` takes (append_only, so
// existing roles are untouched) and goes through the same apply path, printing the same result
// JSON. Without flags it still means "turn this platform back on".

import (
	"context"
	"flag"
	"fmt"
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

// moduleFlags are what `module add` takes; each platform reads its own.
type moduleFlags struct {
	wsURL     string
	token     string
	allowFrom string
	guild     string
	channel   string
	appID     string
	appSecret string
	url       string
	name      string
	lang      string
	dryRun    bool
}

// given: at least one platform parameter (or --dry-run) was typed, so `module add` is a request
// to configure the platform, not to turn a disabled one back on.
func (f moduleFlags) given() bool {
	return f.wsURL != "" || f.token != "" || f.allowFrom != "" || f.guild != "" || f.channel != "" ||
		f.appID != "" || f.appSecret != "" || f.url != "" || f.name != "" || f.dryRun
}

func printModuleUsage() {
	fmt.Println(`Usage: bothouse module <command> [--config <path>]

Platforms are optional modules: only the ones in config.toml start.

  list                  Each platform: enabled / disabled / not configured, and which roles use it
  add <platform>        Configure the platform with its own flags (below), or turn a disabled one back on
  disable <platform>    Stop a platform; its settings stay in config.toml (add turns it back on)

Platforms: qq, discord, feishu, dsh, cloud_web (自建平台).

Parameters of add (non-interactive: missing ones are printed as JSON, nothing is written, exit code 1):
  qq        --ws-url <ws://…> --token <token> --allow-from <QQ numbers|*>
  discord   --token <bot token> --guild <server ID> [--channel <channel ID>] [--allow-from <user IDs>]
  feishu    --app-id <app ID> --app-secret <app secret>
  cloud_web --url <address> --token <bot token> [--name <display name>]
  dsh       no parameters: prints how to install the DSH plugin
  All of them: [--lang <zh|en|ja|…>] [--dry-run] (writes nothing). The result is the same JSON
  as ` + "`bothouse setup apply`" + `.

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
	var f moduleFlags
	fs.StringVar(&f.wsURL, "ws-url", "", "qq: NapCat / OneBot forward WebSocket (default "+core.QQDefaultWSURL+")")
	fs.StringVar(&f.token, "token", "", "qq, discord, cloud_web: access / bot token")
	fs.StringVar(&f.allowFrom, "allow-from", "", "qq: QQ numbers that may give orders (* = anyone); discord: Discord user IDs")
	fs.StringVar(&f.guild, "guild", "", "discord: server ID")
	fs.StringVar(&f.channel, "channel", "", "discord: default chat channel ID")
	fs.StringVar(&f.appID, "app-id", "", "feishu: app ID (from `bothouse feishu setup`)")
	fs.StringVar(&f.appSecret, "app-secret", "", "feishu: app secret (from `bothouse feishu setup`)")
	fs.StringVar(&f.url, "url", "", "cloud_web: platform address (default: the hub this wizard started)")
	fs.StringVar(&f.name, "name", "", "cloud_web: the bot's display name on the platform")
	fs.StringVar(&f.lang, "lang", "", "reply language of the bots (zh|en|ja|…; default: system locale)")
	fs.BoolVar(&f.dryRun, "dry-run", false, "validate and print the plan without writing")
	_ = fs.Parse(args[1:])
	mod := strings.ToLower(strings.TrimSpace(fs.Arg(0)))
	if fs.NArg() > 1 { // flags after the platform: `module add qq --ws-url ws://…`
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
	if args[0] != "disable" && (f.given() || !moduleConfigured(mod)) {
		out, code := moduleAddConfigure(mod, f, *configPath)
		printJSON(out)
		if code != 0 {
			os.Exit(code)
		}
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
	// nothing to flip: already in that state
	cfg, err := config.LoadForSetup(config.ConfigPath)
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

// moduleConfigured: config.toml already has a section for this platform (enabled or disabled).
func moduleConfigured(mod string) bool {
	if _, err := os.Stat(config.ConfigPath); err != nil {
		return false
	}
	cfg, err := config.LoadForSetup(config.ConfigPath)
	if err != nil {
		return false
	}
	_, ok := config.ModuleStates(cfg)[mod]
	return ok
}

// moduleMissing is one parameter `module add` needs but did not get: the request field, the flag
// that sets it, and what belongs there.
type moduleMissing struct {
	Field string `json:"field"`
	Flag  string `json:"flag"`
	Hint  string `json:"hint"`
}

// moduleMissingReport is what `module add` prints when a parameter is missing: the setup apply
// result's ok / warnings, the missing parameters, and nothing written.
type moduleMissingReport struct {
	OK       bool                 `json:"ok"`
	Platform string               `json:"platform"`
	Error    string               `json:"error"`
	Missing  []moduleMissing      `json:"missing"`
	Warnings []core.WizardWarning `json:"warnings"`
}

// moduleAddConfigure: one `module add <platform> <flags>` run. Returns what to print (the
// `setup apply` result JSON, or the missing-parameter report) and the exit code.
func moduleAddConfigure(mod string, f moduleFlags, configFile string) (any, int) {
	req, missing := moduleAddRequest(mod, f)
	if len(missing) > 0 {
		flags := make([]string, 0, len(missing))
		for _, m := range missing {
			flags = append(flags, m.Flag)
		}
		return moduleMissingReport{OK: false, Platform: mod, Missing: missing, Warnings: []core.WizardWarning{},
			Error: "missing required parameters: " + strings.Join(flags, " ")}, 1
	}
	res, err := wizardApplyCLI(req, configFile)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}, 1
	}
	if !res.OK {
		return res, 1
	}
	return res, 0
}

// moduleAddRequest turns the flags into the wizard request `setup apply` takes for this platform:
// one request per platform, append_only so an existing role is never merged or overwritten.
// Required flags that are missing come back as moduleMissing.
func moduleAddRequest(mod string, f moduleFlags) (core.WizardRequest, []moduleMissing) {
	req := core.WizardRequest{Platform: mod, Language: f.lang, AppendOnly: true, DryRun: f.dryRun}
	var missing []moduleMissing
	need := func(value, field, flag, hint string) {
		if value == "" {
			missing = append(missing, moduleMissing{Field: field, Flag: flag, Hint: hint})
		}
	}
	switch mod {
	case "qq":
		// ws_url has a default and the NapCat token may be unset; allow_from has none: an empty
		// one would let anyone in a group command this computer (core/setup_qq.go).
		need(f.allowFrom, "qq.allow_from", "--allow-from", "your own QQ number(s), comma-separated; * lets anyone command the bots")
		req.QQ = &core.WizardQQ{WSURL: f.wsURL, Token: f.token, AllowFrom: f.allowFrom}
		req.Roles = []core.WizardRole{{}}
	case "discord":
		need(f.token, "roles[0].token", "--token", "bot token: Discord Developer Portal → your application → Bot → Reset Token")
		need(f.guild, "discord.guild_id", "--guild", "server ID: Discord settings → Advanced → Developer Mode, then right-click the server")
		d := struct {
			GuildID   string `json:"guild_id"`
			ChannelID string `json:"channel_id"`
		}{GuildID: f.guild, ChannelID: f.channel}
		req.Discord = &d
		req.Roles = []core.WizardRole{{Token: f.token}}
		if f.allowFrom != "" {
			req.AllowFrom = &f.allowFrom
		}
	case "feishu":
		need(f.appID, "feishu.app_id", "--app-id", "app ID from `bothouse feishu setup`")
		need(f.appSecret, "feishu.app_secret", "--app-secret", "app secret from `bothouse feishu setup`")
		req.Feishu = &core.WizardFeishu{AppID: f.appID, AppSecret: f.appSecret}
		req.Roles = []core.WizardRole{{}}
	case "cloud_web":
		// url and token may stay empty: the hub this wizard started on this machine fills both in
		// (core/setup_cloudweb.go resolveCloudWeb). With no such hub the apply fails and says so.
		req.CloudWeb = &core.WizardCloudWeb{URL: f.url, Token: f.token}
		req.Roles = []core.WizardRole{{Name: f.name}}
		if f.allowFrom != "" {
			req.AllowFrom = &f.allowFrom
		}
	}
	return req, missing
}

func moduleList() error {
	cfg, err := config.LoadForSetup(config.ConfigPath)
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
