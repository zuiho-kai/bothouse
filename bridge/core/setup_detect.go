package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ── Local CLI detection (wizard step 3: "只显示本机装了的") ───────────

// LocalCLI is one agent CLI found on this machine.
type LocalCLI struct {
	AgentType string `json:"agent_type"` // cc-connect agent type ("" = detected but cc-connect can't drive it)
	Label     string `json:"label"`
	Binary    string `json:"binary"`
	Path      string `json:"path"`
	InPath    bool   `json:"in_path"` // false = found in a common install dir outside PATH; the wizard writes Path into the agent's cmd
	Version   string `json:"version,omitempty"`
	// Login: "logged_in" (the CLI's own local login / OAuth found), "not_logged_in", "unknown".
	Login     string `json:"login"`
	Protocol  string `json:"protocol"` // what a third-party API must speak to be attached ("" = can't attach one)
	Supported bool   `json:"supported"`
	Note      string `json:"note,omitempty"`
}

type cliSpec struct {
	agentType, label string
	bins             []string
	protocol         string
	login            func(home string) string
	note             string
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func loginIf(ok bool) string {
	if ok {
		return "logged_in"
	}
	return "not_logged_in"
}

// jsonHasKey reports whether the JSON object in path has a non-null top-level key.
// Only the key's presence is checked; values are discarded and never logged.
func jsonHasKey(path, key string) bool {
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(b, &m) != nil {
		return false
	}
	v, ok := m[key]
	return ok && string(v) != "null"
}

// Binary names follow each agent's ParseCmdOpts default (agent/*/*.go).
// Login checks look at whether the CLI's own credential file exists. The one exception is
// Claude Code: ~/.claude.json exists for logged-out users too and the OAuth token itself
// lives in the macOS keychain, so the file is parsed and only the presence of the
// "oauthAccount" key is checked; values are discarded and never logged or returned.
var cliSpecs = []cliSpec{
	{"claudecode", "Claude Code", []string{"claude"}, ProtocolAnthropic, func(h string) string {
		if os.Getenv("ANTHROPIC_API_KEY") != "" || fileExists(filepath.Join(h, ".claude", ".credentials.json")) ||
			jsonHasKey(filepath.Join(h, ".claude.json"), "oauthAccount") {
			return "logged_in"
		}
		return "not_logged_in"
	}, ""},
	{"codex", "Codex", []string{"codex"}, ProtocolResponses, func(h string) string {
		dir := os.Getenv("CODEX_HOME")
		if dir == "" {
			dir = filepath.Join(h, ".codex")
		}
		return loginIf(os.Getenv("OPENAI_API_KEY") != "" || fileExists(filepath.Join(dir, "auth.json")))
	}, ""},
	{"gemini", "Gemini CLI", []string{"gemini"}, ProtocolGemini, func(h string) string {
		return loginIf(os.Getenv("GEMINI_API_KEY") != "" || fileExists(filepath.Join(h, ".gemini", "oauth_creds.json")))
	}, ""},
	{"opencode", "OpenCode", []string{"opencode"}, ProtocolOpenAIChat, func(h string) string {
		return loginIf(fileExists(filepath.Join(h, ".local", "share", "opencode", "auth.json")))
	}, ""},
	// DSH (npm @deepseek-ai/dsh): logged in = the official key variable, an account login, or the user's own
	// model setup in DSH's config (dshLogin).
	{"dsh", "DSH (DeepSeek Harness)", []string{"dsh"}, ProtocolAnthropic, dshLogin, ""},
	{"antigravity", "Antigravity CLI", []string{"agy"}, "", nil, ""},
	{"cursor", "Cursor Agent", []string{"cursor-agent", "agent"}, "", nil, ""},
	{"copilot", "GitHub Copilot", []string{"copilot"}, "", nil, ""},
	{"kimi", "Kimi", []string{"kimi"}, "", nil, ""},
	{"qoder", "Qoder", []string{"qodercli"}, "", nil, ""},
	{"iflow", "iFlow", []string{"iflow"}, "", nil, ""},
	{"pi", "Pi", []string{"pi"}, "", nil, ""},
	{"", "WorkBuddy", []string{"workbuddy", "codebuddy"}, "", nil,
		"bothouse 还没有 WorkBuddy 的适配器，装了只能显示，不能选 / no bothouse adapter yet"},
}

// extraBinDirs are common install locations that a service (launchd/systemd) PATH
// often lacks; checked after PATH. Sources: claude/codex/gemini installers
// (~/.local/bin), Homebrew (/opt/homebrew/bin, /usr/local/bin), npm -g with a user
// prefix (~/.npm-global/bin), bun (~/.bun/bin), cargo (~/.cargo/bin), go install (~/go/bin).
func extraBinDirs() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		// npm -g puts claude.cmd / codex.cmd in %APPDATA%\npm; Claude Code's native installer
		// uses %USERPROFILE%\.local\bin.
		dirs := []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".bun", "bin"),
			filepath.Join(home, ".cargo", "bin"), filepath.Join(home, "go", "bin")}
		if appData := os.Getenv("APPDATA"); appData != "" {
			dirs = append([]string{filepath.Join(appData, "npm")}, dirs...)
		}
		return dirs
	}
	return []string{
		filepath.Join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin",
		filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".bun", "bin"),
		filepath.Join(home, ".cargo", "bin"), filepath.Join(home, "go", "bin"),
	}
}

// lookPath finds bin on PATH (inPath = true), then in extraBinDirs. Replaceable in tests.
var lookPath = func(bin string) (path string, inPath bool, err error) {
	if p, err := exec.LookPath(bin); err == nil {
		if abs, err := filepath.Abs(p); err == nil { // PATH may hold relative dirs; cmd must be absolute
			p = abs
		}
		return p, true, nil
	}
	for _, d := range extraBinDirs() {
		// LookPath on a full path checks the exec bit on Unix and tries PATHEXT (.exe, .cmd …) on Windows.
		if p, err := exec.LookPath(filepath.Join(d, bin)); err == nil {
			return p, false, nil
		}
	}
	return "", false, exec.ErrNotFound
}

// identityOf: binaries with generic names ("agent", "pi") are only listed when
// they are really that CLI. Checked without running anything first (resolved
// path, the package.json next to an npm-installed script); `--help` only when
// that is inconclusive.
var identityOf = map[string][]string{
	"agent": {"cursor"},
	"pi":    {"pi-coding-agent"},
}

// helpOutput is replaceable in tests.
var helpOutput = func(ctx context.Context, path string) string {
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second) // 来源：沿用本文件 --version 探测的 5 秒
	defer cancel()
	b, _ := exec.CommandContext(tctx, path, "--help").CombinedOutput()
	return string(b)
}

// staticIdentity looks at the resolved path and, for npm installs, the package
// name in the nearest package.json above the script. ok=false means inconclusive.
func staticIdentity(path string, words []string) (match, ok bool) {
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		real = path
	}
	has := func(hay string) bool {
		hay = strings.ToLower(hay)
		for _, w := range words {
			if strings.Contains(hay, w) {
				return true
			}
		}
		return false
	}
	if has(real) {
		return true, true
	}
	for d, n := filepath.Dir(real), 0; n < 6 && d != filepath.Dir(d); d, n = filepath.Dir(d), n+1 { // 来源：npm 包 bin 脚本离 package.json 通常 1–3 层，6 层只是上限
		var pkg struct {
			Name string `json:"name"`
		}
		if b, err := os.ReadFile(filepath.Join(d, "package.json")); err == nil && json.Unmarshal(b, &pkg) == nil && pkg.Name != "" {
			return has(pkg.Name), true
		}
	}
	return false, false
}

func isGenuine(ctx context.Context, bin, path string) bool {
	words, generic := identityOf[bin]
	if !generic {
		return true
	}
	if match, ok := staticIdentity(path, words); ok {
		return match
	}
	help := strings.ToLower(helpOutput(ctx, path))
	for _, w := range words {
		if strings.Contains(help, w) {
			return true
		}
	}
	return false
}

// DetectLocalCLIs lists the agent CLIs installed on this machine (PATH and common
// install dirs, identity check for generic names, `--version`, local login state).
// Each CLI is probed in parallel, every command with a timeout. Not installed = omitted.
func DetectLocalCLIs(ctx context.Context) []LocalCLI {
	home, _ := os.UserHomeDir()
	var wg sync.WaitGroup
	out := make([]*LocalCLI, len(cliSpecs))
	for i, s := range cliSpecs {
		wg.Add(1)
		go func(i int, s cliSpec) {
			defer wg.Done()
			bin, path, inPath := "", "", false
			for _, b := range s.bins {
				if p, in, err := lookPath(b); err == nil && isGenuine(ctx, b, p) {
					bin, path, inPath = b, p, in
					break
				}
			}
			if path == "" && s.label == "WorkBuddy" && runtime.GOOS == "darwin" && fileExists("/Applications/WorkBuddy.app") {
				bin, path, inPath = "WorkBuddy.app", "/Applications/WorkBuddy.app", true
			}
			if path == "" {
				return
			}
			c := &LocalCLI{AgentType: s.agentType, Label: s.label, Binary: bin, Path: path, InPath: inPath, Protocol: s.protocol,
				Supported: s.agentType != "", Login: "unknown", Note: s.note}
			if s.login != nil {
				c.Login = s.login(home)
			}
			if !strings.HasSuffix(path, ".app") {
				tctx, cancel := context.WithTimeout(ctx, 5*time.Second) // 来源：沿用改动前本文件 --version 探测的 5 秒
				if b, err := exec.CommandContext(tctx, path, "--version").Output(); err == nil {
					v := strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
					if len(v) > 80 {
						v = v[:80]
					}
					c.Version = v
				}
				cancel()
			}
			out[i] = c
		}(i, s)
	}
	wg.Wait()
	res := make([]LocalCLI, 0, len(out))
	for _, c := range out {
		if c != nil {
			res = append(res, *c)
		}
	}
	return res
}

// ── Third-party API vendors × CLI ("几家 × CLI" matrix) ──────────────

// WizardVendor is a third-party API the wizard offers. Endpoints maps a
// protocol to the vendor's native endpoint for it; a protocol that is
// missing is served through the local converter from OpenAIBase.
type WizardVendor struct {
	ID         string            `json:"id"`
	Label      string            `json:"label"`
	OpenAIBase string            `json:"openai_base"` // /chat/completions base
	Endpoints  map[string]string `json:"endpoints"`   // protocol → native base URL
	Model      string            `json:"model,omitempty"`
	Thinking   string            `json:"thinking,omitempty"` // Claude Code thinking rewrite (see providerproxy.go)
	SignupURL  string            `json:"signup_url,omitempty"`
	Source     string            `json:"source"` // where the endpoints come from
}

// WizardVendors: the vendors named by the user (2026-10-20) plus local and custom.
// Sources are the vendors' own docs (checked 2026-10-20) or provider-presets.json.
var WizardVendors = []WizardVendor{
	{ID: "siliconflow", Label: "硅基流动 SiliconFlow", OpenAIBase: "https://api.siliconflow.cn/v1",
		Endpoints: map[string]string{ProtocolOpenAIChat: "https://api.siliconflow.cn/v1", ProtocolAnthropic: "https://api.siliconflow.cn"},
		Thinking:  "disabled", SignupURL: "https://cloud.siliconflow.cn",
		Source: "provider-presets.json siliconflow (claudecode base); providerproxy.go: SiliconFlow rejects adaptive thinking; no documented Responses/Gemini endpoint → converter"},
	{ID: "openrouter", Label: "OpenRouter", OpenAIBase: "https://openrouter.ai/api/v1",
		Endpoints: map[string]string{ProtocolOpenAIChat: "https://openrouter.ai/api/v1", ProtocolAnthropic: "https://openrouter.ai/api",
			ProtocolResponses: "https://openrouter.ai/api/v1"},
		SignupURL: "https://openrouter.ai/keys",
		Source:    "openrouter.ai/docs Claude Code integration (ANTHROPIC_BASE_URL=https://openrouter.ai/api); OpenRouter Responses API"},
	{ID: "deepseek", Label: "DeepSeek", OpenAIBase: "https://api.deepseek.com/v1", Model: "deepseek-chat",
		Endpoints: map[string]string{ProtocolOpenAIChat: "https://api.deepseek.com/v1", ProtocolAnthropic: "https://api.deepseek.com/anthropic",
			ProtocolResponses: "https://api.deepseek.com"},
		SignupURL: "https://platform.deepseek.com/api_keys",
		Source:    "api-docs.deepseek.com guides/anthropic_api and guides/responses_api"},
	{ID: "minimax", Label: "MiniMax（中国站）", OpenAIBase: "https://api.minimaxi.com/v1", Model: "MiniMax-M3",
		Endpoints: map[string]string{ProtocolOpenAIChat: "https://api.minimaxi.com/v1", ProtocolAnthropic: "https://api.minimaxi.com/anthropic",
			ProtocolResponses: "https://api.minimaxi.com/v1"},
		SignupURL: "https://platform.minimaxi.com",
		Source:    "provider-presets.json minimax-cn; platform.minimaxi.com docs token-plan/codex-cli (wire_api=responses)"},
	{ID: "minimax-intl", Label: "MiniMax (international)", OpenAIBase: "https://api.minimax.io/v1", Model: "MiniMax-M3",
		Endpoints: map[string]string{ProtocolOpenAIChat: "https://api.minimax.io/v1", ProtocolAnthropic: "https://api.minimax.io/anthropic",
			ProtocolResponses: "https://api.minimax.io/v1"},
		SignupURL: "https://platform.minimax.io",
		Source:    "provider-presets.json minimax; platform.minimax.io docs m-plan/codex"},
	{ID: "local", Label: "本机模型 Local (Ollama / LM Studio / llama.cpp …)", OpenAIBase: "http://127.0.0.1:11434/v1",
		Endpoints: map[string]string{ProtocolOpenAIChat: "http://127.0.0.1:11434/v1"},
		Source:    "any OpenAI-compatible local server; default port 11434 = Ollama's default. Everything else goes through the converter so it works whatever the server supports"},
	{ID: "custom", Label: "其他 OpenAI 兼容接口 / other OpenAI-compatible", Endpoints: map[string]string{},
		Source: "user-supplied base URL; non-OpenAI CLIs go through the converter"},
}

func wizardVendor(id string) (WizardVendor, bool) {
	for _, v := range WizardVendors {
		if v.ID == id {
			return v, true
		}
	}
	return WizardVendor{}, false
}

// MatrixCell says how vendor × CLI is attached.
type MatrixCell struct {
	Vendor    string `json:"vendor"`
	AgentType string `json:"agent_type"`
	Mode      string `json:"mode"` // "native" | "convert"
	BaseURL   string `json:"base_url"`
}

var protocolOfAgent = map[string]string{
	"claudecode": ProtocolAnthropic, "codex": ProtocolResponses, "gemini": ProtocolGemini, "opencode": ProtocolOpenAIChat,
	"dsh": ProtocolAnthropic, // DSH's llm-deepseek speaks Anthropic Messages only (POST <baseURL>/v1/messages)
}

// AttachableAgents are the CLIs a third-party API can be attached to.
var AttachableAgents = []string{"claudecode", "codex", "gemini", "opencode", "dsh"}

// nativeOnlyAgents take a third-party API only at the vendor's own endpoint for their protocol: DSH has no
// cc-connect provider (the API goes into a DSH config layer), so the local converter cannot sit in between.
var nativeOnlyAgents = map[string]bool{"dsh": true}

// VendorServes: vendor × agentType works (natively, or through the converter where the agent allows it).
func VendorServes(vendorID, agentType string) bool {
	v, ok := wizardVendor(vendorID)
	if !ok {
		return false
	}
	if !nativeOnlyAgents[agentType] {
		return true
	}
	_, native := v.Endpoints[protocolOfAgent[agentType]]
	return native
}

// VendorMatrix returns every vendor × attachable CLI combination.
func VendorMatrix() []MatrixCell {
	var out []MatrixCell
	for _, v := range WizardVendors {
		if v.ID == "custom" {
			continue
		}
		for _, at := range AttachableAgents {
			if !VendorServes(v.ID, at) {
				continue
			}
			p := ResolveWizardProvider(v.ID, at, v.OpenAIBase, "", v.Model)
			mode := "native"
			if p.APIFormat == APIFormatOpenAIChat {
				mode = "convert"
			}
			out = append(out, MatrixCell{Vendor: v.ID, AgentType: at, Mode: mode, BaseURL: p.BaseURL})
		}
	}
	return out
}

// ResolveWizardProvider builds the provider for vendor × agentType. baseURL
// overrides the vendor's OpenAI base (local / custom); empty = vendor default.
func ResolveWizardProvider(vendorID, agentType, baseURL, apiKey, model string) ProviderConfig {
	v, _ := wizardVendor(vendorID)
	if model == "" {
		model = v.Model
	}
	p := ProviderConfig{Name: "wizard-" + vendorID, APIKey: apiKey, Model: model}
	if vendorID == "" || vendorID == "custom" {
		p.Name = "wizard-custom"
	}
	proto := protocolOfAgent[agentType]
	custom := baseURL != "" && strings.TrimRight(baseURL, "/") != strings.TrimRight(v.OpenAIBase, "/")
	if ep, ok := v.Endpoints[proto]; ok && !custom {
		p.BaseURL = ep
		if proto == ProtocolAnthropic {
			p.Thinking = v.Thinking
		}
		if proto == ProtocolResponses {
			p.CodexWireAPI = "responses"
		}
		return p
	}
	if baseURL == "" {
		baseURL = v.OpenAIBase
	}
	p.BaseURL = strings.TrimRight(baseURL, "/")
	if proto != ProtocolOpenAIChat {
		p.APIFormat = APIFormatOpenAIChat
	}
	return p
}
