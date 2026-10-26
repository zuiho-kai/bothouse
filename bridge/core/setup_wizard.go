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
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ── request / result ───────────────────────────────────────────

type WizardRequest struct {
	libraryHost string // host of the management page (handleSetupApply): cloud_web loads library pictures from it
	Platform    string `json:"platform"` // "discord" (default) | "feishu" | "lark" | "cloud_web" (自建平台)
	Language    string `json:"language,omitempty"`
	Discord     *struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"` // default chat channel
	} `json:"discord,omitempty"`
	Feishu        *WizardFeishu   `json:"feishu,omitempty"`
	CloudWeb      *WizardCloudWeb `json:"cloud_web,omitempty"` // cloud_web: the platform (setup_cloudweb.go)
	Roles         []WizardRole    `json:"roles"`
	FallbackRole  string          `json:"fallback_role,omitempty"`   // project name; default = first role
	FallbackBotID string          `json:"fallback_bot_id,omitempty"` // or the Discord bot ID (wins; the web wizard sends this)
	Jev           *WizardJev      `json:"jev,omitempty"`
	// Gate: one primary role routes the team's messages (the gate, core/gate_proc.go). nil = on, so a
	// request without it (AI, curl, `setup apply`) gets the default.
	Gate *WizardGate `json:"gate,omitempty"`
	// AllowFrom: Discord user IDs (comma-separated) the bots take orders from; "*" = anyone in the server.
	// Not given = the owner of each bot's Discord application (looked up with the token).
	// Written to new bots and to existing bots whose allow_from is still empty; a non-empty one is kept.
	AllowFrom *string `json:"allow_from,omitempty"`
	// Wiki: the models of the memory wiki's work (core/setup_wiki.go); nil or "" = keep. With a wiki
	// (~/wiki/bin/ingest.py), the wizard also adds its scheduled runs as muted cron jobs.
	Wiki   *WizardWiki `json:"wiki,omitempty"`
	DryRun bool        `json:"dry_run,omitempty"`
	// AppendOnly: the panel's "add role/model" entry. Every role must become a new project; a role
	// that would update an existing one (reuse_project, same bot, same name) is refused, not merged.
	AppendOnly bool `json:"append_only,omitempty"`
}

// WizardGate: enabled = a team of bots (or a single role, as the lead) gets gate_url / gate_fallback (lead "reply", the others
// "context") and gate-team.json, and bothouse starts the gate when python and a jev are there;
// without them core/gate.go fallbackFor still lets only the lead answer what names no one.
// false = no gate: the wizard's own gate_url / gate_fallback are cleared, hand-written ones kept.
type WizardGate struct {
	Enabled bool `json:"enabled"`
}

func (r WizardRequest) gateOn() bool { return r.Gate == nil || r.Gate.Enabled }

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
	// Library picks; nil / "" = keep what the state already has for this project.
	PersonaPreset *string `json:"persona_preset,omitempty"` // library persona slug ("" via pointer = clear)
	Avatar        *string `json:"avatar,omitempty"`         // library avatar slug ("" via pointer = clear)
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
	Code     string `json:"code"` // cloud_web_unreachable | message_content_intent_off | message_content_intent_unknown | bot_not_in_guild | allow_from_unknown | allow_from_everyone | gate_not_running | discord_token_invalid | agent_not_logged_in | agent_login_unknown | reply_language_default | discord_avatar_not_set | jev_recommended
	Project  string `json:"project,omitempty"`
	Blocking bool   `json:"blocking"`
	Message  string `json:"message"`
	Fix      string `json:"fix"`
	URL      string `json:"url,omitempty"` // invite link / Developer Portal page to open
}

type WizardResult struct {
	// OK: nothing failed and nothing blocking is left for the user. A saved config with a
	// blocking warning (intent off, bot not in the server) is saved=true, ok=false.
	OK              bool            `json:"ok"`
	Saved           bool            `json:"saved"`
	NeedsUserAction bool            `json:"needs_user_action"`
	Warnings        []WizardWarning `json:"warnings"`
	InviteURLs      []string        `json:"invite_urls,omitempty"` // bots not in the server yet: open each link to add it
	AllowFrom       string          `json:"allow_from,omitempty"`  // who the new bots take orders from
	GateRunning     *bool           `json:"gate_running,omitempty"`
	GateHint        string          `json:"gate_hint,omitempty"`
	// GateStatus (a team of bots): off | running | starting (bothouse starts it now or on its restart) |
	// python_missing | python_too_old | jev_missing (not started: the lead answers what names no one)
	GateStatus      string             `json:"gate_status,omitempty"`
	dataDir         string             // where the gate's jev.json is (GatePrereq)
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
	// HotLoad: a running service started the roles this save added (handleSetupApply), so no restart
	// is needed for them. nil = not tried (dry run, wizard outside a running service).
	HotLoad      *HotLoadResult      `json:"hot_load,omitempty"`
	ConfigBackup string              `json:"config_backup,omitempty"` // copy of config.toml taken before the write
	CloudWeb     *CloudWebTestResult `json:"cloud_web,omitempty"`     // cloud_web: the connection test (page_url = the platform's web page)
	Error        string              `json:"error,omitempty"`
}

// ── store (implemented in cmd/cc-connect on top of config/) ─────

type WizardProjectWrite struct {
	Name, AgentType, WorkDir, PlatformType string
	AgentCmd                               string            // absolute CLI path when it was found outside PATH (L2); "" = leave
	AgentArgs                              []string          // agent option args; nil = leave
	AgentEnv                               map[string]string // merged into agent option env
	AgentOptions                           map[string]any    // set in the agent's options (new projects only)
	Options                                map[string]any    // merged into the platform's options; "" deletes a key
	GateURL, GateFallback                  *string
	Provider                               *ProviderConfig
	FeishuOwnerOpenID                      string // feishu: merged into allow_from when it is empty
	// DisplayName is the name the user gave the role when it differs from the project name (a
	// non-ASCII name maps to role-N); written as team_name, which the panel shows. "" = leave
	DisplayName string
}

// WizardExistingProject is one [[projects]] entry as read from config.toml.
// Options include secrets; they never leave the server.
type WizardExistingProject struct {
	Name, AgentType, WorkDir, AgentCmd string
	Platforms                          map[string]map[string]any // platform type → options (first of each type)
	GateURL, GateFallback              string
	DisplayName                        string // team_name ("" = Name)
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

// pointsAtGatePort: a project's gate_url is a wizard URL on 127.0.0.1:port (an existing install).
func (s WizardSnapshot) pointsAtGatePort(port int) bool {
	for _, p := range s.Projects {
		u, err := url.Parse(p.GateURL)
		if err == nil && isWizardGateURL(p.GateURL) && u.Port() == strconv.Itoa(port) {
			return true
		}
	}
	return false
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

// WizardProjectRemover is implemented by stores that can take projects back out of config.toml:
// a role the wizard just added that did not start in the running service is removed again.
type WizardProjectRemover interface {
	RemoveProjects(names []string) (removed []string, err error)
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
	// Cron: where the wiki's cron jobs go (core/setup_wiki.go); nil = the job file in DataDir.
	Cron WizardCron
	// WikiSubScript: sub-wiki.sh of the config's agent.closed hook ("" = no teammate wikis).
	WikiSubScript string
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
	// cloud_web runs keep the fields above (the Discord team merge reads them) and use these
	CloudWebURL      string           `json:"cloud_web_url,omitempty"`
	CloudWebFallback string           `json:"cloud_web_fallback,omitempty"`
	CloudWebTeam     []SetupTeamEntry `json:"cloud_web_team,omitempty"`
	// GateOff: the user turned the gate off in the wizard (gate.enabled false). A later run without a
	// gate field (add role, flows that show no gate checkbox, AI) keeps it off; one with the field records the new choice.
	GateOff   bool   `json:"gate_off,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type SetupTeamEntry struct {
	Project   string `json:"project"`
	Name      string `json:"name"`
	BotID     string `json:"bot_id,omitempty"`
	AgentType string `json:"agent_type,omitempty"`
	Persona   string `json:"persona,omitempty"` // library persona slug the role was made from
	Avatar    string `json:"avatar,omitempty"`  // library avatar slug ("" = initial-letter badge)
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
	// Windows does not set LANG: ask the OS ("zh-CN" → "zh"); "" on macOS / Linux.
	if l := NormalizeLanguage(osLocaleName()); l != "" {
		return l
	}
	return "en"
}

// SystemLanguage: "zh" or "en" from the process locale (LC_ALL / LANG). Windows does not set
// LANG, so there the user's locale name (zh-CN, en-US, …) is asked from the OS instead.
func SystemLanguage() string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" {
			if isZH(v) {
				return "zh"
			}
			return "en"
		}
	}
	if isZH(osLocaleName()) {
		return "zh"
	}
	return "en"
}

// JevHint is the one-or-two-sentence line under the jev boxes. usable = a jev
// that returns probabilities is saved. Without one, messages the gate can't
// place go to the fallback role (gate.py scorer → rules; core/gate.go fallback);
// with a board, channel picking falls back to name matching by sound.
// Full details: docs/connect-discord-feishu.md「jev 和主角色」.
func JevHint(lang string, usable bool, hardware bool, fallbackName string) string {
	zhName, enName := "", ""
	if fallbackName != "" {
		zhName, enName = "「"+fallbackName+"」", " \""+fallbackName+"\""
	}
	if isJA(lang) {
		if usable {
			if hardware {
				return "gate はこれでメッセージにどのロールが答えるかを判断し、ボードもこれでチャンネルを選びます。"
			}
			return "gate はこれでメッセージにどのロールが答えるかを判断します。"
		}
		s := "未設定の場合：@ されたロールは普段どおり答え、誰が答えるか判断できないメッセージはメインロール" + zhName + "が答えます"
		if hardware {
			s += "。ボードのチャンネル選択は読みの一致で行います"
		}
		return s + "。"
	}
	if isZH(lang) {
		if usable {
			if hardware {
				return "gate 用它判断一句话该哪个角色回，板子也用它选频道。"
			}
			return "gate 用它判断一句话该哪个角色回。"
		}
		s := "不填时：被 @ 的角色照常回，判断不了该谁回的消息由主角色" + zhName + "回"
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
	s := "Without it: an @-mentioned role still answers; messages the gate can't place go to the primary role" + enName
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
		out.Cleared, out.Detail = true, stepJevRemoved(lang, path)
		return out, nil
	}
	if strings.TrimSpace(j.BaseURL) == "" { // skipped / not filled in: keep whatever is in use
		if old, ok := activeJev(dataDir); ok {
			out.InUse = old.Model + " @ " + old.URL
		}
		out.Detail = stepJevKept(lang)
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
	out.Saved, out.InUse, out.Detail = true, cfg.Model+" @ "+cfg.URL, stepJevSaved(lang, path)
	return out, nil
}

// withOldJev appends "still using the previous jev" to a failure reason.
func withOldJev(lang, reason, inUse string) string {
	if isJA(lang) {
		return strings.TrimSuffix(reason, "。") + "。前のもの（" + inUse + "）を使い続けます。"
	}
	if isZH(lang) {
		return strings.TrimSuffix(reason, "。") + "；仍在用旧的 " + inUse + "。"
	}
	return strings.TrimSuffix(reason, ".") + "; still using the previous one: " + inUse + "."
}

// JevFailReason explains why a jev was not saved.
func JevFailReason(lang string, t JevTestResult) string {
	zh, ja := isZH(lang), isJA(lang)
	if t.Slow {
		if ja {
			return fmt.Sprintf("遅すぎます：1 トークンに %.1f 秒かかりました。gate は毎回 %.1f 秒しか待たないので、保存しても使われません。", float64(t.LatencyMs)/1000, jevMaxLatency.Seconds())
		}
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
	pick := func(zhText, jaText, enText string) string {
		return tr3(lang, zhText, jaText, enText) + t.Error
	}
	switch {
	case code == 400 || code == 422:
		return pick("接口拒绝了请求参数（gate 打分用同样的参数）：", "API がリクエストのパラメーターを拒否しました（gate の採点も同じパラメーターを使います）：", "The endpoint rejected the request parameters (the gate scores with the same ones): ")
	case code == 401 || code == 403:
		return pick("Key 不对或没有权限：", "Key が違うか、権限がありません：", "Wrong key or no permission: ")
	case code == 404:
		return pick("地址不对（Base URL 或模型名）：", "アドレスが違います（Base URL またはモデル名）：", "Wrong address (Base URL or model name): ")
	case code >= 500:
		return pick("服务端出错或暂时连不上：", "サーバーエラー、または一時的に接続できません：", "Server error or temporarily unavailable: ")
	case code != 0:
		return pick("接口返回错误：", "API がエラーを返しました：", "The endpoint returned an error: ")
	case !t.Reachable:
		return pick("连不上：", "接続できません：", "Could not connect: ")
	}
	if ja {
		return "このモデルは確率を返さないため、保存しても使われません。"
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
	"qoder": "AGENTS.md", "kimi": "AGENTS.md", "pi": "AGENTS.md", "dsh": "AGENTS.md",
}

// canonicalAgentType maps a CLI binary name the caller may send (claude, agy, cursor-agent,
// qodercli …, from cliSpecs) to the agent's registered name, and rejects names no agent is
// registered under — the bridge would otherwise write the config and then fail to start with
// `unknown agent`.
func canonicalAgentType(t string) (string, error) {
	t = strings.TrimSpace(t)
	if _, ok := agentFactories[t]; !ok {
		for _, s := range cliSpecs {
			if s.agentType == "" {
				continue
			}
			for _, bin := range s.bins {
				if bin == t {
					t = s.agentType
				}
			}
		}
	}
	if _, ok := agentFactories[t]; !ok {
		names := ListRegisteredAgents()
		sort.Strings(names)
		return "", fmt.Errorf("unknown agent type %q, available: %v", t, names)
	}
	return t, nil
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
	// mentionID (cloud_web): the Discord bot ID of a reused Discord bot, so <@id> reaches it on the hub too
	mentionID string
}

// plannedRole is a role after names are fixed against the config (inside the lock).
type plannedRole struct {
	wizardIdentity
	project   string
	workDir   string
	reused    bool // an existing project (asked for, or the same bot found by its ID)
	agentCmd  string
	agentArgs []string          // dsh: how to start the user's dsh (dshRoleLaunch)
	agentEnv  map[string]string // dsh: UV_CACHE_DIR, the wizard-picked key
	nameNote  string            // why the project name is not the bot's name (e.g. role-1 for a name with no a-z/0-9)
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
	// soloShared: a single-role run while the data dir has another wizard team of two or more
	// roles; that team owns gate-team.json and the gate wiring, so the single role gets neither
	soloShared bool
	// bots whose allow_from was set to AllowFromUnset (nobody known to allow)
	allowFromUnset []string
}

// makeRoleDir creates a role's work_dir with its notes/: the lead writes handoff files to
// notes/<name>.md there (PLAYBOOK, ws-handoff), and a missing notes/ made its first write fail
// (#597 G38, v0.1.25 web check).
func makeRoleDir(workDir string) error {
	return os.MkdirAll(filepath.Join(workDir, "notes"), 0o755)
}

// ApplyWizard validates, fills defaults and (unless DryRun) writes everything.
func ApplyWizard(ctx context.Context, env WizardEnv, req WizardRequest) *WizardResult {
	res := &WizardResult{DryRun: req.DryRun, Roles: []WizardRoleResult{}, Steps: []WizardStep{}, Warnings: []WizardWarning{}, dataDir: env.DataDir}
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
	cloudWeb := isCloudWebPlatform(req.Platform)
	isFeishu := req.Platform == "feishu" || req.Platform == "lark"
	if req.Platform != "discord" && !isFeishu && !cloudWeb {
		return fail("platform", fmt.Errorf("platform must be discord, feishu, lark or cloud_web"))
	}
	if len(req.Roles) == 0 {
		return fail("roles", fmt.Errorf("at least one role is required"))
	}
	if req.Wiki != nil {
		if err := req.Wiki.validate(); err != nil {
			return fail("wiki", err)
		}
	}
	if isFeishu && len(req.Roles) != 1 {
		return fail("roles", fmt.Errorf("feishu: one bot per wizard run (multi-role is Discord and cloud_web only)"))
	}
	if isFeishu && (req.Feishu == nil || req.Feishu.AppID == "" || req.Feishu.AppSecret == "") {
		return fail("role 1", fmt.Errorf("feishu: app_id and app_secret required (scan the QR code first)"))
	}
	// cloud_web: the platform's address and bot token; empty ones come from the hub this wizard started
	cwBase, cwToken := "", ""
	if cloudWeb {
		cw := WizardCloudWeb{}
		if req.CloudWeb != nil {
			cw = *req.CloudWeb
		}
		u, tok := resolveCloudWeb(env.DataDir, cw.URL, cw.Token)
		if u == "" || tok == "" {
			return fail("cloud_web", errors.New(tr3(req.Language,
				"cloud_web：要填平台地址 url 和机器人 token（本机没有向导启动的自建平台可以自动填）",
				"cloud_web：プラットフォームのアドレス url とボットの token が必要です（ウィザードが起動したローカルのプラットフォームがないため自動では入りません）",
				"cloud_web: url and token are required (there is no local platform started by this wizard to fill them in)")))
		}
		b, err := cloudWebWSBase(stripQuery(u))
		if err != nil {
			return fail("cloud_web", err)
		}
		cwBase, cwToken = b, tok
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
				var rl *ErrDiscordRateLimited
				switch {
				case errors.Is(err, ErrDiscordTokenInvalid):
					r := fail(step+" discord", errors.New(discordTokenInvalidText(req.Language)))
					r.Warnings = append(r.Warnings, warnTokenInvalid(req.Language, i+1))
					r.NeedsUserAction = true
					return r
				case errors.As(err, &rl):
					return fail(step+" discord", errors.New(discordRateLimitedText(req.Language, rl.RetryAfter)))
				}
				return fail(step+" discord", err)
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
			switch {
			case !info.IntentKnown: // the application lookup failed: can't tell, so don't call it fine
				res.Warnings = append(res.Warnings, warnIntentUnknown(req.Language, info.Username, info.ApplicationID))
			case !info.MessageContent:
				res.Warnings = append(res.Warnings, warnIntentOff(req.Language, info.Username, info.ApplicationID))
			}
			addStep(res, step+" discord", nil, stepBotDetail(req.Language, info.Username, info.IntentKnown, info.MessageContent))
			res.Roles = append(res.Roles, rr)
		} else if cloudWeb {
			if r.ReuseProject != "" {
				p, ok := snap.project(r.ReuseProject)
				if !ok {
					return fail(step, fmt.Errorf("reuse_project %q is not in config", r.ReuseProject))
				}
				if b, ok := byProject[r.ReuseProject]; ok && b.Token != "" {
					w.mentionID = DiscordBotIDFromToken(b.Token)
				}
				if w.Name == "" { // the name it already has on a platform of this kind
					if o, ok := p.Platforms["cloud_web"]; ok {
						u, _ := o["ws_url"].(string)
						w.Name = cloudWebQuery(u, "name")
					}
				}
			}
			res.Roles = append(res.Roles, WizardRoleResult{})
		} else {
			if isFeishu {
				// the bot's open_id goes into the team file (who is who for d10 / ws-handoff); not
				// reachable now = the member is written without it, the role is still made
				f := req.Feishu
				if id, err := wizardFeishuBotOpenID(ctx, f.AppID, f.AppSecret, f.PlatformType); err == nil {
					w.botID = id
				} else { // not blocking; err carries only the API's code/msg, never the secret or token
					res.Warnings = append(res.Warnings, warnFeishuBotIDUnknown(req.Language, w.Name, err))
				}
			}
			res.Roles = append(res.Roles, WizardRoleResult{BotID: w.botID})
		}
		if w.Name == "" {
			w.Name = w.username
		}
		ids = append(ids, w)
	}
	if cloudWeb {
		// the same handshake a bot makes: a wrong address or token writes nothing; a platform that is
		// down right now is saved with a blocking warning (the bots connect once it is up)
		t := TestCloudWeb(ctx, cwBase, cwToken, req.Language)
		res.CloudWeb = &t
		switch t.Code {
		case "ok":
			addStep(res, "cloud_web", nil, t.Message)
		case "unreachable", "error":
			addStep(res, "cloud_web", nil, t.Message)
			res.Warnings = append(res.Warnings, WizardWarning{Code: "cloud_web_unreachable", Blocking: true, Message: t.Message, Fix: t.Fix, URL: t.PageURL})
		default:
			r := fail("cloud_web", errors.New(t.Message+" "+t.Fix))
			return r
		}
		seen := map[string]bool{}
		for i, w := range ids {
			if w.Name != "" && seen[w.Name] {
				return fail(fmt.Sprintf("role %d", i+1), fmt.Errorf("name %q is used twice in this request: the platform would show two members with the same name", w.Name))
			}
			seen[w.Name] = true
		}
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
	if req.Gate == nil && state.GateOff { // no gate field: keep the user's earlier "off"
		req.Gate = &WizardGate{Enabled: false}
	}
	// 2. plan against a config snapshot: names, work dirs, team merge. It runs again
	//    inside the lock against the config as it is then (H3.4).
	plan := func(s WizardSnapshot) (*wizardPlan, error) {
		return planWizard(s, ids, req, state, env.DataDir, defaultAgent, clis, guildID, channelID, allowFrom, env.AlwaysWriteCmd, cwBase, cwToken)
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
				addStep(res, step, nil, stepDryPersonaWrite(req.Language, PersonaFilePath(r.AgentType, r.workDir), r.ReplyLanguage))
				if r.AgentType == "dsh" && !r.reused {
					addStep(res, fmt.Sprintf("role %d dsh", i+1), nil, DSHPatchPath(env.DataDir, r.project))
				}
				if !r.reused && wizardHooksFor(r.AgentType) {
					addStep(res, fmt.Sprintf("role %d hooks", i+1), nil, stepHooksOn(req.Language, AgentHookNames(), hookSettingsShown(r.AgentType, r.workDir, nil)))
				}
				if !r.reused && AgentToolFS != nil {
					addStep(res, fmt.Sprintf("role %d tools", i+1), nil, stepToolsOn(req.Language, AgentToolNames(), PersonaFilePath(r.AgentType, r.workDir)))
				}
				if !r.reused && (RoleWikiFS != nil || env.WikiSubScript != "") {
					addStep(res, fmt.Sprintf("role %d wiki", i+1), nil, filepath.Join(r.workDir, "wiki"))
				}
			case r.updatesReplyLanguage():
				addStep(res, step, nil, stepDryPersonaLang(req.Language, PersonaFilePath(r.AgentType, r.workDir), r.ReplyLanguage))
			default:
				addStep(res, step, nil, stepDryPersonaKept(req.Language, r.project))
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
		finishWizardResult(res, req, pl, usable)
		return res
	}

	// The gate port (keepGatePort): kept when free, this data dir's gate is on it, or an older gate
	// without /whoami is on it and this config's gate_urls already point there; else a new port. Picked only now, after the tokens checked out and not on
	// a dry run, so a failed or dry-run wizard writes nothing; saved before the plan below runs again
	// inside the lock and writes the gate_urls with it.
	if req.gateOn() {
		if port := pickGatePort(env.DataDir, snap.pointsAtGatePort(LocalGatePort())); port != LocalGatePort() {
			if ps, ok := env.Store.(interface{ SetGatePort(int) error }); ok {
				if err := ps.SetGatePort(port); err != nil {
					return fail("gate port", err)
				}
			}
			SetLocalGatePort(port)
		}
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
		addStep(res, "config", nil, stepConfigFresh(req.Language, len(pl.writes)))
	} else {
		addStep(res, "config", nil, stepConfigBackup(req.Language, len(pl.writes), backup))
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
				if err := makeRoleDir(r.workDir); err != nil {
					return fail(step, err)
				}
				if err := AtomicWriteFile(path, []byte(WithReplyLanguage(string(b), r.ReplyLanguage)), 0o644); err != nil {
					return fail(step, err)
				}
				res.Roles[i].PersonaWritten = true
				addStep(res, step, nil, stepPersonaLangOnly(req.Language, r.project, r.ReplyLanguage, path))
				continue
			}
			addStep(res, step, nil, stepPersonaKept(req.Language, r.project))
			continue
		}
		if err := makeRoleDir(r.workDir); err != nil {
			return fail(step, err)
		}
		path := PersonaFilePath(r.AgentType, r.workDir)
		content := r.Persona
		if content == "" {
			if b, err := os.ReadFile(path); err == nil {
				content = string(b)
			}
		}
		if !r.reused { // a new role keeps a diary (setup_defaults.go)
			lang := r.ReplyLanguage
			if lang == "" {
				lang = req.Language
			}
			content = WithDiary(content, lang)
		}
		if err := AtomicWriteFile(path, []byte(WithReplyLanguage(content, r.ReplyLanguage)), 0o644); err != nil {
			return fail(step, err)
		}
		addStep(res, step, nil, stepPersonaWritten(req.Language, r.project, path))
		dsh := wizardDSH(clis)
		if r.AgentType == "dsh" && !r.reused {
			// every new DSH role gets its overlay (dsh --patch): the third-party API picked for it (the key is in
			// the role's env) and the hook bridge; the user's own $DSH_HOME is not written
			ds := fmt.Sprintf("role %d dsh", i+1)
			p, err := writeDSHProviderPatch(env.DataDir, r.project, r.Provider)
			if err != nil {
				return fail(ds, err)
			}
			addStep(res, ds, nil, p)
		}
		if !r.reused && wizardHooksFor(r.AgentType) {
			// a new role gets every tool hook and their rules in its persona; a failure here
			// (no python3, no npm for DSH's hook bridge, …) is reported but does not undo the role
			// ("cc-connect setup hooks on" later)
			hs := fmt.Sprintf("role %d hooks", i+1)
			o := AgentHookOptions{DataDir: env.DataDir, WorkDir: r.workDir, CLI: r.AgentType, Lang: r.ReplyLanguage}
			var err error
			if r.AgentType == "dsh" {
				o.DSHPatch = DSHPatchPath(env.DataDir, r.project)
				o.DSHBridge, err = EnsureDSHBridgeFor(ctx, env.DataDir, dsh.Path, dsh.Version)
			}
			var h *AgentHookResult
			if err == nil {
				h, err = EnableAgentHooks(o)
			}
			if err != nil {
				addStep(res, hs, err, "")
			} else {
				if h.ReviewRequired {
					addStep(res, hs, nil, tr3(req.Language,
						"Codex hook 配置已写入；请在角色目录启动 Codex，信任项目并用 /hooks 审核后生效。",
						"Codex hooks を保存しました。ロールのディレクトリでプロジェクトを信頼し、/hooks で確認してください。",
						"Codex hook configuration written; start Codex in this role directory, trust the project and review /hooks to activate."))
				} else {
					addStep(res, hs, nil, stepHooksOn(req.Language, h.Enabled, hookSettingsShown(r.AgentType, r.workDir, h)))
				}
			}
		}
		if !r.reused && AgentToolFS != nil {
			// a new role gets the small tools (peek, watchvid, websearch) and their lines in its persona; a failure
			// here is reported but does not undo the role ("cc-connect setup tools on" later)
			ts := fmt.Sprintf("role %d tools", i+1)
			if t, err := EnableAgentTools(AgentToolOptions{DataDir: env.DataDir, WorkDir: r.workDir, AgentType: r.AgentType, Lang: r.ReplyLanguage}); err != nil {
				addStep(res, ts, err, "")
			} else {
				addStep(res, ts, nil, stepToolsOn(req.Language, t.Enabled, t.PersonaFile))
			}
		}
		if !r.reused && r.project == pl.fallback && LeadToolFS != nil {
			// Only the new primary role gets collaboration tools; preserve locally edited scripts.
			ls := fmt.Sprintf("role %d lead tools", i+1)
			if tools, skipped, err := InstallLeadTools(env.DataDir, r.workDir, r.AgentType, false); err != nil {
				addStep(res, ls, err, "")
			} else {
				message := tools["tools_dir"]
				if len(skipped) > 0 {
					message += fmt.Sprintf(tr3(req.Language,
						"（保留 %d 个已修改文件）",
						"（変更済みファイル %d 件を保持）",
						" (preserved %d modified files)"), len(skipped))
				}
				addStep(res, ls, nil, message)
			}
		}
	}

	// 自建平台 team: every member's wizard-made persona (one with a conest marker) gets the team line;
	// a hand-written persona without one is left alone (H1)
	if cloudWeb && len(pl.team) > 1 {
		after, _ := env.Store.Snapshot()
		for _, t := range pl.team {
			p, ok := after.project(t.Project)
			if !ok || p.WorkDir == "" {
				continue
			}
			path := PersonaFilePath(p.AgentType, p.WorkDir)
			b, err := os.ReadFile(path)
			if err != nil || !(strings.Contains(string(b), replyLanguageMarker) || strings.Contains(string(b), teamMarker)) {
				addStep(res, "team", nil, stepTeamLineSkipped(req.Language, t.Name, path))
				continue
			}
			lang := req.Language
			if c, _ := PersonaReplyLanguage(string(b)); c != "" {
				lang = c
			}
			if err := AtomicWriteFile(path, []byte(WithTeam(string(b), cloudWebTeamLine(lang, pl.team, pl.fallback, t.Project))), 0o644); err != nil {
				return fail("team", err)
			}
			addStep(res, "team", nil, stepTeamLineWritten(req.Language, t.Name, path))
		}
		addStep(res, "team", nil, stepTeam(req.Language, len(pl.team), pl.fallbackName))
	}

	// a single role gets the file too, as its lead with no subs (the gate's wiki and task board)
	if (req.Platform == "discord" || cloudWeb || isFeishu) && (len(pl.team) > 1 || len(pl.team) == 1 && !pl.soloShared) && req.gateOn() {
		after, _ := env.Store.Snapshot()
		gt := gateTeamJSON(pl.team, pl.fallback, pl.fallbackName, after)
		path := filepath.Join(env.DataDir, gateTeamFile)
		var prev map[string]any
		if readJSONFile(path, &prev) {
			mergeGateTeam(gt, prev)
		}
		// the file is rewritten whole: DSH's members (kind "dsh") go back in as they were
		keepDSHGateTeamEntries(path, gt)
		if err := writeJSONFile(path, gt, 0o644); err != nil {
			return fail("gate team", err)
		}
		addStep(res, "team", nil, stepTeam(req.Language, len(pl.team), pl.fallbackName))
	}

	// 5. jev: absent = keep; empty base_url = remove; otherwise saved only if the gate could use it
	if req.Jev != nil {
		out, err := ApplyJev(ctx, env.DataDir, *req.Jev, req.Language)
		if err != nil {
			return fail("jev", err)
		}
		res.Jev, res.JevOK, res.JevReason, res.JevInUse = out.Test, out.Reason == "", out.Reason, out.InUse
		if out.Reason != "" {
			addStep(res, "jev", errors.New(stepJevNotSaved(req.Language, out.Reason)), "")
		} else {
			addStep(res, "jev", nil, out.Detail)
		}
	} else if j, ok := activeJev(env.DataDir); ok {
		res.JevOK, res.JevInUse = true, j.Model+" @ "+j.URL
	}
	_, usable := activeJev(env.DataDir)
	res.JevHint = JevHint(req.Language, usable, res.Hardware, pl.fallbackName)

	if req.Platform == "discord" {
		applyDiscordAvatars(ctx, env.DataDir, req.Language, pl.roles, pl.team, state.Team, res)
	}
	st := SetupState{Platform: req.Platform, Language: req.Language, GuildID: guildID, ChannelID: channelID,
		FallbackRole: pl.fallback, Team: pl.team, UpdatedAt: time.Now().Format(time.RFC3339)}
	if isFeishu {
		st.FeishuChatID = req.Feishu.ChatID
	}
	// a Discord / Feishu run keeps the cloud_web team (planWizard merges it on the next cloud_web run)
	st.CloudWebURL, st.CloudWebFallback, st.CloudWebTeam = state.CloudWebURL, state.CloudWebFallback, state.CloudWebTeam
	if cloudWeb { // the Discord / Feishu fields stay as they were
		st = state
		st.Language, st.UpdatedAt = req.Language, time.Now().Format(time.RFC3339)
		st.CloudWebURL, st.CloudWebFallback, st.CloudWebTeam = cwBase, pl.fallback, pl.team
	}
	st.GateOff = !req.gateOn()
	if err := writeJSONFile(filepath.Join(env.DataDir, setupStateFile), st, 0o644); err != nil {
		return fail("state", err)
	}
	wikiSession := cloudWebWikiSession // the self-hosted platform has no fixed channel: the muted jobs need none
	if !cloudWeb {
		ch := st.ChannelID
		if ch == "" {
			ch = state.ChannelID // a run without channel_id keeps the earlier default channel
		}
		wikiSession = wizardSessionKey(req.Platform, ch, st.FeishuChatID)
	}
	// every new role's own wiki + nightly reflection (core/rolewiki.go); the cron jobs below then run its sub-wiki.sh
	env.WikiSubScript = applyRoleWikis(ctx, res, env, req, pl, clis)
	applyWizardWiki(res, env, req, pl.fallback, wikiSession)
	res.RestartRequired = true
	res.Saved = true
	if after, err := env.Store.Snapshot(); err == nil {
		reloadGateAfterWizard(env.DataDir, after) // the service in this process starts / restarts its gate now
	}
	finishWizardResult(res, req, pl, usable)
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
			// left alone: report the language its persona already sets ("" = none set)
			rr.ReplyLanguage, rr.ReplyLanguageFrom = "", "existing"
			if r.workDir != "" {
				if b, err := os.ReadFile(PersonaFilePath(r.AgentType, r.workDir)); err == nil {
					rr.ReplyLanguage, _ = PersonaReplyLanguage(string(b))
				}
			}
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

// DefaultAgentYoloMode returns the full-auto / YOLO permission mode string for the given agent type.
func DefaultAgentYoloMode(agentType string) string {
	if m, ok := KnownAgentYoloMode(agentType); ok {
		return m
	}
	return "yolo"
}

// KnownAgentYoloMode is DefaultAgentYoloMode for the agent types whose YOLO mode
// is known; ok is false for any other type (dsh, acp, …). The upgrade migration
// adds "yolo" for acp and dsh itself (config.migrationYoloMode), matching
// DefaultAgentYoloMode; callers here must not guess other types.
func KnownAgentYoloMode(agentType string) (mode string, ok bool) {
	switch strings.ToLower(strings.TrimSpace(agentType)) {
	case "claudecode", "copilot":
		return "bypassPermissions", true
	case "cursor":
		return "force", true
	case "codex", "gemini", "antigravity", "pi", "qoder", "opencode", "kimi", "iflow", "reasonix":
		return "yolo", true
	default:
		return "", false
	}
}

// planWizard fixes project names against the snapshot, fills defaults and builds
// the config writes, merging the team wiring with what each project already has.
func planWizard(s WizardSnapshot, ids []wizardIdentity, req WizardRequest, state SetupState, dataDir, defaultAgent string,
	clis []LocalCLI, guildID, channelID, allowFrom string, alwaysCmd bool, cwBase, cwToken string) (*wizardPlan, error) {
	pl := &wizardPlan{}
	cloudWeb := isCloudWebPlatform(req.Platform)
	byProject := map[string]WizardExistingBot{}
	byBotID := map[string]string{}
	for _, b := range s.DiscordBots() {
		byProject[b.Project] = b
		if b.BotID != "" && byBotID[b.BotID] == "" {
			byBotID[b.BotID] = b.Project
		}
	}
	taken := map[string]bool{}
	workDirs := map[string]string{} // absolute, cleaned work_dir → owning project
	for _, p := range s.Projects {
		taken[p.Name] = true
		if p.WorkDir != "" {
			dir, err := filepath.Abs(p.WorkDir)
			if err != nil {
				return nil, fmt.Errorf("project %q work_dir: %w", p.Name, err)
			}
			workDirs[dir] = p.Name
		}
	}
	used := map[string]bool{}
	for i, w := range ids {
		r := plannedRole{wizardIdentity: w}
		renamed := false // a new bot's name was taken and got -N
		switch {
		case w.reuse != "":
			if _, ok := s.project(w.reuse); !ok {
				return nil, fmt.Errorf("reuse_project %q is no longer in config", w.reuse)
			}
			r.project, r.reused = w.reuse, true
		case req.Platform == "discord" && w.botID != "" && byBotID[w.botID] != "":
			// the same bot is already configured (matched by its bot ID): update that project (H2)
			r.project, r.reused = byBotID[w.botID], true
		case isFeishuPlatform(req.Platform) && sameFeishuApp(s, req.Feishu, used) != "":
			// the same Feishu / Lark app is already configured: update it, don't add a second project
			r.project, r.reused = sameFeishuApp(s, req.Feishu, used), true
		case cloudWeb && sameCloudWebMember(s, cwBase, w, used) != "":
			// the same member of the same platform is already configured: update it, don't add name-2
			r.project, r.reused = sameCloudWebMember(s, cwBase, w, used), true
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
					return nil, fmt.Errorf("can't tell whether this bot is already configured — %s. Set that environment variable for bothouse, or pick the existing bot (reuse_project)", strings.Join(unreadable, "; "))
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
			name := base
			if base == "" {
				// a generated role-N says nothing about the user's name: if it is taken (an earlier
				// add made role-1), move on to the next free number rather than role-1-2 or refusing
				for n := i + 1; ; n++ {
					if name = fmt.Sprintf("role-%d", n); !taken[name] && !used[name] {
						break
					}
				}
			} else {
				for n := 2; taken[name] || used[name]; n++ {
					name = fmt.Sprintf("%s-%d", base, n)
				}
				renamed = name != base
			}
			if noASCII {
				// project names are a-z 0-9 _ - (they go into paths, URLs and gate_url ?bot=); said
				// without entry-specific steps, since the web wizard has no project-name box
				r.nameNote = nameNote(req.Language, raw, name)
			}
			r.project = name
		}
		if req.AppendOnly && (r.reused || renamed) {
			given := w.Name // the name the user typed, not the project name it maps to
			if given == "" {
				given = w.Project
			}
			if given == "" {
				given = r.project
			}
			return nil, fmt.Errorf("a role named %q already exists; pick another name (adding never changes existing roles)", given)
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
			return nil, fmt.Errorf("no supported agent CLI found on this machine (install claude / codex / gemini / opencode / dsh …)")
		}
		agentType, err := canonicalAgentType(r.AgentType)
		if err != nil {
			return nil, fmt.Errorf("role %q: %w", r.project, err)
		}
		r.AgentType = agentType
		if r.Provider != nil && protocolOfAgent[r.AgentType] == "" {
			return nil, fmt.Errorf("%s can't take a third-party API in bothouse; use one of %v", r.AgentType, AttachableAgents)
		}
		if r.Provider != nil && !VendorServes(r.Provider.Vendor, r.AgentType) {
			return nil, fmt.Errorf("%s: %s has no Anthropic endpoint, which DSH needs (DSH only speaks Anthropic Messages)", r.AgentType, r.Provider.Vendor)
		}
		if r.Provider != nil && r.AgentType == "dsh" && r.reused {
			return nil, fmt.Errorf("%s is an existing DSH role: change its model in DSH's own config", r.project)
		}
		if !r.reused {
			r.workDir = r.WorkDir
			if r.workDir == "" {
				r.workDir = filepath.Join(dataDir, "roles", r.project)
			}
			dir, err := filepath.Abs(r.workDir)
			if err != nil {
				return nil, fmt.Errorf("project %q work_dir: %w", r.project, err)
			}
			if owner, exists := workDirs[dir]; exists {
				return nil, fmt.Errorf("%s", sharedWorkDirText(req.Language, r.project, owner, dir))
			}
			workDirs[dir] = r.project
		}
		if r.reused && r.workDir == "" && r.writesPersona() {
			return nil, fmt.Errorf("project %q has no work_dir, so there is no persona file to write", r.project)
		}
		for _, c := range clis {
			if c.AgentType == r.AgentType && c.Supported && c.Path != "" && (!c.InPath || alwaysCmd) {
				r.agentCmd = c.Path // found outside PATH: tell the service where it is (L2)
			}
		}
		if r.AgentType == "dsh" && !r.reused {
			for _, c := range clis {
				if c.AgentType == "dsh" && c.Path != "" {
					r.agentCmd, r.agentArgs, r.agentEnv = dshRoleLaunch(c.Path, dataDir, r.project, r.workDir, r.Provider)
				}
			}
		}
		if cloudWeb {
			r.mentionID = cloudWebMentionID(s.projectPlatform(r.project, "cloud_web"), r.mentionID, cwBase, r.project)
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
	// Feishu / Lark make one bot per wizard run: a later run adds its bot to the earlier ones still in
	// config, and the lead recorded then stays the lead unless this request names another
	if isFeishuPlatform(req.Platform) && isFeishuPlatform(state.Platform) {
		if req.FallbackRole == "" && req.FallbackBotID == "" {
			req.FallbackRole = state.FallbackRole
		}
		for _, t := range state.Team {
			if p, still := s.project(t.Project); still && !inRun[t.Project] && feishuPlatformOf(p) != "" {
				pl.team = append(pl.team, t)
			}
		}
	}
	if cloudWeb && sameCloudWebHub(state.CloudWebURL, cwBase) {
		if req.FallbackRole == "" {
			req.FallbackRole = state.CloudWebFallback
		}
		for _, t := range state.CloudWebTeam {
			if p, still := s.project(t.Project); still && !inRun[t.Project] {
				if o, ok := p.Platforms["cloud_web"]; ok && sameCloudWebHub(fmt.Sprint(o["ws_url"]), cwBase) {
					pl.team = append(pl.team, t)
				}
			}
		}
	}
	for _, r := range pl.roles {
		id := r.botID
		if cloudWeb { // on the platform a bot is known by its mention_id (rh/cloudweb.py user_mention_id)
			id = r.mentionID
		}
		e := SetupTeamEntry{Project: r.project, Name: r.Name, BotID: id, AgentType: r.AgentType}
		for _, old := range append(append([]SetupTeamEntry{}, state.Team...), state.CloudWebTeam...) {
			if old.Project == r.project { // not passed = keep what the state has
				e.Persona, e.Avatar = old.Persona, old.Avatar
				// open_id not reachable this run: keep the one found before, but only for the same bot
				// (r.reused: sameFeishuApp found the same app_id), never for a new app on a reused key/name
				if e.BotID == "" && old.BotID != "" && r.reused && isFeishuPlatform(req.Platform) && isFeishuPlatform(state.Platform) {
					e.BotID = old.BotID
				}
				break
			}
		}
		if r.PersonaPreset != nil {
			e.Persona = *r.PersonaPreset
		}
		if r.Avatar != nil {
			e.Avatar = *r.Avatar
		}
		pl.team = append(pl.team, e)
	}

	// adding a role never moves the lead: keep the recorded fallback of this platform/hub, whatever
	// the request says; only with no recorded one (nothing in the team) does the new role take it
	if req.AppendOnly {
		req.FallbackRole, req.FallbackBotID = "", ""
		if req.Platform == "discord" && state.Platform == "discord" {
			req.FallbackRole = state.FallbackRole
		} else if cloudWeb && sameCloudWebHub(state.CloudWebURL, cwBase) {
			req.FallbackRole = state.CloudWebFallback
		}
	}
	// fallback role (unit = bot): one of the team's bots, else the first bot of this run (L3)
	pl.fallback = req.FallbackRole
	if cloudWeb && req.FallbackRole != "" && !req.AppendOnly { // append: a recorded project name, not a display name
		// the web wizard names the fallback by display name: its guess of a project name can differ
		// from the one planned here (an existing member of the same name is reused, sameCloudWebMember)
		for _, r := range pl.roles {
			if r.Name == req.FallbackRole {
				pl.fallback = r.project
			}
		}
	}
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
			pl.note = stepFallbackNote(req.Language, pl.fallback, pl.roles[0].project)
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
			if r.Name != r.project {
				pw.DisplayName = r.Name
			}
		}
		if r.agentCmd != "" && (!exists || ex.AgentCmd == "") {
			pw.AgentCmd = r.agentCmd
		}
		if r.Provider != nil && r.AgentType != "dsh" { // DSH has no cc-connect provider: dshRoleLaunch + the role's overlay
			p := ResolveWizardProvider(r.Provider.Vendor, r.AgentType, r.Provider.BaseURL, r.Provider.APIKey, r.Provider.Model)
			pw.Provider = &p
		}
		if !exists {
			pw.AgentArgs, pw.AgentEnv = r.agentArgs, r.agentEnv
			pw.AgentOptions = map[string]any{}
			if mode := DefaultAgentYoloMode(r.AgentType); mode != "" {
				pw.AgentOptions["mode"] = mode
			}
			if r.AgentType == "codex" {
				// The exec backend has no approval path: a command outside its read-only sandbox
				// is refused with no card to click. app_server asks through a permission card.
				pw.AgentOptions["backend"] = "app_server"
				if pw.Provider != nil && strings.TrimSpace(pw.Provider.Model) != "" {
					pw.AgentOptions["model"] = strings.TrimSpace(pw.Provider.Model)
				}
			}
		}
		if cloudWeb {
			pw.PlatformType = "cloud_web"
			cur := s.projectPlatform(r.project, "cloud_web")
			pw.Options["transport"] = "websocket"
			avatar := cloudWebQuery(fmt.Sprint(cur["ws_url"]), "avatar") // not passed = keep
			if r.Avatar != nil {
				avatar = cloudWebAvatar(dataDir, req.libraryHost, *r.Avatar)
			}
			pw.Options["ws_url"] = cloudWebBotURL(cwBase, r.project, r.Name, r.mentionID, avatar)
			pw.Options["token"] = cwToken
			if a, _ := cur["allow_from"].(string); strings.TrimSpace(a) == "" || strings.TrimSpace(a) == AllowFromUnset {
				pw.Options["allow_from"] = cloudWebPresets[req.Platform].AllowFrom
			}
			// rh/cloudweb.py 文件头：hub 要求 group_reply_all = true（不然没 @ 它的消息在 gate 之前就被丢了）
			// 和 share_session_in_channel = true（一个频道一个会话）。已有的值不改。
			for _, k := range []string{"share_session_in_channel", "group_reply_all"} {
				if _, set := cur[k]; !set {
					pw.Options[k] = true
				}
			}
		} else if req.Platform == "discord" {
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
		pl.writes = mergeTeamWrites(pl.writes, pl.team, byProject, pl.fallback, pl.fallbackBot, req.gateOn())
	}
	if cloudWeb && len(pl.team) > 1 {
		pl.writes = cloudWebTeamWrites(pl.writes, pl.team, s, pl.fallback, cwBase, req.gateOn())
	}
	if isFeishuPlatform(req.Platform) && len(pl.team) > 1 {
		pl.writes = feishuTeamWrites(pl.writes, pl.team, s, pl.fallback, req.gateOn())
	}
	pl.soloShared = len(pl.team) == 1 && otherWizardTeam(s, state, pl.team[0].Project)
	if (req.Platform == "discord" || cloudWeb || isFeishuPlatform(req.Platform)) && len(pl.team) == 1 && !pl.soloShared {
		pl.writes = soloGateWrites(pl.writes, pl.team[0].Project, req.Platform, s, req.gateOn())
	}
	return pl, nil
}

// projectPlatform: the options of project's first platform of type t (nil when none).
func (s WizardSnapshot) projectPlatform(project, t string) map[string]any {
	if p, ok := s.project(project); ok {
		return p.Platforms[t]
	}
	return nil
}

// sameCloudWebMember finds a project that is already this role on the platform at cwBase: its
// cloud_web ws_url points at the same platform and carries the same display name (or, with no
// name given, the project the name would become). Projects used earlier in the request are skipped.
func sameCloudWebMember(s WizardSnapshot, cwBase string, w wizardIdentity, used map[string]bool) string {
	want := w.Project
	if want == "" {
		want = cleanProjectName(w.Name)
	}
	for _, p := range s.Projects {
		o, ok := p.Platforms["cloud_web"]
		if !ok || used[p.Name] {
			continue
		}
		u, _ := o["ws_url"].(string)
		if !sameCloudWebHub(u, cwBase) {
			continue
		}
		name := cloudWebQuery(u, "name")
		if name == "" {
			name = cloudWebQuery(u, "bot")
		}
		if (w.Name != "" && name == w.Name) || (want != "" && p.Name == want) {
			return p.Name
		}
	}
	return ""
}

// cloudWebMentionID is a role's mention_id on the platform, kept stable across runs: the one its
// ws_url already has; else the Discord bot ID of a reused Discord bot (so <@id> written for Discord
// reaches it on the hub too, like the hand-made production configs); else a number derived from the
// platform address and the project name. The hub takes digits only (rh/cloudweb.py handle: gate.py
// recognises <@digits>); 18 digits like a Discord ID (来源：线上 mention_id 是 18–19 位 Discord ID).
func cloudWebMentionID(cur map[string]any, discordID, cwBase, project string) string {
	if u, _ := cur["ws_url"].(string); u != "" {
		if m := cloudWebQuery(u, "mention_id"); m != "" && isDigits(m) {
			return m
		}
	}
	if discordID != "" && isDigits(discordID) {
		return discordID
	}
	h := sha256.Sum256([]byte(cwBase + "\x00" + project))
	const lo, span = uint64(100000000000000000), uint64(900000000000000000) // [10^17, 10^18): 18 digits
	return strconv.FormatUint(lo+binary.BigEndian.Uint64(h[:8])%span, 10)
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

// cloudWebTeamWrites wires several roles on one platform the way a Discord team is wired
// (mergeTeamWrites):
//   - every member has a mention_id in its ws_url (earlier members configured without one get it);
//   - every member but the lead (the fallback role) has team_lead_bot = the lead's mention_id, so a sub
//     that finishes work the lead @-ed it for hands the answer back with <@lead> (platform/cloud-web
//     lead_return.go). A team_lead_bot outside the team (set by hand) is kept;
//   - gate_url / gate_fallback: the lead answers when no gate can decide ("reply"), the others only
//     listen unless named ("context"); an @-mentioned role always answers (core/gate.go fallbackFor).
//     They are project-wide, so a project that already has a gate_url from its Discord team or set
//     by hand keeps it.
func cloudWebTeamWrites(writes []WizardProjectWrite, team []SetupTeamEntry, s WizardSnapshot, fallback, cwBase string, gateOn bool) []WizardProjectWrite {
	idx := map[string]int{}
	for i, w := range writes {
		idx[w.Name] = i
	}
	write := func(project string) *WizardProjectWrite {
		i, ok := idx[project]
		if !ok {
			writes = append(writes, WizardProjectWrite{Name: project, PlatformType: "cloud_web", Options: map[string]any{}})
			i = len(writes) - 1
			idx[project] = i
		}
		return &writes[i]
	}
	lead := ""
	teamIDs := map[string]bool{}
	for i := range team {
		// Older wizard-owned links still point at the recorded ID when a member's address
		// has been edited. Recognise both IDs so those links follow the current lead.
		if isDigits(team[i].BotID) {
			teamIDs[team[i].BotID] = true
		}
		// the address in config.toml is what the bot really connects with: its mention_id wins over the
		// wizard's record (conest-setup.json), which may be older or hand-edited around
		cur := s.projectPlatform(team[i].Project, "cloud_web")
		u, _ := cur["ws_url"].(string)
		if m := cloudWebQuery(u, "mention_id"); m != "" && isDigits(m) {
			team[i].BotID = m
		} else if team[i].BotID == "" || !isDigits(team[i].BotID) { // saved before mention IDs were written
			team[i].BotID = cloudWebMentionID(nil, "", cwBase, team[i].Project)
		}
		teamIDs[team[i].BotID] = true
		if team[i].Project == fallback {
			lead = team[i].BotID
		}
	}
	for _, t := range team {
		cur := s.projectPlatform(t.Project, "cloud_web")
		w := write(t.Project)
		if u, _ := cur["ws_url"].(string); u != "" && cloudWebQuery(u, "mention_id") == "" && w.Options["ws_url"] == nil {
			w.PlatformType = "cloud_web"
			w.Options["ws_url"] = withQueryParam(u, "mention_id", t.BotID)
		}
		if lb, _ := cur["team_lead_bot"].(string); lb == "" || teamIDs[lb] {
			switch {
			case t.Project == fallback && lb != "":
				w.PlatformType, w.Options["team_lead_bot"] = "cloud_web", "" // the lead names no lead ("" deletes)
			case t.Project != fallback && lead != "":
				w.PlatformType, w.Options["team_lead_bot"] = "cloud_web", lead
			}
		}
		ex, _ := s.project(t.Project)
		_, hasDiscord := ex.Platforms["discord"]
		if ex.GateURL != "" && (hasDiscord || !isWizardGateURL(ex.GateURL)) {
			continue
		}
		if !gateOn {
			clearWizardGate(w, ex.GateURL, ex.GateFallback)
			continue
		}
		gate, fb := localGateURL()+"?bot="+t.Project, "context"
		if t.Project == fallback {
			gate, fb = localGateURL(), "reply"
		}
		w.GateURL, w.GateFallback = &gate, &fb
	}
	return writes
}

// clearWizardGate: the gate turned off in the wizard clears the gate_url / gate_fallback the wizard
// wrote before (core/gate.go: an empty gate_url = no gate); unset or hand-written ones are left.
func clearWizardGate(w *WizardProjectWrite, gateURL, gateFallback string) {
	if !isWizardGateURL(gateURL) {
		return
	}
	empty, emptyFb := "", ""
	w.GateURL = &empty
	if gateFallback == "reply" || gateFallback == "context" {
		w.GateFallback = &emptyFb
	}
}

func isFeishuPlatform(p string) bool { return p == "feishu" || p == "lark" }

// feishuPlatformOf: "feishu" / "lark" when the project has one of them (first found), else "".
func feishuPlatformOf(p WizardExistingProject) string {
	for _, t := range []string{"feishu", "lark"} {
		if _, ok := p.Platforms[t]; ok {
			return t
		}
	}
	return ""
}

// sameFeishuApp: the project that already runs this Feishu / Lark app (same app_id), else "".
func sameFeishuApp(s WizardSnapshot, f *WizardFeishu, used map[string]bool) string {
	if f == nil || strings.TrimSpace(f.AppID) == "" {
		return ""
	}
	for _, p := range s.Projects {
		if t := feishuPlatformOf(p); t != "" && !used[p.Name] && fmt.Sprint(p.Platforms[t]["app_id"]) == strings.TrimSpace(f.AppID) {
			return p.Name
		}
	}
	return ""
}

// feishuTeamWrites wires a Feishu / Lark team made over several wizard runs (one bot each): with the
// gate on, the lead gets gate_url + gate_fallback "reply", the others ?bot=<project> + "context", and,
// as on Discord and cloud_web, group_reply_all and share_session_in_channel when unset (without
// group_reply_all a bot never sees a message that does not @ it, so the lead could not answer those).
// gate_url / gate_fallback are only (re)written when unset or written by the wizard (H3.2).
func feishuTeamWrites(writes []WizardProjectWrite, team []SetupTeamEntry, s WizardSnapshot, fallback string, gateOn bool) []WizardProjectWrite {
	idx := map[string]int{}
	for i, w := range writes {
		idx[w.Name] = i
	}
	for _, t := range team {
		ex, ok := s.project(t.Project)
		pt := feishuPlatformOf(ex)
		i, has := idx[t.Project]
		if !has {
			if pt == "" {
				pt = "feishu"
			}
			writes = append(writes, WizardProjectWrite{Name: t.Project, PlatformType: pt, Options: map[string]any{}})
			i = len(writes) - 1
			idx[t.Project] = i
		}
		w := &writes[i]
		if !gateOn {
			clearWizardGate(w, ex.GateURL, ex.GateFallback)
			continue
		}
		cur := map[string]any{}
		if ok && pt != "" {
			cur = ex.Platforms[pt]
		}
		for _, k := range []string{"group_reply_all", "share_session_in_channel"} {
			if _, set := cur[k]; !set {
				if _, nm := cur["require_mention"]; k == "group_reply_all" && nm { // platform/feishu: require_mention = false means the same
					continue
				}
				w.Options[k] = true
			}
		}
		isLead := t.Project == fallback
		if ex.GateURL == "" || isWizardGateURL(ex.GateURL) {
			gate := localGateURL() + "?bot=" + t.Project
			if isLead {
				gate = localGateURL()
			}
			w.GateURL = &gate
		}
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

// otherWizardTeam reports whether the recorded wizard teams (Discord / Feishu and cloud_web) hold
// a team of at least two roles still in the snapshot that has a role other than project. Such a
// team owns <data_dir>/gate-team.json, so a single-role run must not rewrite it.
func otherWizardTeam(s WizardSnapshot, state SetupState, project string) bool {
	for _, team := range [][]SetupTeamEntry{state.Team, state.CloudWebTeam} {
		live, other := 0, false
		for _, t := range team {
			if _, ok := s.project(t.Project); ok {
				live++
				other = other || t.Project != project
			}
		}
		if live >= 2 && other {
			return true
		}
	}
	return false
}

// soloGateWrites gives a single-role install the gate a team lead gets: gate_url (the lead's, no
// ?bot=) for the wiki and task board each turn, and gate_fallback "reply", so the only role still
// answers whatever the gate cannot decide. Only the team wiring of the gate is written (no
// allow_bots, team_lead_bot or group_reply_all: there is no teammate). The same rules as the team
// writes keep hand-written values: on Discord / Feishu gate_url is (re)written when unset or the
// wizard's; on cloud_web, as in cloudWebTeamWrites, a gate_url the project already has from Discord
// or set by hand is kept. gate_fallback is (re)written when unset or a value the wizard writes.
func soloGateWrites(writes []WizardProjectWrite, project, platform string, s WizardSnapshot, gateOn bool) []WizardProjectWrite {
	i := -1
	for j, w := range writes {
		if w.Name == project {
			i = j
			break
		}
	}
	if i < 0 {
		writes = append(writes, WizardProjectWrite{Name: project, PlatformType: platform, Options: map[string]any{}})
		i = len(writes) - 1
	}
	w := &writes[i]
	ex, _ := s.project(project)
	if !gateOn {
		clearWizardGate(w, ex.GateURL, ex.GateFallback)
		return writes
	}
	if isCloudWebPlatform(platform) && ex.GateURL != "" {
		if _, hasDiscord := ex.Platforms["discord"]; hasDiscord || !isWizardGateURL(ex.GateURL) {
			return writes
		}
	}
	if ex.GateURL == "" || isWizardGateURL(ex.GateURL) {
		gate := localGateURL()
		w.GateURL = &gate
	}
	if ex.GateFallback == "" || (isWizardGateURL(ex.GateURL) && (ex.GateFallback == "reply" || ex.GateFallback == "context")) {
		fb := "reply"
		w.GateFallback = &fb
	}
	return writes
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

// localGateURL: the /decide URL of this data dir's gate (gateAddr, config [gate] port).
func localGateURL() string { return "http://" + localGateAddr() + "/decide" }

// isWizardGateURL reports whether u is a gate_url the wizard itself writes: /decide (and ?bot=) on
// 127.0.0.1 at the gate port in use, the old fixed 9930, or a port this process moved away from.
func isWizardGateURL(u string) bool {
	rest, ok := strings.CutPrefix(u, "http://127.0.0.1:")
	if !ok {
		return false
	}
	port, path, ok := strings.Cut(rest, "/")
	if !ok || (path != "decide" && !strings.HasPrefix(path, "decide?bot=")) {
		return false
	}
	gateAddrMu.RLock()
	defer gateAddrMu.RUnlock()
	return knownGatePorts[port] || "127.0.0.1:"+port == gateAddr
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
func mergeTeamWrites(writes []WizardProjectWrite, team []SetupTeamEntry, existing map[string]WizardExistingBot, fallback, fallbackBot string, gateOn bool) []WizardProjectWrite {
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
		if !gateOn {
			clearWizardGate(w, ex.GateURL, ex.GateFallback)
			continue
		}
		if ex.GateURL == "" || isWizardGateURL(ex.GateURL) {
			gate := localGateURL() + "?bot=" + t.Project
			if isLead {
				gate = localGateURL()
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
	out["gate_enabled"] = !st.GateOff // the wizard's gate checkbox starts from this
	if j, ok := LoadJevConfig(m.wizardDataDir); ok {
		out["jev"] = map[string]any{"url": j.URL, "model": j.Model, "has_key": j.APIKey != "", "logprobs": j.Logprobs}
	}
	m.mu.RLock()
	out["has_projects"] = len(m.engines) > 0
	m.mu.RUnlock()
	if m.wizardStore != nil {
		if snap, err := m.wizardStore.Snapshot(); err == nil {
			names, shown := []string{}, []string{}
			for _, p := range snap.Projects {
				names = append(names, p.Name)
				if p.DisplayName != "" {
					shown = append(shown, p.DisplayName)
				} else {
					shown = append(shown, p.Name)
				}
			}
			out["projects"] = names              // the web wizard avoids these names for new bots (same rule as planWizard)
			out["project_display_names"] = shown // what the panel lists as existing roles (team_name, else name)
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
	if w := LoadWikiSetup(); w != nil {
		out["wiki"] = w
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
		Lang         string `json:"lang"` // language of the error text (the web UI language)
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
		msg := err.Error()
		var rl *ErrDiscordRateLimited
		switch {
		case errors.Is(err, ErrDiscordTokenInvalid):
			msg = discordTokenInvalidText(req.Lang)
		case errors.As(err, &rl):
			msg = discordRateLimitedText(req.Lang, rl.RetryAfter)
		}
		mgmtError(w, http.StatusBadRequest, msg)
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
	// AlwaysWriteCmd as in the command-line wizard: the PATH this process has now says nothing about
	// the PATH a later restart or reinstall gives the service, so the detected absolute path goes into cmd.
	env := WizardEnv{Store: m.wizardStore, DataDir: m.wizardDataDir, AlwaysWriteCmd: true, WikiSubScript: m.wikiSubScript}
	if m.cronScheduler != nil { // a running service: the wiki's jobs start without a restart
		env.Cron = CronOfScheduler(m.cronScheduler)
	}
	req.libraryHost = r.Host
	// the projects config.toml had before this save: only the ones it adds may be rolled back
	before := map[string]bool{}
	if snap, err := m.wizardStore.Snapshot(); err == nil {
		for _, p := range snap.Projects {
			before[p.Name] = true
		}
	}
	res := ApplyWizard(r.Context(), env, req)
	if res.Saved && !res.DryRun && m.hotLoad != nil {
		// adding a role also rewrites the running roles' allow_bots / team_lead_bot / gate: reload
		// them first (outside m.mu before hotLoad, which registers new engines under it)
		pending, reloadErr := m.reloadRunning()
		hl := m.hotLoad()
		if reloadErr != nil {
			hl.ReloadError = reloadErr.Error()
			slog.Warn("setup apply: running roles not reloaded, restart needed", "error", reloadErr)
		}
		if len(pending) > 0 {
			hl.RestartKeys = pending
			slog.Warn("setup apply: options need a restart", "keys", strings.Join(pending, "; "))
		}
		unremoved := m.rollBackFailedRoles(&hl, before)
		res.HotLoad = &hl
		// restart only when something could not be applied live; a role that failed and was taken
		// back out of config.toml would not start after a restart either
		if req.AppendOnly && hl.Error == "" && unremoved == 0 && reloadErr == nil && len(pending) == 0 {
			res.RestartRequired = false
		}
	}
	status := http.StatusOK
	if !res.OK && !res.Saved { // saved with warnings is still a 200: the config was written
		status = http.StatusBadRequest
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": res.OK, "data": res, "error": res.Error})
}

// rollBackFailedRoles takes the roles this save added that did not start (hl.Failed, not in
// before) out of config.toml again; left there, every save retries them and the next start
// exits on them. Roles that were already in the file are left alone. It returns how many failed
// roles are still in config.toml.
func (m *ManagementServer) rollBackFailedRoles(hl *HotLoadResult, before map[string]bool) int {
	var added []string
	for name := range hl.Failed {
		if !before[name] {
			added = append(added, name)
		}
	}
	sort.Strings(added)
	if len(added) == 0 {
		return len(hl.Failed)
	}
	rm, ok := m.wizardStore.(WizardProjectRemover)
	if !ok {
		return len(hl.Failed)
	}
	removed, err := rm.RemoveProjects(added)
	if err != nil {
		slog.Error("setup apply: failed roles not removed from config", "projects", strings.Join(added, ","), "error", err)
		hl.RollbackError = err.Error()
		return len(hl.Failed)
	}
	for _, n := range removed {
		slog.Warn("setup apply: role did not start, removed from config", "project", n, "error", hl.Failed[n])
	}
	hl.Removed = removed
	return len(hl.Failed) - len(removed)
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

// writePersonaJSON also says which reply language the persona sets (PersonaReplyLanguage), so the
// wizard can show what an existing bot keeps when its persona is left alone.
func writePersonaJSON(w http.ResponseWriter, path string) {
	b, err := os.ReadFile(path)
	code, line := PersonaReplyLanguage(string(b))
	mgmtJSON(w, http.StatusOK, map[string]any{"path": path, "exists": err == nil, "content": string(b),
		"reply_language": code, "reply_language_line": line})
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

// mergeGateTeam carries over from the team file already on disk what the wizard does not write
// itself: top-level keys (e.g. the workspace channel id "workspace") and, per member, keys the user
// added by hand (e.g. "wt"). A member is matched by its id, else by its project key / name; what the
// wizard wrote now always wins. "id" and "workspace" (work dir) are the wizard's own keys and are never
// carried over: a matched-by-name old member may be a deleted bot (the id comes from planWizard/state only).
func mergeGateTeam(gt, prev map[string]any) {
	for k, v := range prev {
		if _, ok := gt[k]; !ok {
			gt[k] = v
		}
	}
	var olds []map[string]any
	if m, ok := prev["lead"].(map[string]any); ok {
		olds = append(olds, m)
	}
	oldSubs, _ := prev["subs"].(map[string]any)
	for _, v := range oldSubs {
		if m, ok := v.(map[string]any); ok {
			olds = append(olds, m)
		}
	}
	find := func(key string, m map[string]any) map[string]any {
		if id, _ := m["id"].(string); id != "" {
			for _, o := range olds {
				if oid, _ := o["id"].(string); oid == id {
					return o
				}
			}
		}
		if o, ok := oldSubs[key].(map[string]any); ok && key != "" {
			return o
		}
		name, _ := m["name"].(string)
		for _, o := range olds {
			if on, _ := o["name"].(string); on != "" && on == name {
				return o
			}
		}
		return nil
	}
	fill := func(key string, m map[string]any) {
		if o := find(key, m); o != nil {
			for k, v := range o {
				if k == "id" || k == "workspace" {
					continue
				}
				if _, ok := m[k]; !ok {
					m[k] = v
				}
			}
		}
	}
	if m, ok := gt["lead"].(map[string]any); ok {
		fill("", m)
	}
	if subs, ok := gt["subs"].(map[string]any); ok {
		for k, v := range subs {
			if m, ok := v.(map[string]any); ok {
				fill(k, m)
			}
		}
	}
}

// warnFeishuBotIDUnknown: the bot's open_id could not be looked up (network, or the app has no bot
// capability); the role is made, but d10 / ws-handoff cannot tell who she is until a rerun finds it.
func warnFeishuBotIDUnknown(lang, project string, err error) WizardWarning {
	return WizardWarning{Code: "feishu_bot_id_unknown", Project: project, Blocking: false,
		Message: tr3(lang, "没查到这个飞书机器人的 open_id（"+err.Error()+"），协作脚本暂时认不出她。",
			"この Feishu ボットの open_id を取得できませんでした（"+err.Error()+"）。連携スクリプトはまだ彼女を識別できません。",
			"Could not look up this Feishu bot's open_id ("+err.Error()+"); the collaboration scripts cannot tell who she is yet."),
		Fix: tr3(lang, "网络好了、或给应用开了机器人能力后重跑一次向导即可补上。",
			"ネットワークが戻るか、アプリでボット機能を有効にしてから、もう一度ウィザードを実行してください。",
			"Run the wizard again once the network is back or the app has the bot capability enabled.")}
}

// wizardFeishuBotOpenID is FeishuBotOpenID; tests swap it (no network in core tests).
var wizardFeishuBotOpenID = FeishuBotOpenID

// gateTeamJSON is <data_dir>/gate-team.json, the one team file the gate and the collaboration
// scripts (contrib/lead/_team.py: d10, ws-handoff) read to know who is who: every member has its
// platform user id ("id": a Discord bot id, a Feishu open_id, a DSH member id — kept as the string
// the platform uses, never assumed numeric) and its work directory ("workspace"). Both are left out
// when the wizard does not know them.
func gateTeamJSON(team []SetupTeamEntry, fallback, fallbackName string, s WizardSnapshot) map[string]any {
	member := func(t SetupTeamEntry, name string, aliases []string) map[string]any {
		m := map[string]any{"name": name, "aliases": aliases}
		if t.BotID != "" {
			m["id"] = t.BotID
		}
		if p, ok := s.project(t.Project); ok && p.WorkDir != "" {
			m["workspace"] = p.WorkDir
		}
		return m
	}
	subs := map[string]any{}
	gt := map[string]any{"lead": map[string]any{"name": fallbackName, "aliases": []string{fallback}}, "subs": subs}
	for _, t := range team {
		if t.Project == fallback {
			gt["lead"] = member(t, fallbackName, []string{fallback})
		} else {
			subs[t.Project] = member(t, t.Name, []string{})
		}
	}
	return gt
}
