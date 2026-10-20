package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// configWizardStore implements core.WizardStore on top of config.toml.
type configWizardStore struct{}

func toCoreSnapshot(ps []config.WizardProjectSnapshot) core.WizardSnapshot {
	out := core.WizardSnapshot{Projects: make([]core.WizardExistingProject, 0, len(ps))}
	for _, p := range ps {
		out.Projects = append(out.Projects, core.WizardExistingProject{Name: p.Name, AgentType: p.AgentType, WorkDir: p.WorkDir,
			AgentCmd: p.AgentCmd, Platforms: p.Platforms, GateURL: p.GateURL, GateFallback: p.GateFallback})
	}
	return out
}

func (configWizardStore) Snapshot() (core.WizardSnapshot, error) {
	ps, err := config.WizardSnapshot()
	if err != nil {
		return core.WizardSnapshot{}, err
	}
	return toCoreSnapshot(ps), nil
}

func (configWizardStore) ApplyProjects(plan func(core.WizardSnapshot) ([]core.WizardProjectWrite, error)) (string, error) {
	return config.ApplyWizardProjects(func(ps []config.WizardProjectSnapshot) ([]config.WizardProjectOptions, error) {
		ws, err := plan(toCoreSnapshot(ps))
		if err != nil {
			return nil, err
		}
		list := make([]config.WizardProjectOptions, 0, len(ws))
		for _, w := range ws {
			o := config.WizardProjectOptions{Name: w.Name, AgentType: w.AgentType, WorkDir: w.WorkDir, AgentCmd: w.AgentCmd,
				PlatformType: w.PlatformType, Options: w.Options, GateURL: w.GateURL, GateFallback: w.GateFallback,
				OwnerOpenID: w.FeishuOwnerOpenID}
			if w.Provider != nil {
				p := config.ProviderConfig{Name: w.Provider.Name, APIKey: w.Provider.APIKey, BaseURL: w.Provider.BaseURL,
					Model: w.Provider.Model, Thinking: w.Provider.Thinking, APIFormat: w.Provider.APIFormat}
				if w.Provider.CodexWireAPI != "" {
					p.Codex = &config.CodexProviderConfig{WireAPI: w.Provider.CodexWireAPI}
				}
				o.Provider = &p
			}
			list = append(list, o)
		}
		return list, nil
	})
}

// saveFeishuSetup is shared by the QR save endpoint and the wizard.
func saveFeishuSetup(req core.FeishuSetupSaveRequest) error {
	platType := req.PlatformType
	if platType == "" {
		platType = "feishu"
	}
	if _, err := config.EnsureProjectWithFeishuPlatform(config.EnsureProjectWithFeishuOptions{
		ProjectName: req.ProjectName, PlatformType: platType, WorkDir: req.WorkDir, AgentType: req.AgentType,
	}); err != nil {
		return fmt.Errorf("ensure project: %w", err)
	}
	_, err := config.SaveFeishuPlatformCredentials(config.FeishuCredentialUpdateOptions{
		ProjectName: req.ProjectName, PlatformType: platType, AppID: req.AppID, AppSecret: req.AppSecret,
		OwnerOpenID: req.OwnerOpenID, SetAllowFromEmpty: true,
	})
	return err
}

// runSetupOnly serves the web wizard when config.toml has no projects yet, so
// a fresh install can be configured from the browser. After the wizard saves,
// "restart" re-executes cc-connect with the new config.
func runSetupOnly(cfg *config.Config, configPath string, release func()) {
	port := cfg.Management.Port
	if port <= 0 {
		port = 9820 // 来源：沿用 main.go 管理接口的默认端口
	}
	// /setup/apply writes tokens and keys: never serve it without auth.
	token := cfg.Management.Token
	if token == "" {
		token = core.GenerateToken(16)
		if err := config.EnsureManagementToken(token); err != nil {
			fmt.Fprintf(os.Stderr, "cannot write a management token to %s: %v\n", configPath, err)
			release()
			os.Exit(1)
		}
	}
	// Setup mode listens on this machine only unless [management] host says otherwise.
	host := cfg.Management.Host
	if host == "" {
		host = "127.0.0.1"
	}
	srv := core.NewManagementServer(port, token, cfg.Management.CORSOrigins)
	srv.SetHost(host)
	srv.SetConfigFilePath(configPath)
	srv.SetSetupFeishuSave(saveFeishuSetup)
	srv.SetWizard(configWizardStore{}, cfg.DataDir)
	srv.Start()
	// The sign-in link carries the token: it goes into a file only you can read and into the
	// browser; the terminal only shows it when no browser could be opened.
	linkFile := setupLinkFile(configPath)
	link := fmt.Sprintf("http://localhost:%d/login?token=%s&next=/setup", port, token)
	if err := os.WriteFile(linkFile, []byte(link+"\n"), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "cannot write %s: %v\n", linkFile, err)
	}
	announceSetupWizard(link, linkFile, port, os.Getenv("CC_LOG_FILE") == "" && !overSSH())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sigCh:
		srv.Stop()
		release()
	case <-core.RestartCh:
		srv.Stop()
		release()
		exe, err := os.Executable()
		if err == nil {
			err = restartProcess(exe)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "restart failed: %v\n", err)
			os.Exit(1)
		}
	}
}

func setupLinkFile(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "setup-link.txt")
}

// openBrowserFn is swapped in tests.
var openBrowserFn = openBrowser

// overSSH: this terminal is an SSH session, so a browser would open on the remote desktop (or nowhere).
func overSSH() bool { return os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_TTY") != "" }

// announceSetupWizard opens the wizard in the browser (unless running as a service or over SSH)
// and always prints the link: a browser that "opened" may be on another screen or none at all.
// Over SSH it adds the port-forward command, since the wizard only listens on 127.0.0.1.
func announceSetupWizard(link, linkFile string, port int, tryBrowser bool) {
	zh := core.SystemLanguage() == "zh"
	opened := tryBrowser && openBrowserFn(link) == nil
	switch {
	case opened && zh:
		fmt.Print("还没有配置机器人：已尝试在浏览器打开安装向导（只有这台电脑能访问）。没看到的话，把下面这个链接复制到浏览器（含登录口令，别发给别人）：\n")
	case opened:
		fmt.Print("No bots configured yet: tried to open the setup wizard in your browser (this computer only). Not there? Paste this link into a browser (it contains a sign-in token, keep it private):\n")
	case zh:
		fmt.Print("还没有配置机器人。请把下面这个链接复制到浏览器打开安装向导（含登录口令，别发给别人）：\n")
	default:
		fmt.Print("No bots configured yet. Paste this link into a browser to open the setup wizard (it contains a sign-in token, keep it private):\n")
	}
	fmt.Printf("\n  %s\n\n", link)
	if overSSH() {
		if zh {
			fmt.Printf("你是通过 SSH 连进来的：向导只听这台机器的 127.0.0.1。在你自己的电脑上另开一个终端运行\n  ssh -L %d:127.0.0.1:%d <用户名>@<这台机器的地址>\n保持它开着，再在你自己电脑的浏览器里打开上面的链接。也可以不用网页：让 AI 跑 cc-connect setup apply。\n", port, port)
		} else {
			fmt.Printf("You are on SSH: the wizard only listens on this machine's 127.0.0.1. On your own computer run\n  ssh -L %d:127.0.0.1:%d <user>@<this machine>\nkeep it open, then open the link above in your own browser. Or skip the web page: have an AI run cc-connect setup apply.\n", port, port)
		}
	}
	if zh {
		fmt.Printf("链接也存在 %s\n", linkFile)
	} else {
		fmt.Printf("The link is also in %s\n", linkFile)
	}
}

// startSetupWizard serves only the setup wizard for a config without projects
// (writing the first-run config when there is none). lock is already held.
func startSetupWizard(configPath string, release func()) {
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		if err := bootstrapSetupConfig(configPath); err != nil {
			fmt.Fprintf(os.Stderr, "Error creating config: %v\n", err)
			release()
			os.Exit(1)
		}
		fmt.Printf("Created %s\n", configPath)
	}
	pc, err := config.LoadForSetup(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config (%s): %v\n", configPath, err)
		release()
		os.Exit(1)
	}
	config.ConfigPath = configPath
	runSetupOnly(pc, configPath, release)
}

// needsSetup: no config yet, or a config without any [[projects]].
func needsSetup(configPath string) bool {
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return true
	}
	pc, err := config.LoadForSetup(configPath)
	return err == nil && len(pc.Projects) == 0
}

// instanceRunning reports whether a cc-connect process holds the lock for this config.
func instanceRunning(configPath string) bool {
	l, err := AcquireInstanceLock(configPath)
	if err != nil {
		return true
	}
	l.Release()
	return false
}

// setupNextSteps tells the user (or AI) how to get the new config running.
func setupNextSteps(lang, configFlag string, running, needsAction bool) []string {
	cmd := "cc-connect"
	if configFlag != "" {
		cmd += " --config " + configFlag
	}
	zh := strings.HasPrefix(strings.ToLower(lang), "zh")
	var out []string
	if needsAction {
		if zh {
			out = append(out, "先处理 warnings 里 blocking=true 的每一项（打开它的 url 照 fix 做），不做机器人不会回话")
		} else {
			out = append(out, "First do every warning with blocking=true (open its url, follow fix); until then the bot will not answer")
		}
	}
	switch {
	case running && zh:
		out = append(out, "cc-connect 正在运行，重启后新配置才生效：在向导网页点「重启生效」；装成后台服务的运行 cc-connect daemon restart；前台跑的按 Ctrl+C 后再运行 "+cmd)
	case running:
		out = append(out, "cc-connect is running; restart it to use the new config: click \"Restart to apply\" in the wizard, or cc-connect daemon restart for the service, or Ctrl+C and run "+cmd+" again")
	case zh:
		out = append(out, "后台启动并常驻（推荐，AI 也用这个，不要在前台跑 "+cmd+"，会一直占住终端）："+daemonCmd(configFlag)+"；看日志 cc-connect daemon logs -f，出现 \"discord: connected\" 就是上线了，去频道里 @ 机器人说一句试试",
			"只想先临时试一下：nohup "+cmd+" > ~/.cc-connect/run.log 2>&1 &（日志在 ~/.cc-connect/run.log）")
	default:
		out = append(out, "Start in the background as a service (recommended, also for AI agents — do not run "+cmd+" in the foreground, it holds the terminal): "+daemonCmd(configFlag)+"; follow the log with cc-connect daemon logs -f, \"discord: connected\" means it is online — @ the bot in the channel to try",
			"Just a quick try: nohup "+cmd+" > ~/.cc-connect/run.log 2>&1 & (log in ~/.cc-connect/run.log)")
	}
	return out
}

func daemonCmd(configFlag string) string {
	if configFlag != "" {
		return "cc-connect daemon install --config " + configFlag
	}
	return "cc-connect daemon install"
}

// runSetup: `cc-connect setup apply --json <file|->` (one-shot config for AI
// agents), `cc-connect setup clis`, `cc-connect setup matrix`, `cc-connect setup personas`.
// Output is JSON on stdout.
func runSetup(args []string) {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, setupUsage)
		os.Exit(2)
	}
	sub := args[0]
	if sub == "-h" || sub == "--help" || sub == "help" {
		fmt.Print(setupUsage)
		return
	}
	fs := flag.NewFlagSet("setup "+sub, flag.ExitOnError)
	if sub == "apply" {
		fs.Usage = func() {
			fmt.Fprint(fs.Output(), "Usage: cc-connect setup apply --json <file|-> [--config path] [--dry-run]\n\nFlags:\n")
			fs.PrintDefaults()
			fmt.Fprint(fs.Output(), setupApplyFields)
		}
	}
	configFile := fs.String("config", "", "path to config file")
	jsonPath := fs.String("json", "", "wizard request JSON file, or - for stdin")
	dryRun := fs.Bool("dry-run", false, "validate and print the plan without writing")
	lang := fs.String("lang", "", "language for personas (zh|en; default: system)")
	_ = fs.Parse(args[1:])
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	switch sub {
	case "clis":
		_ = enc.Encode(core.DetectLocalCLIs(context.Background()))
	case "matrix":
		_ = enc.Encode(map[string]any{"vendors": core.WizardVendors, "matrix": core.VendorMatrix()})
	case "personas":
		l := *lang
		if l == "" {
			l = core.SystemLanguage()
		}
		_ = enc.Encode(core.PersonaPresets(l))
	case "apply":
		initConfigPath(*configFile)
		var raw []byte
		var err error
		switch *jsonPath {
		case "":
			fail(fmt.Errorf("--json <file|-> required"))
		case "-":
			raw, err = io.ReadAll(os.Stdin)
		default:
			raw, err = os.ReadFile(*jsonPath)
		}
		if err != nil {
			fail(err)
		}
		var req core.WizardRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			fail(fmt.Errorf("invalid JSON: %w", err))
		}
		if *dryRun {
			req.DryRun = true
		}
		// A dry run writes nothing, not even the first-run config: plan against an empty one.
		var store core.WizardStore = configWizardStore{}
		dataDir := ""
		_, statErr := os.Stat(config.ConfigPath)
		switch {
		case os.IsNotExist(statErr) && req.DryRun:
			store, dataDir = emptyWizardStore{}, defaultDataDir()
		case os.IsNotExist(statErr):
			// same first-run config as `cc-connect` writes (web admin on, this machine only)
			if err := bootstrapSetupConfig(config.ConfigPath); err != nil {
				fail(err)
			}
		}
		if dataDir == "" {
			cfg, err := config.LoadForSetup(config.ConfigPath)
			if err != nil {
				fail(err)
			}
			dataDir = cfg.DataDir
		}
		res := core.ApplyWizard(context.Background(), core.WizardEnv{Store: store, DataDir: dataDir, AlwaysWriteCmd: true}, req)
		if res.Saved {
			lang := req.Language
			if lang == "" {
				lang = core.SystemLanguage()
			}
			res.NextSteps = setupNextSteps(lang, *configFile, instanceRunning(config.ConfigPath), res.NeedsUserAction)
		}
		_ = enc.Encode(res)
		if !res.OK {
			os.Exit(1)
		}
	default:
		fail(fmt.Errorf("unknown setup subcommand %q", sub))
	}
}

// emptyWizardStore is a config with no projects, for a dry run before any config exists.
type emptyWizardStore struct{}

func (emptyWizardStore) Snapshot() (core.WizardSnapshot, error) { return core.WizardSnapshot{}, nil }
func (emptyWizardStore) ApplyProjects(func(core.WizardSnapshot) ([]core.WizardProjectWrite, error)) (string, error) {
	return "", fmt.Errorf("dry run: nothing is written")
}

// defaultDataDir is config.load's default data_dir (no data_dir in the config).
func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".cc-connect")
	}
	return ".cc-connect"
}

func fail(err error) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": err.Error()})
	os.Exit(1)
}

// bootstrapSetupConfig writes the first-run config: web admin on, nothing else.
func bootstrapSetupConfig(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	content := fmt.Sprintf(`# cc-connect (conest) — created on first run. Open the setup wizard in the browser;
# it adds one [[projects]] per bot. Manual reference: cc-connect config-example

[log]
level = "info"

[management]
enabled = true
host = "127.0.0.1" # this machine only; remove to listen on all interfaces
port = 9820 # 来源：沿用 cc-connect 管理接口默认端口
token = %q
`, core.GenerateToken(16))
	return os.WriteFile(path, []byte(content), 0o600)
}

// setupPortFromLink reads the port out of a setup link ("http://localhost:9820/login?…").
func setupPortFromLink(link string) int {
	var port int
	if i := strings.Index(link, "localhost:"); i >= 0 {
		fmt.Sscanf(link[i+len("localhost:"):], "%d", &port)
	}
	return port
}
