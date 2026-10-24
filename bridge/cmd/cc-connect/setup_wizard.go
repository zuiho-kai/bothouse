package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	ccconnect "github.com/chenhg5/cc-connect"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// configWizardStore implements core.WizardStore on top of config.toml.
type configWizardStore struct{}

func (configWizardStore) EnsureHook(event, command string) (bool, error) {
	return config.EnsureWizardHook(event, command)
}

func (bootstrapOnWriteStore) EnsureHook(event, command string) (bool, error) {
	return config.EnsureWizardHook(event, command) // called after ApplyProjects wrote the config
}

func toCoreSnapshot(ps []config.WizardProjectSnapshot) core.WizardSnapshot {
	out := core.WizardSnapshot{Projects: make([]core.WizardExistingProject, 0, len(ps))}
	for _, p := range ps {
		out.Projects = append(out.Projects, core.WizardExistingProject{Name: p.Name, AgentType: p.AgentType, WorkDir: p.WorkDir,
			AgentCmd: p.AgentCmd, Platforms: p.Platforms, GateURL: p.GateURL, GateFallback: p.GateFallback})
	}
	return out
}

// firstRunHeader starts the config bootstrapSetupConfig writes; the wizard's rewrite drops comments.
const firstRunHeader = "# bothouse (conest) — created on first run."

// IsFreshConfig: config.toml is still the first-run template (written by cc-connect or setup apply,
// no projects yet), so a backup of it holds nothing of the user's. Used by core.ApplyWizard for
// both the web wizard and setup apply.
func (configWizardStore) IsFreshConfig() bool {
	b, err := os.ReadFile(config.ConfigPath)
	if err != nil || !strings.HasPrefix(string(b), firstRunHeader) {
		return false
	}
	ps, err := config.WizardSnapshot()
	return err == nil && len(ps) == 0
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
				AgentArgs: w.AgentArgs, AgentEnv: w.AgentEnv, AgentOptions: w.AgentOptions,
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
			err = restartProcess(core.BinaryFromBackupPath(exe))
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
			fmt.Printf("你是通过 SSH 连进来的：向导只听这台机器的 127.0.0.1。在你自己的电脑上另开一个终端运行\n  ssh -L %d:127.0.0.1:%d <用户名>@<这台机器的地址>\n保持它开着，再在你自己电脑的浏览器里打开上面的链接。也可以不用网页：让 AI 跑 bothouse setup apply。\n", port, port)
		} else {
			fmt.Printf("You are on SSH: the wizard only listens on this machine's 127.0.0.1. On your own computer run\n  ssh -L %d:127.0.0.1:%d <user>@<this machine>\nkeep it open, then open the link above in your own browser. Or skip the web page: have an AI run bothouse setup apply.\n", port, port)
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
	cmd := "bothouse"
	if configFlag != "" {
		cmd += " --config " + quoteIfSpaced(configFlag)
	}
	// quick background try: nohup on macOS/Linux. Windows has no nohup: PowerShell's Start-Process,
	// with the log going to the file cc-connect itself writes (CC_LOG_FILE, main.go). CC_LOG_FILE is
	// removed again right after, so later commands in the same window are not redirected too.
	homeDir := filepath.Base(defaultDataDir())
	tryLog := "~/" + homeDir + "/run.log"
	tryCmd := "nohup " + cmd + " > " + tryLog + " 2>&1 &"
	if nextStepsGOOS == "windows" {
		start := "Start-Process bothouse -WindowStyle Hidden"
		if configFlag != "" {
			// Start-Process joins -ArgumentList with spaces and does not quote: a path with spaces
			// needs its own double quotes inside the single-quoted PowerShell string.
			start = `Start-Process bothouse -ArgumentList '--config','"` + strings.ReplaceAll(configFlag, "'", "''") + `"' -WindowStyle Hidden`
		}
		tryLog = `$HOME\` + homeDir + `\run.log`
		tryCmd = `$env:CC_LOG_FILE="` + tryLog + `"; ` + start + `; Remove-Item Env:CC_LOG_FILE`
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
		out = append(out, "bothouse 正在运行，重启后新配置才生效：在向导网页点「重启生效」；装成后台服务的运行 bothouse daemon restart；前台跑的按 Ctrl+C 后再运行 "+cmd)
	case running:
		out = append(out, "bothouse is running; restart it to use the new config: click \"Restart to apply\" in the wizard, or bothouse daemon restart for the service, or Ctrl+C and run "+cmd+" again")
	case zh:
		out = append(out, "后台启动并常驻（推荐，AI 也用这个，不要在前台跑 "+cmd+"，会一直占住终端）："+daemonCmd(configFlag)+"；看日志 bothouse daemon logs -f，出现 \"discord: connected\" 就是上线了，去频道里 @ 机器人说一句试试",
			"只想先临时试一下："+tryCmd+"（日志在 "+tryLog+"）")
	default:
		out = append(out, "Start in the background as a service (recommended, also for AI agents — do not run "+cmd+" in the foreground, it holds the terminal): "+daemonCmd(configFlag)+"; follow the log with bothouse daemon logs -f, \"discord: connected\" means it is online — @ the bot in the channel to try",
			"Just a quick try: "+tryCmd+" (log in "+tryLog+")")
	}
	return out
}

// cloudWebNextStep: how to check a role on the self-hosted platform (the Discord wording of
// setupNextSteps says "discord: connected"; cloud_web logs "cloud_web: websocket connected").
func cloudWebNextStep(lang, page string) string {
	switch {
	case strings.HasPrefix(strings.ToLower(lang), "zh"):
		return "自建平台：日志出现 \"cloud_web: websocket connected\" 就是连上了；打开平台网页 " + page + "（本机向导启动的平台用 bothouse setup hub 输出里的 open_url 登录），发一句「@角色名 你好」试试"
	case strings.HasPrefix(strings.ToLower(lang), "ja"):
		return "自前プラットフォーム：ログに \"cloud_web: websocket connected\" が出たら接続済みです。プラットフォームの Web ページ " + page + " を開き（このマシンでウィザードが起動したものは bothouse setup hub の open_url でログイン）、「@ロール名 こんにちは」と送ってみてください"
	}
	return "Self-hosted platform: \"cloud_web: websocket connected\" in the log means it is connected; open the platform's page " + page + " (for the one started on this machine, sign in with open_url from bothouse setup hub) and send \"@<role name> hi\""
}

// nextStepsGOOS is runtime.GOOS; swapped in tests.
var nextStepsGOOS = runtime.GOOS

// quoteIfSpaced wraps a path with spaces in double quotes (sh, zsh, bash and PowerShell all accept it).
func quoteIfSpaced(p string) string {
	if strings.ContainsAny(p, " \t") {
		return `"` + p + `"`
	}
	return p
}

func daemonCmd(configFlag string) string {
	if configFlag != "" {
		return "bothouse daemon install --config " + quoteIfSpaced(configFlag)
	}
	return "bothouse daemon install"
}

// runSetup: `cc-connect setup apply --json <file|->` (one-shot config for AI
// agents), `cc-connect setup clis`, `cc-connect setup matrix`, `cc-connect setup hub [start]`, `cc-connect setup personas`.
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
	if sub == "hooks" {
		runSetupHooks(args[1:])
		return
	}
	if sub == "lead" {
		runSetupLead(args[1:])
		return
	}
	if sub == "tools" {
		runSetupTools(args[1:])
		return
	}
	fs := flag.NewFlagSet("setup "+sub, flag.ExitOnError)
	if sub == "apply" {
		fs.Usage = func() {
			fmt.Fprint(fs.Output(), "Usage: bothouse setup apply --json <file|-> [--config path] [--dry-run]\n\nFlags:\n")
			fs.PrintDefaults()
			fmt.Fprint(fs.Output(), setupApplyFields)
		}
	}
	configFile := fs.String("config", "", "path to config file")
	jsonPath := fs.String("json", "", "wizard request JSON file, or - for stdin")
	dryRun := fs.Bool("dry-run", false, "validate and print the plan without writing")
	lang := fs.String("lang", "", "personas: language of the examples (zh|en; default: system). apply: reply language of the bots (zh|en|ja|…), same as \"language\" in the request")
	rest, hubStart := args[1:], false
	dshInstall := false
	if sub == "dsh" && len(rest) > 0 && rest[0] == "install" {
		dshInstall = true
		rest = rest[1:]
	}
	if sub == "hub" { // "setup hub start [--config path]": the word may come before or after the flags
		rest = nil
		for _, a := range args[1:] {
			if a == "start" {
				hubStart = true
				continue
			}
			rest = append(rest, a)
		}
	}
	_ = fs.Parse(rest)
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	switch sub {
	case "clis":
		clis := core.DetectLocalCLIs(context.Background())
		_ = enc.Encode(clis)
		if hint := setupCLIsHint(core.SystemLanguage(), clis); hint != "" {
			fmt.Fprintln(os.Stderr, hint) // stdout stays the JSON list
		}
	case "matrix":
		_ = enc.Encode(map[string]any{"vendors": core.WizardVendors, "matrix": core.VendorMatrix()})
	case "dsh":
		if dshInstall {
			st, err := core.InstallDSHPlugin(context.Background(), *lang, nil)
			if err != nil {
				fail(err)
				return
			}
			_ = enc.Encode(st)
		} else {
			_ = enc.Encode(core.GetDSHStatus(context.Background()))
		}
		return
	case "hub":
		// the self-hosted platform on this machine (core/setup_cloudweb.go); "start" starts it
		initConfigPath(*configFile)
		dataDir := defaultDataDir()
		if _, err := os.Stat(config.ConfigPath); err == nil {
			if cfg, err := config.LoadForSetup(config.ConfigPath); err == nil && cfg.DataDir != "" {
				dataDir = cfg.DataDir
			}
		}
		l := *lang
		if l == "" {
			l = core.SystemLanguage()
		}
		if hubStart {
			st, err := core.StartLocalHub(context.Background(), dataDir, l)
			if err != nil {
				fail(err)
			}
			_ = enc.Encode(st)
			return
		}
		_ = enc.Encode(core.GetLocalHubStatus(context.Background(), dataDir, l))
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
		if *lang != "" {
			req.Language = *lang
		}
		// No config yet: plan against an empty one. A dry run writes nothing; a real run writes the
		// first-run config only when it gets to writing projects, so a run that stops earlier (token
		// invalid, Discord rate limit …) leaves no config.toml behind and "nothing was written" holds.
		var store core.WizardStore = configWizardStore{}
		dataDir := ""
		_, statErr := os.Stat(config.ConfigPath)
		switch {
		case os.IsNotExist(statErr) && req.DryRun:
			store, dataDir = emptyWizardStore{}, defaultDataDir()
		case os.IsNotExist(statErr):
			store, dataDir = bootstrapOnWriteStore{}, defaultDataDir()
		}
		wikiSub := ""
		if dataDir == "" {
			cfg, err := config.LoadForSetup(config.ConfigPath)
			if err != nil {
				fail(err)
			}
			dataDir = cfg.DataDir
			wikiSub = subWikiScript(cfg)
		}
		env := core.WizardEnv{Store: store, DataDir: dataDir, AlwaysWriteCmd: true, WikiSubScript: wikiSub}
		if sock := resolveSocketPath(dataDir); !req.DryRun && fileExistsCmd(sock) && instanceRunning(config.ConfigPath) {
			env.Cron = socketCron{sock} // the running cc-connect owns the job file: add through it
		}
		res := core.ApplyWizard(context.Background(), env, req)
		if res.Saved {
			lang := req.Language
			if lang == "" {
				lang = core.SystemLanguage()
			}
			res.NextSteps = setupNextSteps(lang, *configFile, instanceRunning(config.ConfigPath), res.NeedsUserAction)
			if res.CloudWeb != nil {
				res.NextSteps = append(res.NextSteps, cloudWebNextStep(lang, res.CloudWeb.PageURL))
			}
		}
		_ = enc.Encode(res)
		if !res.OK {
			os.Exit(1)
		}
	default:
		fail(fmt.Errorf("unknown setup subcommand %q", sub))
	}
}

// setupCLIsHint explains an empty or not-logged-in `setup clis` list (printed to stderr).
func setupCLIsHint(lang string, clis []core.LocalCLI) string {
	zh := lang == "zh"
	supported, loggedIn := 0, 0
	for _, c := range clis {
		if c.Supported {
			supported++
			if c.Login == "logged_in" {
				loggedIn++
			}
		}
	}
	switch {
	case supported == 0 && zh:
		return "本机没找到 bothouse 能用的 CLI（claude / codex / gemini / opencode / dsh …，PATH 和 ~/.local/bin 等常见目录都找过）。先装一个并登录，例如 Claude Code：curl -fsSL https://claude.ai/install.sh | bash，然后 claude auth login；DSH：" + core.DSHInstallHint + "；装好再跑一次 bothouse setup clis。"
	case supported == 0:
		return "No agent CLI bothouse can use was found (claude / codex / gemini / opencode / dsh …; searched PATH and common dirs like ~/.local/bin). Install one and log in, e.g. Claude Code: curl -fsSL https://claude.ai/install.sh | bash, then claude auth login; DSH: " + core.DSHInstallHint + "; then run bothouse setup clis again."
	case loggedIn == 0 && zh:
		return "找到了 CLI，但没有一个确认已登录（login 不是 logged_in）。没登录的 CLI 配上去机器人答不出来：先登录（claude auth login / codex login / gemini / opencode auth login），再跑一次 bothouse setup clis。"
	case loggedIn == 0:
		return "CLIs were found but none is confirmed logged in (login is not logged_in). A bot on a CLI that is not logged in cannot answer: log in first (claude auth login / codex login / gemini / opencode auth login), then run bothouse setup clis again."
	}
	return ""
}

// emptyWizardStore is a config with no projects, for a dry run before any config exists.
type emptyWizardStore struct{}

func (emptyWizardStore) Snapshot() (core.WizardSnapshot, error) { return core.WizardSnapshot{}, nil }
func (emptyWizardStore) ApplyProjects(func(core.WizardSnapshot) ([]core.WizardProjectWrite, error)) (string, error) {
	return "", fmt.Errorf("dry run: nothing is written")
}

// bootstrapOnWriteStore is a config that does not exist yet: empty until the wizard writes
// projects, then the first-run config `cc-connect` writes (web admin on, this machine only) is
// created and the projects go into it.
type bootstrapOnWriteStore struct{}

func (bootstrapOnWriteStore) Snapshot() (core.WizardSnapshot, error) {
	return core.WizardSnapshot{}, nil
}
func (bootstrapOnWriteStore) IsFreshConfig() bool { return true }
func (bootstrapOnWriteStore) ApplyProjects(plan func(core.WizardSnapshot) ([]core.WizardProjectWrite, error)) (string, error) {
	if _, err := os.Stat(config.ConfigPath); os.IsNotExist(err) {
		if err := bootstrapSetupConfig(config.ConfigPath); err != nil {
			return "", err
		}
	}
	return configWizardStore{}.ApplyProjects(plan)
}

// defaultDataDir is config.load's default data_dir (no data_dir in the config).
func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return ccconnect.DataDir(home)
	}
	return ".bothouse"
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
	content := fmt.Sprintf(firstRunHeader+` Open the setup wizard in the browser;
# it adds one [[projects]] per bot. Manual reference: bothouse config-example

[log]
level = "info"

[management]
enabled = true
host = "127.0.0.1" # this machine only; remove to listen on all interfaces
port = 9820 # 来源：沿用 bothouse 管理接口默认端口
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

// subWikiScript: sub-wiki.sh of the config's agent.closed hook (bridge/contrib/wiki/README.md step 3), "" if none.
func subWikiScript(cfg *config.Config) string {
	var cmds []string
	for _, h := range cfg.Hooks {
		if h.Event == "agent.closed" && h.Type == "command" {
			cmds = append(cmds, h.Command)
		}
	}
	return core.SubWikiScriptFromHooks(cmds)
}

func fileExistsCmd(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func (c socketCron) SetExec(id, exec string) error {
	payload, _ := json.Marshal(map[string]any{"id": id, "field": "exec", "value": exec})
	resp, err := apiPost(c.sock, "/cron/edit", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cron edit: %s", strings.TrimSpace(string(body)))
	}
	return nil
}

// socketCron adds the wizard's cron jobs through a running cc-connect (its /cron/list and /cron/add), so the
// jobs start now and the running process does not write its older job list over them.
type socketCron struct{ sock string }

func (c socketCron) List() ([]*core.CronJob, error) {
	client := &http.Client{Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.Dial("unix", c.sock)
	}}}
	resp, err := client.Get("http://unix/cron/list")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("cron list: %s", strings.TrimSpace(string(body)))
	}
	var jobs []*core.CronJob
	return jobs, json.Unmarshal(body, &jobs)
}

func (c socketCron) Add(j *core.CronJob) error {
	payload, _ := json.Marshal(core.CronAddRequest{Project: j.Project, SessionKey: j.SessionKey, CronExpr: j.CronExpr,
		Exec: j.Exec, Description: j.Description, Mute: j.Mute, TimeoutMins: j.TimeoutMins})
	resp, err := apiPost(c.sock, "/cron/add", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cron add: %s", strings.TrimSpace(string(body)))
	}
	return nil
}
