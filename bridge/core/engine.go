package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxPlatformMessageLen = 4000
const telegramBotCommandLimit = 100
const defaultMaxQueuedMessages = 5 // default cap for queued messages per session

// defaultPendingRestartTimeout is how long the post-restart notify
// dispatcher waits for the target platform to reach ready before
// dropping the notify with a warning. 10s covers the typical 2-3s
// Telegram connect window with margin and is short enough that a stuck
// platform does not block startup logging indefinitely.
const defaultPendingRestartTimeout = 10 * time.Second

// previewText truncates s to maxRunes runes for safe inclusion in debug logs.
// Truncation uses runes (not bytes) so multi-byte characters render cleanly.
// Newlines are replaced with literal "\n" to keep each log entry on one line.
func previewText(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	r := []rune(s)
	truncated := false
	if len(r) > maxRunes {
		r = r[:maxRunes]
		truncated = true
	}
	out := strings.ReplaceAll(string(r), "\n", "\\n")
	if truncated {
		out += "...(truncated)"
	}
	return out
}

const (
	defaultThinkingMaxLen = 300
	defaultToolMaxLen     = 500
	// cardToolResultMaxLen caps the tool output kept on a progress card
	// (maomao fork #1197/#1231). Agents hand over the whole output and the
	// 细节 view pages through it; this only guards the card payload against a
	// runaway dump (the agent CLIs cap their own output well below it).
	cardToolResultMaxLen = 30000
	defaultHistoryMaxLen = 1000
)

// Slow-operation thresholds. Operations exceeding these durations produce a
// slog.Warn so operators can quickly pinpoint bottlenecks.
const (
	slowPlatformSend    = 2 * time.Second  // platform Reply / Send
	slowAgentStart      = 5 * time.Second  // agent.StartSession
	slowAgentClose      = 3 * time.Second  // agentSession.Close
	slowAgentSend       = 2 * time.Second  // agentSession.Send
	slowAgentFirstEvent = 15 * time.Second // time from send to first agent event
)

const (
	// replyFooterUsageTimeout bounds session-level quota lookups, which run
	// inline with the footer.
	replyFooterUsageTimeout = 3 * time.Second
	// Agent-level probes (e.g. Claude Code's PTY /usage, 3–6s) run in the
	// background so the footer never waits on them; see replyFooterUsageStatus.
	replyFooterUsageProbeTimeout = 20 * time.Second
	replyFooterUsageFirstWait    = 500 * time.Millisecond
	replyFooterUsageStaleAfter   = 60 * time.Second
	replyFooterUsageRetryAfter   = 30 * time.Second
	// A last good balance older than this is no longer shown once refreshes
	// keep failing.
	replyFooterUsageMaxAge = 30 * time.Minute
)

const (
	messageRecallCheckTimeout  = 2 * time.Second
	messageRecallPollInterval  = 2 * time.Second
	messageRecallProbeCooldown = time.Minute
	recalledStopLockWait       = 2 * time.Second
)

// VersionInfo is set by main at startup so that /version works.
var VersionInfo string

// CurrentVersion is the semver tag (e.g. "v1.2.0-beta.1"), set by main.
var CurrentVersion string

// ErrAttachmentSendDisabled indicates that side-channel image/file delivery is disabled by config.
var ErrAttachmentSendDisabled = errors.New("attachment send is disabled by config")

// RestartRequest carries info needed to send a post-restart notification.
type RestartRequest struct {
	SessionKey string `json:"session_key"`
	Platform   string `json:"platform"`
	// Text replaces the "restart successful" message (the update self-check sets it on rollback).
	Text string `json:"text,omitempty"`
}

type replyFooterUsageKey struct {
	agent any // the Agent itself, or its Name() when the value is not comparable
	model string
}

type replyFooterUsageEntry struct {
	report       *UsageReport // immutable snapshot for the role card
	reportScope  string       // attribution captured when the existing footer fetched it
	reportAt     time.Time
	footerReport *UsageReport // last successful footer measurement, rendered at read time
	okAt         time.Time    // when the footer measurement was fetched; zero if never
	failText     string       // set when the latest attempt failed
	attemptAt    time.Time    // when the latest attempt finished
	done         chan struct{}
	waited       bool // a footer already spent the first-probe wait
}

// DisplayCfg controls how intermediate messages are surfaced.
// A value of -1 means "use default", 0 means "no truncation".
type DisplayCfg struct {
	Mode             string // "full" (default), "compact", or "quiet" — thinking/tool visibility
	CardMode         string // "legacy" (default) or "rich" (Card 2.0 Feishu)
	ThinkingMessages bool
	ThinkingMaxLen   int // max runes for thinking preview; 0 = no truncation
	ToolMaxLen       int // max runes for tool use preview; 0 = no truncation
	ToolMessages     bool
	HistoryMaxLen    *int // max runes for /history entries; nil = default, 0 = no truncation
	HideAgentFooter  bool // strip model/token footer lines emitted as agent text
}

// InstantReplyCfg controls the immediate confirmation reply sent when a message
// is received, before the agent starts processing.
type InstantReplyCfg struct {
	Enabled bool
	Content string // custom reply text; empty = use i18n MsgStarting default
}

// RateLimitCfg controls per-session message rate limiting.
type RateLimitCfg struct {
	MaxMessages int           // max messages per window; 0 = disabled
	Window      time.Duration // sliding window size
}

// Engine routes messages between platforms and the agent for a single project.
type Engine struct {
	taskForumOff           atomic.Bool
	mentionAssignerOn      atomic.Bool
	keepRunningOn          atomic.Bool
	mentionHumanGateOn     atomic.Bool
	humanMentions          humanMentionGate
	proactiveMu            sync.Mutex
	proactiveAuthorization *ProactiveAuthorization
	// #618 K1: running-turn journal (turn_journal.go), opened on first use.
	turnJournal     *TurnJournal
	turnJournalOnce sync.Once
	// #624 K4: resume interrupted turns once, after the first platform is ready.
	turnResumeOnce sync.Once
	// #1856 restart catch-up (missed_catchup.go)
	missedSkipOnce  sync.Once
	missedSkip      map[string]bool
	missedCaughtUp  sync.Map // Platform -> true once read
	releaseHoldOnce sync.Once
	turnResumeHooks turnResumeHooks
	relaySessions   relaySessionSet

	name                  string
	agent                 Agent
	platforms             []Platform
	sessions              *SessionManager
	ctx                   context.Context
	cancel                context.CancelFunc
	i18n                  *I18n
	speech                SpeechCfg
	tts                   *TTSCfg
	display               DisplayCfg
	injectSender          bool
	attachmentSendEnabled bool
	startedAt             time.Time

	providerSaveFunc        func(providerName string) error
	providerAddSaveFunc     func(p ProviderConfig) error
	providerRemoveSaveFunc  func(name string) error
	providerModelSaveFunc   func(providerName, model string) error
	providerRefsSaveFunc    func(refs []string) error
	listGlobalProvidersFunc func(agentType string) ([]ProviderConfig, error)
	modelSaveFunc           func(model string) error
	effortSaveFunc          func(effort string) error

	ttsSaveFunc func(mode string) error

	commandSaveAddFunc func(name, description, prompt, exec, workDir string) error
	commandSaveDelFunc func(name string) error

	displaySaveFunc  func(mode *string, thinkingMessages *bool, thinkingMaxLen, toolMaxLen *int, toolMessages *bool) error
	configReloadFunc func() (*ConfigReloadResult, error)

	hooks              *HookManager
	cronScheduler      *CronScheduler
	timerScheduler     *TimerScheduler
	teamReviewAfter    atomic.Int64
	heartbeatScheduler *HeartbeatScheduler

	commands *CommandRegistry
	skills   *SkillRegistry
	paused   atomic.Bool
	aliases  map[string]string // trigger → command (e.g. "帮助" → "/help")
	aliasMu  sync.RWMutex

	aliasSaveAddFunc func(name, command string) error
	aliasSaveDelFunc func(name string) error

	bannedWords []string
	bannedMu    sync.RWMutex

	disabledCmds map[string]bool
	adminFrom    string           // comma-separated user IDs for privileged commands; "*" = all allowed users; "" = deny
	userRoles    *UserRoleManager // nil = legacy mode (no per-user policies)
	userRolesMu  sync.RWMutex     // protects userRoles, disabledCmds, and adminFrom

	rateLimiter      atomic.Pointer[RateLimiter]         // swapped by SetRateLimitCfg (config reload)
	outgoingRL       atomic.Pointer[OutgoingRateLimiter] // swapped by SetOutgoingRateLimitCfg
	proactive        *proactiveOutbox                    // #1857: one door for scheduled messages (proactive_outbox.go)
	proactiveOn      atomic.Bool                         // #1860: [proactive] enabled; off by default, then everything goes straight through
	streamPreview    StreamPreviewCfg
	instantReply     InstantReplyCfg
	references       ReferenceRenderCfg
	relayManager     *RelayManager
	notBoundNoticed  sync.Map // notBoundKey → posted (team_hints.go)
	eventIdleTimeout time.Duration
	maxTurnTime      time.Duration // absolute wall-clock cap per turn (0 = disabled)
	// agentSessionIdleTimeoutNanos 在单轮正常结束后关闭空闲的 live agent 进程，
	// 同时保留已保存的 session ID，便于下次继续恢复。
	agentSessionIdleTimeoutNanos atomic.Int64
	agentSessionIdleSeq          atomic.Uint64
	maxQueuedMessages            int
	gate                         atomic.Pointer[gateState] // maomao fork: fast-brain gate (nil = off); config is swapped whole, see gateState
	gateSetMu                    sync.Mutex                // serializes the gate config setters (copy, change, swap)
	heardOnce                    sync.Once                 // heardRT is made once (heard)
	heardRT                      *gateRuntime              // what this role only listened to, gate or not (call_context.go)
	gateLocal                    bool                      // built-in busy rules when gate is nil (gate_local.go)
	tiers                        *modelTiers               // maomao fork: gate-driven chat/task model switching (nil = off)
	modelSwitchMu                sync.Mutex
	pendingSwitch                map[string]pendingModelSwitch // maomao fork: switches agents asked for, applied before their next turn
	pendingResetMu               sync.Mutex
	callerMu                     sync.Mutex                      // guards callerTurns (caller_identity.go)
	memberWSMu                   sync.Mutex                      // guards memberWS / memberWSSave (member_workspace.go)
	memberWS                     bool                            // member_workspaces: personal dirs + own GitHub auth per person
	memberWSSave                 func(on bool) error             // persists `bothouse member enable|disable`
	callerTurns                  map[string]callerTurn           // session → sender of the turn running now
	workspaceReports             map[string]*workspaceReportTurn // guarded by pendingResetMu
	pendingReset                 map[string]bool                 // session new --after-turn (session_reset.go)
	resetTurns                   map[string]int                  // running turns per reset key (CC_SESSION_KEY), guarded by pendingResetMu
	team                         *teamState                      // maomao fork: team status board (nil = off)
	displayName                  atomic.Pointer[string]          // team_name from config ("" / nil = the project name); see DisplayName
	teamWS                       *teamWorkspaces                 // team mode D: Discord 工作区 channels (team_workspace.go; nil = off)
	teamWSGatherFailed           sync.Map                        // workspace channel ID → not movable into the workspace category this run (gatherTeamWorkspaces)
	board                        *channelBoardHub                // maomao fork: channel task board (channel_board.go); shared by the process
	memoryIndex                  string                          // maomao fork: MEMORY.md for fresh contexts (memoryindex.go; "" = off)
	experienceDir                string                          // team memory folder for personal agents' lessons (team_experience.go; "" = off)
	personalAgents               []string                        // bot IDs of personal agents (team_experience.go)
	lifePage                     string                          // life_page: "how she is now" file put before every turn (lifepage.go; "" = off)
	voiceDesk                    voiceDeskState                  // maomao fork: voice desk (voice_desk.go)
	dirHistory                   *DirHistory
	baseWorkDir                  string
	projectState                 *ProjectStateStore

	// maomao fork: media library (media.go) — notes of recent video messages for channel
	// backfill (capped at mediaNoteKeep).
	mediaNoteMu  sync.Mutex
	mediaNotes   map[string]string
	mediaNoteIDs []string

	// Auto-compress settings
	autoCompressEnabled   bool
	autoCompressMaxTokens int
	autoCompressMinGap    time.Duration
	// nativeAutoCompactAt: last auto native compaction per interactive key, guarded by interactiveMu (native_compact.go).
	nativeAutoCompactAt map[string]time.Time
	// Cold-cache fresh start (maomao fork, see handoff.go)
	coldFreshEnabled   bool
	coldFreshIdle      time.Duration
	coldFreshMinTokens int
	coldFreshMaxTokens int
	// ctxWindows: agent session ID -> context window its CLI reported (int), so the
	// context-size check can stay under the CLI's own compaction point (see handoff.go).
	ctxWindows sync.Map
	// Image-bloat fresh start (maomao fork, see handoff.go)
	imageFreshEnabled  bool
	imageFreshMaxBytes int
	resetOnIdle        time.Duration
	// Per-session model overrides (maomao fork, see session_models.go)
	// Model-at-capacity cooldown (maomao fork, see capacity_retry.go)
	capMu        sync.Mutex
	capUntil     time.Time
	quotaUntil   time.Time            // legacy unscoped cooldown only
	quotaDomains map[string]time.Time // guarded by quotaDomainsMu
	// quotaMu guards quotaState. Lock order: relayManager.quotaMu → quotaMu →
	// publicProgress.transitionMu → publicRun.mu. quotaTick holds quotaMu while it
	// walks task runs, so code that may run under a task lock (admission checks,
	// PublicProgress.quotaBlocked) must never wait on quotaMu: it reads Verified
	// through quotaVerifiedMu and writes through updateQuotaState.
	quotaMu           sync.Mutex
	quotaVerifiedMu   sync.Mutex     // leaf lock for quotaState.Verified; never held while taking another lock
	quotaUpdates      sync.WaitGroup // deferred updateQuotaState writes still running
	quotaState        quotaCoolingState
	quotaProbeFn      func(ctx context.Context) (usable bool, nextRetry time.Duration, err error)
	capRound          int
	capPending        []capPendingEntry // messages to re-deliver when the cooldown ends, in order
	capArmed          bool              // a flush timer is pending
	capNotified       map[string]bool   // channels already told about this cooldown round
	capWhy            string            // #134: why this cooldown round started, for its notice ("" = at capacity)
	capSwitchedTo     string            // #134: fallback model the failing turn switched to, for its notice
	capFallbackUsed   bool              // #134: this failure streak already switched once (no ping-pong)
	fallbackModels    []string          // #134: fallback_models from config (model_fallback.go)
	sessionModelsMu   sync.RWMutex
	sessionModels     map[string]string
	turnModels        map[string]string // interactive key → model one scheduled side turn starts on
	workspaceExec     workspaceExec     // team workspaces start on this provider/model (session_models.go)
	sessionSelections map[string]sessionModelSelection
	handoffModelBases map[string]sessionModelSelection // projectState nil: see projectStateData.HandoffModelBases
	// Per-session base-instruction files (maomao fork, see session_models.go)
	sessionInstructions map[string]sessionInstructions

	// Reply footer composition flags. The footer renders up to two lines:
	//   line 1 — model · [effort ·] out/in/cw/cr · ctx%   (gated by showContextIndicator)
	//   line 2 — workspace directory                       (gated by showWorkdirIndicator)
	// replyFooterEnabled is the master toggle: when false, no footer is emitted
	// regardless of the per-line flags.
	showContextIndicator bool
	showWorkdirIndicator bool
	// hideQuotaIndicator drops the quota segment of the status line and stops
	// the quota probe (for Claude that spawns a CLI each time). Zero value shows it.
	hideQuotaIndicator atomic.Bool
	// hideQuotaStatus drops the quota status texts when there is no measured
	// quota (project option show_quota_status = false). Default false = show.
	hideQuotaStatus atomic.Bool
	// skipSubagentPolicy drops the per-turn delegation policy block
	// (project option inject_subagent_policy = false). Default false = inject.
	skipSubagentPolicy atomic.Bool
	skipAgentIdentity  atomic.Bool
	skipQueuedNotice   atomic.Bool // queued_notice=false suppresses only the queue receipt.
	// skipTeamModeRules drops the per-turn team-mode rules block
	// (project option inject_team_rules = false). Default false = inject.
	skipTeamModeRules  atomic.Bool
	replyFooterEnabled bool

	// When true, /list etc. only show sessions tracked by cc-connect,
	// hiding sessions created by direct CLI usage in the same work_dir.
	// Default false = show all sessions.
	filterExternalSessions bool

	// Shell configuration for /shell, cron exec, hooks, webhook exec
	shell        string // shell binary path (e.g. "sh", "/bin/zsh")
	shellFlag    string // shell flag (e.g. "-c", "-Command", "/C")
	shellProfile string // prepended to every command (e.g. "source ~/.zshrc;")

	// Multi-workspace mode
	multiWorkspace               bool
	baseDir                      string
	skipGit                      bool
	workspaceInitAllowLocalPaths bool
	workspaceBindings            *WorkspaceBindingManager
	workspacePool                *workspacePool
	initFlows                    map[string]*workspaceInitFlow // workspace channel key → init state
	initFlowsMu                  sync.Mutex
	sendWorkDirMu                sync.RWMutex
	sendWorkDirs                 map[string]string // sessionKey → work_dir assigned by send --cwd

	// Terminal observation (--observe)
	observeEnabled    bool
	observeProjectDir string // ~/.claude/projects/{projectKey}
	observeSessionKey string // e.g. "slack:C123:U456" — target for forwarding
	observeCancel     context.CancelFunc

	// Interactive agent session management
	interactiveMu     sync.Mutex
	roleEvents        atomic.Pointer[roleEventBroker]
	interactiveStates map[string]*interactiveState // key = sessionKey
	// #739: admission order is independent of queue priority; keep it across state replacement.
	queueOrder        atomic.Uint64
	scheduledTurns    map[string]string            // scheduled run id -> interactive key (scheduled_timeout.go)
	nativeCompactions map[string]*nativeCompaction // guarded by interactiveMu

	// handoffWatchOn: the API server's handoff watch runs on this engine (team_watch.go
	// startHandoffWatch, called when the API server starts and again when projects are hot-loaded
	// or removed); while false a claim records no check time and the list shows no watch_due.
	handoffWatchOn atomic.Bool

	platformLifecycleMu sync.Mutex
	platformReady       map[Platform]bool
	platformConnectErr  map[Platform]error // last connect error an async platform reported (WaitPlatformsReady)
	stopping            bool
	messageWorkers      sync.WaitGroup // admission is serialized with Stop by platformLifecycleMu
	replyFooterMu       sync.Mutex
	replyFooterUsage    map[replyFooterUsageKey]*replyFooterUsageEntry
	replyFooterInflight map[any]bool // agent identity -> probe running

	// pendingRestartNotify is queued at startup if a /restart was consumed
	// from the run/restart_notify file. It is dispatched on the first
	// OnPlatformReady for the matching platform name, so async platforms
	// (Telegram, Weixin, Matrix, Discord) have a chance to actually connect
	// before the post-restart message is sent. See issue #1383.
	pendingRestartMu      sync.Mutex
	pendingRestartNotify  *RestartRequest
	pendingRestartFiredCh chan struct{} // closed when the notify is dispatched (success or exhausted)

	// pendingRestartTimeout is how long the dispatcher waits for the
	// target platform to reach ready before dropping the notify with a
	// warning. Default 10s; tests may override.
	pendingRestartTimeout time.Duration

	// /web command callbacks
	webSetupFunc  func() (port int, token string, needRestart bool, err error)
	webStatusFunc func() (url string)

	// Data directory for socket path injection
	dataDir        string
	publicProgress *PublicProgress
	// Source: #750/#751; set before Start by the shared authorization layer.
	externalTaskEventCheck func(ExternalTaskEvent, *Task) error
	workspaceChatForTest   func(session string) bool
	productPyBin           atomic.Value   // string: bin dir holding the product python3, resolved once in Start (role_env.go)
	productPyWG            sync.WaitGroup // the Start-time lookup above; Stop waits for it (role_env.go)

	// Team mode (#139 C): workspace -> chat channel exit and the asks waiting for an answer.
	teamExit     teamExitState
	dispatchMode dispatchModeSetting // team mode C: solo / team / mixed (team_mode.go)
}

// workspaceInitFlow tracks a channel that is being onboarded to a workspace.
type workspaceInitFlow struct {
	state       string // "awaiting_url", "awaiting_confirm"
	repoURL     string
	cloneTo     string
	channelName string
}

// queuedMessage holds a message that arrived while the session was busy.
// The message is NOT sent to agent stdin at queue time; the event loop
// sends it after the current turn completes to avoid mid-turn interference.
type queuedMessage struct {
	authorization *AuthorizationTurn
	taskForum     *TaskForumReply // keep post delivery separate within the source conversation
	turnTrigger   string          // #618 K1: Message.turnTrigger, kept across the queue
	// #618 K4: Message.resumedFrom/timerJobID/resumeNoProgress/resumeFallback, kept across the queue.
	resumedFrom      string
	timerJobID       string
	wakeID           string // #2024
	cronJobID        string
	resumeNoProgress int
	resumeFallback   string
	messageID        string
	platform         Platform
	replyCtx         any
	content          string
	ambientChat      string // background to include once when queued messages are batched
	reference        *MessageReference
	images           []ImageAttachment
	files            []FileAttachment
	fromVoice        bool
	// #215: content already carries the per-part speech marks (mergeQueuedChat marks each
	// voice part where it sits), so the prompt must not mark the whole text again.
	voiceMarked       bool
	userID            string
	userName          string // sender's display name for sender injection
	msgPlatform       string // platform name for sender injection
	msgSessionKey     string // session key for extracting chat ID
	channelKey        string // platform-provided channel identifier (preferred over sessionKey extraction)
	userMessageTimeMs int64  // Feishu create_time ms (optional); see Message.UserMessageTimeMs
	turnCtx           bool   // maomao fork: see Message.TurnCtx
	turnCtxQuery      string
	// #739: a gate abort/redirect (Message.abortFront) is queued at the front, ahead of what it
	// cancels; a batch that folds it in still answers it (queue_batch.go).
	abortFront    bool
	nativeCommand bool   // Message.nativeCommand, kept across the queue
	queueOrder    uint64 // #739: assigned at admission, before an abort moves to the queue front
	turnCtxSender string // #1160
	fromBot       bool
	mentioned     bool   // Message.Mentioned: a queue-full chat never turns it away (queue_batch.go)
	direct        bool   // Message.Direct
	overflow      bool   // context only: a full group queue gave its place away (queue_batch.go)
	modeOverride  string // maomao fork: see Message.ModeOverride (cron/timer job.Mode)
	// maomao fork: set for a queued cron/timer turn to its unmuted platform. When the turn starts
	// it gets the same team note and channel backfill as a cron/timer turn run directly.
	scheduledFrom Platform
	// maomao fork: the backfill is already in content (a capacity re-delivery must not redo it).
	scheduledBackfilled bool
	// maomao fork: the channel task board's text for this message (boardDescOf).
	boardDesc string
	// older context-only messages folded into this one (queue_batch.go trimQueuedOverflowLocked)
	contextBefore []queuedMessage
}

// interactiveState tracks a running interactive agent session and its permission state.
type interactiveState struct {
	modelSettings SessionSettings // immutable startup selection; effort-only changes also recycle
	handoffID     string          // immutable: the workspace task the process was started for (CC_HANDOFF), "" when none
	quotaScope    quotaScope      // immutable attribution captured at session creation
	authorization *AuthorizationTurn
	// #618 K4 S1: resumeArmed is set while a resumed turn has not yet shown it
	// works (no tool step, no first result); resumeFailed holds the error its
	// first result was, and resumeFailedQueued the queued message that turn ran
	// (nil = the turn the loop started with). Guarded by mu.
	resumeArmed              bool
	resumeFailed             string
	resumeFailedQueued       *queuedMessage
	publicProgressRun        string
	externalTaskInput        *externalInputDelivery
	resetHandoff             bool            // session new --after-turn: queued messages move to the fresh session instead of being dropped; guarded by mu
	abortCloseDone           <-chan struct{} // gate abort: actual Close completion before resuming the same session; guarded by mu
	agentCloseDone           <-chan struct{} // turn/idle close: wait for durable close before resume; guarded by interactiveMu
	agentStartDone           <-chan struct{} // startup: placeholder while StartSession runs outside interactiveMu; guarded by interactiveMu
	agentSession             AgentSession
	processClaimed           bool           // foreground owns the process until the final queue check and session unlock; guarded by mu
	modeRestore              func()         // maomao fork: undoes the running turn's mode override (setTurnMode); guarded by mu
	turnMode                 string         // maomao fork: mode applied by the running turn's override (setTurnMode); "" when none; guarded by mu
	capacityFailed           bool           // maomao fork: last turn failed with "model at capacity"
	capacityErr              string         // #134: that failure's error text (429 waits use its Retry-After)
	capacityClass            errorClass     // what that failure is (classifyEventError); guarded by mu
	capacityAttempt          int            // #134: which send of runTurnWithCapacityRetry is running (1 = first)
	turnErrored              bool           // maomao fork: last turn ended with an error event (not a success)
	promptTooLong            string         // maomao fork: last turn's "prompt is too long" error (takePromptTooLong)
	promptTooLongQueued      *queuedMessage // maomao fork: the chained queued message that turn was, if any
	refused                  string         // #1414: last turn's classifier refusal (takeRefused)
	refusedQueued            *queuedMessage // #1414: the chained queued message that turn was, if any
	cheapFailed              string         // #1562: last workspace turn on a cheap lane ended with an API error (takeCheapFailed)
	cheapFailedQueued        *queuedMessage // #1562: the chained queued message that turn was, if any
	platform                 Platform
	replyCtx                 any
	injectedReplyCtxs        []*injectedReply // maomao fork: reply contexts of messages injected into the running turn (gate.go); guarded by mu
	injectedMsgIDs           []string         // maomao fork: ids of user messages injected into the running turn (noteTurnHandoffs); guarded by mu
	currentMessageID         string
	lastRecallProbeMessageID string
	lastRecallProbeAt        time.Time
	recallProbeInFlight      bool
	stopDraft                string // a Stop hook blocked this reply draft; it is withdrawn when the segment matches (stop_draft.go); guarded by mu
	stopWithhold             bool   // the blocked draft must never reach the channel, not even merged back (copy gate #1907); guarded by mu
	stopReplace              string // the hook let the turn end but the draft must not go out: send this instead (#1907); guarded by mu
	workspaceDir             string
	agent                    Agent
	mu                       sync.Mutex
	stopCh                   chan struct{}
	stopped                  bool
	pending                  *pendingPermission
	pendingMessages          []queuedMessage // messages queued while session was busy
	approveAll               bool            // when true, auto-approve all permission requests for this session
	fromVoice                bool            // true if current turn originated from voice transcription
	turnUserID               string          // who sent the message the running turn answers ("" = the bridge: timer, handoff); guarded by mu
	sideText                 string
	turnSentTexts            []string   // texts this turn already pushed through a script/side send; guarded by mu
	turnSentNonText          bool       // a sticker/image/file already went out this turn (#181); guarded by mu
	localInputOnly           *inputTurn // block API/CLI side sends during a local voice turn
	deleteMode               *deleteModeState
	modelSwitch              *modelSwitchState
	pendingProviderAdd       *pendingProviderAddState
	lastAutoCompressAt       time.Time
	lastAutoCompressTokens   int
	// autoCompactDue: the auto-compress check passed at a turn's end for an agent
	// with native compaction; applyPendingAutoCompact runs it once the session is free.
	autoCompactDue bool

	// Unsolicited event reader: a background goroutine that consumes agent
	// events between user-initiated turns (e.g. background task completions).
	// Cancel unsolicitedCancel to stop the reader; wait on unsolicitedDone
	// to confirm it has exited before starting a new foreground turn.
	unsolicitedCancel context.CancelFunc // nil when no reader is running
	unsolicitedDone   chan struct{}      // closed when the reader goroutine exits

	// maomao fork: agent session whose sub-agent table updater is running.
	subTableFor AgentSession
	// maomao fork: channel task board — the next/current turn's short text, and
	// the Discord channel its board row is in (channel_board.go).
	turnDesc     string
	boardChannel string
	boardKey     string // interactive key of the board row

	// turnScheduled: the current turn is a cron/timer/heartbeat routine, which
	// never gets an automatic task card (public_progress_auto.go).
	turnScheduled bool

	// agentSessionIdleCancel 取消当前会话的 idle 关闭计时器。
	agentSessionIdleCancel context.CancelFunc
	agentSessionIdleToken  uint64

	// eventsNeedResync is true when buffered events should be drained before
	// the next turn (e.g. after an abnormal exit). Defaults to true (safe);
	// cleared to false only after a clean EventResult.
	eventsNeedResync bool

	// turnCancelled: maomao fork — set when /stop or a gate abort cancels the running turn
	// via CancelTurn (session kept alive). The cancelled turn's EventError (ACP: "prompt did
	// not complete successfully") is then only logged, not sent to the channel. Cleared when
	// the next turn starts. Guarded by mu.
	turnCancelled bool

	// currentJobID: the timer job this turn is running (a workspace-handback wake settles
	// against it, team_report_delivery.go); empty for a user turn. Guarded by mu.
	currentJobID string
	// currentWakeID: the wake (#2024, wake_return.go) this turn runs; its result goes back to
	// the conversation that woke it. Guarded by mu.
	currentWakeID string
	// scheduledWatch: the token of the time limit armed for this turn (armScheduledTurnTimeout); 0 none.
	scheduledWatch uint64
	// scheduledCancel: open while a time limit's cancel claimed for the running turn is in flight
	// (fireScheduledTurnTimeout); the next turn start waits for it. Guarded by mu.
	scheduledCancel chan struct{}
	// spendWatch: the token of the spend cap armed for this turn (armTurnSpendCap); 0 none.
	// Guarded by mu.
	spendWatch uint64
	// queuedBehindCompact: messages queued here while a native /compact held the
	// session (enqueueForBusySession). Only then may a placeholder state with no
	// agent session start a turn from its queue (drainOrphanedQueue). Guarded by mu.
	queuedBehindCompact bool

	// maomao fork: why the agent session failed to start (shown to the user),
	// and when the running turn last received an agent event (dead-turn check).
	startErr    string
	lastEventAt atomic.Int64

	// lastCompletedUserMessageTimeMs is the max platform user-message create time
	// (ms) for which an agent turn has finished with EventResult.
	lastCompletedUserMessageTimeMs int64
	// currentTurnUserMessageTimeMs is the UserMessageTimeMs for the in-flight
	// foreground turn (including a queued turn after EventResult).
	currentTurnUserMessageTimeMs int64
	// turnStartedAt is when the running turn began, for the queue receipt's "current
	// task has been running %s" (#545: a message that waited behind an 8m22s turn got
	// the plain "will process after the current task" line and read as lost).
	// Guarded by mu; zero until a turn starts.
	turnStartedAt time.Time
}

// markTurnStartLocked transfers the state to the turn owning currentMessageID.
// Caller holds state.mu. A claimed timeout finishes before the transfer; whether
// it was already done or we waited, its cancellation flag belongs to the old turn.
func (s *interactiveState) markTurnStartLocked() {
	s.awaitScheduledCancelLocked()
	s.scheduledWatch = 0
	s.spendWatch = 0
	s.turnCancelled = false
	s.turnStartedAt = time.Now()
}

// latestUserMessageWatermarkLocked returns the highest UserMessageTimeMs among
// completed turns, the in-flight turn, and queued messages for this session.
// state.mu must be held by the caller.
func latestUserMessageWatermarkLocked(state *interactiveState) int64 {
	if state == nil {
		return 0
	}
	wm := state.lastCompletedUserMessageTimeMs
	if state.currentTurnUserMessageTimeMs > wm {
		wm = state.currentTurnUserMessageTimeMs
	}
	for _, q := range state.pendingMessages {
		if q.userMessageTimeMs > wm {
			wm = q.userMessageTimeMs
		}
	}
	return wm
}

type userMessageWatermarkSnapshot struct {
	maxMs       int64
	completedMs int64
	inFlightMs  int64
	queuedMaxMs int64
}

// userMessageWatermarkSnapshotLocked captures the per-source watermark values.
// state.mu must be held by the caller.
func userMessageWatermarkSnapshotLocked(state *interactiveState) userMessageWatermarkSnapshot {
	if state == nil {
		return userMessageWatermarkSnapshot{}
	}
	snap := userMessageWatermarkSnapshot{
		completedMs: state.lastCompletedUserMessageTimeMs,
		inFlightMs:  state.currentTurnUserMessageTimeMs,
	}
	for _, q := range state.pendingMessages {
		if q.userMessageTimeMs > snap.queuedMaxMs {
			snap.queuedMaxMs = q.userMessageTimeMs
		}
	}
	snap.maxMs = latestUserMessageWatermarkLocked(state)
	return snap
}

// acceptReason describes which accepted message makes an older create_time stale.
func (s userMessageWatermarkSnapshot) acceptReason() string {
	if s.maxMs <= 0 {
		return "none"
	}
	// Prefer the most specific active state when multiple sources tie.
	if s.inFlightMs == s.maxMs && s.inFlightMs > 0 {
		return "processing"
	}
	if s.queuedMaxMs == s.maxMs && s.queuedMaxMs > 0 {
		return "queued"
	}
	if s.completedMs == s.maxMs && s.completedMs > 0 {
		return "completed"
	}
	return "unknown"
}

func (e *Engine) logStaleUserMessageDropped(action string, msg *Message, interactiveKey string, snap userMessageWatermarkSnapshot) {
	if msg == nil {
		return
	}
	slog.Info("stale user message dropped: received from platform but create_time older than accepted watermark",
		"action", action,
		"platform", msg.Platform,
		"session", msg.SessionKey,
		"interactive_key", interactiveKey,
		"msg_id", msg.MessageID,
		"msg_create_time_ms", msg.UserMessageTimeMs,
		"watermark_ms", snap.maxMs,
		"watermark_reason", snap.acceptReason(),
		"watermark_processing_ms", snap.inFlightMs,
		"watermark_queued_max_ms", snap.queuedMaxMs,
		"watermark_completed_ms", snap.completedMs,
	)
	slog.Debug("stale user message dropped detail",
		"action", action,
		"msg_id", msg.MessageID,
		"msg_create_time_ms", msg.UserMessageTimeMs,
		"watermark_ms", snap.maxMs,
		"watermark_reason", snap.acceptReason(),
		"content_len", len(msg.Content),
	)
}

type pendingProviderAddState struct {
	phase            string // "preset" = waiting for API key; "other" = waiting for name api_key base_url [model]
	name             string
	baseURL          string
	model            string
	inviteURL        string
	codexWireAPI     string
	codexHTTPHeaders map[string]string
}

type deleteModeState struct {
	page        int
	selectedIDs map[string]struct{}
	phase       string
	hint        string
	result      string
}

type modelSwitchState struct {
	phase  string
	target string
	result string
}

// pendingPermission represents a permission request waiting for user response.
type pendingPermission struct {
	ApprovalID      string // random per-request key; never reuse backend request IDs
	RequestID       string
	ToolName        string
	ToolInput       map[string]any
	InputPreview    string
	Questions       []UserQuestion // non-nil for AskUserQuestion
	Answers         map[int]string // collected answers keyed by question index
	CurrentQuestion int            // index of the question currently being asked
	Resolved        chan struct{}  // closed when user responds
	resolveOnce     sync.Once
	handling        atomic.Bool // only one response may consume this request at a time
}

func (s *interactiveState) stopSignal() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopCh == nil {
		s.stopCh = make(chan struct{})
		if s.stopped {
			close(s.stopCh)
		}
	}
	return s.stopCh
}

func (s *interactiveState) isStopped() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopped
}

func (s *interactiveState) markStopped() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	s.stopped = true
	if s.stopCh == nil {
		s.stopCh = make(chan struct{})
	}
	close(s.stopCh)
}

// resolve safely closes the Resolved channel exactly once.
func (pp *pendingPermission) resolve() {
	pp.resolveOnce.Do(func() { close(pp.Resolved) })
}

func NewEngine(name string, ag Agent, platforms []Platform, sessionStorePath string, lang Language) *Engine {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{
		name:                  name,
		agent:                 ag,
		platforms:             platforms,
		sessions:              NewSessionManager(sessionStorePath),
		proactive:             sharedProactiveOutbox,
		ctx:                   ctx,
		cancel:                cancel,
		i18n:                  NewI18n(lang),
		attachmentSendEnabled: true,
		display:               DisplayCfg{Mode: "full", ThinkingMessages: true, ThinkingMaxLen: defaultThinkingMaxLen, ToolMaxLen: defaultToolMaxLen, ToolMessages: true, CardMode: "legacy"},
		commands:              NewCommandRegistry(),
		skills:                NewSkillRegistry(),
		aliases:               make(map[string]string),
		interactiveStates:     make(map[string]*interactiveState),
		sendWorkDirs:          make(map[string]string),
		platformReady:         make(map[Platform]bool),
		platformConnectErr:    make(map[Platform]error),
		startedAt:             time.Now(),
		streamPreview:         DefaultStreamPreviewCfg(),
		references:            DefaultReferenceRenderCfg(),
		eventIdleTimeout:      defaultEventIdleTimeout,
		maxQueuedMessages:     defaultMaxQueuedMessages,
		board:                 defaultChannelBoard,
		showContextIndicator:  true,
		showWorkdirIndicator:  true,
		shell:                 defaultShell(),
		shellFlag:             defaultShellFlag(),
		pendingRestartTimeout: defaultPendingRestartTimeout,
	}

	if ag != nil {
		e.sessions.InvalidateForAgent(ag.Name())
	}

	if cp, ok := ag.(CommandProvider); ok {
		e.commands.SetAgentDirs(cp.CommandDirs())
	}
	if sp, ok := ag.(SkillProvider); ok {
		e.skills.SetDirs(sp.SkillDirs())
	}
	e.board.addSource(e)    // maomao fork: report to the process's channel task board
	e.teamExit.resolver = e // team mode C exit: workspaces recorded by block D

	return e
}

func (e *Engine) Start() error {
	e.restoreProactiveAdmissions()
	go e.queueReportLoop() // #1020 queue_report.go
	e.resolveRoleProductPython()
	var startErrs []error
	readyCount := 0
	pendingCount := 0
	for _, p := range e.platforms {
		_, isAsync := p.(AsyncRecoverablePlatform)
		if async, ok := p.(AsyncRecoverablePlatform); ok {
			async.SetLifecycleHandler(e)
		}
		if src, ok := p.(PlatformEventSource); ok {
			src.SetPlatformEventHandler(e) // platform events (core/member_events.go)
		}
		if sc, ok := p.(SilentChannelAware); ok {
			// A released workspace is still a workspace (isTeamWorkspaceChat checks Handoffs too).
			sc.SetSilentChannel(e.isTeamWorkspaceChat)
		}
		if mg, ok := p.(HumanMentionGateAware); ok {
			mg.SetHumanMentionGate(e.mentionHumanGateEnabled)
		}
		if err := p.Start(e.handlePlatformMessage); err != nil {
			slog.Warn("platform start failed", "project", e.name, "platform", p.Name(), "error", err)
			startErrs = append(startErrs, fmt.Errorf("[%s] start platform %s: %w", e.name, p.Name(), err))
			continue
		}
		if isAsync {
			pendingCount++
			slog.Info("platform recovery loop started", "project", e.name, "platform", p.Name())
			continue
		}
		e.onPlatformReady(p)
		readyCount++
	}

	// Log summary
	if len(startErrs) > 0 || pendingCount > 0 {
		slog.Warn("engine started with partial readiness",
			"project", e.name,
			"agent", e.agent.Name(),
			"ready", readyCount,
			"pending", pendingCount,
			"failed", len(startErrs))
	} else {
		slog.Info("engine started", "project", e.name, "agent", e.agent.Name(), "platforms", len(e.platforms))
	}

	// Only return error if ALL platforms failed
	if len(startErrs) == len(e.platforms) && len(e.platforms) > 0 {
		return startErrs[0] // Return first error
	}

	e.startPublicProgress()
	e.startObserver()
	e.startQuotaCooling()
	return nil
}

func (e *Engine) Stop() error {
	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()

	// Cancel first so late lifecycle callbacks observe shutdown immediately.
	e.cancel()

	// maomao fork: the channel board's last edit (running turns → stopped) goes
	// out before the platforms close.
	if e.board != nil {
		e.board.shutdown(e)
		e.board.removeSource(e)
	}

	if e.observeCancel != nil {
		e.observeCancel()
	}

	// Stop platforms after cancellation so they can unwind against the closed context.
	var errs []error
	for _, p := range e.platforms {
		if err := p.Stop(); err != nil {
			errs = append(errs, fmt.Errorf("stop platform %s: %w", p.Name(), err))
		}
	}

	e.interactiveMu.Lock()
	states := make(map[string]*interactiveState, len(e.interactiveStates))
	for k, v := range e.interactiveStates {
		states[k] = v
		delete(e.interactiveStates, k)
	}
	e.interactiveMu.Unlock()

	sessions := make(map[string]AgentSession, len(states))
	for key, state := range states {
		state.mu.Lock()
		as := state.agentSession
		state.mu.Unlock()
		if as != nil {
			sessions[key] = as
		}
	}
	// #624 K4: agent sessions relays started themselves are not in states.
	for i, as := range e.takeLiveRelaySessions() {
		sessions[fmt.Sprintf("relay#%d", i)] = as
	}
	// Close in parallel under one budget; stragglers get their process group
	// SIGKILLed so no agent survives the bridge (#618 K3).
	closeSessionsWithBudget(sessions, engineStopCloseBudget)

	if rl := e.rateLimiter.Load(); rl != nil {
		rl.Stop()
	}
	e.userRolesMu.Lock()
	if e.userRoles != nil {
		e.userRoles.Stop()
	}
	e.userRolesMu.Unlock()

	if err := e.agent.Stop(); err != nil {
		errs = append(errs, fmt.Errorf("stop agent %s: %w", e.agent.Name(), err))
	}
	// Cancellation requests shutdown; joining ensures no accepted message or
	// event reader can persist state after Stop returns.
	e.messageWorkers.Wait()
	e.productPyWG.Wait() // the role-PATH python3 link is not written into the data dir after Stop
	if len(errs) > 0 {
		return fmt.Errorf("engine stop errors: %v", errs)
	}
	return nil
}

// OnPlatformReady marks an async platform as ready and initializes platform-level
// capabilities once per ready cycle.
func (e *Engine) OnPlatformReady(p Platform) {
	e.onPlatformReady(p)
}

// OnPlatformUnavailable marks an async platform as unavailable.
func (e *Engine) OnPlatformUnavailable(p Platform, err error) {
	if err != nil {
		e.platformLifecycleMu.Lock()
		if e.platformConnectErr == nil {
			e.platformConnectErr = make(map[Platform]error)
		}
		e.platformConnectErr[p] = err
		e.platformLifecycleMu.Unlock()
	}
	if !e.markPlatformUnavailable(p) {
		return
	}
	slog.Warn("platform unavailable", "project", e.name, "platform", p.Name(), "error", err)
}

// ReceiveMessage delivers a message from a platform to the engine.
// This is a public wrapper for use in integration tests and external callers.
func (e *Engine) ReceiveMessage(p Platform, msg *Message) {
	e.handleMessage(p, msg)
}

func (e *Engine) onPlatformReady(p Platform) {
	if !e.markPlatformReady(p) {
		return
	}
	slog.Info("platform ready", "project", e.name, "platform", p.Name())
	e.initPlatformCapabilities(p)
	// #624 K4: scan the turn journal once; each entry waits for its own platform.
	// Tracked as message work so Stop waits for it (it opens the journal under dataDir).
	// #1856: what the inherited journal holds is left to the resume; read it before the resume runs.
	e.missedSkipOnce.Do(func() { e.missedSkip = e.journalMessageIDs() })
	e.turnResumeOnce.Do(func() { e.startMessageWorker(e.ResumeInterruptedTurns) })
	if _, done := e.missedCaughtUp.LoadOrStore(p, true); !done {
		skip := e.missedSkip
		e.startMessageWorker(func() { e.catchUpMissed(p, skip) })
	}
	e.releaseHoldOnce.Do(func() { e.startMessageWorker(e.resumeReleaseHolds) })
}

func (e *Engine) markPlatformReady(p Platform) bool {
	e.platformLifecycleMu.Lock()
	defer e.platformLifecycleMu.Unlock()

	if e.stopping || e.ctx.Err() != nil {
		return false
	}
	if e.platformReady[p] {
		return false
	}
	e.platformReady[p] = true
	return true
}

func (e *Engine) markPlatformUnavailable(p Platform) bool {
	e.platformLifecycleMu.Lock()
	defer e.platformLifecycleMu.Unlock()

	if e.stopping || e.ctx.Err() != nil {
		return false
	}
	if !e.platformReady[p] {
		return false
	}
	e.platformReady[p] = false
	return true
}

func (e *Engine) initPlatformCapabilities(p Platform) {
	if registrar, ok := p.(CommandRegistrar); ok {
		commands, skillsOmitted := e.menuCommandsForPlatform(p.Name())
		if skillsOmitted && strings.EqualFold(p.Name(), "telegram") {
			slog.Info("telegram: omitting skill commands from menu due to command limit", "project", e.name)
		}
		if err := registrar.RegisterCommands(commands); err != nil {
			slog.Error("platform command registration failed", "project", e.name, "platform", p.Name(), "error", err)
		} else {
			slog.Debug("platform commands registered", "project", e.name, "platform", p.Name(), "count", len(commands))
		}
	}

	if nav, ok := p.(CardNavigable); ok {
		nav.SetCardNavigationHandler(e.handleCardNav)
	}
}

// matchBannedWord returns the first banned word found in content, or "".
func (e *Engine) matchBannedWord(content string) string {
	e.bannedMu.RLock()
	defer e.bannedMu.RUnlock()
	if len(e.bannedWords) == 0 {
		return ""
	}
	lower := strings.ToLower(content)
	for _, w := range e.bannedWords {
		if strings.Contains(lower, w) {
			return w
		}
	}
	return ""
}

// resolveAlias checks if the content (or its first word) matches an alias and replaces it.
func (e *Engine) resolveAlias(content string) string {
	e.aliasMu.RLock()
	defer e.aliasMu.RUnlock()

	if len(e.aliases) == 0 {
		return content
	}

	// Exact match on full content
	if cmd, ok := e.aliases[content]; ok {
		return cmd
	}

	// Match first word, append remaining args
	parts := strings.SplitN(content, " ", 2)
	if cmd, ok := e.aliases[parts[0]]; ok {
		if len(parts) > 1 {
			return cmd + " " + parts[1]
		}
		return cmd
	}
	return content
}

func (e *Engine) handleMessageRecall(p Platform, msg *Message) {
	messageID := strings.TrimSpace(msg.MessageID)
	if messageID == "" {
		slog.Debug("message recall ignored without message id", "platform", msg.Platform)
		return
	}

	if sessionKey, ok := e.findCurrentMessageSession(messageID); ok {
		e.revokeInteractiveAuthorization(sessionKey)
		if e.stopInteractiveSessionSilently(sessionKey) {
			slog.Info("active message recalled; session stopped",
				"platform", p.Name(),
				"msg_id", messageID,
				"session", sessionKey,
			)
			return
		}
	}

	if sessionKey, ok := e.removeQueuedMessageByID(messageID); ok {
		slog.Info("queued message recalled; removed from pending queue",
			"platform", p.Name(),
			"msg_id", messageID,
			"session", sessionKey,
		)
		return
	}

	slog.Debug("message recall ignored; no active or queued message matched",
		"platform", p.Name(),
		"msg_id", messageID,
	)
}

func (e *Engine) findCurrentMessageSession(messageID string) (string, bool) {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()

	for sessionKey, state := range e.interactiveStates {
		if state == nil {
			continue
		}
		state.mu.Lock()
		currentMessageID := state.currentMessageID
		state.mu.Unlock()
		if currentMessageID == messageID {
			return sessionKey, true
		}
	}
	return "", false
}

func (e *Engine) removeQueuedMessageByID(messageID string) (string, bool) {
	e.interactiveMu.Lock()
	states := make(map[string]*interactiveState, len(e.interactiveStates))
	for sessionKey, state := range e.interactiveStates {
		states[sessionKey] = state
	}
	e.interactiveMu.Unlock()

	for sessionKey, state := range states {
		if state == nil {
			continue
		}
		state.mu.Lock()
		pending := state.pendingMessages
		if len(pending) == 0 {
			state.mu.Unlock()
			continue
		}
		filtered := pending[:0]
		removed := false
		for _, queued := range pending {
			if queued.messageID == messageID {
				removed = true
				continue
			}
			filtered = append(filtered, queued)
		}
		if removed {
			state.pendingMessages = filtered
			state.mu.Unlock()
			return sessionKey, true
		}
		state.mu.Unlock()
	}
	return "", false
}

// isStaleUserMessageLocked reports whether timeMs is strictly older than the
// latest user message already accepted for this session (completed, in-flight,
// or queued). state.mu must be held by the caller. timeMs <= 0 is never stale.
func (e *Engine) isStaleUserMessageLocked(state *interactiveState, timeMs int64) bool {
	if timeMs <= 0 {
		return false
	}
	wm := latestUserMessageWatermarkLocked(state)
	return wm > 0 && timeMs < wm
}

// isQueuedUserMessageStaleForDrainLocked reports whether a queued message is
// older than an already processed or currently in-flight turn. It intentionally
// ignores other queued messages so a FIFO queue with increasing create_time
// does not drop earlier queued messages just because later queued messages
// have already been accepted.
func (e *Engine) isQueuedUserMessageStaleForDrainLocked(state *interactiveState, timeMs int64) bool {
	if timeMs <= 0 {
		return false
	}
	wm := state.lastCompletedUserMessageTimeMs
	if state.currentTurnUserMessageTimeMs > wm {
		wm = state.currentTurnUserMessageTimeMs
	}
	return wm > 0 && timeMs < wm
}

// noteUserTurnCompleted advances lastCompletedUserMessageTimeMs after an
// agent turn ends with EventResult.
func (e *Engine) noteUserTurnCompleted(state *interactiveState) {
	state.mu.Lock()
	t := state.currentTurnUserMessageTimeMs
	if t > 0 && t > state.lastCompletedUserMessageTimeMs {
		state.lastCompletedUserMessageTimeMs = t
	}
	state.mu.Unlock()
}

// noteUserMessageAccepted records that a user message was accepted for this
// session (direct processing). Queued messages update the watermark via
// pendingMessages instead. This closes the window before processInteractiveMessageWith
// starts where a redelivery could slip through while the session lock is held.
func (e *Engine) noteUserMessageAccepted(interactiveKey string, timeMs int64) {
	if timeMs <= 0 {
		return
	}
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if !ok || state == nil {
		return
	}
	state.mu.Lock()
	if timeMs > state.currentTurnUserMessageTimeMs {
		state.currentTurnUserMessageTimeMs = timeMs
	}
	state.mu.Unlock()
}

// discardStaleUserMessageIfNeeded returns true when the message is dropped
// because a newer user message is already in progress, queued, or completed
// for this interactive session (e.g. Feishu redelivery with a new message_id
// but an older create_time).
func (e *Engine) discardStaleUserMessageIfNeeded(interactiveKey string, msg *Message) bool {
	if msg == nil || msg.UserMessageTimeMs <= 0 {
		return false
	}
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if !ok || state == nil {
		return false
	}
	state.mu.Lock()
	stale := e.isStaleUserMessageLocked(state, msg.UserMessageTimeMs)
	snap := userMessageWatermarkSnapshotLocked(state)
	state.mu.Unlock()
	if !stale {
		return false
	}
	e.logStaleUserMessageDropped("reject_before_handle", msg, interactiveKey, snap)
	return true
}

func (e *Engine) stopCurrentMessageIfRecalled(sessionKey string) bool {
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[sessionKey]
	e.interactiveMu.Unlock()
	if !ok || state == nil {
		return false
	}

	state.mu.Lock()
	platform := state.platform
	replyCtx := state.replyCtx
	messageID := state.currentMessageID
	if platform == nil || replyCtx == nil || messageID == "" {
		state.mu.Unlock()
		return false
	}
	detector, ok := platform.(MessageRecallDetector)
	if !ok {
		state.mu.Unlock()
		return false
	}
	if state.recallProbeInFlight {
		state.mu.Unlock()
		slog.Debug("message recall fallback probe skipped; probe already in flight",
			"platform", platform.Name(),
			"msg_id", messageID,
			"session", sessionKey,
		)
		return false
	}
	now := time.Now()
	if state.lastRecallProbeMessageID == messageID && now.Sub(state.lastRecallProbeAt) < messageRecallProbeCooldown {
		nextProbeIn := messageRecallProbeCooldown - now.Sub(state.lastRecallProbeAt)
		state.mu.Unlock()
		slog.Debug("message recall fallback probe throttled",
			"platform", platform.Name(),
			"msg_id", messageID,
			"session", sessionKey,
			"next_probe_in", nextProbeIn,
		)
		return false
	}
	state.recallProbeInFlight = true
	state.lastRecallProbeMessageID = messageID
	state.lastRecallProbeAt = now
	state.mu.Unlock()

	defer func() {
		state.mu.Lock()
		if state.currentMessageID == messageID {
			state.recallProbeInFlight = false
		}
		state.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(e.ctx, messageRecallCheckTimeout)
	defer cancel()
	recalled, err := detector.IsMessageRecalled(ctx, replyCtx)
	if err != nil {
		slog.Debug("message recall fallback check failed",
			"platform", platform.Name(),
			"msg_id", messageID,
			"session", sessionKey,
			"error", err,
		)
		return false
	}
	if !recalled {
		return false
	}
	e.revokeInteractiveAuthorization(sessionKey)
	if e.stopInteractiveSessionSilently(sessionKey) {
		slog.Info("active message recalled by fallback probe; session stopped",
			"platform", platform.Name(),
			"msg_id", messageID,
			"session", sessionKey,
		)
		return true
	}
	return false
}

func (e *Engine) waitForSessionLock(session *Session, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if session.TryLock() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-e.ctx.Done():
			return false
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (e *Engine) startMessageRecallMonitor(sessionKey string) context.CancelFunc {
	ctx, cancel := context.WithCancel(e.ctx)
	go func() {
		ticker := time.NewTicker(messageRecallPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e.stopCurrentMessageIfRecalled(sessionKey) {
					return
				}
			}
		}
	}()
	return cancel
}

// IsPaused reports whether the engine is currently paused.
func (e *Engine) IsPaused() bool {
	return e.paused.Load()
}

// SetPaused toggles the engine paused state.
func (e *Engine) SetPaused(v bool) {
	e.paused.Store(v)
}

// handleMessage takes one platform message through the whole path, once:
//
//	admit    – recall, team routing, stop words, hook, voice, alias, rate limit, banned words
//	route    – which agent / session manager / interactive key (resolveMessageRoute)
//	prepare  – commands, permission answers, "!" shell, prompt assembly, media
//	dispatch – gate (burst collection, routing model), then start or queue the turn (dispatchMessage)
//
// A message the gate holds for its burst stops inside dispatch. When its window passes, the timer
// continues it with releaseHeldMessage, which runs route and dispatch only: admit and prepare are
// per platform message and already ran. (Until #1627 the timer called handleMessage again with the
// same *Message, and each step that must not run twice carried its own "done" flag on Message; the
// steps without a flag — rate limit, the MessageReceived hook — ran twice.)
func (e *Engine) handleMessage(p Platform, msg *Message) {
	if msg.TaskForum != nil && !e.prepareTaskForumReply(p, msg) {
		return
	}
	if !e.enterMessageWork(msg) {
		return
	}
	defer e.messageWorkers.Done()
	if msg.Recalled {
		e.handleMessageRecall(p, msg)
		return
	}
	// A voice message becomes its text here, before anything reads the words, so every later
	// step (team routing, stop words, hooks, who-said-what) sees it once, as text.
	if msg.Audio != nil && !e.voiceToText(p, msg) {
		return
	}
	e.collectExperience(msg)
	if e.team != nil {
		// The shared lead file can change without restarting any role. Refresh
		// lead-only board/workspace services before handling the next message.
		e.setDynamicTeamLead(e.isTeamLead())
	}
	if msg.authorization == nil && msg.TaskForum == nil {
		// #139 C: a user reply to a forwarded workspace [ask] goes back to that workspace.
		if e.routeWorkspaceAnswer(p, msg) {
			return
		}
		// A reply in a workspace to a task that already ended there goes to that task's chat lead.
		if e.routeEndedTaskReply(p, msg) {
			return
		}
		// A reply to a task card or a workspace report: its quote stays whole and the turn gets
		// that work's background (reply_task.go). Replies to an open [ask] were taken above.
		e.noteReplyTaskOf(msg)
		// A reply to work still running in a workspace is handed there at once, marked as an interrupt.
		e.forwardReplyToWorkspace(p, msg)
	}
	// "/stop all" stops this bot's work in the whole channel. It runs before
	// any mention/gate filtering so every bot in the channel honours it.
	// A stop word that calls no bot (no @, no reply) means the same.
	if msg.TaskForum == nil && !msg.FromBot && len(msg.Images) == 0 && (IsStopAllCommand(msg.Content) || e.isUnaddressedStop(msg)) {
		e.cmdStopAll(p, msg)
		return
	}

	if ob := e.outbox(); msg.authorization == nil && msg.TaskForum == nil && !msg.FromBot && ob != nil {
		ob.answered(proactiveChat(msg.SessionKey)) // #1857: a person spoke here
	}
	slog.Info("message received",
		"platform", msg.Platform, "msg_id", msg.MessageID,
		"session", msg.SessionKey, "user", msg.UserName,
		"content_len", len(msg.Content),
		"has_images", len(msg.Images) > 0, "has_audio", msg.Audio != nil, "has_files", len(msg.Files) > 0,
	)
	// DEBUG: full message content for in-depth debugging (release-gate testing).
	// Gated behind DEBUG level so production INFO logs don't leak user text.
	if slog.Default().Enabled(e.ctx, slog.LevelDebug) {
		slog.Debug("message content",
			"platform", msg.Platform, "msg_id", msg.MessageID,
			"session", msg.SessionKey, "user", msg.UserName,
			"content", previewText(msg.Content, 500),
		)
	}

	if e.checkTurnAuthorization(msg.authorization, "tool.execute") == nil {
		e.emitEvent(HookEvent{
			Event:      HookEventMessageReceived,
			SessionKey: msg.SessionKey,
			Platform:   msg.Platform,
			UserID:     msg.UserID,
			UserName:   msg.UserName,
			Content:    msg.Content,
			Extra:      e.agentHookExtra(e.activeAgentSessionID(msg.SessionKey), nil),
		})
	}
	e.recordPersonSaid(msg) // #1160: each person's own words, for their 懂你 page (people_said.go)

	content := strings.TrimSpace(msg.Content)
	if content == "" && msg.ExtraContent == "" && msg.AmbientChat == "" && len(msg.Images) == 0 && len(msg.Files) == 0 && msg.Location == nil {
		return
	}

	// Route commands and permissions using the sender's words, never group context.
	content = e.resolveAlias(strings.TrimSpace(userTextOf(msg)))
	msg.Content = content

	// Rate limit check (per-user role-based, then global fallback)
	if !e.checkRateLimit(msg) {
		slog.Info("message rate limited",
			"session", msg.SessionKey, "user_id", msg.UserID, "user", msg.UserName)
		e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgRateLimited))
		return
	}

	// Banned words check (skip for slash commands and ! shell shortcut)
	if !strings.HasPrefix(content, "/") && !strings.HasPrefix(content, "!") {
		if word := e.matchBannedWord(content); word != "" {
			slog.Info("message blocked by banned word", "word", word, "user", msg.UserName)
			e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgBannedWordBlocked))
			return
		}
	}

	route, ok := e.resolveMessageRoute(p, msg, content)
	if !ok {
		return
	}
	interactiveKey := route.interactiveKey

	if len(msg.Images) == 0 && strings.HasPrefix(content, "/") {
		if e.handleCommand(p, msg, content) {
			return
		}
		// Unrecognized slash command — fall through to agent as normal message
	}

	// Permission responses bypass the session lock.
	// Must be after workspace resolution so interactiveKey is correct.
	if e.handlePendingPermission(p, msg, content, interactiveKey) {
		return
	}

	// "!" prefix: treat as shell command (same as /shell)
	// Placed after permission handling so "!yes" doesn't hijack permission responses.
	if len(msg.Images) == 0 && strings.HasPrefix(content, "!") {
		shellCmd := strings.TrimSpace(content[1:])
		if shellCmd != "" {
			// Check disabled / admin just like handleCommand does for "shell"
			e.userRolesMu.RLock()
			disabledCmds := e.disabledCmds
			urm := e.userRoles
			e.userRolesMu.RUnlock()
			if urm != nil {
				if role := urm.ResolveRole(msg.UserID); role != nil {
					disabledCmds = role.DisabledCmds
				}
			}
			if disabledCmds["shell"] {
				e.replyToAuthorizedMessage(p, msg, fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "!"))
				return
			}
			if !e.isAdmin(msg.UserID) {
				e.replyToAuthorizedMessage(p, msg, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "!"))
				return
			}
			slog.Info("audit: command_executed",
				"user_id", msg.UserID, "platform", msg.Platform,
				"project", e.name, "command", "shell")
			e.cmdShell(p, msg, "/shell "+shellCmd)
			return
		}
	}

	// Pending provider add (card-driven multi-step flow)
	if e.handlePendingProviderAdd(p, msg, content, interactiveKey) {
		return
	}

	if e.discardStaleUserMessageIfNeeded(interactiveKey, msg) {
		return
	}

	// The prompt of this message: the sender's words under the platform blocks.
	if keepUserText(msg); !msg.nativeCommand {
		body := content
		// A multi-party chat's own words need the speaker's name; otherwise the newest message
		// reads as if the previous speaker said it. GroupChat
		// and UserName are structured fields, so this works with an empty AmbientChat too (first
		// message, after restart, quote-only). Commands, bridge payloads and DMs keep their raw
		// text so command parsing and DM routing do not change.
		body = senderText(msg, body)
		var head []string
		if chatIdentity := chatIdentityBlock(msg); chatIdentity != "" {
			head = append(head, chatIdentity)
		}
		if _, ok := p.(MessageReplySender); ok && msg.MessageID != "" {
			ids := "[Message IDs: current=" + msg.MessageID
			if msg.Reference != nil && msg.Reference.ID != "" {
				ids += " reply_to=" + msg.Reference.ID
			}
			head = append(head, ids+"]")
			// ACP backends need the usage inline: they need not implement
			// SystemPromptSupporter or load an instruction file.
			head = append(head, nativeQuotedReplyInstructions)
		}
		if msg.AmbientChat != "" {
			head = append(head, msg.AmbientChat)
		}
		if msg.ExtraContent != "" {
			head = append(head, msg.ExtraContent)
		}
		if len(head) > 0 {
			if body == "" {
				content = strings.Join(head, "\n")
			} else {
				content = strings.Join(head, "\n") + "\n" + body
			}
		} else {
			content = body
		}
		msg.Content = content
	}

	// maomao fork: video links → watchvid once, result paths appended (media library).
	if e.checkTurnAuthorization(msg.authorization, "tool.execute") == nil {
		e.prepareMedia(msg)
	}

	e.dispatchMessage(p, msg, route)
}

// messageRoute is where one message runs: the agent and session manager of its workspace (the
// engine's own without one) and the key of its interactive state.
type messageRoute struct {
	agent          Agent
	sessions       *SessionManager
	interactiveKey string
	workspace      string // resolved workspace dir; "" outside multi-workspace / send work dir
}

// enterMessageWork is the door of every pass over a message (handleMessage, releaseHeldMessage):
// its authorization, the pause switch and the shutdown counter. true: the caller must call
// e.messageWorkers.Done() when it is through.
func (e *Engine) enterMessageWork(msg *Message) bool {
	if err := e.checkTurnAuthorization(msg.authorization, "task.resume"); err != nil {
		slog.Warn("message authorization denied", "error", err)
		return false
	}
	if e.IsPaused() {
		return false
	}
	return e.beginMessageWork()
}

// releaseHeldMessage continues a message the gate held for its burst (gate.go, the burst timer):
// msg is the burst folded into its first message, already admitted and prepared by handleMessage.
// The route is resolved again — the hold is up to silenceMax long and a workspace binding can
// change meanwhile — and the message goes on to the gate's judgement and the turn.
func (e *Engine) releaseHeldMessage(p Platform, msg *Message) {
	if !e.enterMessageWork(msg) {
		return
	}
	defer e.messageWorkers.Done()
	route, ok := e.resolveMessageRoute(p, msg, e.resolveAlias(strings.TrimSpace(userTextOf(msg))))
	if !ok {
		return
	}
	if e.discardStaleUserMessageIfNeeded(route.interactiveKey, msg) {
		return
	}
	e.dispatchMessage(p, msg, route)
}

// resolveMessageRoute picks the agent, session manager and interactive key for msg. content is
// the sender's words after alias resolution (the workspace commands are recognised on it).
// false: the message ends here (no workspace bound and the init flow took it, or an error was
// replied).
func (e *Engine) resolveMessageRoute(p Platform, msg *Message, content string) (messageRoute, bool) {
	// Multi-workspace resolution
	var wsAgent Agent
	var wsSessions *SessionManager
	var resolvedWorkspace string
	if e.multiWorkspace {
		e.migrateLegacyWorkspaceBindings(msg)
	}
	if forcedWorkDir := e.sendWorkDirForSession(msg.SessionKey); forcedWorkDir != "" {
		e.bindSendWorkDir(msg.SessionKey, forcedWorkDir)
		var err error
		wsAgent, wsSessions, err = e.getOrCreateWorkspaceAgent(forcedWorkDir)
		if err != nil {
			slog.Error("failed to create send work_dir agent", "work_dir", forcedWorkDir, "err", err)
			e.replyToAuthorizedMessage(p, msg, fmt.Sprintf("Failed to initialize workspace: %v", err))
			return messageRoute{}, false
		}
		resolvedWorkspace = forcedWorkDir
	} else if e.multiWorkspace {
		channelID := effectiveChannelID(msg)
		channelKey := effectiveWorkspaceChannelKey(msg)
		workspace, channelName, err := e.resolveWorkspace(p, channelID)
		if err != nil {
			slog.Error("workspace resolution failed", "err", err)
			e.replyToAuthorizedMessage(p, msg, e.i18n.Tf(MsgWsResolutionError, err))
			return messageRoute{}, false
		}
		if workspace == "" {
			// No workspace — handle init flow (unless it's a /workspace command)
			if !strings.HasPrefix(content, "/workspace") && !strings.HasPrefix(content, "/ws ") {
				if e.handleWorkspaceInitFlow(p, msg, channelName) {
					return messageRoute{}, false
				}
			} else {
				// Workspace command bypassed the init flow; clean up any stale flow
				// so it doesn't interfere if the channel becomes unbound again later.
				e.initFlowsMu.Lock()
				delete(e.initFlows, channelKey)
				e.initFlowsMu.Unlock()
			}
			// If init flow didn't consume, only workspace commands work
			if !strings.HasPrefix(content, "/") {
				return messageRoute{}, false
			}
		} else {
			// Touch for idle tracking
			if ws := e.workspacePool.Get(workspace); ws != nil {
				ws.Touch()
			}

			var effectiveWorkspace string
			wsAgent, wsSessions, _, effectiveWorkspace, err = e.workspaceContext(workspace, msg.SessionKey)
			if err != nil {
				slog.Error("failed to create workspace agent", "workspace", workspace, "err", err)
				e.replyToAuthorizedMessage(p, msg, fmt.Sprintf("Failed to initialize workspace: %v", err))
				return messageRoute{}, false
			}
			resolvedWorkspace = effectiveWorkspace
		}
	}
	// Select session manager and agent based on workspace mode
	route := messageRoute{agent: e.agent, sessions: e.sessions, interactiveKey: msg.SessionKey, workspace: resolvedWorkspace}
	if resolvedWorkspace != "" && wsSessions != nil {
		route.sessions = wsSessions
		route.agent = wsAgent
		route.interactiveKey = resolvedWorkspace + ":" + msg.SessionKey
	}
	return route, true
}

// dispatchMessage is the last stage of a message: the gate, then the turn. The gate may take the
// message (held for its burst, buffered as context, inserted into the running turn); otherwise
// the turn starts, or the message queues behind the one running.
func (e *Engine) dispatchMessage(p Platform, msg *Message, route messageRoute) {
	sessions, agent, interactiveKey, resolvedWorkspace := route.sessions, route.agent, route.interactiveKey, route.workspace
	session := sessions.GetOrCreateActive(msg.SessionKey)
	sessions.UpdateUserMeta(msg.SessionKey, msg.UserName, msg.ChatName)
	if msg.Direct {
		sessions.MarkDirect(msg.SessionKey)
	}
	if msg.TaskForum == nil && e.applyGate(p, msg, session, interactiveKey) {
		return
	}
	// 任务帖里的回话不过 gate。会话正忙、agent 又收得下中途输入时，
	// 直接插进当前这一轮，回执发回帖子；插不进（不支持、这一轮卡住、
	// 发送失败）就照旧往下走排队。写法同 injectLocal（gate_local.go）。
	if msg.TaskForum != nil && msg.Mentioned && session.Busy() && e.canInjectInto(agent, interactiveKey) {
		content := msg.Content
		if strings.TrimSpace(content) == "" {
			content = "（补充附件，和刚才的消息是一起发的）"
		}
		content = e.buildSenderPrompt(withVoiceNote(content, msg.FromVoice && !msg.voiceMarked),
			msg.UserID, msg.UserName, msg.Platform, msg.SessionKey, msg.ChannelKey)
		if e.injectIntoRunningTurn(interactiveKey, content, msg.ReplyCtx, msg.Images, msg.Files) {
			e.insertNotice(p, msg.ReplyCtx, e.i18n.T(MsgLocalGateInserted))
			return
		}
	}
	if e.nativeCompactRejectsUser(interactiveKey) {
		e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgPreviousProcessing))
		return
	}

	// Ensure an interactiveState entry exists before taking the session lock.
	// Without this, concurrent messages can observe the session as busy during
	// startup but still find no state to queue into.
	e.ensureInteractiveStateForQueueing(interactiveKey, p, msg.ReplyCtx)
	if !session.TryLock() {
		if e.stopCurrentMessageIfRecalled(interactiveKey) {
			if e.waitForSessionLock(session, recalledStopLockWait) {
				goto sessionLocked
			}
			e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgPreviousProcessing))
			return
		}
		// Session is busy — try to queue the message for the running turn
		// so the agent processes it immediately after the current turn ends.
		if out := e.queueForBusySession(p, msg, session, sessions, interactiveKey, agent, resolvedWorkspace, nil); out != queueUnavailable {
			if out == queueAccepted {
				e.reactReceived(p, msg)
				if msg.abortFront {
					e.abortForQueuedFront(p, msg, interactiveKey) // maomao fork: queued first, now cancel (gate.go)
				}
			}
			return
		}
		e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgPreviousProcessing))
		return
	}

sessionLocked:
	if rotated := e.maybeAutoResetSessionOnIdle(p, msg, sessions, interactiveKey, session); rotated != nil {
		session = rotated
	}
	// Record that a real user message is being processed. This keeps
	// LastUserActivity separate from UpdatedAt (bumped by every Unlock), so
	// reset_on_idle_mins is not defeated by heartbeats or unsolicited agent
	// output running between user messages (#1115).
	session.TouchUserActivity()

	// Ensure an interactiveState entry exists before launching the async
	// processor so messages arriving during session startup can be queued
	// instead of dropped (issue #565). This is still needed after idle auto-
	// reset because cleanupInteractiveState may remove the early placeholder.
	e.ensureInteractiveStateForQueueing(interactiveKey, p, msg.ReplyCtx)
	e.noteUserMessageAccepted(interactiveKey, msg.UserMessageTimeMs)
	runMessageAccepted(msg)
	slog.Debug("user message accepted for processing",
		"platform", msg.Platform,
		"session", msg.SessionKey,
		"interactive_key", interactiveKey,
		"msg_id", msg.MessageID,
		"msg_create_time_ms", msg.UserMessageTimeMs,
	)

	slog.Info("processing message",
		"platform", msg.Platform,
		"user", msg.UserName,
		"session", session.ID,
	)

	e.reactReceived(p, msg)
	e.startInteractiveMessage(p, msg, session, agent, sessions, interactiveKey, resolvedWorkspace, msg.SessionKey)
}

func runMessageAccepted(msg *Message) {
	if msg == nil || msg.OnAccepted == nil {
		return
	}
	callback := msg.OnAccepted
	msg.OnAccepted = nil
	callback()
}

func (e *Engine) maybeAutoResetSessionOnIdle(p Platform, msg *Message, sessions *SessionManager, interactiveKey string, session *Session) *Session {
	if e.resetOnIdle <= 0 || session == nil {
		return nil
	}

	hasBackend := session.GetAgentSessionID() != ""
	hasHistory := len(session.GetHistory(1)) > 0
	if !hasBackend && !hasHistory {
		return nil
	}

	// Prefer LastUserActivity for idle tracking: it is only updated on actual
	// user messages, so heartbeats and unsolicited agent output don't prevent
	// idle reset from firing (#1115). Fall back to UpdatedAt for sessions
	// created before this field was introduced.
	lastActive := session.GetLastUserActivity()
	if lastActive.IsZero() {
		lastActive = session.GetUpdatedAt()
	}
	if lastActive.IsZero() || time.Since(lastActive) < e.resetOnIdle {
		return nil
	}

	slog.Info("auto-resetting idle session",
		"session_key", msg.SessionKey,
		"session_id", session.ID,
		"idle_for", time.Since(lastActive),
		"threshold", e.resetOnIdle,
	)

	// Check if the old session has an agent process that needs graceful
	// shutdown. If so, tell the user we're wrapping up before blocking.
	e.interactiveMu.Lock()
	state, hasState := e.interactiveStates[interactiveKey]
	hasAgent := hasState && state != nil && state.agentSession != nil && state.agentSession.Alive()
	e.interactiveMu.Unlock()

	if hasAgent {
		// Notify the user before the potentially long close. The close
		// returns as soon as the process exits (usually seconds), but
		// Stop hooks can take up to 120s.
		e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgSessionClosingGraceful))
	}

	e.cleanupInteractiveState(interactiveKey)
	session.UnlockWithoutUpdate()

	newSession := sessions.NewSession(msg.SessionKey, "")
	if !newSession.TryLock() {
		slog.Error("failed to lock new session after idle auto-reset", "session_key", msg.SessionKey, "new_session", newSession.ID)
		return nil
	}

	e.replyToAuthorizedMessage(p, msg, e.i18n.Tf(MsgSessionAutoResetIdle, int(e.resetOnIdle/time.Minute)))
	return newSession
}

// queueOutcome is what enqueueForBusySession did with a message (maomao fork).
type queueOutcome int

const (
	queueUnavailable queueOutcome = iota // no live state to queue into; the caller handles the message
	queueAccepted                        // appended to the queue
	queueRejected                        // handled but not queued: stale, or the queue is full (user was told)
)

// enqueueForBusySession is queueMessageForBusySession with the outcome spelled out, so a
// cron/timer job can tell "queued" from "turned away" (maomao fork). scheduledFrom is set for a
// cron/timer turn (see queuedMessage.scheduledFrom).
func (e *Engine) enqueueForBusySession(p Platform, msg *Message, interactiveKey string, scheduledFrom Platform) queueOutcome {
	if scheduledFrom == nil {
		scheduledFrom = msg.scheduledFrom // a re-delivered cron/timer turn (deferForCapacity)
	}
	e.interactiveMu.Lock()
	// A running native /compact holds the session lock; what queues here runs
	// when it ends (drainQueuedAfterNativeCompact). New user messages are
	// turned away before this during a user /compact (nativeCompactRejectsUser
	// in handleMessage), and queue here during an auto compaction.
	behindCompact := e.nativeCompactions[interactiveKey] != nil
	state, hasState := e.interactiveStates[interactiveKey]
	if !hasState || state == nil {
		e.interactiveMu.Unlock()
		return queueUnavailable
	}
	// Keep interactiveMu until state.mu is held. Otherwise a starting session can
	// replace a placeholder state between lookup and queue append, losing the
	// queued message before adoptPendingFromPlaceholder sees it.
	state.mu.Lock()
	e.interactiveMu.Unlock()
	defer e.journalSyncQueued(state, interactiveKey) // #618 K4 #12: runs after the unlock below
	defer state.mu.Unlock()

	// Allow queueing when agentSession is nil (session is starting up,
	// issue #565). Only reject if the session was established and died.
	if state.agentSession != nil && !state.agentSession.Alive() && !msg.abortFront {
		return queueUnavailable
	}

	// Only queue metadata — do NOT send to agent stdin yet.
	// The agent CLI may treat a mid-turn stdin message as part of the
	// current turn, causing the event loop to hang waiting for a second
	// EventResult that never arrives. Instead, the event loop sends the
	// message after the current turn's EventResult is received.
	if e.isStaleUserMessageLocked(state, msg.UserMessageTimeMs) {
		snap := userMessageWatermarkSnapshotLocked(state)
		e.logStaleUserMessageDropped("reject_before_queue", msg, interactiveKey, snap)
		return queueRejected
	}
	// Only a person's message makes room; a cron/timer or teammate turn keeps the old rule.
	groupQueue := groupChatQueue(p, msg.ReplyCtx, msg.Direct) && !msg.FromBot && scheduledFrom == nil &&
		msg.timerJobID == "" && !scheduledTurnUser(msg.UserID)
	if len(state.pendingMessages) >= e.maxQueuedMessages && !msg.abortFront && !groupQueue {
		depth := len(state.pendingMessages)
		e.replyToAuthorizedMessage(p, msg, fmt.Sprintf(e.i18n.T(MsgQueueFull), depth))
		return queueRejected // handled: queue-full reply sent
	}
	if behindCompact {
		state.queuedBehindCompact = true
	}
	q := queuedMessage{
		authorization:       msg.authorization,
		taskForum:           msg.TaskForum,
		messageID:           msg.MessageID,
		platform:            p,
		replyCtx:            msg.ReplyCtx,
		content:             msg.Content,
		ambientChat:         msg.AmbientChat,
		reference:           msg.Reference,
		images:              msg.Images,
		files:               msg.Files,
		fromVoice:           msg.FromVoice,
		voiceMarked:         msg.voiceMarked, // #215: a re-queued batch keeps its per-part marks
		userID:              msg.UserID,
		userName:            msg.UserName,
		turnCtx:             msg.TurnCtx,
		turnCtxQuery:        msg.TurnCtxQuery,
		turnCtxSender:       msg.TurnCtxSender,
		modeOverride:        msg.ModeOverride,
		scheduledFrom:       scheduledFrom,
		turnTrigger:         msg.turnTrigger,
		resumedFrom:         msg.resumedFrom,
		timerJobID:          msg.timerJobID,
		wakeID:              msg.wakeID,
		cronJobID:           msg.cronJobID,
		resumeNoProgress:    msg.resumeNoProgress,
		resumeFallback:      msg.resumeFallback,
		scheduledBackfilled: msg.scheduledBackfilled,
		msgPlatform:         msg.Platform,
		msgSessionKey:       msg.SessionKey,
		channelKey:          msg.ChannelKey,
		userMessageTimeMs:   msg.UserMessageTimeMs,
		fromBot:             msg.FromBot,
		mentioned:           msg.Mentioned,
		direct:              msg.Direct,
		abortFront:          msg.abortFront, // #739: the batch still answers this one
		nativeCommand:       msg.nativeCommand,
		boardDesc:           boardDescOf(msg),
	}
	// Mixed explicit/automatic turns keep separate durable queue entries.
	if q.resumedFrom == "" && (q.authorization != nil || state.authorization != nil) {
		id, err := e.journalPendingAuthorizationTurn(&q, interactiveKey, state.workspaceDir)
		if err != nil {
			slog.Warn("queue authorization journal failed", "error", err)
			return queueRejected
		}
		q.resumedFrom = id
	}
	// Room is made only for a message that is accepted (its journal entry, if any, is written);
	// one that cannot ride as context (journaled, so never batchable) holds a place.
	if groupQueue && countQueuedLocked(state) >= e.maxQueuedMessages && !msg.abortFront {
		// A busy group chat: the oldest queued message nobody @-ed becomes context for the next
		// turn instead of a "queue full" notice (queue_batch.go).
		q.overflow = e.makeRoomInGroupQueueLocked(state, msg, interactiveKey) && batchableQueued(&q)
	}
	q.queueOrder = e.queueOrder.Add(1)
	if msg.abortFront {
		// maomao fork: a gate abort is answered before what queued behind the turn it cancels.
		state.pendingMessages = append([]queuedMessage{q}, state.pendingMessages...)
	} else {
		state.pendingMessages = append(state.pendingMessages, q)
	}
	runMessageAccepted(msg)
	if e.board != nil {
		e.board.touchKey(interactiveKey) // maomao fork: "排着队的" on the channel board
	}
	queueDepth := len(state.pendingMessages)

	slog.Debug("user message accepted into queue",
		"session", msg.SessionKey,
		"interactive_key", interactiveKey,
		"msg_id", msg.MessageID,
		"msg_create_time_ms", msg.UserMessageTimeMs,
		"queue_depth", queueDepth,
	)

	// #545: age of the running turn at enqueue time, not this message's wait.
	// Message waiting time requires correlating enqueue and processing timestamps.
	turnElapsed := time.Duration(0)
	if !state.turnStartedAt.IsZero() {
		turnElapsed = time.Since(state.turnStartedAt).Round(time.Second)
	}
	slog.Info("message queued for busy session",
		"session", msg.SessionKey,
		"user", msg.UserName,
		"queue_depth", queueDepth,
		"turn_elapsed", turnElapsed,
		"mentioned", msg.Mentioned,
	)
	if !msg.abortFront { // the abort says "⏹ 已打断" instead (abortForQueuedFront)
		// Cron/timer/heartbeat turns have no human waiting; the receipt is channel noise (11-02 restart burst).
		if !e.skipQueuedNotice.Load() && msg.timerJobID == "" && scheduledFrom == nil && !scheduledTurnUser(msg.UserID) {
			e.replyToAuthorizedMessage(p, msg, e.queueReceiptText(state, queueDepth))
		}
	}
	return queueAccepted
}

// queueReceiptText renders the receipt for a message queued behind a running turn.
// Always include status and the consequences of /stop: an early arrival may wait
// behind a long turn with no later message to trigger an updated receipt (#882).
// Caller holds state.mu (turnStartedAt is guarded by it).
func (e *Engine) queueReceiptText(state *interactiveState, depth int) string {
	base := e.i18n.T(MsgMessageQueued)
	elapsed := e.i18n.T(MsgMessageQueuedAgeUnknown)
	if !state.turnStartedAt.IsZero() {
		// 来源: #545 返工要求秒级入队也显示时长；沿用 Go duration 的秒精度。
		elapsed = time.Since(state.turnStartedAt).Truncate(time.Second).String()
	}
	return base + "\n" + e.i18n.Tf(MsgMessageQueuedWaiting, elapsed, depth)
}

// queueForBusySession queues msg behind the turn running on session (see
// enqueueForBusySession) and makes sure someone drains it.
func (e *Engine) queueForBusySession(p Platform, msg *Message, session *Session, sessions *SessionManager, interactiveKey string, agent Agent, workspaceDir string, scheduledFrom Platform) queueOutcome {
	outcome := e.enqueueForBusySession(p, msg, interactiveKey, scheduledFrom)
	if outcome == queueUnavailable {
		return outcome
	}
	// Race guard: the drain loop in processInteractiveMessageWith may
	// have just finished (session unlocked) between our TryLock failure
	// and the queue append. Re-try TryLock — if it succeeds, no one is
	// draining the queue so we must start a processor ourselves.
	if session.TryLock() {
		// conest #14: register the drain with messageWorkers so Stop waits for
		// it; a stopping engine refuses it and the lock is handed back.
		if !e.startMessageWorker(func() { e.drainOrphanedQueue(session, sessions, interactiveKey, agent, workspaceDir) }) {
			session.Unlock()
		}
	}
	return outcome
}

// ensureInteractiveStateForQueueing creates a placeholder interactiveState
// entry if none exists. This allows messages arriving while the agent session
// is still starting up to be queued instead of dropped (issue #565).
// The placeholder has agentSession==nil; getOrCreateInteractiveStateWith will
// replace it with a fully initialized state once the agent process is spawned.
func (e *Engine) ensureInteractiveStateForQueueing(key string, p Platform, replyCtx any) {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	if _, ok := e.interactiveStates[key]; !ok {
		e.interactiveStates[key] = &interactiveState{
			platform:         p,
			replyCtx:         replyCtx,
			eventsNeedResync: true,
		}
	}
}

// drainOrphanedQueue is called when a message was queued but the drain loop
// has already exited. It processes all pending messages in the state, similar
// to the drain loop in processInteractiveMessageWith but as a standalone
// goroutine.
func (e *Engine) drainOrphanedQueue(session *Session, sessions *SessionManager, interactiveKey string, agent Agent, workspaceDir string) {
	unlocked := false
	defer func() {
		if !unlocked {
			session.Unlock()
		}
	}()

	e.interactiveMu.Lock()
	state, hasState := e.interactiveStates[interactiveKey]

	if hasState && state != nil {
		// A compact placeholder or a process being closed has no live process to
		// drain into. Re-enter the foreground acquisition path: it waits for
		// actual Close, resumes the saved ID and adopts the remaining queue.
		state.mu.Lock()
		placeholder := state.agentSession == nil && len(state.pendingMessages) > 0 &&
			(state.agentCloseDone != nil || (state.queuedBehindCompact && !state.stopped))
		alive := state.agentSession != nil && state.agentSession.Alive()
		state.queuedBehindCompact = false
		var first queuedMessage
		if placeholder {
			first = state.pendingMessages[0]
			state.pendingMessages = state.pendingMessages[1:]
		}
		state.mu.Unlock()
		e.interactiveMu.Unlock()
		if placeholder {
			msg := queuedToMessage(first)
			e.startScheduledTurn(&msg, session) // a queued cron/timer turn, as when run directly
			unlocked = true                     // processInteractiveMessageWith releases the session
			e.processInteractiveMessageWith(first.platform, &msg, session, agent, sessions, interactiveKey, workspaceDir, msg.SessionKey)
			return
		}
		if !alive {
			e.notifyDroppedQueuedMessages(state, fmt.Errorf("agent session ended"))
			return
		}
	} else {
		e.interactiveMu.Unlock()
		return
	}

	// The drain owns the event reader until it atomically returns to idle.
	unlocked = e.drainPendingMessages(state, session, sessions, interactiveKey)
}

// restoreActiveProviderFromSession syncs the agent's active provider to the
// one persisted in the session, but only when the choice survived a
// cc-connect process restart (i.e. the in-memory active provider is not
// already the desired one). It is a no-op when:
//   - the agent does not implement ProviderSwitcher,
//   - the session never recorded a provider choice (`/provider switch` was
//     never called for this conversation), or
//   - the agent already has the correct provider active (steady-state path
//     within a single process lifetime).
//
// The empty-session-value case is intentionally a no-op rather than
// `SetActiveProvider("")`: clearing the agent here would clobber a
// project-level default for sessions that predate this field.
func restoreActiveProviderFromSession(agent Agent, session *Session) {
	if agent == nil || session == nil {
		return
	}
	want := session.GetActiveProvider()
	if want == "" {
		return
	}
	ps, ok := agent.(ProviderSwitcher)
	if !ok {
		return
	}
	if cur := ps.GetActiveProvider(); cur != nil && cur.Name == want {
		return
	}
	if !ps.SetActiveProvider(want) {
		slog.Warn("session.active_provider no longer registered; leaving agent default",
			"session_id", session.ID, "wanted_provider", want)
		return
	}
	slog.Info("restored active provider from session",
		"session_id", session.ID, "provider", want)
}

// relayDrainingError means only the caller stopped waiting; execution still owns
// the task receipt and reporting token until the background drain completes.
type relayDrainingError struct{ error }

func (e *relayDrainingError) Unwrap() error { return e.error }
