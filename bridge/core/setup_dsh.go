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

	"gopkg.in/yaml.v3"
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
	// a credentials file alone is no login: the web UI's own browser session is stored there too
	refs, account := dshCredentials(dir)
	return loginIf(os.Getenv(dshDefaultKeyEnv) != "" || refs[dshDefaultKeyEnv] != "" || account || dshHasOwnModel(dir))
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

// DSHMaxImageDimension is the per-side pixel limit written for dsh-attachment-local (config maxImageDimension).
// Its default 8192 refuses long screenshots outright ("Image exceeds the configured per-side pixel limit");
// an accepted image is still scaled down to the normalized image budget before it goes to the model,
// so a higher limit does not make requests bigger. 65535 is the largest PNG/WebP side.
const DSHMaxImageDimension = 65535

// dshAttachmentID is DSH's attachment-local entry, the one that has maxImageDimension.
const dshAttachmentID = "attachment-local"

// dshAttachmentPatch is the overlay entry that raises the per-side limit (see DSHMaxImageDimension). DSH replaces
// an entry's whole config with a later layer's (cordis-plugin-include applyEntryPatches), so the entry carries the
// attachment-local config the user set in dshHome (profiles/acp/cordis.patch.yml, then cordis.patch.yml: DSH's
// layer order) and then the keys of own (the overlay's earlier config, nil = none), with maxImageDimension raised
// (as ConfigureDSH does in the web profile).
func dshAttachmentPatch(dshHome string, own *yaml.Node) (string, error) {
	home := DSHHome(dshHome)
	cfg := &yaml.Node{Kind: yaml.MappingNode}
	user := dshPatchEntryConfig(filepath.Join(home, "profiles", "acp", "cordis.patch.yml"), dshAttachmentID)
	if c := dshPatchEntryConfig(filepath.Join(home, "cordis.patch.yml"), dshAttachmentID); c != nil {
		user = c
	}
	for _, c := range []*yaml.Node{user, own} {
		if c == nil {
			continue
		}
		for i := 0; i+1 < len(c.Content); i += 2 {
			mapSet(cfg, c.Content[i].Value, c.Content[i+1])
		}
	}
	mapSet(cfg, "maxImageDimension", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: fmt.Sprint(DSHMaxImageDimension)})
	entry := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(entry, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: dshAttachmentID})
	mapSet(entry, "config", cfg)
	var buf strings.Builder
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&yaml.Node{Kind: yaml.SequenceNode, Content: []*yaml.Node{entry}}); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// dshPatchEntryConfig is the config the patch list at path gives entry id (the last `- id: <id>` with a config
// mapping wins, as in DSH); nil when there is none or the file cannot be read.
func dshPatchEntryConfig(path, id string) *yaml.Node {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc yaml.Node
	if yaml.Unmarshal(b, &doc) != nil || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.SequenceNode {
		return nil
	}
	var cfg *yaml.Node
	for _, it := range doc.Content[0].Content {
		if it.Kind != yaml.MappingNode || mapGet(it, "insert") != nil {
			continue
		}
		if v := mapGet(it, "id"); v != nil && v.Value == id {
			if c := mapGet(it, "config"); c != nil && c.Kind == yaml.MappingNode {
				cfg = c
			}
		}
	}
	return cfg
}

// EnsureDSHAttachmentPatch adds the attachment-local entry (dshAttachmentPatch) to a role's existing overlay that
// lacks maxImageDimension: roles set up before it was written get it at start. The rest of the overlay is kept;
// the entry goes before the hook bridge block. A missing overlay, or one that has it, is left as is.
func EnsureDSHAttachmentPatch(patch, dshHome string) (bool, error) {
	b, err := os.ReadFile(patch)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	own := dshPatchEntryConfig(patch, dshAttachmentID)
	if own != nil && mapGet(own, "maxImageDimension") != nil {
		return false, nil
	}
	entry, err := dshAttachmentPatch(dshHome, own)
	if err != nil {
		return false, err
	}
	s := string(b)
	head, tail := s, ""
	if i := strings.Index(s, dshPatchBegin); i >= 0 {
		head, tail = s[:i], s[i:]
	}
	if strings.TrimSpace(head) == "[]" {
		head = "" // an empty flow list cannot take block items after it
	}
	if head = strings.TrimRight(head, "\n"); head != "" {
		head += "\n"
	}
	return true, AtomicWriteFile(patch, []byte(head+entry+tail), 0o644)
}

// EnsureDSHRoleAttachmentPatch runs EnsureDSHAttachmentPatch for a DSH role from its agent options: the overlay
// is the args' --patch (roles without one are left alone), dsh_home is the role's DSH_HOME.
func EnsureDSHRoleAttachmentPatch(opts map[string]any) (bool, error) {
	var args []string
	switch a := opts["args"].(type) {
	case []string:
		args = a
	case []any:
		for _, v := range a {
			s, _ := v.(string)
			args = append(args, s)
		}
	}
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--patch" {
			return EnsureDSHAttachmentPatch(args[i+1], DSHHomeFromOptions(opts))
		}
	}
	return false, nil
}

// dshProviderPatch points llm-deepseek at the vendor's Anthropic endpoint and makes model the default.
func dshProviderPatch(project, baseURL, model string) string {
	q := func(s string) string { b, _ := json.Marshal(s); return string(b) } // JSON string = YAML double-quoted scalar
	// without inputModalities DSH tells the ACP client image=false and a pasted picture reaches the model only as a path
	modalities := "        inputModalities: [text, image]\n"
	return "# written by the bothouse setup wizard for role " + project + ": the third-party API picked in the wizard.\n" +
		"# The key is in this role's env " + DSHKeyEnv + " (config.toml). Everything else is the user's own DSH setup.\n" +
		"- id: llm-deepseek\n  config:\n    baseURL: " + q(baseURL) + "\n    apiKeyEnv: " + DSHKeyEnv + "\n" +
		"    models:\n      - id: " + q(model) + "\n" + modalities +
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
// keyEnv is the role's model key (dshModelSetup).
func dshRoleLaunch(dshPath, dataDir, project, workDir string, keyEnv map[string]string) (string, []string, map[string]string) {
	cmd, args := dshLaunch(dshPath)
	env := map[string]string{
		"UV_CACHE_DIR":      filepath.Join(workDir, ".cache", "uv"),
		"CONEST_LEAD_FILE":  filepath.Join(dataDir, "lead.json"),
		"BOTHOUSE_DATA_DIR": dataDir,
		// the home this DSH uses now ($DSH_HOME, else ~/.dsh), written down so the
		// usage page reads this role's session logs without asking the user
		"DSH_HOME": DSHHome(""),
	}
	args = append(args, "--patch", DSHPatchPath(dataDir, project))
	for k, v := range keyEnv {
		env[k] = v
	}
	return cmd, args, env
}

// writeDSHProviderPatch writes the role's overlay: the third-party API in p, or (p nil) the model setup from the
// user's own DSH home (dshOwnModelPatch), and the image size limit (dshAttachmentPatch); a hook bridge block already
// in it is kept. keyEnv (dshModelSetup) also goes to DSHEnvPath for runs outside the role's process.
func writeDSHProviderPatch(dataDir, project string, p *WizardProvider, keyEnv map[string]string) (string, error) {
	path := DSHPatchPath(dataDir, project)
	body, err := dshAttachmentPatch(DSHHome(""), nil)
	if err != nil {
		return "", err
	}
	var model string
	if p != nil {
		model, err = dshProviderBody(project, *p)
	} else {
		model, _, err = dshOwnModelPatch("")
	}
	if err != nil {
		return "", err
	}
	body = model + body
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if len(keyEnv) > 0 {
		// the wiki's dsh ingest runs outside the role's process, so it reads the key from this 0600 file
		var env strings.Builder
		for _, k := range sortedKeys(keyEnv) {
			env.WriteString(k + "=" + keyEnv[k] + "\n")
		}
		if err := AtomicWriteFile(DSHEnvPath(dataDir, project), []byte(env.String()), 0o600); err != nil {
			return "", err
		}
	}
	if old, err := os.ReadFile(path); err == nil {
		if i := strings.Index(string(old), dshPatchBegin); i >= 0 {
			body += string(old[i:])
		}
	}
	return path, AtomicWriteFile(path, []byte(body), 0o644)
}

func dshProviderBody(project string, p WizardProvider) (string, error) {
	base, err := dshProviderBase(p)
	if err != nil {
		return "", err
	}
	model := strings.TrimSpace(p.Model)
	if model == "" {
		v, _ := wizardVendor(p.Vendor)
		model = v.Model
	}
	if model == "" {
		return "", fmt.Errorf("%s: model is required", p.Vendor)
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
	return AgentHookSettingsPath(agentType, workDir)
}
