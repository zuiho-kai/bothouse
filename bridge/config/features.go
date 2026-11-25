package config

// The feature switch registry (#1861): every on/off switch of config.toml in one list, so the
// panel's 功能开关 page and `bothouse features list` show the same thing. A switch is a boolean
// that turns a feature on or off; ports, tokens, numbers and permission/security flags are not
// listed (featureNotSwitch names each boolean left out and why — features_test.go fails when a
// new boolean is in neither list).

import (
	"fmt"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
)

const (
	FeatureScopeGlobal  = "global"
	FeatureScopeProject = "project"
)

// FeatureSwitch is one row of the registry.
type FeatureSwitch struct {
	// Key is the config.toml path; a project switch is relative to its [[projects]] block.
	Key   string `json:"key"`
	Scope string `json:"scope"`
	Name  string `json:"name"` // plain Chinese name
	// NameEN / DescEN: the same for a panel or a role that is not Chinese.
	NameEN string `json:"name_en"`
	Desc   string `json:"desc"`
	DescEN string `json:"desc_en"`
	// Restart: the running bridge only reads it at start.
	Restart bool `json:"restart"`
	// Inverted: the config key means "off" (team_review.disabled): on = the key is false.
	Inverted bool `json:"inverted,omitempty"`

	def func(p *ProjectConfig) bool
	get func(cfg *Config, p *ProjectConfig) bool
	set func(cfg *Config, p *ProjectConfig, on bool)
}

// FeatureState is a switch with its value in one config (and one project).
type FeatureState struct {
	FeatureSwitch
	Project string `json:"project,omitempty"`
	On      bool   `json:"on"`
	Default bool   `json:"default"`
	// Running is what the running bridge uses: the value at start for a Restart switch, On otherwise.
	Running        bool `json:"running"`
	PendingRestart bool `json:"pending_restart"`
}

// ID names a state in the start-time snapshot: "<key>" or "<project>/<key>".
func (s FeatureState) ID() string {
	if s.Project == "" {
		return s.Key
	}
	return s.Project + "/" + s.Key
}

func boolOr(v *bool, dflt bool) bool {
	if v == nil {
		return dflt
	}
	return *v
}

func always(v bool) func(*ProjectConfig) bool { return func(*ProjectConfig) bool { return v } }

// g / p build a global / project switch on a *bool (unset = dflt).
func g(key string, dflt, restart bool, name, desc, nameEN, descEN string, field func(*Config) **bool) FeatureSwitch {
	return FeatureSwitch{Key: key, Scope: FeatureScopeGlobal, Name: name, Desc: desc, NameEN: nameEN, DescEN: descEN, Restart: restart,
		def: always(dflt),
		get: func(cfg *Config, _ *ProjectConfig) bool { return boolOr(*field(cfg), dflt) },
		set: func(cfg *Config, _ *ProjectConfig, on bool) { *field(cfg) = &on }}
}

func p(key string, dflt, restart bool, name, desc, nameEN, descEN string, field func(*ProjectConfig) **bool) FeatureSwitch {
	return FeatureSwitch{Key: key, Scope: FeatureScopeProject, Name: name, Desc: desc, NameEN: nameEN, DescEN: descEN, Restart: restart,
		def: always(dflt),
		get: func(_ *Config, p *ProjectConfig) bool { return boolOr(*field(p), dflt) },
		set: func(_ *Config, p *ProjectConfig, on bool) { *field(p) = &on }}
}

// gPlain / pPlain: the same on a plain bool (unset = false).
func gPlain(key string, restart bool, name, desc, nameEN, descEN string, field func(*Config) *bool) FeatureSwitch {
	return FeatureSwitch{Key: key, Scope: FeatureScopeGlobal, Name: name, Desc: desc, NameEN: nameEN, DescEN: descEN, Restart: restart,
		def: always(false),
		get: func(cfg *Config, _ *ProjectConfig) bool { return *field(cfg) },
		set: func(cfg *Config, _ *ProjectConfig, on bool) { *field(cfg) = on }}
}

func pPlain(key string, restart bool, name, desc, nameEN, descEN string, field func(*ProjectConfig) *bool) FeatureSwitch {
	return FeatureSwitch{Key: key, Scope: FeatureScopeProject, Name: name, Desc: desc, NameEN: nameEN, DescEN: descEN, Restart: restart,
		def: always(false),
		get: func(_ *Config, p *ProjectConfig) bool { return *field(p) },
		set: func(_ *Config, p *ProjectConfig, on bool) { *field(p) = on }}
}

// globalDisplay is EffectiveDisplay without a project: what [display] and legacy quiet give.
func globalDisplay(cfg *Config) (thinking, tool, showCtx, footer, hideAgentFooter bool) {
	_, thinking, tool, _, _, showCtx, footer, hideAgentFooter = EffectiveDisplay(cfg, &ProjectConfig{})
	return
}

var featureSwitches = []FeatureSwitch{
	// ── global ──
	g("proactive.enabled", false, false, "主动消息控量", "角色自己主动发的消息：同时到点的合成一条、每个聊天有上限、没人理就少发。",
		"Proactive message control", "Messages roles send on their own: merge the ones due together, cap them per chat, back off when nobody answers.",
		func(c *Config) **bool { return &c.Proactive.Enabled }),
	g("proactive.min_gap", true, false, "主动消息最小间隔", "他没回时，同一个聊天两小时内不再主动发第二条（「过一阵再找他」）；他说话或点反应就从头算。",
		"Proactive message min gap", "While nobody answers, at most one proactive message per chat every two hours; an answer starts the count over.",
		func(c *Config) **bool { return &c.Proactive.MinGap }),
	g("stream_preview.enabled", true, true, "回复流式预览", "回复边写边显示，不用等整段写完。",
		"Streaming preview", "Show the reply while it is being written.",
		func(c *Config) **bool { return &c.StreamPreview.Enabled }),
	g("instant_reply.enabled", false, false, "收到先回一句", "收到消息马上回一句「处理中」，再开始干活。",
		"Instant reply", "Answer \"processing\" right away, before the work starts.",
		func(c *Config) **bool { return &c.InstantReply.Enabled }),
	{Key: "display.thinking_messages", Scope: FeatureScopeGlobal, Name: "显示思考过程", Desc: "把模型的思考过程也发到聊天里。",
		NameEN: "Thinking messages", DescEN: "Post the model's thinking to the chat.", def: always(false),
		get: func(c *Config, _ *ProjectConfig) bool { v, _, _, _, _ := globalDisplay(c); return v },
		set: func(c *Config, _ *ProjectConfig, on bool) { c.Display.ThinkingMessages = &on }},
	{Key: "display.tool_messages", Scope: FeatureScopeGlobal, Name: "显示工具调用", Desc: "把跑命令、读文件这些进度发到聊天里。",
		NameEN: "Tool messages", DescEN: "Post tool progress (commands, file reads) to the chat.", def: always(true),
		get: func(c *Config, _ *ProjectConfig) bool { _, v, _, _, _ := globalDisplay(c); return v },
		set: func(c *Config, _ *ProjectConfig, on bool) { c.Display.ToolMessages = &on }},
	g("display.reply_footer", true, false, "回复页脚", "回复末尾那几行：模型、用量、工作目录。角色自己设了的以角色为准。",
		"Reply footer", "The lines under a reply: model, usage, work dir. A role's own setting wins.",
		func(c *Config) **bool { return &c.Display.ReplyFooter }),
	g("display.show_context_indicator", true, false, "页脚里的上下文用量", "页脚第一行（模型、用量、上下文占比）。角色自己设了的以角色为准。",
		"Context line in the footer", "The footer's first line (model, usage, context %). A role's own setting wins.",
		func(c *Config) **bool { return &c.Display.ShowContextIndicator }),
	g("display.hide_agent_footer", false, false, "去掉模型自带的页脚", "模型自己在正文里写的模型名、用量那几行不显示。",
		"Hide the agent's own footer", "Strip the model/token lines the agent writes into its text.",
		func(c *Config) **bool { return &c.Display.HideAgentFooter }),
	gPlain("speech.enabled", true, "语音转文字", "收到语音消息先转成文字再给角色。要先配好语音服务。",
		"Speech to text", "Transcribe voice messages before the role sees them. Needs a speech provider.",
		func(c *Config) *bool { return &c.Speech.Enabled }),
	gPlain("tts.enabled", true, "语音回复", "把回复合成语音发出去。要先配好语音合成服务。",
		"Text to speech", "Send replies as synthesized voice. Needs a TTS provider.",
		func(c *Config) *bool { return &c.TTS.Enabled }),
	gPlain("image_gen.enabled", true, "生图", "角色可以生成图片。花的是主人的钱，要先填好生图的密钥。",
		"Image generation", "Roles may generate pictures. It costs the owner money and needs an API key.",
		func(c *Config) *bool { return &c.ImageGen.Enabled }),
	{Key: "team_review.disabled", Scope: FeatureScopeGlobal, Inverted: true, Name: "交回自动验收", Desc: "工作区交回后自动派一位队友验收；关掉就直接算完成。",
		NameEN: "Review of handbacks", DescEN: "A teammate verifies each workspace handback; off closes it as done.", def: always(true),
		get: func(c *Config, _ *ProjectConfig) bool { return !c.TeamReview.Disabled },
		set: func(c *Config, _ *ProjectConfig, on bool) { c.TeamReview.Disabled = !on }},
	g("cron.silent", false, true, "定时任务开始时不通知", "定时任务开跑时不发「开始执行」那条消息。",
		"Silent cron start", "Do not post the start notice when a scheduled task begins.",
		func(c *Config) **bool { return &c.Cron.Silent }),
	g("relay.voice_resident", false, true, "语音常驻会话", "语音对话复用同一个会话，不每句话新开一个，省等待时间。",
		"Resident voice session", "Voice turns reuse one live session instead of starting one per turn.",
		func(c *Config) **bool { return &c.Relay.VoiceResident }),
	g("cleanup.enabled", true, true, "自动清理", "一周没人碰的临时目录和旧运行记录自动清掉。",
		"Automatic cleanup", "Remove temporary dirs and old run records nobody touched for a week.",
		func(c *Config) **bool { return &c.Cleanup.Enabled }),
	g("webhook.enabled", false, true, "外部 Webhook 入口", "让外部程序用网络请求叫醒角色。没设令牌时谁都能调，先设令牌再开。",
		"Webhook endpoint", "Outside programs may wake a role over HTTP. Without a token anyone can call it: set one first.",
		func(c *Config) **bool { return &c.Webhook.Enabled }),
	g("bridge.enabled", false, true, "外接适配器通道", "网页聊天和外部平台适配器接进来的通道。要有令牌才起得来。",
		"Adapter bridge", "The WebSocket channel web chat and external adapters connect to. Needs a token.",
		func(c *Config) **bool { return &c.Bridge.Enabled }),

	// ── per project ──
	p("heartbeat.enabled", false, true, "心跳", "隔一段时间自动叫醒角色看一眼。要先填好发到哪个会话。",
		"Heartbeat", "Wake the role at an interval. Needs a target session.",
		func(p *ProjectConfig) **bool { return &p.Heartbeat.Enabled }),
	p("auto_compress.enabled", false, false, "自动压缩上下文", "上下文太长时自动压缩一次。",
		"Auto compress", "Compress the context when it grows too long.",
		func(p *ProjectConfig) **bool { return &p.AutoCompress.Enabled }),
	p("cold_cache_fresh.enabled", true, false, "久没说话换新会话", "隔了很久再说话时开新会话并带上摘要，不重读整段旧上下文。",
		"Fresh session on cold cache", "After a long pause start a fresh session with a summary instead of re-reading the old context.",
		func(p *ProjectConfig) **bool { return &p.ColdCacheFresh.Enabled }),
	p("image_fresh.enabled", false, false, "图片太多换新会话", "上下文里图片攒多了，下一条消息开新会话，只带文字。",
		"Fresh session on many images", "Once images pile up in the context, the next message starts a fresh session with text only.",
		func(p *ProjectConfig) **bool { return &p.ImageFresh.Enabled }),
	{Key: "observe.enabled", Scope: FeatureScopeProject, Restart: true, Name: "转发终端会话", Desc: "把本机终端里直接开的会话转发到聊天频道。要先填好频道。",
		NameEN: "Observe terminal sessions", DescEN: "Forward sessions started in a local terminal to a chat channel. Needs a channel.", def: always(false),
		get: func(_ *Config, p *ProjectConfig) bool { return p.Observe != nil && p.Observe.Enabled },
		set: func(_ *Config, p *ProjectConfig, on bool) {
			if p.Observe == nil {
				p.Observe = &ObserveConfig{}
			}
			p.Observe.Enabled = on
		}},
	p("public_progress", true, true, "公开任务卡", "派活时在频道里自动建一张公开的任务进度卡。",
		"Public task cards", "A delegation creates a public progress card in the channel.",
		func(p *ProjectConfig) **bool { return &p.PublicProgress }),
	p("gate_local", true, false, "忙时接话规则", "角色正忙时又被叫到：说停就停，别的话插进当前这一轮。",
		"Built-in busy rules", "A message that calls a busy role: a stop word cancels the turn, anything else is inserted into it.",
		func(p *ProjectConfig) **bool { return &p.GateLocal }),
	{Key: "gate_sender_silence", Scope: FeatureScopeProject, Name: "连发合并成一次回", Desc: "同一个人连着发几条，等他停下再合成一轮回。QQ 默认开，其他默认关。",
		NameEN: "Merge consecutive messages", DescEN: "Several lines from one person become one turn once they stop typing. On by default for QQ only.",
		def: func(p *ProjectConfig) bool { c := *p; c.GateSenderSilence = nil; return c.GateSenderSilenceEnabled() },
		get: func(_ *Config, p *ProjectConfig) bool { return p.GateSenderSilenceEnabled() },
		set: func(_ *Config, p *ProjectConfig, on bool) { p.GateSenderSilence = &on }},
	pPlain("channel_board", false, "频道任务看板", "在每个频道置顶一条任务看板消息并持续更新。",
		"Channel task board", "Post, pin and keep editing one task board message per channel.",
		func(p *ProjectConfig) *bool { return &p.ChannelBoard }),
	p("team_board", true, false, "团队状态板", "每个频道置顶一条「谁在做什么」并持续更新。只对主角色起作用。",
		"Team board", "One pinned, live \"who is doing what\" message per channel. Lead only.",
		func(p *ProjectConfig) **bool { return &p.TeamBoard }),
	p("task_forum", true, false, "任务同步到论坛", "团队任务在服务器论坛里各有一个帖子。",
		"Task forum", "Team tasks are mirrored as posts in the server forum.",
		func(p *ProjectConfig) **bool { return &p.TaskForum }),
	p("mention_assigner", false, false, "交回结果 @ 布置人", "交回结果和转你拍板的问题，开头 @ 布置这件活的人；机器人或定时布置的活 @ 你。只对主角色起作用。",
		"Mention the task assigner", "The handback and the questions passed to you open with an @ of whoever set the task; a task set by a bot or a timer @ the owner. Lead only.",
		func(p *ProjectConfig) **bool { return &p.MentionAssigner }),
	p("mention_human_gate", false, false, "收口 @ 真人", "普通回复里的 @ 真人只留文字不提醒，只在放行交回和要拍板两个出口响铃并防重复 @；关掉时桥不拦，按角色规矩走。开着时规矩里写的 @ 也只在这两个出口生效。单角色配在自己项目上，团队里主角色打开后全队生效。",
		"Gate human mentions", "Ordinary replies keep @human as text without pinging; only release posts and decision asks notify (with dedup). Off leaves mentions to role rules. While on, @ in rules only notifies on those two exits. Per project; enabling on the team lead applies to the whole team.",
		func(p *ProjectConfig) **bool { return &p.MentionHumanGate }),
	p("team_workspaces", true, false, "工作区", "每个频道配一个工作区频道，大活交到那里做。只对主角色起作用。",
		"Team workspaces", "Each channel gets a workspace channel big jobs are handed to. Lead only.",
		func(p *ProjectConfig) **bool { return &p.TeamWorkspaces }),
	p("member_workspaces", false, false, "成员个人目录", "每个加入的真人有自己的目录，可以用自己的 GitHub 授权。",
		"Member workspaces", "Every person who joins gets a personal directory and may authorize their own GitHub.",
		func(p *ProjectConfig) **bool { return &p.MemberWorkspaces }),
	pPlain("voice_desk", false, "语音总台", "语音对话时能看到队友进度，并把确认过的指令转给队友。",
		"Voice desk", "Voice turns see teammates' progress and may hand a confirmed instruction to one.",
		func(p *ProjectConfig) *bool { return &p.VoiceDesk }),
	{Key: "reply_footer", Scope: FeatureScopeProject, Name: "回复页脚", Desc: "这个角色回复末尾的那几行。没设时跟全局的回复页脚。",
		NameEN: "Reply footer", DescEN: "The lines under this role's replies. Unset follows the global switch.", def: always(true),
		get: func(c *Config, p *ProjectConfig) bool { _, _, _, _, _, _, v, _ := EffectiveDisplay(c, p); return v },
		set: func(_ *Config, p *ProjectConfig, on bool) { p.ReplyFooter = &on }},
	{Key: "show_context_indicator", Scope: FeatureScopeProject, Name: "页脚里的上下文用量", Desc: "页脚第一行（模型、用量、上下文占比）。没设时跟全局。",
		NameEN: "Context line in the footer", DescEN: "The footer's first line. Unset follows the global switch.", def: always(true),
		get: func(c *Config, p *ProjectConfig) bool { _, _, _, _, _, v, _, _ := EffectiveDisplay(c, p); return v },
		set: func(_ *Config, p *ProjectConfig, on bool) { p.ShowContextIndicator = &on }},
	p("show_workdir_indicator", true, false, "页脚里的工作目录", "页脚第二行，写当前工作目录。",
		"Work dir line in the footer", "The footer's second line: the work directory.",
		func(p *ProjectConfig) **bool { return &p.ShowWorkdirIndicator }),
	p("show_quota_indicator", true, false, "页脚里的额度", "在页脚后面附上账号额度；关掉就不查也不显示。",
		"Quota in the footer", "Append the account quota to the footer; off never queries it.",
		func(p *ProjectConfig) **bool { return &p.ShowQuotaIndicator }),
	p("show_quota_status", true, false, "没额度数据时写原因", "查不到额度时写「查询中、没数据、失败」这类状态。",
		"Quota status", "Without a measured quota, say why (querying, no data, failed).",
		func(p *ProjectConfig) **bool { return &p.ShowQuotaStatus }),
	p("inject_agent_identity", true, false, "附身份说明", "每个会话第一轮告诉角色它在桥里叫什么。关掉由人设自己管，省一点字数。",
		"Identity block", "Tell the role its bridge identity on the first turn of each session. Off leaves identity to the persona.",
		func(p *ProjectConfig) **bool { return &p.InjectAgentIdentity }),
	p("inject_team_rules", true, false, "附团队规矩", "把团队模式的规矩附给角色。团队频道以外的聊天角色可以关。",
		"Team rules", "Give the role the team-mode rules. A chat persona outside the team may turn it off.",
		func(p *ProjectConfig) **bool { return &p.InjectTeamRules }),
	p("inject_subagent_policy", false, false, "限制自己开子任务", "每个会话第一轮提醒角色：人明确同意了才开子任务。",
		"Subagent policy", "Remind the role on the first turn of each session to start subagents only on explicit human consent.",
		func(p *ProjectConfig) **bool { return &p.InjectSubagentPolicy }),
	{Key: "inject_sender", Scope: FeatureScopeProject, Name: "每条消息附发送人", Desc: "告诉角色每句话是谁说的。多人频道默认开，一个人用默认关。",
		NameEN: "Sender on each message", DescEN: "Tell the role who wrote each message. On by default in multi-person channels.",
		def: func(p *ProjectConfig) bool { c := *p; c.InjectSender = nil; return c.InjectSenderEnabled() },
		get: func(_ *Config, p *ProjectConfig) bool { return p.InjectSenderEnabled() },
		set: func(_ *Config, p *ProjectConfig, on bool) { p.InjectSender = &on }},
	p("queued_notice", true, false, "排队提示", "角色正忙时新消息进队列，回一句「已排队」。",
		"Queued notice", "Say \"queued\" when a message waits behind a running turn.",
		func(p *ProjectConfig) **bool { return &p.QueuedNotice }),
	p("filter_external_sessions", false, false, "会话列表只看桥建的", "列会话时不显示在终端里直接开的那些。",
		"Hide external sessions", "The session list leaves out sessions started directly in a terminal.",
		func(p *ProjectConfig) **bool { return &p.FilterExternalSessions }),
}

// featureNotSwitch: booleans of config.toml that are deliberately not in the registry, and why.
// Keys are toml paths; "projects." marks a [[projects]] field.
var featureNotSwitch = map[string]string{
	"quiet":                      "legacy alias of [display]; the display switches cover it",
	"management.enabled":         "the panel's own switch: turning it off from the panel locks the panel out",
	"bridge.insecure":            "security flag (run without a token), not a feature",
	"plugins.allow_non_registry": "permission: which plugin sources may be installed",
	"projects.quiet":             "legacy alias of [projects.display]",
	"projects.skip_git":          "workspace init option, not a feature",
	"projects.workspace_init_allow_local_paths": "permission: which paths workspace init may bind",
	"projects.general":                          "room membership: connects the project to the native General room",
	"projects.name_customized":                  "state the wizard records, not a feature",
	"projects.team_status_inject":               "marks the primary role; changing it changes who leads",
	"projects.heartbeat.only_when_idle":         "option of the heartbeat, not a feature of its own",
	"projects.heartbeat.silent":                 "option of the heartbeat, not a feature of its own",
	"projects.display.thinking_messages":        "per-project display override; the global switch is listed",
	"projects.display.tool_messages":            "per-project display override; the global switch is listed",
	"projects.display.show_context_indicator":   "per-project display override; projects.show_context_indicator is listed",
	"projects.display.reply_footer":             "per-project display override; projects.reply_footer is listed",
	"projects.display.hide_agent_footer":        "per-project display override; the global switch is listed",
}

// FeatureSwitches returns the registry (a copy).
func FeatureSwitches() []FeatureSwitch {
	return append([]FeatureSwitch(nil), featureSwitches...)
}

// FeatureStates is every switch's value in cfg: the global ones, then each project's.
// boot is the snapshot taken when the bridge started (FeatureValues); nil = nothing is pending.
func FeatureStates(cfg *Config, boot map[string]bool) []FeatureState {
	var out []FeatureState
	add := func(f FeatureSwitch, proj *ProjectConfig) {
		s := FeatureState{FeatureSwitch: f, On: f.get(cfg, proj), Default: f.def(proj)}
		if proj != nil {
			s.Project = proj.Name
		}
		s.Running = s.On
		if was, ok := boot[s.ID()]; ok && f.Restart {
			s.Running = was
		}
		s.PendingRestart = s.Running != s.On
		out = append(out, s)
	}
	for _, f := range featureSwitches {
		if f.Scope == FeatureScopeGlobal {
			add(f, nil)
		}
	}
	for i := range cfg.Projects {
		for _, f := range featureSwitches {
			if f.Scope == FeatureScopeProject {
				add(f, &cfg.Projects[i])
			}
		}
	}
	return out
}

// FeatureValues is the ID → on map of cfg, taken once at start as the "running" snapshot.
func FeatureValues(cfg *Config) map[string]bool {
	out := map[string]bool{}
	for _, s := range FeatureStates(cfg, nil) {
		out[s.ID()] = s.On
	}
	return out
}

func readConfigFile() (*Config, error) {
	if ConfigPath == "" {
		return nil, fmt.Errorf("config path not set")
	}
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	cfg := &Config{}
	if err := toml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return cfg, nil
}

// ListFeatureStates reads config.toml and returns every switch's state, plus the config language.
func ListFeatureStates(boot map[string]bool) ([]FeatureState, string, error) {
	cfg, err := readConfigFile()
	if err != nil {
		return nil, "", err
	}
	return FeatureStates(cfg, boot), cfg.Language, nil
}

// SetFeatureSwitch writes one switch to config.toml (project = "" for a global one) and reports
// whether the running bridge needs a restart to follow.
func SetFeatureSwitch(project, key string, on bool) (restart bool, err error) {
	configMu.Lock()
	defer configMu.Unlock()
	project, key = strings.TrimSpace(project), strings.TrimSpace(key)
	scope := FeatureScopeGlobal
	if project != "" {
		scope = FeatureScopeProject
	}
	var sw *FeatureSwitch
	for i := range featureSwitches {
		if featureSwitches[i].Key == key && featureSwitches[i].Scope == scope {
			sw = &featureSwitches[i]
		}
	}
	if sw == nil {
		return false, fmt.Errorf("unknown %s feature switch %q", scope, key)
	}
	cfg, err := readConfigFile()
	if err != nil {
		return false, err
	}
	var proj *ProjectConfig
	if project != "" {
		for i := range cfg.Projects {
			if cfg.Projects[i].Name == project {
				proj = &cfg.Projects[i]
			}
		}
		if proj == nil {
			return false, fmt.Errorf("project %q not found", project)
		}
	}
	sw.set(cfg, proj, on)
	if err := saveConfig(cfg); err != nil {
		return false, err
	}
	return sw.Restart, nil
}
