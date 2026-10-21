package core

// Setup wizard (conest): one request configures platform → bots → per-role CLI
// (+ optional third-party API) → persona → jev → fallback role. The web wizard,
// `cc-connect setup apply` and POST /api/v1/setup/apply all go through ApplyWizard.
//
//   web wizard ─┐
//   AI / curl ──┼─▶ ApplyWizard ─▶ WizardStore (config.toml)   one project per bot
//   CLI ────────┘                ├▶ <work_dir>/CLAUDE.md|AGENTS.md|…  persona (same file the
//                                │                                     project page and /memory edit)
//                                ├▶ <data_dir>/jev.json       gate + role-household router
//                                ├▶ <data_dir>/gate-team.json gate team (lead = fallback role)
//                                └▶ <data_dir>/conest-setup.json default server/channel/chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ── request / result ───────────────────────────────────────────

type WizardRequest struct {
	Platform string `json:"platform"` // "discord" (default) | "feishu" | "lark"
	Language string `json:"language,omitempty"`
	Discord  *struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"` // default chat channel
	} `json:"discord,omitempty"`
	Feishu        *WizardFeishu `json:"feishu,omitempty"`
	Roles         []WizardRole  `json:"roles"`
	FallbackRole  string        `json:"fallback_role,omitempty"`   // project name; default = first role
	FallbackBotID string        `json:"fallback_bot_id,omitempty"` // or the Discord bot ID (wins; the web wizard sends this)
	Jev           *WizardJev    `json:"jev,omitempty"`
	// AllowFrom: Discord user IDs (comma-separated) the bots take orders from; "*" = anyone in the server.
	// Not given = the owner of each bot's Discord application (looked up with the token).
	// Written to new bots and to existing bots whose allow_from is still empty; a non-empty one is kept.
	AllowFrom *string `json:"allow_from,omitempty"`
	DryRun    bool    `json:"dry_run,omitempty"`
}

type WizardFeishu struct {
	AppID        string `json:"app_id"`
	AppSecret    string `json:"app_secret"`
	PlatformType string `json:"platform_type,omitempty"` // feishu | lark
	OwnerOpenID  string `json:"owner_open_id,omitempty"`
	ChatID       string `json:"chat_id,omitempty"` // default group chat
}

type WizardRole struct {
	Project       string          `json:"project,omitempty"`
	Name          string          `json:"name,omitempty"`
	Token         string          `json:"token,omitempty"`         // discord bot token (new bot)
	ReuseProject  string          `json:"reuse_project,omitempty"` // or reuse the bot of an existing project
	AgentType     string          `json:"agent_type,omitempty"`
	WorkDir       string          `json:"work_dir,omitempty"`
	Persona       string          `json:"persona,omitempty"`
	EditPersona   bool            `json:"edit_persona,omitempty"` // an existing bot's persona file is only written when this is true
	ReplyLanguage string          `json:"reply_language,omitempty"`
	Provider      *WizardProvider `json:"provider,omitempty"` // nil = the CLI's own local login
}

type WizardProvider struct {
	Vendor  string `json:"vendor"` // siliconflow | openrouter | deepseek | minimax | minimax-intl | local | custom
	BaseURL string `json:"base_url,omitempty"`
	APIKey  string `json:"api_key,omitempty"`
	Model   string `json:"model,omitempty"`
}

type WizardJev struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key,omitempty"`
	Model   string `json:"model"`
	Remove  bool   `json:"remove,omitempty"` // stop using jev: delete jev.json (an empty base_url alone keeps the one in use)
}

type WizardStep struct {
	Step   string `json:"step"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

type WizardRoleResult struct {
	Project        string `json:"project"`
	Name           string `json:"name"`
	AgentType      string `json:"agent_type"`
	WorkDir        string `json:"work_dir"`
	PersonaFile    string `json:"persona_file"`
	BotID          string `json:"bot_id,omitempty"`
	InviteURL      string `json:"invite_url,omitempty"`
	InGuild        *bool  `json:"in_guild,omitempty"`
	Provider       string `json:"provider,omitempty"`
	ProviderVia    string `json:"provider_via,omitempty"` // native | convert
	Fallback       bool   `json:"fallback"`
	Reused         bool   `json:"reused"`
	PersonaWritten bool   `json:"persona_written"` // false = the persona file was not written (existing bot left alone, or dry run)
	// ReplyLanguage is the language written into the persona ("zh", "zh-TW", "en", "ja", "ko", …),
	// ReplyLanguageFrom where it came from: role (reply_language) | request (language) |
	// system (this machine's locale) | existing (an existing bot's file, not touched).
	ReplyLanguage     string `json:"reply_language,omitempty"`
	ReplyLanguageName string `json:"reply_language_name,omitempty"`
	ReplyLanguageFrom string `json:"reply_language_from,omitempty"`
}

// WizardWarning is something the user still has to do (or should know) after apply.
// Blocking ones mean the bot will not work until it is done, so the result is not ok.
type WizardWarning struct {
	Code     string `json:"code"` // message_content_intent_off | message_content_intent_unknown | bot_not_in_guild | allow_from_unknown | allow_from_everyone | gate_not_running | discord_token_invalid | agent_not_logged_in | agent_login_unknown | reply_language_default
	Project  string `json:"project,omitempty"`
	Blocking bool   `json:"blocking"`
	Message  string `json:"message"`
	Fix      string `json:"fix"`
	URL      string `json:"url,omitempty"` // invite link / Developer Portal page to open
}

type WizardResult struct {
	// OK: nothing failed and nothing blocking is left for the user. A saved config with a
	// blocking warning (intent off, bot not in the server) is saved=true, ok=false.
	OK              bool               `json:"ok"`
	Saved           bool               `json:"saved"`
	NeedsUserAction bool               `json:"needs_user_action"`
	Warnings        []WizardWarning    `json:"warnings"`
	InviteURLs      []string           `json:"invite_urls,omitempty"` // bots not in the server yet: open each link to add it
	AllowFrom       string             `json:"allow_from,omitempty"`  // who the new bots take orders from
	GateRunning     *bool              `json:"gate_running,omitempty"`
	GateHint        string             `json:"gate_hint,omitempty"`
	NextSteps       []string           `json:"next_steps,omitempty"` // how to start / restart (filled by the caller that knows)
	DryRun          bool               `json:"dry_run"`
	Steps           []WizardStep       `json:"steps"`
	Roles           []WizardRoleResult `json:"roles"`
	FallbackRole    string             `json:"fallback_role,omitempty"`
	Jev             *JevTestResult     `json:"jev_test,omitempty"`
	JevOK           bool               `json:"jev_ok"`               // a jev that returns probabilities is saved (now or earlier)
	JevReason       string             `json:"jev_reason,omitempty"` // why the jev in this request was not saved
	JevInUse        string             `json:"jev_in_use,omitempty"` // "model @ url" of the jev in effect after this request ("" = none)
	JevHint         string             `json:"jev_hint"`
	Hardware        bool               `json:"hardware"`
	RestartRequired bool               `json:"restart_required"`
	ConfigBackup    string             `json:"config_backup,omitempty"` // copy of config.toml taken before the write
	Error           string             `json:"error,omitempty"`
}

// ── store (implemented in cmd/cc-connect on top of config/) ─────

type WizardProjectWrite struct {
	Name, AgentType, WorkDir, PlatformType string
	AgentCmd                               string         // absolute CLI path when it was found outside PATH (L2); "" = leave
	Options                                map[string]any // merged into the platform's options; "" deletes a key
	GateURL, GateFallback                  *string
	Provider                               *ProviderConfig
	FeishuOwnerOpenID                      string // feishu: merged into allow_from when it is empty
}

// WizardExistingProject is one [[projects]] entry as read from config.toml.
// Options include secrets; they never leave the server.
type WizardExistingProject struct {
	Name, AgentType, WorkDir, AgentCmd string
	Platforms                          map[string]map[string]any // platform type → options (first of each type)
	GateURL, GateFallback              string
}

// WizardSnapshot is config.toml's projects at one moment.
type WizardSnapshot struct {
	Projects []WizardExistingProject
}

func (s WizardSnapshot) project(name string) (WizardExistingProject, bool) {
	for _, p := range s.Projects {
		if p.Name == name {
			return p, true
		}
	}
	return WizardExistingProject{}, false
}

// WizardExistingBot is a Discord bot already in the local config. Token and options stay server-side.
type WizardExistingBot struct {
	Project      string         `json:"project"`
	AgentType    string         `json:"agent_type"`
	WorkDir      string         `json:"work_dir,omitempty"`
	BotID        string         `json:"bot_id,omitempty"`
	GuildID      string         `json:"guild_id,omitempty"`
	Token        string         `json:"-"`
	Options      map[string]any `json:"-"`
	GateURL      string         `json:"-"`
	GateFallback string         `json:"-"`
	TokenError   string         `json:"token_error,omitempty"` // token = "${VAR}" but VAR is not set
}

// Same placeholder syntax and rule as config.resolveEnvPlaceholders (config/config.go): ${VAR} → env, unset → "".
var envRefPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandEnvRefs expands ${VAR} in a token read raw from config.toml (snapshots keep the
// placeholder so the wizard never writes the secret back) and names the first unset variable.
func expandEnvRefs(s string) (out, missing, empty string) {
	out = envRefPattern.ReplaceAllStringFunc(s, func(m string) string {
		name := envRefPattern.FindStringSubmatch(m)[1]
		v, ok := os.LookupEnv(name)
		if !ok && missing == "" {
			missing = name
		}
		if ok && v == "" && empty == "" {
			empty = name
		}
		return v
	})
	return out, missing, empty
}

// DiscordBots lists the snapshot's projects that have a Discord platform.
func (s WizardSnapshot) DiscordBots() []WizardExistingBot {
	out := []WizardExistingBot{}
	for _, p := range s.Projects {
		opts, ok := p.Platforms["discord"]
		if !ok {
			continue
		}
		raw, _ := opts["token"].(string)
		gid, _ := opts["guild_id"].(string)
		// Token is for the Discord API calls; Options keep the raw "${VAR}" text.
		tok, missing, empty := expandEnvRefs(raw)
		b := WizardExistingBot{Project: p.Name, AgentType: p.AgentType, WorkDir: p.WorkDir, Token: tok,
			GuildID: gid, BotID: DiscordBotIDFromToken(tok), Options: opts, GateURL: p.GateURL, GateFallback: p.GateFallback}
		switch {
		case missing != "":
			b.Token = ""
			b.TokenError = fmt.Sprintf("token is %s but %s is not set in this process's environment", raw, missing)
		case empty != "":
			b.Token = ""
			b.TokenError = fmt.Sprintf("token is %s but %s is set to an empty value", raw, empty)
		}
		out = append(out, b)
	}
	return out
}

type WizardStore interface {
	// Snapshot reads config.toml (no lock held afterwards; for previews and checks).
	Snapshot() (WizardSnapshot, error)
	// ApplyProjects takes the config lock (in-process and cross-process), reads the
	// current config, calls plan with it, applies the returned writes and saves once
	// (temp file + rename). It returns the path of the backup taken before writing.
	ApplyProjects(plan func(WizardSnapshot) ([]WizardProjectWrite, error)) (backup string, err error)
}

// WizardEnv carries what ApplyWizard needs besides the request.
type WizardEnv struct {
	Store   WizardStore
	DataDir string
	CLIs    []LocalCLI // nil = detect
	// AlwaysWriteCmd: write the detected absolute CLI path into the agent's cmd even when the
	// CLI is on this PATH. The command-line entry sets it: a shell PATH says nothing about the
	// PATH launchd/systemd gives the service later. Projects that already have cmd keep it.
	AlwaysWriteCmd bool
}

// ── files written next to config.toml ─────────────────────────

// SetupState is <data_dir>/conest-setup.json (no secrets).
type SetupState struct {
	Platform     string           `json:"platform"`
	Language     string           `json:"language,omitempty"`
	GuildID      string           `json:"guild_id,omitempty"`
	ChannelID    string           `json:"channel_id,omitempty"`
	FeishuChatID string           `json:"feishu_chat_id,omitempty"`
	FallbackRole string           `json:"fallback_role,omitempty"`
	Team         []SetupTeamEntry `json:"team,omitempty"`
	UpdatedAt    string           `json:"updated_at,omitempty"`
}

type SetupTeamEntry struct {
	Project   string `json:"project"`
	Name      string `json:"name"`
	BotID     string `json:"bot_id,omitempty"`
	AgentType string `json:"agent_type,omitempty"`
}

// JevConfig is <data_dir>/jev.json — read by contrib/gate (scorer) and by
// role-household ([discord.router] key_file). api_key matches the key_file JSON format.
type JevConfig struct {
	Backend  string `json:"backend"` // "llm" (OpenAI-compatible)
	URL      string `json:"url"`
	Model    string `json:"model"`
	APIKey   string `json:"api_key,omitempty"`
	Logprobs bool   `json:"logprobs"`
	TestedAt string `json:"tested_at,omitempty"`
	// request knobs the test found to work; contrib/gate/scorer_remote.py uses the same
	TopLogprobs int  `json:"top_logprobs,omitempty"`
	NoThinking  bool `json:"no_thinking"`
}

const (
	setupStateFile = "conest-setup.json"
	jevFile        = "jev.json"
	gateTeamFile   = "gate-team.json"
	// 来源：contrib/gate/gate.py PORT = 9930，config.example.toml 的 gate_url 示例。
	defaultGateURL = "http://127.0.0.1:9930/decide"
)

// 来源：role-household roles.example.toml [xiaozhi] port = 8791（固件默认 OTA 端口）。变量便于测试替换。
var roleHouseholdAddr = "127.0.0.1:8791"

func readJSONFile(path string, v any) bool {
	b, err := os.ReadFile(path)
	return err == nil && json.Unmarshal(b, v) == nil
}

func writeJSONFile(path string, v any, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	return AtomicWriteFile(path, append(b, '\n'), mode)
}

func LoadSetupState(dataDir string) SetupState {
	var s SetupState
	readJSONFile(filepath.Join(dataDir, setupStateFile), &s)
	return s
}

func LoadJevConfig(dataDir string) (JevConfig, bool) {
	var j JevConfig
	ok := readJSONFile(filepath.Join(dataDir, jevFile), &j) && j.URL != ""
	return j, ok
}

// HardwarePresent reports whether a role-household host (board server) is running locally.
func HardwarePresent() bool {
	c, err := net.DialTimeout("tcp", roleHouseholdAddr, 300*time.Millisecond) // 本机连接，300ms 足够（timeout）
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// SystemReplyLanguage is the reply-language code of the process locale (LC_ALL / LC_MESSAGES /
// LANG, e.g. "ja_JP.UTF-8" → "ja"); "C", "POSIX" or none → "en".
func SystemReplyLanguage() string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" {
			if v == "C" || v == "POSIX" || strings.HasPrefix(v, "C.") {
				return "en"
			}
			if l := NormalizeLanguage(v); l != "" {
				return l
			}
		}
	}
	return "en"
}

// SystemLanguage: "zh" or "en" from the process locale (LC_ALL / LANG).
func SystemLanguage() string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" {
			if isZH(v) {
				return "zh"
			}
			return "en"
		}
	}
	return "en"
}

// JevHint is the one-or-two-sentence line under the jev boxes. usable = a jev
// that returns probabilities is saved. Without one, messages the gate can't
// place go to the fallback role (gate.py scorer → rules; core/gate.go fallback);
// with a board, channel picking falls back to name matching by sound.
// Full details: docs/connect-discord-feishu.md「jev 和兜底角色」.
func JevHint(lang string, usable bool, hardware bool, fallbackName string) string {
	zhName, enName := "", ""
	if fallbackName != "" {
		zhName, enName = "「"+fallbackName+"」", " \""+fallbackName+"\""
	}
	if isZH(lang) {
		if usable {
			if hardware {
				return "gate 用它判断一句话该哪个角色回，板子也用它选频道。"
			}
			return "gate 用它判断一句话该哪个角色回。"
		}
		s := "不填时：被 @ 的角色照常回，判断不了该谁回的消息由兜底角色" + zhName + "回"
		if hardware {
			s += "；接了板子的，选频道按读音匹配"
		}
		return s + "。"
	}
	if usable {
		if hardware {
			return "The gate uses it to decide which role answers; the board also uses it to pick channels."
		}
		return "The gate uses it to decide which role answers."
	}
	s := "Without it: an @-mentioned role still answers; messages the gate can't place go to the fallback role" + enName
	if hardware {
		s += "; with a board, channels are picked by matching names by sound"
	}
	return s + "."
}

// JevApplyResult says what happened to jev.json.
type JevApplyResult struct {
	Test    *JevTestResult
	Saved   bool   // the new jev was written
	Cleared bool   // jev.json was removed (empty base_url = skip)
	Reason  string // why the new jev was not written
	InUse   string // "model @ url" of the jev in effect afterwards ("" = none)
	Detail  string
}

// activeJev returns the saved jev when the gate would use it.
func activeJev(dataDir string) (JevConfig, bool) {
	j, ok := LoadJevConfig(dataDir)
	return j, ok && j.Logprobs
}

// ApplyJev writes or removes <dataDir>/jev.json:
//   - remove: delete it (the explicit 不用 jev);
//   - empty base_url (skipped / not filled in): keep the one in use;
//   - otherwise test once; write only if the gate could use it (TestJevEndpoint).
//
// A new jev that fails leaves a working old one in place and says so in Reason
// ("仍在用旧的 …"): a typo in a new attempt should not silently switch routing off.
func ApplyJev(ctx context.Context, dataDir string, j WizardJev, lang string) (JevApplyResult, error) {
	path := filepath.Join(dataDir, jevFile)
	var out JevApplyResult
	if j.Remove {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return out, err
		}
		out.Cleared, out.Detail = true, "removed "+path
		return out, nil
	}
	if strings.TrimSpace(j.BaseURL) == "" { // skipped / not filled in: keep whatever is in use
		if old, ok := activeJev(dataDir); ok {
			out.InUse = old.Model + " @ " + old.URL
		}
		out.Detail = "kept"
		return out, nil
	}
	cfg := JevConfig{Backend: "llm", URL: strings.TrimRight(strings.TrimSpace(j.BaseURL), "/"),
		Model: strings.TrimSpace(j.Model), APIKey: strings.TrimSpace(j.APIKey)}
	t := TestJevEndpoint(ctx, cfg.URL, cfg.APIKey, cfg.Model)
	out.Test = &t
	if !t.Logprobs {
		out.Reason = JevFailReason(lang, t)
		if old, ok := activeJev(dataDir); ok {
			out.InUse = old.Model + " @ " + old.URL
			out.Reason = withOldJev(lang, out.Reason, out.InUse)
		}
		return out, nil
	}
	cfg.Logprobs, cfg.TestedAt = true, time.Now().Format(time.RFC3339)
	cfg.TopLogprobs, cfg.NoThinking = t.TopLogprobs, t.NoThinking
	if err := writeJSONFile(path, cfg, 0o600); err != nil {
		return out, err
	}
	out.Saved, out.InUse, out.Detail = true, cfg.Model+" @ "+cfg.URL, "saved "+path
	return out, nil
}

// withOldJev appends "still using the previous jev" to a failure reason.
func withOldJev(lang, reason, inUse string) string {
	if isZH(lang) {
		return strings.TrimSuffix(reason, "。") + "；仍在用旧的 " + inUse + "。"
	}
	return strings.TrimSuffix(reason, ".") + "; still using the previous one: " + inUse + "."
}

// JevFailReason explains why a jev was not saved.
func JevFailReason(lang string, t JevTestResult) string {
	zh := isZH(lang)
	if t.Slow {
		if zh {
			return fmt.Sprintf("太慢：回一个字用了 %.1f 秒，gate 每次只等 %.1f 秒，存了也用不上。", float64(t.LatencyMs)/1000, jevMaxLatency.Seconds())
		}
		return fmt.Sprintf("Too slow: %.1fs for one token; the gate waits %.1fs, so it would never be used.", float64(t.LatencyMs)/1000, jevMaxLatency.Seconds())
	}
	// TestJevEndpoint reports a non-2xx answer as "HTTP <code>: …".
	code := 0
	if strings.HasPrefix(t.Error, "HTTP ") {
		fmt.Sscanf(t.Error, "HTTP %d", &code)
	}
	pick := func(zhText, enText string) string {
		if zh {
			return zhText + t.Error
		}
		return enText + t.Error
	}
	switch {
	case code == 400 || code == 422:
		return pick("接口拒绝了请求参数（gate 打分用同样的参数）：", "The endpoint rejected the request parameters (the gate scores with the same ones): ")
	case code == 401 || code == 403:
		return pick("Key 不对或没有权限：", "Wrong key or no permission: ")
	case code == 404:
		return pick("地址不对（Base URL 或模型名）：", "Wrong address (Base URL or model name): ")
	case code >= 500:
		return pick("服务端出错或暂时连不上：", "Server error or temporarily unavailable: ")
	case code != 0:
		return pick("接口返回错误：", "The endpoint returned an error: ")
	case !t.Reachable:
		return pick("连不上：", "Could not connect: ")
	}
	if zh {
		return "这个模型不给概率，存了也不会被用上。"
	}
	return "This model returns no probabilities, so it would never be used."
}

// ── persona file ───────────────────────────────────────────────

var memoryFileOfAgent = map[string]string{
	"claudecode": "CLAUDE.md", "codex": "AGENTS.md", "gemini": "GEMINI.md", "antigravity": "GEMINI.md",
	"opencode": "OPENCODE.md", "iflow": "IFLOW.md", "reasonix": "REASONIX.md",
	"qoder": "AGENTS.md", "kimi": "AGENTS.md", "pi": "AGENTS.md",
}

// PersonaFilePath is the agent's project instruction file in workDir — the same
// file each agent's ProjectMemoryFile() returns (agent/*/…go), so the wizard,
// the project page, `/memory` in chat and editing the folder all touch one file.
func PersonaFilePath(agentType, workDir string) string {
	name := memoryFileOfAgent[agentType]
	if name == "" {
		name = "AGENTS.md"
	}
	return filepath.Join(workDir, name)
}

// ── apply ──────────────────────────────────────────────────────

var projectNameClean = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

func cleanProjectName(s string) string {
	s = strings.Trim(projectNameClean.ReplaceAllString(strings.ToLower(s), "-"), "-")
	return s
}

func addStep(res *WizardResult, step string, err error, detail string) bool {
	st := WizardStep{Step: step, OK: err == nil, Detail: detail}
	if err != nil {
		st.Detail = err.Error()
	}
	res.Steps = append(res.Steps, st)
	return err == nil
}

// wizardIdentity is what a role resolves to before planning: who the bot is.
type wizardIdentity struct {
	WizardRole
	token    string
	botID    string
	username string
	reuse    string // reuse_project as asked
	// replyFrom: where ReplyLanguage came from (see WizardRoleResult.ReplyLanguageFrom)
	replyFrom string
	// agentAsked: agent_type as given in the request ("" = default / the existing project's)
	agentAsked string
}

// plannedRole is a role after names are fixed against the config (inside the lock).
type plannedRole struct {
	wizardIdentity
	project  string
	workDir  string
	reused   bool // an existing project (asked for, or the same bot found by its ID)
	agentCmd string
	nameNote string // why the project name is not the bot's name (e.g. role-1 for a name with no a-z/0-9)
}

// updatesReplyLanguage: an existing bot whose persona is otherwise left alone gets only its
// reply-language line changed when this request names reply_language for that role.
func (r plannedRole) updatesReplyLanguage() bool {
	return r.reused && !r.writesPersona() && r.replyFrom == "role" && r.workDir != ""
}

// writesPersona: a new bot always gets its persona file; an existing one (asked for by
// reuse_project, or the same bot found by its ID) only when edit_persona is set and a
// persona is given — a preset sent by mistake must not overwrite a real CLAUDE.md.
func (r plannedRole) writesPersona() bool {
	if !r.reused {
		return true
	}
	return r.EditPersona && r.Persona != ""
}

type wizardPlan struct {
	roles        []plannedRole
	team         []SetupTeamEntry
	fallback     string
	fallbackName string
	fallbackBot  string
	note         string
	writes       []WizardProjectWrite
	// bots whose allow_from was set to AllowFromUnset (nobody known to allow)
	allowFromUnset []string
}

// ApplyWizard validates, fills defaults and (unless DryRun) writes everything.
func ApplyWizard(ctx context.Context, env WizardEnv, req WizardRequest) *WizardResult {
	res := &WizardResult{DryRun: req.DryRun, Roles: []WizardRoleResult{}, Steps: []WizardStep{}, Warnings: []WizardWarning{}}
	fail := func(step string, err error) *WizardResult {
		addStep(res, step, err, "")
		res.Error = err.Error()
		return res
	}
	// The reply language: a role's reply_language, else the request's language, else this
	// machine's locale. Messages in the result use req.Language (default: system).
	replyLang, replyFrom := NormalizeLanguage(req.Language), "request"
	if req.Language == "" {
		req.Language = SystemLanguage()
	}
	if req.Platform == "" {
		req.Platform = "discord"
	}
	if req.Platform != "discord" && req.Platform != "feishu" && req.Platform != "lark" {
		return fail("platform", fmt.Errorf("platform must be discord, feishu or lark"))
	}
	if len(req.Roles) == 0 {
		return fail("roles", fmt.Errorf("at least one role is required"))
	}
	if req.Platform != "discord" && len(req.Roles) != 1 {
		return fail("roles", fmt.Errorf("feishu: one bot per wizard run (multi-role is Discord only)"))
	}
	if req.Platform != "discord" && (req.Feishu == nil || req.Feishu.AppID == "" || req.Feishu.AppSecret == "") {
		return fail("role 1", fmt.Errorf("feishu: app_id and app_secret required (scan the QR code first)"))
	}
	clis := env.CLIs
	if clis == nil {
		clis = DetectLocalCLIs(ctx)
	}
	defaultAgent := ""
	for _, c := range clis {
		if c.Supported && c.Login == "logged_in" {
			defaultAgent = c.AgentType
			break
		}
	}
	for _, c := range clis {
		if defaultAgent == "" && c.Supported {
			defaultAgent = c.AgentType
		}
	}
	res.Hardware = HardwarePresent()

	snap, err := env.Store.Snapshot()
	if err != nil {
		return fail("config", err)
	}
	// asked before writing: after the write the config is no longer the first-run template
	storeIsFresh := false
	if f, ok := env.Store.(interface{ IsFreshConfig() bool }); ok {
		storeIsFresh = f.IsFreshConfig()
	}
	byProject := map[string]WizardExistingBot{}
	for _, b := range snap.DiscordBots() {
		byProject[b.Project] = b
	}
	guildID, channelID := "", ""
	if req.Discord != nil {
		guildID, channelID = req.Discord.GuildID, req.Discord.ChannelID
	}

	// 1. who each bot is (network checks happen here, outside the config lock)
	ids := make([]wizardIdentity, 0, len(req.Roles))
	var owners []string // owners of the bots' Discord applications: the default allow_from
	for i, r := range req.Roles {
		w := wizardIdentity{WizardRole: r, reuse: r.ReuseProject, agentAsked: r.AgentType}
		step := fmt.Sprintf("role %d", i+1)
		if r.Provider != nil {
			if err := validateWizardProvider(*r.Provider); err != nil {
				return fail(step+" provider", err)
			}
		}
		if req.Platform == "discord" {
			switch {
			case r.ReuseProject != "":
				b, ok := byProject[r.ReuseProject]
				if !ok || b.Token == "" {
					why := "no discord bot with a token in config"
					if b.TokenError != "" {
						why = b.TokenError
					}
					return fail(step, fmt.Errorf("reuse_project %q: %s", r.ReuseProject, why))
				}
				w.token = b.Token
			case r.Token != "":
				w.token = strings.TrimSpace(r.Token)
			default:
				return fail(step, fmt.Errorf("token or reuse_project required"))
			}
			info, err := CheckDiscordBot(ctx, w.token)
			if err != nil {
				r := fail(step+" discord", err)
				if errors.Is(err, ErrDiscordTokenInvalid) {
					r.Warnings = append(r.Warnings, warnTokenInvalid(req.Language, i+1))
					r.NeedsUserAction = true
				}
				return r
			}
			w.botID, w.username = info.BotID, info.Username
			rr := WizardRoleResult{BotID: info.BotID}
			in := guildID == ""
			for _, g := range info.Guilds {
				if g.ID == guildID {
					in = true
				}
			}
			rr.InGuild = &in
			if !in {
				rr.InviteURL = DiscordInviteURL(info.ApplicationID, guildID)
				res.InviteURLs = append(res.InviteURLs, rr.InviteURL)
				res.Warnings = append(res.Warnings, warnNotInGuild(req.Language, info.Username, rr.InviteURL, req.DryRun))
			}
			if info.OwnerID != "" {
				owners = appendUnique(owners, info.OwnerID)
			}
			detail := "bot " + info.Username
			switch {
			case !info.IntentKnown: // the application lookup failed: can't tell, so don't call it fine
				detail += "; Message Content Intent 没查到 / could not be checked"
				res.Warnings = append(res.Warnings, warnIntentUnknown(req.Language, info.Username, info.ApplicationID))
			case !info.MessageContent:
				detail += "; Message Content Intent 未开启 / not enabled (Developer Portal → Bot)"
				res.Warnings = append(res.Warnings, warnIntentOff(req.Language, info.Username, info.ApplicationID))
			}
			addStep(res, step+" discord", nil, detail)
			res.Roles = append(res.Roles, rr)
		} else {
			res.Roles = append(res.Roles, WizardRoleResult{})
		}
		if w.Name == "" {
			w.Name = w.username
		}
		ids = append(ids, w)
	}
	if replyLang == "" {
		replyLang, replyFrom = SystemReplyLanguage(), "system"
	}
	for i := range ids {
		if ids[i].ReplyLanguage != "" {
			ids[i].ReplyLanguage, ids[i].replyFrom = NormalizeLanguage(ids[i].ReplyLanguage), "role"
		} else {
			ids[i].ReplyLanguage, ids[i].replyFrom = replyLang, replyFrom
		}
	}

	// allow_from: what the user gave, else the bots' owners. Nothing known (owner lookup failed,
	// or an empty value given) fails closed: an empty allow_from would let anyone in the server
	// command this computer, so the bots get AllowFromUnset (matches no one) and a blocking warning.
	allowFrom := strings.Join(owners, ",")
	if req.AllowFrom != nil {
		allowFrom = strings.Join(csvSet(*req.AllowFrom), ",")
	}
	if req.Platform == "discord" {
		res.AllowFrom = allowFrom
		if allowFrom == "" {
			allowFrom = AllowFromUnset
		}
		if allowFrom == "*" { // the user's explicit choice: allowed, but say what it means
			res.Warnings = append(res.Warnings, warnAllowFromEveryone(req.Language))
		}
	}

	state := LoadSetupState(env.DataDir)
	// 2. plan against a config snapshot: names, work dirs, team merge. It runs again
	//    inside the lock against the config as it is then (H3.4).
	plan := func(s WizardSnapshot) (*wizardPlan, error) {
		return planWizard(s, ids, req, state, env.DataDir, defaultAgent, clis, guildID, channelID, allowFrom, env.AlwaysWriteCmd)
	}
	pl, err := plan(snap)
	if err != nil {
		return fail("plan", err)
	}
	res.Warnings = append(res.Warnings, warnAgentLogins(req.Language, pl.roles, clis)...)
	res.Warnings = append(res.Warnings, warnReplyLanguageDefault(req.Language, pl.roles)...)
	for _, r := range pl.roles {
		if r.nameNote != "" {
			addStep(res, "project name", nil, r.nameNote)
		}
	}

	if req.DryRun {
		fillRoleResults(res, pl)
		for i, r := range pl.roles {
			res.Roles[i].PersonaWritten = false
			step := fmt.Sprintf("role %d persona", i+1)
			switch {
			case r.writesPersona():
				addStep(res, step, nil, "dry run: would write "+PersonaFilePath(r.AgentType, r.workDir)+" (reply language "+r.ReplyLanguage+")")
			case r.updatesReplyLanguage():
				addStep(res, step, nil, "dry run: would set the reply-language line of "+PersonaFilePath(r.AgentType, r.workDir)+" to "+r.ReplyLanguage)
			default:
				addStep(res, step, nil, "dry run: "+r.project+": existing persona would be left untouched")
			}
		}
		usable := false
		if req.Jev != nil && strings.TrimSpace(req.Jev.BaseURL) != "" {
			t := TestJevEndpoint(ctx, req.Jev.BaseURL, req.Jev.APIKey, req.Jev.Model)
			res.Jev, res.JevOK, usable = &t, t.Logprobs, t.Logprobs
			if !t.Logprobs {
				res.JevReason = JevFailReason(req.Language, t)
			}
		} else if req.Jev == nil {
			if j, ok := activeJev(env.DataDir); ok {
				usable, res.JevOK, res.JevInUse = true, true, j.Model+" @ "+j.URL
			}
		}
		res.JevHint = JevHint(req.Language, usable, res.Hardware, pl.fallbackName)
		finishWizardResult(res, req, pl)
		return res
	}

	// 3. one locked read-modify-write of config.toml, planned on what is there now
	backup, err := env.Store.ApplyProjects(func(s WizardSnapshot) ([]WizardProjectWrite, error) {
		p, err := plan(s)
		if err != nil {
			return nil, err
		}
		pl = p
		return p.writes, nil
	})
	if err != nil {
		return fail("config", err)
	}
	fillRoleResults(res, pl)
	if pl.note != "" {
		addStep(res, "fallback_role", nil, pl.note)
	}
	res.ConfigBackup = backup
	if storeIsFresh {
		// the backup is only the empty first-run template: nothing of the user's to keep
		res.ConfigBackup = ""
		addStep(res, "config", nil, fmt.Sprintf("%d projects written to a new config (first run, no earlier config)", len(pl.writes)))
	} else {
		addStep(res, "config", nil, fmt.Sprintf("%d projects written; previous config kept as %s (the rewrite does not keep comments)", len(pl.writes), backup))
	}

	// 4. persona files: new roles always; existing bots only when this request carries a persona (H1)
	for i, r := range pl.roles {
		step := fmt.Sprintf("role %d persona", i+1)
		if r.reused && !r.writesPersona() {
			if r.updatesReplyLanguage() {
				// only the reply-language section changes; the rest of the persona stays as it is
				path := PersonaFilePath(r.AgentType, r.workDir)
				b, err := os.ReadFile(path)
				if err != nil && !os.IsNotExist(err) {
					return fail(step, err) // unreadable: don't overwrite the persona with just the language line
				}
				if err := os.MkdirAll(r.workDir, 0o755); err != nil {
					return fail(step, err)
				}
				if err := AtomicWriteFile(path, []byte(WithReplyLanguage(string(b), r.ReplyLanguage)), 0o644); err != nil {
					return fail(step, err)
				}
				res.Roles[i].PersonaWritten = true
				addStep(res, step, nil, r.project+": reply language set to "+r.ReplyLanguage+" in "+path+" (rest of the persona untouched)")
				continue
			}
			addStep(res, step, nil, r.project+": existing persona left untouched")
			continue
		}
		if err := os.MkdirAll(r.workDir, 0o755); err != nil {
			return fail(step, err)
		}
		path := PersonaFilePath(r.AgentType, r.workDir)
		content := r.Persona
		if content == "" {
			if b, err := os.ReadFile(path); err == nil {
				content = string(b)
			}
		}
		if err := AtomicWriteFile(path, []byte(WithReplyLanguage(content, r.ReplyLanguage)), 0o644); err != nil {
			return fail(step, err)
		}
		addStep(res, step, nil, r.project+" → "+path)
	}

	if req.Platform == "discord" && len(pl.team) > 1 {
		gt := map[string]any{"lead": map[string]any{"name": pl.fallbackName, "aliases": []string{pl.fallback}}, "subs": map[string]any{}}
		for _, t := range pl.team {
			if t.Project != pl.fallback {
				gt["subs"].(map[string]any)[t.Project] = map[string]any{"name": t.Name, "aliases": []string{}}
			}
		}
		if err := writeJSONFile(filepath.Join(env.DataDir, gateTeamFile), gt, 0o644); err != nil {
			return fail("gate team", err)
		}
		addStep(res, "team", nil, fmt.Sprintf("%d bots, fallback %s", len(pl.team), pl.fallbackName))
	}

	// 5. jev: absent = keep; empty base_url = remove; otherwise saved only if the gate could use it
	if req.Jev != nil {
		out, err := ApplyJev(ctx, env.DataDir, *req.Jev, req.Language)
		if err != nil {
			return fail("jev", err)
		}
		res.Jev, res.JevOK, res.JevReason, res.JevInUse = out.Test, out.Reason == "", out.Reason, out.InUse
		if out.Reason != "" {
			addStep(res, "jev", fmt.Errorf("not saved: %s", out.Reason), "")
		} else {
			addStep(res, "jev", nil, out.Detail)
		}
	} else if j, ok := activeJev(env.DataDir); ok {
		res.JevOK, res.JevInUse = true, j.Model+" @ "+j.URL
	}
	_, usable := activeJev(env.DataDir)
	res.JevHint = JevHint(req.Language, usable, res.Hardware, pl.fallbackName)

	st := SetupState{Platform: req.Platform, Language: req.Language, GuildID: guildID, ChannelID: channelID,
		FallbackRole: pl.fallback, Team: pl.team, UpdatedAt: time.Now().Format(time.RFC3339)}
	if req.Platform != "discord" {
		st.FeishuChatID = req.Feishu.ChatID
	}
	if err := writeJSONFile(filepath.Join(env.DataDir, setupStateFile), st, 0o644); err != nil {
		return fail("state", err)
	}
	res.RestartRequired = true
	res.Saved = true
	finishWizardResult(res, req, pl)
	return res
}

func fillRoleResults(res *WizardResult, pl *wizardPlan) {
	res.FallbackRole = pl.fallback
	for i, r := range pl.roles {
		rr := &res.Roles[i]
		rr.Project, rr.Name, rr.AgentType, rr.WorkDir = r.project, r.Name, r.AgentType, r.workDir
		rr.PersonaFile = ""
		if r.workDir != "" {
			rr.PersonaFile = PersonaFilePath(r.AgentType, r.workDir)
		}
		rr.Reused = r.reused
		rr.PersonaWritten = !r.reused || r.writesPersona()
		rr.ReplyLanguage, rr.ReplyLanguageFrom = r.ReplyLanguage, r.replyFrom
		if r.reused && !r.writesPersona() && !r.updatesReplyLanguage() {
			rr.ReplyLanguage, rr.ReplyLanguageFrom = "", "existing"
		}
		if rr.ReplyLanguage != "" {
			rr.ReplyLanguageName = LanguageName(rr.ReplyLanguage)
		}
		rr.Fallback = r.project == pl.fallback
		rr.Provider, rr.ProviderVia = "", ""
		if r.Provider != nil {
			p := ResolveWizardProvider(r.Provider.Vendor, r.AgentType, r.Provider.BaseURL, r.Provider.APIKey, r.Provider.Model)
			rr.Provider, rr.ProviderVia = p.Name+" "+p.BaseURL, "native"
			if p.APIFormat == APIFormatOpenAIChat {
				rr.ProviderVia = "convert"
			}
		}
	}
}

// planWizard fixes project names against the snapshot, fills defaults and builds
// the config writes, merging the team wiring with what each project already has.
func planWizard(s WizardSnapshot, ids []wizardIdentity, req WizardRequest, state SetupState, dataDir, defaultAgent string,
	clis []LocalCLI, guildID, channelID, allowFrom string, alwaysCmd bool) (*wizardPlan, error) {
	pl := &wizardPlan{}
	byProject := map[string]WizardExistingBot{}
	byBotID := map[string]string{}
	for _, b := range s.DiscordBots() {
		byProject[b.Project] = b
		if b.BotID != "" && byBotID[b.BotID] == "" {
			byBotID[b.BotID] = b.Project
		}
	}
	taken := map[string]bool{}
	for _, p := range s.Projects {
		taken[p.Name] = true
	}
	used := map[string]bool{}
	for i, w := range ids {
		r := plannedRole{wizardIdentity: w}
		switch {
		case w.reuse != "":
			if _, ok := s.project(w.reuse); !ok {
				return nil, fmt.Errorf("reuse_project %q is no longer in config", w.reuse)
			}
			r.project, r.reused = w.reuse, true
		case req.Platform == "discord" && w.botID != "" && byBotID[w.botID] != "":
			// the same bot is already configured (matched by its bot ID): update that project (H2)
			r.project, r.reused = byBotID[w.botID], true
		default:
			// Can't rule out that it is one of the existing bots whose token can't be read
			// (unset/empty env var): refuse rather than create a duplicate project with a
			// plain-text token.
			if req.Platform == "discord" {
				var unreadable []string
				for _, b := range s.DiscordBots() {
					if b.TokenError != "" {
						unreadable = append(unreadable, b.Project+": "+b.TokenError)
					}
				}
				if len(unreadable) > 0 {
					return nil, fmt.Errorf("can't tell whether this bot is already configured — %s. Set that environment variable for cc-connect, or pick the existing bot (reuse_project)", strings.Join(unreadable, "; "))
				}
			}
			// a new bot: clean the name, fall back to role-N, then avoid every existing
			// project name and every name used earlier in this request (H2)
			base := w.Project
			if base == "" {
				base = w.Name
			}
			raw := base
			base = cleanProjectName(base)
			noASCII := base == "" && raw != ""
			if base == "" {
				base = fmt.Sprintf("role-%d", i+1)
			}
			name := base
			for n := 2; taken[name] || used[name]; n++ {
				name = fmt.Sprintf("%s-%d", base, n)
			}
			if noASCII {
				// project names are a-z 0-9 _ - (they go into paths, URLs and gate_url ?bot=); said
				// without entry-specific steps, since the web wizard has no project-name box
				r.nameNote = nameNote(req.Language, raw, name)
			}
			r.project = name
		}
		if used[r.project] {
			return nil, fmt.Errorf("bot %q is used twice in this request", r.project)
		}
		used[r.project] = true
		if r.Name == "" {
			r.Name = r.project
		}
		if r.reused {
			ex, _ := s.project(r.project)
			if r.AgentType == "" {
				r.AgentType = ex.AgentType
			}
			r.workDir = ex.WorkDir
		}
		if r.AgentType == "" {
			r.AgentType = defaultAgent
		}
		if r.AgentType == "" {
			return nil, fmt.Errorf("no supported agent CLI found on this machine (install claude / codex / gemini / opencode …)")
		}
		if r.Provider != nil && protocolOfAgent[r.AgentType] == "" {
			return nil, fmt.Errorf("%s can't take a third-party API in cc-connect; use one of %v", r.AgentType, AttachableAgents)
		}
		if !r.reused {
			r.workDir = r.WorkDir
			if r.workDir == "" {
				r.workDir = filepath.Join(dataDir, "roles", r.project)
			}
		}
		if r.reused && r.workDir == "" && r.writesPersona() {
			return nil, fmt.Errorf("project %q has no work_dir, so there is no persona file to write", r.project)
		}
		for _, c := range clis {
			if c.AgentType == r.AgentType && c.Supported && c.Path != "" && (!c.InPath || alwaysCmd) {
				r.agentCmd = c.Path // found outside PATH: tell the service where it is (L2)
			}
		}
		pl.roles = append(pl.roles, r)
	}

	// team = earlier wizard team still in config + this run
	inRun := map[string]bool{}
	for _, r := range pl.roles {
		inRun[r.project] = true
	}
	if state.Platform == req.Platform && req.Platform == "discord" {
		for _, t := range state.Team {
			if _, still := byProject[t.Project]; still && !inRun[t.Project] {
				pl.team = append(pl.team, t)
			}
		}
	}
	for _, r := range pl.roles {
		pl.team = append(pl.team, SetupTeamEntry{Project: r.project, Name: r.Name, BotID: r.botID, AgentType: r.AgentType})
	}

	// fallback role (unit = bot): one of the team's bots, else the first bot of this run (L3)
	pl.fallback = req.FallbackRole
	if req.FallbackBotID != "" {
		for _, t := range pl.team {
			if t.BotID == req.FallbackBotID {
				pl.fallback = t.Project
			}
		}
	}
	found := false
	for _, t := range pl.team {
		if t.Project == pl.fallback {
			found = true
		}
	}
	if !found {
		if pl.fallback != "" {
			pl.note = fmt.Sprintf("%q is not one of the bots; using %q", pl.fallback, pl.roles[0].project)
		}
		pl.fallback = pl.roles[0].project
	}
	pl.fallbackName = pl.fallback
	for _, t := range pl.team {
		if t.Project == pl.fallback {
			pl.fallbackName, pl.fallbackBot = t.Name, t.BotID
		}
	}

	for _, r := range pl.roles {
		pw := WizardProjectWrite{Name: r.project, AgentType: r.AgentType, PlatformType: req.Platform, Options: map[string]any{}}
		ex, exists := s.project(r.project)
		if !r.reused {
			pw.WorkDir = r.workDir
		}
		if r.agentCmd != "" && (!exists || ex.AgentCmd == "") {
			pw.AgentCmd = r.agentCmd
		}
		if r.Provider != nil {
			p := ResolveWizardProvider(r.Provider.Vendor, r.AgentType, r.Provider.BaseURL, r.Provider.APIKey, r.Provider.Model)
			pw.Provider = &p
		}
		if req.Platform == "discord" {
			// A reused bot's token (maybe "${ENV}") is not rewritten; the same bot found by its ID
			// gets the typed token only if it changed and is not an env placeholder.
			cur, _ := byProject[r.project].Options["token"].(string)
			if !r.reused || (r.reuse == "" && cur != r.token && !strings.Contains(cur, "${")) {
				pw.Options["token"] = r.token
			}
			// an existing bot keeps the server it already has (H3.3)
			if cur, _ := byProject[r.project].Options["guild_id"].(string); guildID != "" && cur == "" {
				pw.Options["guild_id"] = guildID
			}
			// allow_from: new bots, existing ones that still let anyone in, and ones a failed run
			// closed with AllowFromUnset (so a rerun with the user's ID takes); a real list is kept
			if cur, _ := byProject[r.project].Options["allow_from"].(string); allowFrom != "" &&
				(strings.TrimSpace(cur) == "" || strings.TrimSpace(cur) == AllowFromUnset) {
				pw.Options["allow_from"] = allowFrom
				if allowFrom == AllowFromUnset {
					pl.allowFromUnset = append(pl.allowFromUnset, r.Name)
				}
			}
			// the wizard's default chat channel: listening without an @ stays in it (platform/discord
			// group_reply_all_channels); an existing value is kept
			if cur, _ := byProject[r.project].Options["group_reply_all_channels"].(string); channelID != "" && strings.TrimSpace(cur) == "" {
				pw.Options["group_reply_all_channels"] = channelID
			}
		} else {
			f := req.Feishu
			if f.PlatformType != "" {
				pw.PlatformType = f.PlatformType
			}
			pw.Options["app_id"], pw.Options["app_secret"] = f.AppID, f.AppSecret
			pw.FeishuOwnerOpenID = f.OwnerOpenID
		}
		pl.writes = append(pl.writes, pw)
	}
	if req.Platform == "discord" && len(pl.team) > 1 {
		pl.writes = mergeTeamWrites(pl.writes, pl.team, byProject, pl.fallback, pl.fallbackBot)
	}
	return pl, nil
}

// vendorsWithoutDefaultModel: their model must be given (no single sensible default).
func validateWizardProvider(p WizardProvider) error {
	v, ok := wizardVendor(p.Vendor)
	if !ok {
		return fmt.Errorf("unknown provider vendor %q", p.Vendor)
	}
	if p.Vendor == "custom" && strings.TrimSpace(p.BaseURL) == "" {
		return fmt.Errorf("custom provider: base_url is required")
	}
	if v.Model == "" && strings.TrimSpace(p.Model) == "" {
		return fmt.Errorf("%s: model is required", p.Vendor)
	}
	return nil
}

// isWizardGateURL reports whether u is a gate_url the wizard itself writes.
func isWizardGateURL(u string) bool {
	return u == defaultGateURL || strings.HasPrefix(u, defaultGateURL+"?bot=")
}

func csvSet(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// mergeTeamWrites adds the main + subs wiring to the batch, merging with what each
// project already has (planWizard runs it inside the config lock on fresh data): allow_bots becomes a union (IDs outside the team are kept);
// gate_url / gate_fallback / team_lead_bot are only (re)written when unset or
// previously written by the wizard; group_reply_all and share_session_in_channel
// only when unset (group_reply_all also not when group_reply_all_guilds is set).
// A reused bot's token may be "${VAR}": it is expanded for the API calls only, never written back.
func mergeTeamWrites(writes []WizardProjectWrite, team []SetupTeamEntry, existing map[string]WizardExistingBot, fallback, fallbackBot string) []WizardProjectWrite {
	idx := map[string]int{}
	for i, w := range writes {
		idx[w.Name] = i
	}
	teamIDs := map[string]bool{}
	for _, t := range team {
		if t.BotID != "" {
			teamIDs[t.BotID] = true
		}
	}
	for _, t := range team {
		i, ok := idx[t.Project]
		if !ok {
			writes = append(writes, WizardProjectWrite{Name: t.Project, PlatformType: "discord", Options: map[string]any{}})
			i = len(writes) - 1
			idx[t.Project] = i
		}
		w := &writes[i]
		ex := existing[t.Project]
		cur := ex.Options
		if cur == nil {
			cur = map[string]any{}
		}
		// allow_bots: existing ∪ other team bots
		seen := map[string]bool{}
		var allow []string
		for _, id := range csvSet(fmt.Sprint(valueOr(cur["allow_bots"], ""))) {
			if !seen[id] {
				seen[id] = true
				allow = append(allow, id)
			}
		}
		for _, o := range team {
			if o.BotID != "" && o.BotID != t.BotID && !seen[o.BotID] {
				seen[o.BotID] = true
				allow = append(allow, o.BotID)
			}
		}
		w.Options["allow_bots"] = strings.Join(allow, ",")
		for _, k := range []string{"group_reply_all", "share_session_in_channel"} {
			if _, set := cur[k]; !set {
				// group_reply_all_guilds, when set, already decides where replying to all applies (platform/discord).
				if g, _ := cur["group_reply_all_guilds"].(string); k == "group_reply_all" && g != "" {
					continue
				}
				w.Options[k] = true
			}
		}
		isLead := t.Project == fallback
		// every team bot, the lead included, names the lead: platform/discord compares
		// p.botID == p.teamLead to know it is the lead (H3.1). A custom value outside the team is kept.
		if lb, _ := cur["team_lead_bot"].(string); (lb == "" || teamIDs[lb]) && fallbackBot != "" {
			w.Options["team_lead_bot"] = fallbackBot
		}
		if ex.GateURL == "" || isWizardGateURL(ex.GateURL) {
			gate := defaultGateURL + "?bot=" + t.Project
			if isLead {
				gate = defaultGateURL
			}
			w.GateURL = &gate
		}
		// gate_fallback only when unset, or still a value the wizard writes next to its own gate_url (H3.2)
		if ex.GateFallback == "" || (isWizardGateURL(ex.GateURL) && (ex.GateFallback == "reply" || ex.GateFallback == "context")) {
			fb := "context"
			if isLead {
				fb = "reply"
			}
			w.GateFallback = &fb
		}
	}
	return writes
}

func valueOr(v any, d any) any {
	if v == nil {
		return d
	}
	return v
}

// ── HTTP handlers ──────────────────────────────────────────────

func (m *ManagementServer) SetWizard(store WizardStore, dataDir string) {
	m.wizardStore = store
	m.wizardDataDir = dataDir
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func (m *ManagementServer) handleSetupCLIs(w http.ResponseWriter, r *http.Request) {
	mgmtJSON(w, http.StatusOK, map[string]any{"clis": DetectLocalCLIs(r.Context())})
}

func (m *ManagementServer) handleSetupMatrix(w http.ResponseWriter, r *http.Request) {
	mgmtJSON(w, http.StatusOK, map[string]any{"vendors": WizardVendors, "agents": AttachableAgents, "matrix": VendorMatrix()})
}

func (m *ManagementServer) handleSetupPersonas(w http.ResponseWriter, r *http.Request) {
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = SystemLanguage()
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"language": lang, "presets": PersonaPresets(lang)})
}

func (m *ManagementServer) handleSetupState(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"system_language": SystemLanguage(), "hardware": HardwarePresent(), "data_dir": m.wizardDataDir}
	st := LoadSetupState(m.wizardDataDir)
	out["setup"] = st
	if j, ok := LoadJevConfig(m.wizardDataDir); ok {
		out["jev"] = map[string]any{"url": j.URL, "model": j.Model, "has_key": j.APIKey != "", "logprobs": j.Logprobs}
	}
	m.mu.RLock()
	out["has_projects"] = len(m.engines) > 0
	m.mu.RUnlock()
	if m.wizardStore != nil {
		if snap, err := m.wizardStore.Snapshot(); err == nil {
			names := []string{}
			for _, p := range snap.Projects {
				names = append(names, p.Name)
			}
			out["projects"] = names // the web wizard avoids these names for new bots (same rule as planWizard)
		}
	}
	fb := r.URL.Query().Get("fallback_name") // the wizard passes the bot it is about to pick
	for _, t := range st.Team {
		if fb != "" {
			break
		}
		if t.Project == st.FallbackRole {
			fb = t.Name
		}
	}
	j, ok := LoadJevConfig(m.wizardDataDir)
	out["jev_hint"] = JevHint(r.URL.Query().Get("lang"), ok && j.Logprobs, out["hardware"].(bool), fb)
	mgmtJSON(w, http.StatusOK, out)
}

func (m *ManagementServer) handleSetupDiscordBots(w http.ResponseWriter, r *http.Request) {
	if m.wizardStore == nil {
		mgmtError(w, http.StatusServiceUnavailable, "wizard not configured")
		return
	}
	snap, err := m.wizardStore.Snapshot()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	bots := snap.DiscordBots()
	type botOut struct {
		WizardExistingBot
		Username string `json:"username,omitempty"`
		Error    string `json:"error,omitempty"`
	}
	out := []botOut{}
	for _, b := range bots {
		o := botOut{WizardExistingBot: b, Error: b.TokenError}
		if b.Token != "" && r.URL.Query().Get("check") != "0" {
			if info, err := CheckDiscordBot(r.Context(), b.Token); err == nil {
				o.Username, o.BotID = info.Username, info.BotID
			} else {
				o.Error = err.Error()
			}
		}
		out = append(out, o)
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"bots": out})
}

// discordTokenFor resolves {token} or {reuse_project} to a token (server-side only).
func (m *ManagementServer) discordTokenFor(token, reuse string) (string, error) {
	if token != "" {
		return token, nil
	}
	if reuse == "" || m.wizardStore == nil {
		return "", fmt.Errorf("token or reuse_project required")
	}
	snap, err := m.wizardStore.Snapshot()
	if err != nil {
		return "", err
	}
	for _, b := range snap.DiscordBots() {
		if b.Project == reuse && b.Token != "" {
			return b.Token, nil
		}
		if b.Project == reuse && b.TokenError != "" {
			return "", fmt.Errorf("%s: %s", reuse, b.TokenError)
		}
	}
	return "", fmt.Errorf("no discord bot in project %q", reuse)
}

func (m *ManagementServer) handleSetupDiscordCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token        string `json:"token"`
		ReuseProject string `json:"reuse_project"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	tok, err := m.discordTokenFor(req.Token, req.ReuseProject)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := CheckDiscordBot(r.Context(), tok)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, info)
}

func (m *ManagementServer) handleSetupDiscordChannels(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token        string `json:"token"`
		ReuseProject string `json:"reuse_project"`
		GuildID      string `json:"guild_id"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	tok, err := m.discordTokenFor(req.Token, req.ReuseProject)
	if err != nil || req.GuildID == "" {
		mgmtError(w, http.StatusBadRequest, "token/reuse_project and guild_id required")
		return
	}
	chs, err := ListDiscordChannels(r.Context(), tok, req.GuildID)
	if err != nil {
		mgmtError(w, http.StatusBadGateway, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"channels": chs})
}

func (m *ManagementServer) handleSetupFeishuChats(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AppID        string `json:"app_id"`
		AppSecret    string `json:"app_secret"`
		PlatformType string `json:"platform_type"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	chats, err := ListFeishuChats(r.Context(), req.AppID, req.AppSecret, req.PlatformType)
	if err != nil {
		mgmtError(w, http.StatusBadGateway, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"chats": chats})
}

type jevHTTPRequest struct {
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	Model    string `json:"model"`
	Lang     string `json:"lang"`
	Fallback string `json:"fallback_name"`
	Remove   bool   `json:"remove"`
}

// handleSetupJevTest (POST /setup/jev/test) only tests; nothing is written.
func (m *ManagementServer) handleSetupJevTest(w http.ResponseWriter, r *http.Request) {
	var req jevHTTPRequest
	if !decodeBody(w, r, &req) {
		return
	}
	t := TestJevEndpoint(r.Context(), req.BaseURL, req.APIKey, req.Model)
	out := map[string]any{"test": t, "usable": t.Logprobs, "hint": JevHint(req.Lang, t.Logprobs, HardwarePresent(), req.Fallback)}
	if !t.Logprobs {
		reason := JevFailReason(req.Lang, t)
		if old, ok := activeJev(m.wizardDataDir); ok {
			out["in_use"] = old.Model + " @ " + old.URL
			reason = withOldJev(req.Lang, reason, old.Model+" @ "+old.URL)
		}
		out["reason"] = reason
		out["hint"] = JevHint(req.Lang, false, HardwarePresent(), req.Fallback)
	}
	mgmtJSON(w, http.StatusOK, out)
}

// handleSetupJevSave (POST /setup/jev/save) is what the wizard's 下一步 / 跳过 call:
// empty base_url removes jev.json, otherwise it is tested and written only if usable.
func (m *ManagementServer) handleSetupJevSave(w http.ResponseWriter, r *http.Request) {
	var req jevHTTPRequest
	if !decodeBody(w, r, &req) {
		return
	}
	out, err := ApplyJev(r.Context(), m.wizardDataDir, WizardJev{BaseURL: req.BaseURL, APIKey: req.APIKey, Model: req.Model, Remove: req.Remove}, req.Lang)
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, usable := activeJev(m.wizardDataDir)
	mgmtJSON(w, http.StatusOK, map[string]any{"saved": out.Saved, "cleared": out.Cleared, "reason": out.Reason,
		"in_use": out.InUse, "test": out.Test, "hint": JevHint(req.Lang, usable, HardwarePresent(), req.Fallback)})
}

func (m *ManagementServer) handleSetupApply(w http.ResponseWriter, r *http.Request) {
	var req WizardRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if m.wizardStore == nil {
		mgmtError(w, http.StatusServiceUnavailable, "wizard not configured")
		return
	}
	res := ApplyWizard(r.Context(), WizardEnv{Store: m.wizardStore, DataDir: m.wizardDataDir}, req)
	status := http.StatusOK
	if !res.OK && !res.Saved { // saved with warnings is still a 200: the config was written
		status = http.StatusBadRequest
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": res.OK, "data": res, "error": res.Error})
}

// handleSetupPersona: GET ?agent_type=&work_dir= → the persona file a new role would use.
func (m *ManagementServer) handleSetupPersona(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	wd := q.Get("work_dir")
	if wd == "" {
		mgmtError(w, http.StatusBadRequest, "work_dir required")
		return
	}
	writePersonaJSON(w, PersonaFilePath(q.Get("agent_type"), wd))
}

func writePersonaJSON(w http.ResponseWriter, path string) {
	b, err := os.ReadFile(path)
	mgmtJSON(w, http.StatusOK, map[string]any{"path": path, "exists": err == nil, "content": string(b)})
}

// handleProjectPersona: GET/PUT /projects/{name}/persona — the agent's
// ProjectMemoryFile, i.e. the file the wizard wrote and `/memory` edits.
func (m *ManagementServer) handleProjectPersona(w http.ResponseWriter, r *http.Request, e *Engine) {
	mp, ok := e.agent.(MemoryFileProvider)
	if !ok {
		mgmtError(w, http.StatusBadRequest, "this agent has no instruction file")
		return
	}
	path := mp.ProjectMemoryFile()
	switch r.Method {
	case http.MethodGet:
		writePersonaJSON(w, path)
	case http.MethodPut, http.MethodPost:
		var body struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := AtomicWriteFile(path, []byte(body.Content), 0o644); err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"path": path, "saved": true})
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or PUT")
	}
}
