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
	// The sign-in link carries the token, so it goes into a file only you can read, not into the terminal/logs.
	linkFile := filepath.Join(filepath.Dir(configPath), "setup-link.txt")
	link := fmt.Sprintf("http://localhost:%d/login?token=%s&next=/setup\n", port, token)
	if err := os.WriteFile(linkFile, []byte(link), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "cannot write %s: %v\n", linkFile, err)
	}
	fmt.Printf("No projects yet — setup wizard on http://localhost:%d/setup (this machine only).\n", port)
	fmt.Printf("Sign-in link (with token): open the link in %s\n", linkFile)
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

// runSetup: `cc-connect setup apply --json <file|->` (one-shot config for AI
// agents), `cc-connect setup clis`, `cc-connect setup matrix`, `cc-connect setup personas`.
// Output is JSON on stdout.
func runSetup(args []string) {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: cc-connect setup apply --json <file|-> [--config path] [--dry-run]\n       cc-connect setup clis | matrix | personas [--lang zh|en]")
		os.Exit(2)
	}
	sub := args[0]
	fs := flag.NewFlagSet("setup "+sub, flag.ExitOnError)
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
		if _, err := os.Stat(config.ConfigPath); os.IsNotExist(err) {
			if err := os.MkdirAll(filepath.Dir(config.ConfigPath), 0o755); err != nil {
				fail(err)
			}
			if err := os.WriteFile(config.ConfigPath, []byte("[log]\nlevel = \"info\"\n"), 0o600); err != nil {
				fail(err)
			}
		}
		cfg, err := config.LoadForSetup(config.ConfigPath)
		if err != nil {
			fail(err)
		}
		var raw []byte
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
		res := core.ApplyWizard(context.Background(), core.WizardEnv{Store: configWizardStore{}, DataDir: cfg.DataDir, AlwaysWriteCmd: true}, req)
		_ = enc.Encode(res)
		if !res.OK {
			os.Exit(1)
		}
	default:
		fail(fmt.Errorf("unknown setup subcommand %q", sub))
	}
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
