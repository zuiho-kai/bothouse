package core

// DSH (DeepSeek Harness, npm @deepseek-ai/dsh) in the setup wizard.
//
// cc-connect is the forwarding layer: it runs the dsh the user already installed, with the user's own
// DSH_HOME (login, models, settings). It does not install, pin or patch DSH, and it does not change DSH's
// own defaults (telemetry, persona prefix, sandbox, search, image settings). What it adds is only what its
// own plug-ins need:
//   - a third-party API picked in the wizard: a per-role overlay (dsh --patch <file>) in cc-connect's data
//     dir with the vendor's Anthropic endpoint and model; the key goes into the role's env;
//   - hooks: DSH's official Claude Code hook bridge (@deepseek-ai/dsh-hooks-claude-code). It is a
//     devDependency of @deepseek-ai/dsh, so a plain `npm i -g @deepseek-ai/dsh` does not bring it; when it is
//     not next to the user's dsh the wizard installs it into <data_dir>/dsh-hooks/<dsh version>/ (never into
//     the user's global npm) — see EnsureDSHHookBridge for where it is mounted;
//   - small tools under DSH's own sandbox: UV_CACHE_DIR inside the work dir (the sandbox only lets a tool
//     write the work dir and the temp dirs; uv's default ~/.cache/uv fails with "Operation not permitted").

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// DSHKeyEnv is the env variable that carries a wizard-picked API key to DSH (llm-deepseek apiKeyEnv).
const DSHKeyEnv = "DSH_WIZARD_API_KEY"

// DSHInstallHint is the one line shown when DSH is not installed (the bridge is its own package, see above).
const DSHInstallHint = "npm i -g @deepseek-ai/dsh @deepseek-ai/dsh-hooks-claude-code"

// dshLogin: the official key variable (dsh-llm-deepseek-api-key), an account login ($DSH_HOME/.credentials.yaml,
// dsh-credentials-local), or the user's own model setup (llm-deepseek in the home layer or the acp profile).
func dshLogin(h string) string {
	dir := os.Getenv("DSH_HOME")
	if strings.TrimSpace(dir) == "" {
		dir = filepath.Join(h, ".dsh")
	}
	return loginIf(os.Getenv("DEEPSEEK_API_KEY") != "" || fileExists(filepath.Join(dir, ".credentials.yaml")) ||
		dshHasOwnModel(dir))
}

func dshHasOwnModel(dshHome string) bool {
	for _, p := range []string{filepath.Join(dshHome, "cordis.patch.yml"), filepath.Join(dshHome, "profiles", "acp", "cordis.patch.yml")} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		s := string(b)
		if strings.Contains(s, "llm-deepseek") && (strings.Contains(s, "baseURL") || strings.Contains(s, "apiKeyEnv")) {
			return true
		}
	}
	return false
}

// DSHPatchPath is the role's overlay (dsh --patch), every DSH role has one: the third-party API picked in the
// wizard (if any) and the hook bridge (EnsureDSHHookBridge). The user's own $DSH_HOME is not written.
func DSHPatchPath(dataDir, project string) string {
	return filepath.Join(dataDir, "dsh", project+".patch.yml")
}

// DSHEnvPath holds the role's wizard-picked key as KEY=VALUE (0600) for runs outside the role's own process (the wiki's
// dsh engine runs from cron, which does not get the role's env).
func DSHEnvPath(dataDir, project string) string {
	return filepath.Join(dataDir, "dsh", project+".env")
}

// dshProviderPatch points llm-deepseek at the vendor's Anthropic endpoint and makes model the default.
func dshProviderPatch(project, baseURL, model string) string {
	q := func(s string) string { b, _ := json.Marshal(s); return string(b) } // JSON string = YAML double-quoted scalar
	return "# written by the bothouse setup wizard for role " + project + ": the third-party API picked in the wizard.\n" +
		"# The key is in this role's env " + DSHKeyEnv + " (config.toml). Everything else is the user's own DSH setup.\n" +
		"- id: llm-deepseek\n  config:\n    baseURL: " + q(baseURL) + "\n    apiKeyEnv: " + DSHKeyEnv + "\n" +
		"    models:\n      - id: " + q(model) + "\n" +
		"- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: " + q(model) + "\n" +
		"- id: acp\n  config:\n    provider: deepseek-official\n    model: " + q(model) + "\n"
}

// dshLaunch: how cc-connect starts the user's dsh. dsh is a node script (#!/usr/bin/env node) and a service
// PATH (launchd/systemd) often has no node, so on Unix cmd = the absolute node and args start with the script.
// Windows (dsh.cmd) and a dsh that is not a node script run as they are.
func dshLaunch(dshPath string) (cmd string, args []string) {
	args = []string{"--profile", "acp"}
	if runtime.GOOS == "windows" || dshPath == "" {
		return dshPath, args
	}
	script := dshPath
	if real, err := filepath.EvalSymlinks(dshPath); err == nil {
		script = real
	}
	f, err := os.Open(script)
	if err != nil {
		return dshPath, args
	}
	head := make([]byte, 128)
	n, _ := f.Read(head)
	f.Close()
	line := strings.SplitN(string(head[:n]), "\n", 2)[0]
	if !strings.HasPrefix(line, "#!") || !strings.Contains(line, "node") {
		return dshPath, args
	}
	node, _, err := lookPath("node")
	if err != nil {
		return dshPath, args
	}
	return node, append([]string{script}, args...)
}

// dshRoleLaunch is what the wizard writes for a DSH role: cmd, args and env.
func dshRoleLaunch(dshPath, dataDir, project, workDir string, p *WizardProvider) (string, []string, map[string]string) {
	cmd, args := dshLaunch(dshPath)
	env := map[string]string{"UV_CACHE_DIR": filepath.Join(workDir, ".cache", "uv")}
	args = append(args, "--patch", DSHPatchPath(dataDir, project))
	if p != nil {
		env[DSHKeyEnv] = p.APIKey
	}
	return cmd, args, env
}

// writeDSHProviderPatch writes the role's overlay: the third-party API in p (nil = the user's own model setup,
// an empty overlay "[]"); a hook bridge block already in it is kept.
func writeDSHProviderPatch(dataDir, project string, p *WizardProvider) (string, error) {
	path := DSHPatchPath(dataDir, project)
	body := "[]\n"
	if p != nil {
		var err error
		if body, err = dshProviderBody(project, *p); err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", err
		}
		// the wiki's dsh ingest runs outside the role's process, so it reads the key from this 0600 file
		if err := AtomicWriteFile(DSHEnvPath(dataDir, project), []byte(DSHKeyEnv+"="+p.APIKey+"\n"), 0o600); err != nil {
			return "", err
		}
	}
	if old, err := os.ReadFile(path); err == nil {
		if i := strings.Index(string(old), dshPatchBegin); i >= 0 {
			if strings.TrimSpace(body) == "[]" {
				body = ""
			}
			body += string(old[i:])
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	return path, AtomicWriteFile(path, []byte(body), 0o644)
}

func dshProviderBody(project string, p WizardProvider) (string, error) {
	v, _ := wizardVendor(p.Vendor)
	base := v.Endpoints[ProtocolAnthropic]
	if base == "" {
		return "", fmt.Errorf("%s has no Anthropic endpoint, which DSH needs", p.Vendor)
	}
	model := strings.TrimSpace(p.Model)
	if model == "" {
		model = v.Model
	}
	return dshProviderPatch(project, base, model), nil
}

var dshVersionRe = regexp.MustCompile(`\d+\.\d+\.\d+[0-9A-Za-z.+-]*`)

// dshHookBridgeDir is where the wizard installs the bridge for one dsh version.
func dshHookBridgeDir(dataDir, version string) string {
	if version == "" {
		version = "latest"
	}
	return filepath.Join(dataDir, "dsh-hooks", version)
}

// npmInstall is replaceable in tests.
var npmInstall = func(ctx context.Context, dir, pkg string) error {
	npm, _, err := lookPath("npm")
	if err != nil {
		return fmt.Errorf("npm not found: install the hook bridge with: npm i -g %s", pkg)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	// 来源：本机实测 npm install 这个包 9 秒（2026-10-22）；给慢网络留足余量
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, npm, "install", "--prefix", dir, "--no-audit", "--no-fund", "--no-save", pkg)
	if node, _, err := lookPath("node"); err == nil { // npm's own shebang needs node on PATH
		c.Env = MergeEnv(os.Environ(), []string{"PATH=" + filepath.Dir(node) + string(os.PathListSeparator) + os.Getenv("PATH")})
	}
	if out, err := c.CombinedOutput(); err != nil {
		s := strings.TrimSpace(string(out))
		if len(s) > 400 {
			s = s[len(s)-400:]
		}
		return fmt.Errorf("npm install %s: %v: %s", pkg, err, s)
	}
	return nil
}

// EnsureDSHBridgeFor finds the hook bridge for the dsh at dshPath (next to it, else a copy the wizard installed
// earlier), else installs the version that matches dsh into the data dir.
func EnsureDSHBridgeFor(ctx context.Context, dataDir, dshPath, dshVersion string) (string, error) {
	if dshPath != "" {
		if b, err := findDSHBridgeNear(dshPath); err == nil {
			return b, nil
		}
	}
	ver := dshVersionRe.FindString(dshVersion)
	dir := dshHookBridgeDir(dataDir, ver)
	entry := filepath.Join(dir, "node_modules", "@deepseek-ai", filepath.FromSlash(dshBridgeRel))
	if fileExists(entry) {
		return entry, nil
	}
	pkg := "@deepseek-ai/dsh-hooks-claude-code"
	if ver != "" {
		pkg += "@" + ver
	}
	if err := npmInstall(ctx, dir, pkg); err != nil {
		return "", err
	}
	if !fileExists(entry) {
		return "", fmt.Errorf("installed %s but %s is missing", pkg, entry)
	}
	return entry, nil
}

// wizardDSH is the detected dsh (zero value when there is none).
func wizardDSH(clis []LocalCLI) LocalCLI {
	for _, c := range clis {
		if c.AgentType == "dsh" {
			return c
		}
	}
	return LocalCLI{}
}

// hookSettingsShown is the hook file the wizard reports: for DSH the role's overlay that mounts the bridge.
func hookSettingsShown(agentType, workDir string, h *AgentHookResult) string {
	if agentType == "dsh" {
		if h != nil && h.DSHPatchFile != "" {
			return h.DSHPatchFile
		}
		return DSHHookSettingsPath(workDir)
	}
	if h != nil {
		return h.SettingsFile
	}
	return AgentHookSettingsPath(workDir)
}
