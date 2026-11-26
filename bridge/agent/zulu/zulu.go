package zulu

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

func init() {
	core.RegisterAgent("zulu", New)
}

// Agent drives the iDev Zulu CLI (`zulu run --display delta-stream`), locally or over SSH.
type Agent struct {
	cmd            string
	cliExtraArgs   []string
	configEnv      []string
	workDir        string
	remoteHost     string // optional SSH host
	relayHost      string // optional interactive SSH relay host
	sshArgs        []string
	username       string
	license        string
	ptoken         string
	oneAPIToken    string // passed as COMATE_AGENT_EXECUTION_ACCESS_TOKEN (matches iDev zulu-cli)
	model          string
	mode           string // "default" | "yolo"
	workMode       string // optional `zulu run --mode`: Agent | Ask | Plan | Cloud | Bot
	thinking       string
	effort         string // optional `zulu run --effort`: low | medium | high | extra_high | max
	platformPrompt string
	providers      []core.ProviderConfig
	activeIdx      int
	sessionEnv     []string
	mu             sync.Mutex
}

// New constructs a Zulu agent from [projects.agent.options].
func New(opts map[string]any) (core.Agent, error) {
	workDir, _ := opts["work_dir"].(string)
	if workDir == "" {
		workDir = "."
	}
	model, _ := opts["model"].(string)
	mode, _ := opts["mode"].(string)
	mode = normalizeMode(mode)
	workMode, _ := opts["zulu_mode"].(string)
	workMode = strings.TrimSpace(workMode)
	thinking, _ := opts["thinking"].(string)
	effort, _ := opts["effort"].(string)
	if effort == "" {
		effort, _ = opts["reasoning_effort"].(string)
	}
	effort = strings.TrimSpace(effort)
	oneAPIToken, _ := opts["one_api_token"].(string)
	oneAPIToken = strings.TrimSpace(oneAPIToken)
	remoteHost, _ := opts["remote_host"].(string)
	remoteHost = strings.TrimSpace(remoteHost)
	relayHost, _ := opts["relay_host"].(string)
	relayHost = strings.TrimSpace(relayHost)
	username, _ := opts["username"].(string)
	username = strings.TrimSpace(username)
	if username == "" && remoteHost == "" {
		username = core.DetectComateUsername()
	}
	if username == "" && remoteHost == "" {
		username = os.Getenv("ZULU_USERNAME")
	}
	if username == "" && remoteHost == "" {
		username = os.Getenv("USER")
	}
	license, _ := opts["license"].(string)
	ptoken, _ := opts["ptoken"].(string)
	var sshArgs []string
	switch args := opts["ssh_args"].(type) {
	case []string:
		sshArgs = append(sshArgs, args...)
	case []any:
		for _, v := range args {
			if arg, ok := v.(string); ok {
				sshArgs = append(sshArgs, arg)
			}
		}
	}

	cmd, extraArgs := core.ParseCmdOpts(opts, "zulu")
	if remoteHost == "" {
		resolved, err := core.ResolveCLI(cmd)
		if err != nil {
			return nil, fmt.Errorf("zulu: %q %w", cmd, core.ErrCLINotFound)
		}
		cmd = resolved
	}

	return &Agent{
		cmd:          cmd,
		cliExtraArgs: extraArgs,
		configEnv:    core.ParseConfigEnv(opts),
		workDir:      workDir,
		remoteHost:   remoteHost,
		relayHost:    relayHost,
		sshArgs:      sshArgs,
		username:     username,
		license:      license,
		ptoken:       ptoken,
		oneAPIToken:  oneAPIToken,
		model:        model,
		mode:         mode,
		workMode:     workMode,
		thinking:     thinking,
		effort:       effort,
		activeIdx:    -1,
	}, nil
}

func normalizeMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "yolo", "bypass", "auto-approve":
		return "yolo"
	default:
		return "default"
	}
}

func (a *Agent) Name() string           { return "zulu" }
func (a *Agent) CLIBinaryName() string  { return a.cmd }
func (a *Agent) CLIDisplayName() string { return "Zulu (iDev)" }

func (a *Agent) SetWorkDir(dir string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.workDir = dir
}

func (a *Agent) GetWorkDir() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.workDir
}

func (a *Agent) SetModel(model string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.model = model
	slog.Info("zulu: model changed", "model", model)
}

func (a *Agent) GetModel() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.model
}

func (a *Agent) SetMode(mode string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.mode = normalizeMode(mode)
}

func (a *Agent) GetMode() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mode
}

func (a *Agent) GetRemoteHost() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.remoteHost
}

func (a *Agent) GetRelayHost() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.relayHost
}

func (a *Agent) GetSSHArgs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.sshArgs...)
}

func (a *Agent) SetSessionEnv(env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sessionEnv = env
}

func (a *Agent) SetPlatformPrompt(prompt string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.platformPrompt = strings.TrimSpace(prompt)
}

func (a *Agent) SetReasoningEffort(effort string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.effort = strings.TrimSpace(effort)
}

func (a *Agent) GetReasoningEffort() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.effort
}

func (a *Agent) AvailableReasoningEfforts() []string {
	return []string{"low", "medium", "high", "extra_high", "max"}
}

func (a *Agent) SetProviders(providers []core.ProviderConfig) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.providers = append([]core.ProviderConfig(nil), providers...)
	if a.activeIdx >= len(a.providers) {
		a.activeIdx = -1
	}
}

func (a *Agent) SetActiveProvider(name string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if name == "" {
		a.activeIdx = -1
		return true
	}
	for i, p := range a.providers {
		if p.Name == name {
			a.activeIdx = i
			return true
		}
	}
	return false
}

func (a *Agent) GetActiveProvider() *core.ProviderConfig {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeIdx < 0 || a.activeIdx >= len(a.providers) {
		return nil
	}
	p := a.providers[a.activeIdx]
	return &p
}

func (a *Agent) ListProviders() []core.ProviderConfig {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]core.ProviderConfig(nil), a.providers...)
}

// resolveEnvLocked builds the child environment for zulu-cli, matching iDev's zulu-cli source:
//   - configEnv ([projects.agent.options.env])
//   - active provider Env + COMATE_AGENT_EXECUTION_ACCESS_TOKEN (one-api-token) if configured
//   - sessionEnv (bridge session variables)
func (a *Agent) resolveEnvLocked() []string {
	extraEnv := make([]string, 0, len(a.configEnv)+len(a.sessionEnv)+4)
	extraEnv = append(extraEnv, a.configEnv...)

	token := a.oneAPIToken
	if a.activeIdx >= 0 && a.activeIdx < len(a.providers) {
		p := a.providers[a.activeIdx]
		for k, v := range p.Env {
			extraEnv = append(extraEnv, k+"="+v)
		}
		if token == "" && strings.TrimSpace(p.APIKey) != "" {
			token = strings.TrimSpace(p.APIKey)
		}
	}
	if token != "" && !hasEnvKey(extraEnv, "COMATE_AGENT_EXECUTION_ACCESS_TOKEN") {
		extraEnv = append(extraEnv, "COMATE_AGENT_EXECUTION_ACCESS_TOKEN="+token)
	}
	extraEnv = append(extraEnv, a.sessionEnv...)
	return extraEnv
}

func hasEnvKey(env []string, key string) bool {
	prefix := key + "="
	for _, kv := range env {
		if strings.HasPrefix(kv, prefix) {
			return true
		}
	}
	return false
}

// AvailableModels queries `zulu list-model` (locally or via direct/relay SSH) and falls back to Auto on error.
func (a *Agent) AvailableModels(ctx context.Context) []core.ModelOption {
	a.mu.Lock()
	cmdPath := a.cmd
	remoteHost := a.remoteHost
	relayHost := a.relayHost
	sshArgs := append([]string(nil), a.sshArgs...)
	user := a.username
	a.mu.Unlock()

	if models := core.FetchZuluModels(ctx, cmdPath, remoteHost, relayHost, sshArgs, user, false); len(models) > 0 {
		return models
	}
	return []core.ModelOption{
		{Name: "Auto", Desc: "Zulu default model"},
	}
}

// WorkspaceAgentOptions implements core.WorkspaceAgentOptionSnapshotter.
func (a *Agent) WorkspaceAgentOptions() map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	opts := map[string]any{}
	if a.cmd != "" && a.cmd != "zulu" {
		opts["cmd"] = a.cmd
	}
	if a.username != "" {
		opts["username"] = a.username
	}
	if a.license != "" {
		opts["license"] = a.license
	}
	if a.ptoken != "" {
		opts["ptoken"] = a.ptoken
	}
	if a.oneAPIToken != "" {
		opts["one_api_token"] = a.oneAPIToken
	}
	if a.workMode != "" {
		opts["zulu_mode"] = a.workMode
	}
	if a.thinking != "" {
		opts["thinking"] = a.thinking
	}
	if a.effort != "" {
		opts["effort"] = a.effort
	}
	if a.remoteHost != "" {
		opts["remote_host"] = a.remoteHost
		opts["work_dir"] = a.workDir
	}
	if a.relayHost != "" {
		opts["relay_host"] = a.relayHost
	}
	if len(a.sshArgs) > 0 {
		opts["ssh_args"] = append([]string(nil), a.sshArgs...)
	}
	return opts
}

func (a *Agent) StartSession(_ context.Context, sessionID string) (core.AgentSession, error) {
	a.mu.Lock()
	extraEnv := a.resolveEnvLocked()
	sess := newZuluSession(
		a.cmd,
		append([]string(nil), a.cliExtraArgs...),
		a.workDir,
		a.remoteHost,
		a.relayHost,
		append([]string(nil), a.sshArgs...),
		a.username,
		a.license,
		a.ptoken,
		a.model,
		a.mode,
		a.workMode,
		a.thinking,
		a.effort,
		a.platformPrompt,
		sessionID,
		extraEnv,
	)
	a.mu.Unlock()
	return sess, nil
}

func (a *Agent) ListSessions(_ context.Context) ([]core.AgentSessionInfo, error) {
	return nil, nil
}

func (a *Agent) Stop() error {
	return nil
}

func attachDirForWorkDir(workDir string) string {
	return filepath.Join(workDir, ".cc-connect", "attachments")
}
