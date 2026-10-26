package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/daemon"
	// Agent and platform imports are in separate plugin_*.go files
	// controlled by build tags. See Makefile for selective compilation.
)

var (
	version   = "dev"
	commit    = "none"
	buildTime = "unknown"
	trayMode  bool
)

// globalAPIServer holds the running API server so the config-reload path can
// re-apply hot-reloadable settings (e.g. max attachment size) without threading
// it through the engine's reload closure. nil when the API server is disabled.
var globalAPIServer *core.APIServer

// defaultResetOnIdleMins is applied when a project does not set
// reset_on_idle_mins. After this many minutes of user inactivity, cc-connect
// rotates to a fresh session for the next message instead of resuming the
// previous transcript via --continue. This avoids "context drift" where stale
// chat history (failed commands, debugging noise, abandoned tangents) is
// repeatedly re-ingested and starts to dominate the model's attention. The
// previous session is preserved and remains accessible via /list and /switch.
//
// Set reset_on_idle_mins = 0 in config.toml to opt out and restore the
// previous behavior of always continuing the prior session.
const defaultResetOnIdleMins = 0

// resolveResetOnIdle returns the configured reset-on-idle duration for a
// project, applying defaultResetOnIdleMins when the field is unset. The second
// return value indicates whether the default was applied, so the caller can
// emit a one-time nudge log directing users to the docs.
func resolveResetOnIdle(configured *int) (time.Duration, bool) {
	if configured != nil {
		return time.Duration(*configured) * time.Minute, false
	}
	return time.Duration(defaultResetOnIdleMins) * time.Minute, true
}

// logSizeSource describes where the resolved log size came from, so the
// caller can log it and operators can audit the active setting without
// grepping systemd/launchd definitions.
type logSizeSource string

const (
	logSizeSourceFlag    logSizeSource = "flag"
	logSizeSourceEnv     logSizeSource = "env"
	logSizeSourceDefault logSizeSource = "default"
)

// resolveLogMaxSize picks the effective max log size in bytes, applying the
// priority order: explicit flag value > CC_LOG_MAX_SIZE env var > built-in
// default. flagValue is the raw string from --log-max-size ("" if not set).
// Returns the byte count and which source won. Invalid flag/env values are
// logged to stderr and the value is ignored — a malformed setting must never
// silently downgrade to "0 bytes" or another surprise.
func resolveLogMaxSize(flagValue string) (int64, logSizeSource) {
	if strings.TrimSpace(flagValue) != "" {
		n, err := daemon.ParseLogSize(flagValue)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: ignoring --log-max-size=%q: %v\n", flagValue, err)
		} else {
			return n, logSizeSourceFlag
		}
	}
	if v := os.Getenv("CC_LOG_MAX_SIZE"); v != "" {
		n, err := daemon.ParseLogSize(v)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: ignoring CC_LOG_MAX_SIZE=%q: %v\n", v, err)
		} else {
			return n, logSizeSourceEnv
		}
	}
	return int64(daemon.DefaultLogMaxSize), logSizeSourceDefault
}

// preScanLogMaxSizeFlag returns the value passed via --log-max-size before
// flag.Parse() runs, so the rotating-writer setup can honour the flag too.
// Returns "" if the flag is absent. Both "--log-max-size VALUE" and
// "--log-max-size=VALUE" forms are recognised.
func preScanLogMaxSizeFlag(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--log-max-size" {
			if i+1 < len(args) {
				return args[i+1]
			}
			return ""
		}
		if strings.HasPrefix(a, "--log-max-size=") {
			return strings.TrimPrefix(a, "--log-max-size=")
		}
	}
	return ""
}

// logBackupsSource describes where the resolved max-backups count came
// from, mirroring logSizeSource so operators can audit the active value
// from the startup log line alone.
type logBackupsSource string

const (
	logBackupsSourceFlag    logBackupsSource = "flag"
	logBackupsSourceEnv     logBackupsSource = "env"
	logBackupsSourceDefault logBackupsSource = "default"
)

// resolveLogMaxBackups picks the effective number of rotated log backups
// to retain, with the same priority order as resolveLogMaxSize: explicit
// flag value > CC_LOG_MAX_BACKUPS env var > built-in default. Returns
// the count and which source won. Invalid inputs are logged to stderr
// and the value is ignored so a typo never silently downgrades to "0".
func resolveLogMaxBackups(flagValue string) (int, logBackupsSource) {
	if strings.TrimSpace(flagValue) != "" {
		n, err := daemon.ParseLogBackups(flagValue)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: ignoring --log-max-backups=%q: %v\n", flagValue, err)
		} else {
			return n, logBackupsSourceFlag
		}
	}
	if v := os.Getenv("CC_LOG_MAX_BACKUPS"); v != "" {
		n, err := daemon.ParseLogBackups(v)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: ignoring CC_LOG_MAX_BACKUPS=%q: %v\n", v, err)
		} else {
			return n, logBackupsSourceEnv
		}
	}
	return daemon.DefaultLogMaxBackups, logBackupsSourceDefault
}

// preScanLogMaxBackupsFlag returns the value passed via --log-max-backups
// before flag.Parse() runs, mirroring preScanLogMaxSizeFlag. Returns ""
// if the flag is absent.
func preScanLogMaxBackupsFlag(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--log-max-backups" {
			if i+1 < len(args) {
				return args[i+1]
			}
			return ""
		}
		if strings.HasPrefix(a, "--log-max-backups=") {
			return strings.TrimPrefix(a, "--log-max-backups=")
		}
	}
	return ""
}

// resolveMaxAttachmentSize returns the per-attachment size limit in bytes for
// the /send API. Priority: CC_MAX_ATTACHMENT_SIZE_MB env var (MiB) >
// config max_attachment_size_mb > core.DefaultMaxAttachmentSize. The env var
// intentionally uses the same MiB unit as the config field so the two knobs
// cannot silently disagree by a factor of 1<<20. A malformed or non-positive
// env value is ignored (falling through to config/default) rather than being
// fatal — the same lenient posture as resolveLogMaxSize, which also warns so
// a typo never silently downgrades the setting.
func resolveMaxAttachmentSize(cfg *config.Config) int64 {
	if v := strings.TrimSpace(os.Getenv("CC_MAX_ATTACHMENT_SIZE_MB")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n << 20
		}
		fmt.Fprintf(os.Stderr, "warning: ignoring CC_MAX_ATTACHMENT_SIZE_MB=%q: must be a positive integer (MiB)\n", v)
	}
	if cfg != nil && cfg.MaxAttachmentSizeMB > 0 {
		return int64(cfg.MaxAttachmentSizeMB) << 20
	}
	return core.DefaultMaxAttachmentSize
}

type initialModelRefreshStarter interface {
	StartInitialModelRefresh()
}

type providerWiringResult struct {
	explicitProviderRequested bool
	activeProviderApplied     bool
	canStartInitialRefresh    bool
}

var topLevelCommandHandlers = map[string]func([]string){
	"config-example": func(_ []string) {
		fmt.Print(ccconnect.ConfigExampleTOML)
	},
	"config": runConfig,
	// Post-update self-check, started by the web update from the old (backup) binary.
	core.UpdateGuardArg: func(_ []string) {
		os.Exit(core.RunUpdateGuard())
	},
	"update":       runUpdate,
	"check-update": checkUpdate,
	"provider":     runProviderCommand,
	"send":         runSend,
	"progress":     runProgress,
	"task":         runTask,
	"handoff":      runHandoff,
	"cron":         runCron,
	"model":        runModel,
	"workspace":    runWorkspace,
	"voice-desk":   runVoiceDesk,
	"timer":        runTimer,
	"at":           runTimer,
	"relay":        runRelay,
	"sessions":     runSessions,
	"session":      runSession,
	"agent-sid":    runAgentSID,
	"daemon":       runDaemon,
	"feishu":       runFeishu,
	"tuitui":       runTuiTui,
	"weixin":       runWeixin,
	"yuanbao":      runYuanbao,
	"doctor":       runDoctor,
	"web":          runWeb,
	"setup":        runSetup,
}

func main() {
	if startDesktopTray() {
		return
	}
	runMain()
}

func runMain() {
	if trayMode {
		defer quitDesktopTray()
	}
	// First of all: a new version that did not pass its update self-check last start goes back to
	// the old binary here, before anything that can make startup exit (flags, config, lock).
	core.RecoverPendingUpdate(version)

	// Agy hooks require stdout to contain only the final JSON decision. Handle
	// this internal command before update checks, logging, or normal CLI setup.
	if len(os.Args) > 1 && os.Args[1] == "_agy-permission-hook" {
		runAntigravityPermissionHook()
		return
	}

	checkUpdateAsync()
	// When started as a daemon (CC_LOG_FILE set), redirect logs to a rotating file.
	// Log file setup happens before flag.Parse() so the rotating writer is in
	// place before any slog output. To still honour --log-max-size, we
	// pre-scan os.Args here for the flag value; this is a small, deliberate
	// duplication of flag parsing for one well-known key.
	var logWriter io.Writer
	var logCloser io.Closer
	if logFile := os.Getenv("CC_LOG_FILE"); logFile != "" {
		maxSize, maxSizeSrc := resolveLogMaxSize(preScanLogMaxSizeFlag(os.Args[1:]))
		maxBackups, maxBackupsSrc := resolveLogMaxBackups(preScanLogMaxBackupsFlag(os.Args[1:]))
		fmt.Fprintf(os.Stderr, "log: redirecting to %s with max_size=%d bytes (source: %s), max_backups=%d (source: %s)\n", logFile, maxSize, maxSizeSrc, maxBackups, maxBackupsSrc)
		w, err := daemon.NewRotatingWriter(logFile, maxSize, maxBackups)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to open log file %s: %v\n", logFile, err)
			os.Exit(1)
		}
		logWriter = w
		logCloser = w
		slog.SetDefault(slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo})))
	}

	rootOpts, err := parseRootCLIOptions(os.Args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		os.Exit(2)
	}

	// Cross-check: the rotating-writer setup above consumed a pre-scanned
	// value of --log-max-size. Validate the parsed value too so malformed
	// values surface a clear warning.
	if strings.TrimSpace(rootOpts.logMaxSize) != "" {
		if _, err := daemon.ParseLogSize(rootOpts.logMaxSize); err != nil {
			fmt.Fprintf(os.Stderr, "warning: --log-max-size=%q: %v\n", rootOpts.logMaxSize, err)
		}
	}
	if rootOpts.logMaxBackups < 0 {
		fmt.Fprintf(os.Stderr, "warning: --log-max-backups=%d must be >= 0 (0 means use env/default)\n", rootOpts.logMaxBackups)
	}

	if rootOpts.showVersion {
		fmt.Printf("bothouse %s\ncommit:  %s\nbuilt:   %s\n", version, commit, buildTime)
		return
	}

	rootConfigPath = rootOpts.configPath
	if runTopLevelCommand(rootOpts.args) {
		return
	}

	if err := validateNoExtraTopLevelArgs(rootOpts.args); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n\n", err)
		printUsage()
		os.Exit(1)
	}

	core.VersionInfo = fmt.Sprintf("bothouse %s\ncommit: %s\nbuilt: %s", version, commit, buildTime)
	core.CurrentVersion = version
	core.CurrentCommit = commit
	core.CurrentBuildTime = buildTime

	configPath := resolveConfigPath(rootOpts.configPath)

	// Handle --force: kill any existing instance before we try to acquire the lock
	if rootOpts.force {
		if KillExistingInstance(configPath) {
			slog.Info("killed existing instance via --force")
		}
	}

	// Acquire instance lock to prevent duplicate processes
	instanceLock, err := AcquireInstanceLock(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		fmt.Fprintf(os.Stderr, "Use --force to kill the existing instance.\n")
		os.Exit(1)
	}
	slog.Info("acquired instance lock", "path", instanceLock.Path())
	slog.Info("desktop tray", "enabled", trayMode)

	// After an upgrade, bring ~/.bothouse/dsh plugin code up to this version (user files kept).
	// In the background: when its dependencies changed it runs pnpm install, which must not hold
	// up startup (the post-update self-check waits for /status).
	go func() {
		if refreshed, err := core.RefreshEmbeddedDSH("", version); err != nil {
			slog.Warn("dsh plugin refresh failed", "error", err)
		} else if refreshed {
			slog.Info("dsh plugin code refreshed", "version", version)
		}
	}()

	// conest: no config, or one without any bot ([[projects]]) — e.g. the [log]-only file an older
	// `setup apply --dry-run` left behind → serve the setup wizard instead of asking for TOML.
	// Same test as `cc-connect web` (needsSetup).
	if needsSetup(configPath) {
		startSetupWizard(configPath, instanceLock.Release)
		return
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config (%s): %v\n", configPath, err)
		os.Exit(1)
	}

	config.ConfigPath = configPath
	slog.Info("config loaded", "path", configPath)

	if len(cfg.Projects) == 0 {
		fmt.Fprintf(os.Stderr, "Error: no projects configured in %s\n", configPath)
		fmt.Fprintln(os.Stderr, "Add at least one [[project]] section to your config.toml, or run:")
		fmt.Fprintln(os.Stderr, "  bothouse init")
		os.Exit(1)
	}

	setupLogger(cfg.Log.Level, logWriter)

	// Restore missing stores before any scheduler or usage ledger can load or
	// create empty files in the newly selected default data directory.
	if err := core.MigrateLegacyDataDir(cfg.DataDir); err != nil {
		slog.Warn("legacy data migration incomplete, continuing startup", "error", err)
	}

	// Roles set up before new roles defaulted to full-auto (#225) still ask for
	// approval; give the ones that never chose a mode the same default, once.
	// Never blocks startup: a failed write is rolled back and retried next start.
	applied, backup, err := config.MigrateYoloDefaults(cfg.DataDir, cfg)
	if err != nil {
		slog.Warn("upgrade: permission-mode migration incomplete, continuing startup", "error", err)
	}
	if len(applied) > 0 {
		if newCfg, lerr := config.Load(configPath); lerr != nil {
			slog.Warn("upgrade: config does not load after permission-mode migration, restoring backup", "backup", backup, "error", lerr)
			if rerr := config.RestoreConfigBackup(backup); rerr != nil {
				slog.Error("upgrade: restore config backup failed", "backup", backup, "error", rerr)
			}
		} else {
			cfg = newCfg
		}
	}
	// Roles the migration could not give a mode (dotted/inline options, agent
	// types with no default mode): say once in the log they may still ask.
	if _, err := config.HintRolesWithoutKnownMode(cfg.DataDir, cfg); err != nil {
		slog.Warn("upgrade: permission-mode hint not recorded, it will repeat next start", "error", err)
	}

	// DSH roles set up before the image size limit was written get it in their overlay now (an upgrade restarts here).
	for _, proj := range cfg.Projects {
		if proj.Agent.Type != "dsh" {
			continue
		}
		if changed, err := core.EnsureDSHRoleAttachmentPatch(proj.Agent.Options); err != nil {
			slog.Warn("dsh overlay: image size limit not written", "project", proj.Name, "error", err)
		} else if changed {
			slog.Info("dsh overlay: image size limit written", "project", proj.Name)
		}
	}

	// run_as_user preflight + isolation audit. MUST run before any engine
	// or agent is constructed. If any project fails, abort startup
	// entirely — never half-spawn. See core/runas_check.go and
	// core/runas_audit.go for the checks themselves.
	if err := runRunAsUserStartupChecks(context.Background(), cfg); err != nil {
		slog.Error("run_as_user: startup checks failed, refusing to start", "error", err)
		os.Exit(1)
	}

	// the self-hosted platform the setup wizard started on this machine (<data_dir>/hub/hub.json):
	// start it again if it is not running (after a reboot); the cloud_web bots reconnect on their own
	core.UpdateStateDir = cfg.DataDir
	core.NoteUpdateStart(cfg.DataDir) // a waiting update self-check needs our PID
	go core.EnsureLocalHub(context.Background(), cfg.DataDir)

	usageLedger := core.NewUsageLedger(cfg.DataDir, core.UsagePricesWithDefaults(cfg.UsagePrices))
	engines := make([]*core.Engine, 0, len(cfg.Projects))
	effectiveWorkDirs := make([]string, 0, len(cfg.Projects))

	builtProjs := make([]config.ProjectConfig, 0, len(cfg.Projects))
	rt := newProjectRuntime(configPath, rootOpts)

	for _, proj := range cfg.Projects {
		b, err := buildProject(cfg, configPath, rootOpts, proj)
		if errors.Is(err, errSkipProject) {
			continue
		}
		if err != nil {
			os.Exit(1)
		}
		engines = append(engines, b.engine)
		effectiveWorkDirs = append(effectiveWorkDirs, b.workDir)
		builtProjs = append(builtProjs, proj)
		rt.addRunning(proj.Name, b.engine)
	}

	// Start cron scheduler
	cronStore, err := core.NewCronStore(cfg.DataDir)
	if err != nil {
		slog.Warn("cron store unavailable", "error", err)
	}
	var cronSched *core.CronScheduler
	if cronStore != nil {
		cronSched = core.NewCronScheduler(cronStore)
		if cfg.Cron.Silent != nil && *cfg.Cron.Silent {
			cronSched.SetDefaultSilent(true)
		}
		if cfg.Cron.SessionMode != "" {
			cronSched.SetDefaultSessionMode(cfg.Cron.SessionMode)
		}
		rt.cronSched = cronSched
		for i, e := range engines {
			rt.registerCron(builtProjs[i].Name, e)
		}
	}

	// Start timer scheduler
	timerStore, err := core.NewTimerStore(cfg.DataDir)
	if err != nil {
		slog.Warn("timer store unavailable", "error", err)
	}
	var timerSched *core.TimerScheduler
	if timerStore != nil {
		timerSched = core.NewTimerScheduler(timerStore)
		if cfg.Cron.Silent != nil && *cfg.Cron.Silent {
			timerSched.SetDefaultSilent(true)
		}
		if cfg.Cron.SessionMode != "" {
			timerSched.SetDefaultSessionMode(cfg.Cron.SessionMode)
		}
		rt.timerSched = timerSched
		for i, e := range engines {
			rt.registerTimer(builtProjs[i].Name, e)
		}
	}

	// Start heartbeat scheduler
	heartbeatSched := core.NewHeartbeatScheduler(cfg.DataDir)
	rt.hbSched = heartbeatSched
	for i, proj := range builtProjs {
		rt.registerHeartbeat(proj, engines[i], effectiveWorkDirs[i], false)
	}

	// maomao fork: video links → watchvid once, attachments → NAS media library. Only when
	// CONEST_MEDIA_BIN_DIR names the directory with watchvid and mediaarchive; off otherwise.
	// CONEST_MEDIA_NAS_ROOT: the NAS share it lives on (unset = no NAS).
	core.EnableMediaLibrary(os.Getenv("CONEST_MEDIA_BIN_DIR"), os.Getenv("CONEST_MEDIA_NAS_ROOT"))

	var startErrors []error
	for _, e := range engines {
		if err := e.Start(); err != nil {
			slog.Warn("engine start partially failed (some platforms may be unavailable)", "error", err)
			startErrors = append(startErrors, err)
		}
	}
	// Only exit if ALL engines failed to start
	if len(startErrors) > 0 && len(startErrors) == len(engines) {
		slog.Error("all engines failed to start, exiting")
		os.Exit(1)
	}

	if cronSched != nil {
		if err := cronSched.Start(); err != nil {
			slog.Error("cron scheduler start failed", "error", err)
		}
	}

	if timerSched != nil {
		if err := timerSched.Start(); err != nil {
			slog.Error("timer scheduler start failed", "error", err)
		}
	}

	heartbeatSched.Start()

	// Start bridge server if enabled
	var bridgeSrv *core.BridgeServer
	if cfg.Bridge.Enabled != nil && *cfg.Bridge.Enabled {
		port := cfg.Bridge.Port
		if port <= 0 {
			port = 9810
		}
		path := cfg.Bridge.Path
		if path == "" {
			path = "/bridge/ws"
		}
		// Check insecure flag for local development mode
		insecure := cfg.Bridge.Insecure != nil && *cfg.Bridge.Insecure
		if insecure {
			bridgeSrv = core.NewBridgeServerInsecure(port, cfg.Bridge.Token, path, cfg.Bridge.CORSOrigins)
		} else {
			bridgeSrv = core.NewBridgeServer(port, cfg.Bridge.Token, path, cfg.Bridge.CORSOrigins)
		}
		if bridgeSrv == nil {
			slog.Error("bridge: failed to create server - token is required (or set insecure=true for local dev)")
			os.Exit(1)
		}
		rt.bridgeSrv = bridgeSrv
		for i, e := range engines {
			rt.registerBridge(builtProjs[i].Name, e)
		}
		bridgeSrv.Start()
	}

	// Start webhook server if enabled
	var webhookSrv *core.WebhookServer
	if cfg.Webhook.Enabled != nil && *cfg.Webhook.Enabled {
		port := cfg.Webhook.Port
		if port <= 0 {
			port = 9111
		}
		path := cfg.Webhook.Path
		if path == "" {
			path = "/hook"
		}
		webhookSrv = core.NewWebhookServer(port, cfg.Webhook.Token, path)
		rt.webhookSrv = webhookSrv
		for i, e := range engines {
			rt.registerWebhook(builtProjs[i].Name, e)
		}
		webhookSrv.Start()
	}

	// Start management API server if enabled
	var mgmtSrv *core.ManagementServer
	if cfg.Management.Enabled != nil && *cfg.Management.Enabled {
		port := cfg.Management.Port
		if port <= 0 {
			port = 9820
		}
		mgmtSrv = core.NewManagementServer(port, cfg.Management.Token, cfg.Management.CORSOrigins)
		mgmtSrv.SetHost(cfg.Management.Host)
		mgmtSrv.SetUsageLedger(usageLedger)
		mgmtSrv.SetUsageImporter(core.NewUsageImporter(cfg.DataDir, usageLedger, usageLogSources(cfg.Projects)...))
		rt.mgmtSrv = mgmtSrv
		for i, e := range engines {
			rt.registerManagement(builtProjs[i].Name, e)
		}
		mgmtSrv.SetHotLoadFunc(rt.HotLoad)
		mgmtSrv.SetHotRemoveFunc(rt.HotRemove)
		if cronSched != nil {
			mgmtSrv.SetCronScheduler(cronSched)
		}
		if timerSched != nil {
			mgmtSrv.SetTimerScheduler(timerSched)
		}
		mgmtSrv.SetHeartbeatScheduler(heartbeatSched)
		if bridgeSrv != nil {
			mgmtSrv.SetBridgeServer(bridgeSrv)
		}
		mgmtSrv.SetSetupFeishuSave(saveFeishuSetup)
		mgmtSrv.SetWizard(configWizardStore{}, cfg.DataDir)
		mgmtSrv.SetWikiSubScript(subWikiScript(cfg))
		mgmtSrv.SetSetupWeixinSave(func(req core.WeixinSetupSaveRequest) error {
			_, err := config.EnsureProjectWithWeixinPlatform(config.EnsureProjectWithWeixinOptions{
				ProjectName: req.ProjectName,
				WorkDir:     req.WorkDir,
				AgentType:   req.AgentType,
			})
			if err != nil {
				return fmt.Errorf("ensure project: %w", err)
			}
			_, err = config.SaveWeixinPlatformCredentials(config.WeixinCredentialUpdateOptions{
				ProjectName:       req.ProjectName,
				Token:             req.Token,
				BaseURL:           req.BaseURL,
				AccountID:         req.IlinkBotID,
				ScannedUserID:     req.IlinkUserID,
				SetAllowFromEmpty: true,
			})
			return err
		})
		mgmtSrv.SetAddPlatformToProject(func(projectName, platType string, opts map[string]any, workDir, agentType string) error {
			if opts == nil {
				opts = map[string]any{}
			}
			return config.AddPlatformToProject(projectName, config.PlatformConfig{Type: platType, Options: opts}, workDir, agentType)
		})
		mgmtSrv.SetRemoveProject(config.RemoveProject)
		mgmtSrv.SetSaveProjectSettings(func(name string, u core.ProjectSettingsUpdate) error {
			return config.SaveProjectSettings(name, config.ProjectSettingsUpdate{
				Language:             u.Language,
				AdminFrom:            u.AdminFrom,
				DisabledCommands:     u.DisabledCommands,
				WorkDir:              u.WorkDir,
				Mode:                 u.Mode,
				AgentType:            u.AgentType,
				ShowContextIndicator: u.ShowContextIndicator,
				ShowWorkdirIndicator: u.ShowWorkdirIndicator,
				ReplyFooter:          u.ReplyFooter,
				InjectSender:         u.InjectSender,
				PlatformAllowFrom:    u.PlatformAllowFrom,
			})
		})
		mgmtSrv.SetGetProjectConfig(config.GetProjectConfigDetails)
		mgmtSrv.SetSaveProviderRefs(config.SaveProviderRefs)
		mgmtSrv.SetConfigFilePath(configPath)
		mgmtSrv.SetGetGlobalSettings(config.GetGlobalSettings)
		wireAutostart(mgmtSrv)
		mgmtSrv.SetSaveGlobalSettings(func(updates map[string]any) error {
			u := config.GlobalSettingsUpdate{}
			if v, ok := updates["language"].(string); ok {
				u.Language = &v
			}
			if v, ok := updates["attachment_send"].(string); ok {
				u.AttachmentSend = &v
			}
			if v, ok := updates["log_level"].(string); ok {
				u.LogLevel = &v
			}
			if v, ok := updates["idle_timeout_mins"].(float64); ok {
				iv := int(v)
				u.IdleTimeoutMins = &iv
			}
			if v, ok := updates["thinking_messages"].(bool); ok {
				u.ThinkingMessages = &v
			}
			if v, ok := updates["thinking_max_len"].(float64); ok {
				iv := int(v)
				u.ThinkingMaxLen = &iv
			}
			if v, ok := updates["tool_messages"].(bool); ok {
				u.ToolMessages = &v
			}
			if v, ok := updates["tool_max_len"].(float64); ok {
				iv := int(v)
				u.ToolMaxLen = &iv
			}
			if v, ok := updates["stream_preview_enabled"].(bool); ok {
				u.StreamPreviewOn = &v
			}
			if v, ok := updates["stream_preview_interval_ms"].(float64); ok {
				iv := int(v)
				u.StreamPreviewIntMs = &iv
			}
			if v, ok := updates["rate_limit_max_messages"].(float64); ok {
				iv := int(v)
				u.RateLimitMax = &iv
			}
			if v, ok := updates["rate_limit_window_secs"].(float64); ok {
				iv := int(v)
				u.RateLimitWindow = &iv
			}
			return config.SaveGlobalSettings(u)
		})
		mgmtSrv.SetListGlobalProviders(func() ([]core.GlobalProviderInfo, error) {
			providers, err := config.ListGlobalProviders()
			if err != nil {
				return nil, err
			}
			out := make([]core.GlobalProviderInfo, len(providers))
			for i, p := range providers {
				out[i] = configProviderToGlobal(p)
			}
			return out, nil
		})
		mgmtSrv.SetAddGlobalProvider(func(info core.GlobalProviderInfo) error {
			return config.AddGlobalProvider(globalProviderToConfig(info))
		})
		mgmtSrv.SetUpdateGlobalProvider(func(name string, info core.GlobalProviderInfo) error {
			return config.UpdateGlobalProvider(name, globalProviderToConfig(info))
		})
		mgmtSrv.SetRemoveGlobalProvider(func(name string) error {
			return config.RemoveGlobalProvider(name)
		})
		mgmtSrv.SetFetchPresets(core.FetchProviderPresets)
		mgmtSrv.SetFetchSkillPresets(core.FetchSkillPresets)
		if cfg.ProviderPresetsURL != "" {
			core.SetPresetsURL(cfg.ProviderPresetsURL)
		}
		mgmtSrv.SetListCCSwitchProviders(listCCSwitchProvidersForWeb)
		mgmtSrv.Start()
	}

	// Start internal API server for CLI send
	apiSrv, err := core.NewAPIServer(cfg.DataDir)
	if err != nil {
		slog.Warn("api server unavailable", "error", err)
	} else {
		globalAPIServer = apiSrv
		apiSrv.SetMaxAttachmentSize(resolveMaxAttachmentSize(cfg))

		relayMgr := core.NewRelayManager(cfg.DataDir)
		if cfg.Relay.TimeoutSecs != nil {
			secs := *cfg.Relay.TimeoutSecs
			if secs <= 0 {
				relayMgr.SetTimeout(0)
			} else {
				relayMgr.SetTimeout(time.Duration(secs) * time.Second)
			}
		}
		relayMgr.SetVisibility(cfg.Relay.Visibility)
		apiSrv.SetRelayManager(relayMgr)

		// Create shared DirHistory for all engines
		dirHistory := core.NewDirHistory(cfg.DataDir)

		rt.apiSrv, rt.relayMgr, rt.dirHistory = apiSrv, relayMgr, dirHistory
		for i, e := range engines {
			rt.registerAPI(builtProjs[i].Name, e, effectiveWorkDirs[i])
		}
		if cronSched != nil {
			apiSrv.SetCronScheduler(cronSched)
		}
		if timerSched != nil {
			apiSrv.SetTimerScheduler(timerSched)
		}
		apiSrv.Start()
	}

	gateSup := startGate(cfg)

	slog.Info("bothouse is running", "projects", len(engines))
	rt.setReady(true)

	// After startup, check if we were restarted and queue the success
	// notification. The engine dispatches it on the first OnPlatformReady
	// for the target platform (or with a 10s safety timeout), so async
	// platforms that need 2-3s to actually connect (e.g. Telegram) do not
	// silently drop the notify. See issue #1383.
	if notify := core.ConsumeRestartNotify(cfg.DataDir); notify != nil {
		slog.Info("post-restart: queuing success notification", "platform", notify.Platform, "session", notify.SessionKey)
		for _, e := range engines {
			e.SetPendingRestartNotify(notify)
		}
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	handleDumpSignal() // maomao fork: `kill -USR1 <pid>` logs goroutine stacks (unix only)

	var restartReq *core.RestartRequest
	select {
	case sig := <-sigCh:
		slog.Info("shutdown requested", "source", "system_signal", "signal", sig.String())
	case <-desktopShutdown:
		slog.Info("shutdown requested", "source", "tray")
		defer stopDesktopService()
	case req := <-core.RestartCh:
		restartReq = &req
		slog.Info("shutdown requested", "source", "restart_command", "session", req.SessionKey)
		slog.Info("restart requested via /restart command", "session", req.SessionKey, "platform", req.Platform)
	}

	slog.Info("shutting down...")
	runningEngines := rt.stopAccepting() // startup's engines plus the hot-loaded ones
	if trayMode {
		quitDesktopTray()
	}
	if mgmtSrv != nil {
		mgmtSrv.Stop()
	}
	if bridgeSrv != nil {
		bridgeSrv.Stop()
	}
	if webhookSrv != nil {
		webhookSrv.Stop()
	}
	heartbeatSched.Stop()
	if timerSched != nil {
		timerSched.Stop()
	}
	if cronSched != nil {
		cronSched.Stop()
	}
	if apiSrv != nil {
		apiSrv.Stop()
	}
	for _, e := range runningEngines {
		if err := e.Stop(); err != nil {
			slog.Error("shutdown error", "error", err)
		}
	}
	gateSup.Stop()
	if logCloser != nil {
		logCloser.Close()
	}
	instanceLock.Release()

	if restartReq != nil {
		if err := core.SaveRestartNotify(cfg.DataDir, *restartReq); err != nil {
			slog.Error("restart: save notify failed", "error", err)
		}
		execPath, err := os.Executable()
		if err != nil {
			slog.Error("restart: cannot determine executable path", "error", err)
			os.Exit(1)
		}
		// After self-update, os.Executable() may return the backup path (.old / .old-<n>).
		// Restart from the updated binary instead.
		execPath = core.BinaryFromBackupPath(execPath)
		slog.Info("restarting...", "path", execPath, "args", os.Args)
		if err := restartProcess(execPath); err != nil {
			slog.Error("restart: failed", "error", err)
			os.Exit(1)
		}
	}

	slog.Info("bye")
}

// errSkipProject: buildProject left the project out (its multi-workspace base_dir could not be
// created). Startup goes on without it, as it always did.
var errSkipProject = errors.New("project skipped")

// builtProject is what buildProject made, as far as it got (on an error the caller cleans up).
type builtProject struct {
	agent   core.Agent
	engine  *core.Engine
	workDir string // the effective work_dir (project state may override the configured one)
}

// buildProject creates one project's agent, platforms and Engine with all its settings. Nothing is
// started or registered with the process-wide services. Startup exits on an error (as before);
// hot loading only marks that project as failed.
func buildProject(cfg *config.Config, configPath string, rootOpts rootCLIOptions, proj config.ProjectConfig) (builtProject, error) {
	var b builtProject
	// Inject project-level run_as_user / run_as_env into the agent's
	// opts map so agents that support isolation can pick them up
	// without needing their own top-level config plumbing.
	if proj.RunAsUser != "" {
		if proj.Agent.Options == nil {
			proj.Agent.Options = map[string]any{}
		}
		proj.Agent.Options["run_as_user"] = proj.RunAsUser
		if len(proj.RunAsEnv) > 0 {
			proj.Agent.Options["run_as_env"] = proj.RunAsEnv
		}
	}
	agent, err := core.CreateAgent(proj.Agent.Type, buildAgentOptions(cfg.DataDir, proj))
	if err != nil {
		slog.Error("failed to create agent", "project", proj.Name, "error", err)
		return b, fmt.Errorf("create agent: %w", err)
	}
	b.agent = agent

	providerWiring := wireAgentProviders(agent, proj.Agent)

	var platforms []core.Platform
	for _, pc := range proj.Platforms {
		opts := make(map[string]any, len(pc.Options)+2)
		for k, v := range pc.Options {
			opts[k] = v
		}
		opts["cc_data_dir"] = cfg.DataDir
		opts["cc_project"] = proj.Name
		p, err := core.CreatePlatform(pc.Type, opts)
		if err != nil {
			slog.Error("failed to create platform", "project", proj.Name, "type", pc.Type, "error", err)
			return b, fmt.Errorf("create platform %s: %w", pc.Type, err)
		}
		platforms = append(platforms, p)
	}

	workDir, _ := proj.Agent.Options["work_dir"].(string)
	projectState := core.NewProjectStateStore(projectStatePath(cfg.DataDir, proj.Name))
	effectiveWorkDir := applyProjectStateOverride(proj.Name, agent, workDir, projectState)
	startInitialRefreshIfReady(agent, providerWiring)
	sessionFile := sessionStorePath(cfg.DataDir, proj.Name, effectiveWorkDir)

	// Parse language setting
	var lang core.Language
	switch cfg.Language {
	case "zh", "chinese":
		lang = core.LangChinese
	case "zh-TW", "zh_TW", "zhtw":
		lang = core.LangTraditionalChinese
	case "ja", "japanese":
		lang = core.LangJapanese
	case "es", "spanish":
		lang = core.LangSpanish
	case "en", "english":
		lang = core.LangEnglish
	default:
		lang = core.LangAuto // auto-detect
	}

	engine := core.NewEngine(proj.Name, agent, platforms, sessionFile, lang)
	b.engine = engine
	// Wire display settings including show_context_indicator and reply_footer
	// Global [display] config can be overridden by project-level settings
	_, _, _, _, _, showCtx, showFooter, _ := config.EffectiveDisplay(cfg, &proj)
	engine.SetShowContextIndicator(showCtx)
	showWorkdir := true
	if proj.ShowWorkdirIndicator != nil {
		showWorkdir = *proj.ShowWorkdirIndicator
	}
	engine.SetShowWorkdirIndicator(showWorkdir)
	engine.SetShowQuotaIndicator(proj.ShowQuotaIndicator == nil || *proj.ShowQuotaIndicator)
	engine.SetShowQuotaStatus(proj.ShowQuotaStatus == nil || *proj.ShowQuotaStatus)
	engine.SetSubagentPolicyEnabled(proj.InjectSubagentPolicy == nil || *proj.InjectSubagentPolicy)
	engine.SetAgentIdentityEnabled(proj.AgentIdentityEnabled())
	engine.SetReplyFooterEnabled(showFooter)
	engine.SetAttachmentSendEnabled(cfg.AttachmentSend != "off")
	engine.SetFilterExternalSessions(proj.FilterExternalSessions != nil && *proj.FilterExternalSessions)
	engine.SetBaseWorkDir(workDir)
	engine.SetProjectStateStore(projectState)
	engine.SetDataDir(cfg.DataDir)
	if proj.PublicProgressEnabled() {
		if err := engine.EnablePublicProgress(); err != nil {
			slog.Error("public progress initialization failed", "error", err)
			return b, fmt.Errorf("public progress: %w", err)
		}
	}

	// Wire multi-workspace mode
	if proj.Mode == "multi-workspace" {
		baseDir := proj.BaseDir
		if strings.HasPrefix(baseDir, "~/") {
			home, _ := os.UserHomeDir()
			baseDir = filepath.Join(home, baseDir[2:])
		}
		if err := os.MkdirAll(baseDir, 0o755); err != nil {
			slog.Error("failed to create base_dir", "path", baseDir, "err", err)
			return b, errSkipProject
		}
		bindingStore := filepath.Join(cfg.DataDir, "workspace_bindings.json")
		engine.SetMultiWorkspace(baseDir, bindingStore)
		if proj.WorkspaceInitAllowLocalPaths != nil {
			engine.SetWorkspaceInitAllowLocalPaths(*proj.WorkspaceInitAllowLocalPaths)
		}
		idleMins := cfg.WorkspaceIdleTimeoutMins
		if idleMins == nil && proj.WorkspaceIdleTimeoutMinsLegacy != nil {
			slog.Warn("workspace_idle_timeout_mins under [[projects]] is deprecated; move it to the top level of config.toml. Honoring the legacy value for backwards compatibility.",
				"project", proj.Name, "value", *proj.WorkspaceIdleTimeoutMinsLegacy)
			idleMins = proj.WorkspaceIdleTimeoutMinsLegacy
		}
		if idleMins != nil {
			mins := *idleMins
			if mins <= 0 {
				engine.SetWorkspaceIdleTimeout(0)
			} else {
				engine.SetWorkspaceIdleTimeout(time.Duration(mins) * time.Minute)
			}
		}
		if proj.SkipGit != nil {
			engine.SetSkipGit(*proj.SkipGit)
		}
		slog.Info("multi-workspace mode enabled", "project", proj.Name, "base_dir", baseDir)
	}

	// Wire terminal observation (--observe / [projects.observe])
	observeEnabled := rootOpts.observe
	obsChan := rootOpts.observeChannel
	if proj.Observe != nil {
		if !observeEnabled && proj.Observe.Enabled {
			observeEnabled = true
		}
		if obsChan == "" && proj.Observe.Channel != "" {
			obsChan = proj.Observe.Channel
		}
	}
	if observeEnabled {
		if obsChan == "" {
			slog.Error("observe: channel is required (use --observe-channel or set channel in [projects.observe])")
			return b, errors.New("observe: channel is required (use --observe-channel or set channel in [projects.observe])")
		}
		hasSlack := false
		for _, p := range platforms {
			if p.Name() == "slack" {
				hasSlack = true
				break
			}
		}
		if !hasSlack {
			slog.Warn("observe requires a Slack platform; ignoring")
		} else {
			projectDir := resolveClaudeProjectDir(workDir)
			if projectDir == "" {
				slog.Warn("observe: could not find Claude Code project directory", "workDir", workDir)
			} else {
				sessionKey := fmt.Sprintf("slack:%s", obsChan)
				engine.SetObserveConfig(projectDir, sessionKey)
			}
		}
	}

	// Wire global custom commands
	for _, c := range cfg.Commands {
		engine.AddCommand(c.Name, c.Description, c.Prompt, c.Exec, c.WorkDir, "config")
	}

	// Wire command persistence callbacks
	engine.SetCommandSaveAddFunc(func(name, description, prompt, exec, workDir string) error {
		return config.AddCommand(config.CommandConfig{Name: name, Description: description, Prompt: prompt, Exec: exec, WorkDir: workDir})
	})
	engine.SetCommandSaveDelFunc(func(name string) error {
		return config.RemoveCommand(name)
	})

	// Wire global aliases
	for _, a := range cfg.Aliases {
		engine.AddAlias(a.Name, a.Command)
	}
	engine.SetAliasSaveAddFunc(func(name, command string) error {
		return config.AddAlias(config.AliasConfig{Name: name, Command: command})
	})
	engine.SetAliasSaveDelFunc(func(name string) error {
		return config.RemoveAlias(name)
	})

	// Wire banned words
	if len(cfg.BannedWords) > 0 {
		engine.SetBannedWords(cfg.BannedWords)
	}

	// Wire disabled commands (project-level)
	if len(proj.DisabledCommands) > 0 {
		engine.SetDisabledCommands(proj.DisabledCommands)
	}

	// Wire admin allowlist for privileged commands
	engine.SetAdminFrom(proj.AdminFrom)

	// Wire per-user role-based policies
	if proj.Users != nil {
		engine.SetUserRoles(buildUserRoleManager(proj.Users))
	}

	// Wire display truncation settings (includes legacy quiet → display mapping)
	{
		mode, tm, tool, tmlen, toollen, _, _, hideAgentFooter := config.EffectiveDisplay(cfg, &proj)
		historyMaxLen := config.EffectiveHistoryMaxLen(cfg, &proj)
		engine.SetDisplayConfig(core.DisplayCfg{
			Mode:             mode,
			CardMode:         config.EffectiveCardMode(cfg, &proj),
			ThinkingMessages: tm,
			ThinkingMaxLen:   tmlen,
			ToolMaxLen:       toollen,
			ToolMessages:     tool,
			HistoryMaxLen:    &historyMaxLen,
			HideAgentFooter:  hideAgentFooter,
		})
	}

	// Wire shell configuration
	shell, shellFlag, shellProfile := config.EffectiveShell(cfg, &proj)
	engine.SetShell(shell, shellFlag, shellProfile)

	// Wire hooks
	if len(cfg.Hooks) > 0 {
		coreHooks := make([]core.HookConfig, len(cfg.Hooks))
		for i, h := range cfg.Hooks {
			coreHooks[i] = core.HookConfig{
				Event:   h.Event,
				Type:    h.Type,
				Command: h.Command,
				URL:     h.URL,
				Timeout: h.Timeout,
				Async:   h.Async,
			}
		}
		engine.SetHooks(core.NewHookManager(proj.Name, coreHooks, shell, shellFlag, shellProfile))
	}

	// Wire local reference normalization / rendering
	engine.SetReferenceConfig(core.ReferenceRenderCfg{
		NormalizeAgents: proj.References.NormalizeAgents,
		RenderPlatforms: proj.References.RenderPlatforms,
		DisplayPath:     proj.References.DisplayPath,
		MarkerStyle:     proj.References.MarkerStyle,
		EnclosureStyle:  proj.References.EnclosureStyle,
	})

	// Wire streaming preview
	{
		spcfg := core.DefaultStreamPreviewCfg()
		if cfg.StreamPreview.Enabled != nil {
			spcfg.Enabled = *cfg.StreamPreview.Enabled
		}
		if cfg.StreamPreview.IntervalMs != nil {
			spcfg.IntervalMs = *cfg.StreamPreview.IntervalMs
		}
		if cfg.StreamPreview.MinDeltaChars != nil {
			spcfg.MinDeltaChars = *cfg.StreamPreview.MinDeltaChars
		}
		if cfg.StreamPreview.MaxChars != nil {
			spcfg.MaxChars = *cfg.StreamPreview.MaxChars
		}
		if cfg.StreamPreview.DisabledPlatforms != nil {
			spcfg.DisabledPlatforms = cfg.StreamPreview.DisabledPlatforms
		}
		engine.SetStreamPreviewCfg(spcfg)
	}

	// Wire instant reply
	if cfg.InstantReply.Enabled != nil && *cfg.InstantReply.Enabled {
		engine.SetInstantReply(core.InstantReplyCfg{
			Enabled: true,
			Content: cfg.InstantReply.Content,
		})
	}

	// Wire rate limiting
	{
		maxMsg := 20
		windowSecs := 60
		if cfg.RateLimit.MaxMessages != nil {
			maxMsg = *cfg.RateLimit.MaxMessages
		}
		if cfg.RateLimit.WindowSecs != nil {
			windowSecs = *cfg.RateLimit.WindowSecs
		}
		if maxMsg > 0 {
			engine.SetRateLimitCfg(core.RateLimitCfg{
				MaxMessages: maxMsg,
				Window:      time.Duration(windowSecs) * time.Second,
			})
		}
	}
	// Wire outgoing rate limiting
	{
		var maxPS float64
		if cfg.OutgoingRateLimit.MaxPerSecond != nil {
			maxPS = *cfg.OutgoingRateLimit.MaxPerSecond
		}
		var burst int
		if cfg.OutgoingRateLimit.Burst != nil {
			burst = *cfg.OutgoingRateLimit.Burst
		}
		defaults := core.OutgoingRateLimitCfg{MaxPerSecond: maxPS, Burst: burst}
		overrides := make(map[string]core.OutgoingRateLimitCfg)
		for name, pc := range cfg.OutgoingRateLimit.Platforms {
			var mps float64
			if pc.MaxPerSecond != nil {
				mps = *pc.MaxPerSecond
			}
			var b int
			if pc.Burst != nil {
				b = *pc.Burst
			}
			overrides[name] = core.OutgoingRateLimitCfg{MaxPerSecond: mps, Burst: b}
		}
		if maxPS > 0 || len(overrides) > 0 {
			engine.SetOutgoingRateLimitCfg(defaults, overrides)
		}
	}

	engine.SetDisplaySaveFunc(func(mode *string, thinkingMessages *bool, thinkingMaxLen, toolMaxLen *int, toolMessages *bool) error {
		return config.SaveDisplayConfig(mode, thinkingMessages, thinkingMaxLen, toolMaxLen, toolMessages)
	})

	// Wire idle timeout
	if cfg.IdleTimeoutMins != nil {
		mins := *cfg.IdleTimeoutMins
		if mins <= 0 {
			engine.SetEventIdleTimeout(0)
		} else {
			engine.SetEventIdleTimeout(time.Duration(mins) * time.Minute)
		}
	}

	// Wire max turn time (absolute per-turn wall-clock cap; 0 = disabled)
	if cfg.MaxTurnTimeMins != nil && *cfg.MaxTurnTimeMins > 0 {
		engine.SetMaxTurnTime(time.Duration(*cfg.MaxTurnTimeMins) * time.Minute)
	}

	// Wire queue depth
	if cfg.Queue.MaxDepth != nil && *cfg.Queue.MaxDepth > 0 {
		engine.SetMaxQueuedMessages(*cfg.Queue.MaxDepth)
	}

	// Wire auto-compress settings
	if proj.AutoCompress.Enabled != nil && *proj.AutoCompress.Enabled {
		minGap := 30 * time.Minute
		if proj.AutoCompress.MinGapMins != nil {
			minGap = time.Duration(*proj.AutoCompress.MinGapMins) * time.Minute
		}
		maxTokens := derefInt(proj.AutoCompress.MaxTokens)
		if maxTokens <= 0 {
			maxTokens = 12000
		}
		engine.SetAutoCompressConfig(true, maxTokens, minGap)
	}
	wireColdCacheFresh(engine, proj)
	wireImageFresh(engine, proj)
	engine.SetSessionModels(proj.SessionModels)
	engine.SetSessionInstructions(proj.SessionInstructions)
	engine.SetGate(proj.GateURL, proj.GateTimeoutMs, proj.GateFallback)
	engine.SetGateLocal(proj.GateLocalEnabled())
	engine.SetGateBurstWindow(proj.GateBurstWindowMs)
	engine.SetModelTiers(proj.ChatModel, proj.TaskModel, proj.ChatEffort, proj.TaskEffort, proj.ModelTierStickyMins)
	engine.SetTeam(projectTeamStatus(cfg.DataDir, proj))
	engine.SetChannelBoard(proj.ChannelBoard)
	engine.SetMemoryIndex(proj.MemoryIndex)
	engine.SetTeamBoard(proj.TeamBoardEnabled())
	engine.SetTeamWorkspaces(proj.TeamWorkspacesEnabled())
	engine.SetDispatchMode(proj.DispatchMode)
	engine.SetVoiceDesk(proj.VoiceDesk)
	resetIdle, defaulted := resolveResetOnIdle(proj.ResetOnIdleMins)
	engine.SetResetOnIdle(resetIdle)
	if defaulted {
		slog.Info("project: reset_on_idle_mins not set, applying default — set reset_on_idle_mins = 0 to opt out, see docs/usage.md",
			"project", proj.Name, "default_minutes", defaultResetOnIdleMins)
	}
	if proj.AgentSessionIdleTimeoutMins != nil {
		mins := *proj.AgentSessionIdleTimeoutMins
		if mins <= 0 {
			engine.SetAgentSessionIdleTimeout(0)
		} else {
			engine.SetAgentSessionIdleTimeout(time.Duration(mins) * time.Minute)
		}
	}

	// Wire sender injection
	if proj.InjectSender != nil {
		engine.SetInjectSender(*proj.InjectSender)
	}

	// Wire speech-to-text if enabled
	if cfg.Speech.Enabled {
		speechCfg := core.SpeechCfg{
			Enabled:  true,
			Language: cfg.Speech.Language,
		}
		switch cfg.Speech.Provider {
		case "groq":
			apiKey := cfg.Speech.Groq.APIKey
			model := cfg.Speech.Groq.Model
			if model == "" {
				model = "whisper-large-v3-turbo"
			}
			if apiKey != "" {
				speechCfg.STT = core.NewOpenAIWhisper(apiKey, "https://api.groq.com/openai/v1", model)
			} else {
				slog.Warn("speech: groq provider enabled but api_key is empty")
			}
		case "qwen":
			apiKey := cfg.Speech.Qwen.APIKey
			baseURL := cfg.Speech.Qwen.BaseURL
			model := cfg.Speech.Qwen.Model
			if apiKey != "" {
				speechCfg.STT = core.NewQwenASR(apiKey, baseURL, model)
			} else {
				slog.Warn("speech: qwen provider enabled but api_key is empty")
			}
		case "gemini":
			apiKey := cfg.Speech.Gemini.APIKey
			model := cfg.Speech.Gemini.Model
			if apiKey != "" {
				speechCfg.STT = core.NewGeminiSTT(apiKey, model)
			} else {
				slog.Warn("speech: gemini provider enabled but api_key is empty")
			}
		default: // "openai" or unspecified
			apiKey := cfg.Speech.OpenAI.APIKey
			baseURL := cfg.Speech.OpenAI.BaseURL
			model := cfg.Speech.OpenAI.Model
			if apiKey != "" {
				speechCfg.STT = core.NewOpenAIWhisper(apiKey, baseURL, model)
			} else {
				slog.Warn("speech: openai provider enabled but api_key is empty")
			}
		}
		if speechCfg.STT != nil {
			engine.SetSpeechConfig(speechCfg)
			slog.Info("speech: enabled", "provider", cfg.Speech.Provider)
		}
	}

	// Wire text-to-speech if enabled
	ttsEffective := config.ResolveTTSConfigForProject(cfg.TTS, proj.Name)
	if ttsEffective.Enabled {
		ttsCfg := &core.TTSCfg{
			Enabled:      true,
			Voice:        ttsEffective.Voice,
			LanguageType: ttsEffective.LanguageType,
			Speed:        ttsEffective.Speed,
			MaxTextLen:   ttsEffective.MaxTextLen,
		}
		initMode := ttsEffective.TTSMode
		switch initMode {
		case "always", "voice_only":
		case "":
			initMode = "voice_only"
		default:
			slog.Warn("tts: invalid tts_mode in config, falling back to voice_only", "tts_mode", initMode)
			initMode = "voice_only"
		}
		ttsCfg.SetTTSMode(initMode)
		switch ttsEffective.Provider {
		case "qwen":
			apiKey := cfg.TTS.Qwen.APIKey
			baseURL := cfg.TTS.Qwen.BaseURL
			model := cfg.TTS.Qwen.Model
			if apiKey != "" {
				ttsCfg.TTS = core.NewQwenTTS(apiKey, baseURL, model, nil)
				ttsCfg.Provider = "qwen"
			} else {
				slog.Warn("tts: qwen provider enabled but api_key is empty")
			}
		case "minimax":
			apiKey := cfg.TTS.MiniMax.APIKey
			baseURL := cfg.TTS.MiniMax.BaseURL
			model := cfg.TTS.MiniMax.Model
			if apiKey == "" {
				localCfg, err := config.LoadMiniMaxLocalConfig(cfg.DataDir, cfg.TTS.MiniMax.ConfigFile)
				if err != nil {
					slog.Warn("tts: failed to load minimax local config", "error", err)
				} else {
					apiKey = localCfg.APIKey
					if baseURL == "" {
						if localCfg.BaseURL != "" {
							baseURL = localCfg.BaseURL
						} else if localCfg.APIHost != "" {
							baseURL = localCfg.APIHost
						}
					}
				}
			}
			if apiKey != "" {
				ttsCfg.TTS = core.NewMiniMaxTTS(apiKey, baseURL, model, nil)
				ttsCfg.Provider = "minimax"
			} else {
				slog.Warn("tts: minimax provider enabled but api_key is empty")
			}
		case "mimo":
			apiKey := cfg.TTS.Mimo.APIKey
			baseURL := cfg.TTS.Mimo.BaseURL
			model := cfg.TTS.Mimo.Model
			if apiKey != "" {
				ttsCfg.TTS = core.NewMimoTTS(apiKey, baseURL, model, nil)
				ttsCfg.Provider = "mimo"
			} else {
				slog.Warn("tts: mimo provider enabled but api_key is empty")
			}
		case "espeak":
			voice := ttsEffective.Voice
			if voice == "" {
				voice = "zh" // default to Chinese
			}
			ttsCfg.TTS = core.NewEspeakTTS("", voice)
			ttsCfg.Provider = "espeak"
		case "pico":
			voice := ttsEffective.Voice
			if voice == "" {
				voice = "zh-CN" // default to Chinese (Simplified)
			}
			ttsCfg.TTS = core.NewPicoTTS("", voice)
			ttsCfg.Provider = "pico"
		case "edge":
			voice := ttsEffective.Voice
			if voice == "" {
				voice = "zh-CN-XiaoxiaoNeural" // default Chinese neural voice
			}
			ttsCfg.TTS = core.NewEdgeTTS(voice)
			ttsCfg.Provider = "edge"
		default: // "openai" or unspecified
			apiKey := cfg.TTS.OpenAI.APIKey
			baseURL := cfg.TTS.OpenAI.BaseURL
			model := cfg.TTS.OpenAI.Model
			if apiKey != "" {
				ttsCfg.TTS = core.NewOpenAITTS(apiKey, baseURL, model, nil)
				ttsCfg.Provider = "openai"
			} else {
				slog.Warn("tts: openai provider enabled but api_key is empty")
			}
		}
		if ttsCfg.TTS != nil {
			engine.SetTTSConfig(ttsCfg)
			engine.SetTTSSaveFunc(func(mode string) error {
				return config.SaveTTSMode(mode)
			})
			slog.Info("tts: enabled", "provider", ttsCfg.Provider, "voice", ttsCfg.Voice, "mode", initMode)
		}
	}

	// Set up save callback for auto-detected language
	if lang == core.LangAuto {
		engine.SetLanguageSaveFunc(func(l core.Language) error {
			return config.SaveLanguage(string(l))
		})
	}

	// Set up save callbacks for provider management
	projName := proj.Name
	engine.SetProviderSaveFunc(func(providerName string) error {
		return config.SaveActiveProvider(projName, providerName)
	})
	engine.SetProviderAddSaveFunc(func(p core.ProviderConfig) error {
		cp := config.ProviderConfig{
			Name: p.Name, APIKey: p.APIKey, BaseURL: p.BaseURL,
			Model: p.Model, Models: convertCoreModels(p.Models), Thinking: p.Thinking, Env: p.Env,
		}
		if p.CodexWireAPI != "" || len(p.CodexHTTPHeaders) > 0 {
			cp.Codex = &config.CodexProviderConfig{
				WireAPI: p.CodexWireAPI, HTTPHeaders: p.CodexHTTPHeaders,
			}
		}
		return config.AddProviderToConfig(projName, cp)
	})
	engine.SetProviderRemoveSaveFunc(func(name string) error {
		return config.RemoveProviderFromConfig(projName, name)
	})
	engine.SetProviderModelSaveFunc(func(providerName, model string) error {
		return config.SaveProviderModel(projName, providerName, model)
	})
	engine.SetProviderRefsSaveFunc(func(refs []string) error {
		return config.SaveProviderRefs(projName, refs)
	})
	engine.SetListGlobalProvidersFunc(func(agentType string) ([]core.ProviderConfig, error) {
		globals, err := config.ListGlobalProviders()
		if err != nil {
			return nil, err
		}
		var result []core.ProviderConfig
		for _, g := range globals {
			if len(g.AgentTypes) > 0 && !containsString(g.AgentTypes, agentType) {
				continue
			}
			result = append(result, configProviderToCore(g.ResolveForAgent(agentType)))
		}
		return result, nil
	})
	engine.SetModelSaveFunc(func(model string) error {
		return config.SaveAgentModel(projName, model)
	})
	engine.SetReasoningEffortSaveFunc(func(effort string) error {
		return config.SaveAgentReasoningEffort(projName, effort)
	})

	// Wire config reload
	capturedEngine := engine
	capturedProjName := projName
	startedPlatformOpts := platformOptsByType(proj.Platforms)
	engine.SetConfigReloadFunc(func() (*core.ConfigReloadResult, error) {
		return reloadConfig(configPath, capturedProjName, capturedEngine, startedPlatformOpts)
	})

	// Wire /web command callbacks
	engine.SetWebSetupFunc(func() (int, string, bool, error) {
		mgmtToken := core.GenerateToken(16)
		bridgeToken := core.GenerateToken(16)
		result, err := config.EnableWebAdmin(mgmtToken, bridgeToken)
		if err != nil {
			return 0, "", false, err
		}
		return result.ManagementPort, result.ManagementToken, !result.AlreadyEnabled, nil
	})
	engine.SetWebStatusFunc(func() string {
		if cfg.Management.Enabled == nil || !*cfg.Management.Enabled {
			return ""
		}
		port := cfg.Management.Port
		if port == 0 {
			port = 9820
		}
		return fmt.Sprintf("http://localhost:%d", port)
	})
	b.workDir = effectiveWorkDir
	return b, nil
}

func runTopLevelCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	handler, ok := topLevelCommandHandlers[args[0]]
	if !ok {
		return false
	}
	handler(args[1:])
	return true
}

// rootConfigPath is the root --config flag, for subcommands that must find their own instance
// (`bothouse --config X update`).
var rootConfigPath string

type rootCLIOptions struct {
	headless       bool
	configPath     string
	force          bool
	observe        bool
	observeChannel string
	logMaxSize     string
	logMaxBackups  int
	showVersion    bool
	args           []string
}

func parseRootCLIOptions(args []string) (rootCLIOptions, error) {
	fs := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	fs.Usage = printUsage

	headless := fs.Bool("headless", false, "run without a desktop tray icon")
	configPath := fs.String("config", "", "path to config file (default: ./config.toml or ~/.bothouse/config.toml)")
	force := fs.Bool("force", false, "kill any existing instance with the same config before starting")
	observe := fs.Bool("observe", false, "observe native terminal Claude Code sessions and forward to Slack")
	observeChannel := fs.String("observe-channel", "", "Slack channel ID to forward terminal observations to (requires --observe)")
	logMaxSize := fs.String("log-max-size", "", "max bytes for the rotating log file (e.g. 10MB, 512K, 10485760); overrides CC_LOG_MAX_SIZE env var (default: 10MB)")
	logMaxBackups := fs.Int("log-max-backups", 0, "number of rotated log files to retain (.log.1 .. .log.N); overrides CC_LOG_MAX_BACKUPS env var (default: 3)")
	showVersion := fs.Bool("version", false, "print version and exit")

	if err := fs.Parse(args); err != nil {
		return rootCLIOptions{}, err
	}

	return rootCLIOptions{
		headless:       *headless,
		configPath:     *configPath,
		force:          *force,
		observe:        *observe,
		observeChannel: *observeChannel,
		logMaxSize:     *logMaxSize,
		logMaxBackups:  *logMaxBackups,
		showVersion:    *showVersion,
		args:           fs.Args(),
	}, nil
}

func validateNoExtraTopLevelArgs(args []string) error {
	if len(args) == 0 {
		return nil
	}
	return fmt.Errorf("unknown top-level command: %s", args[0])
}

// sessionStorePath builds a unique filename from project name + work_dir.
// It checks for legacy session files (without the sessions/ subdirectory) in dataDir
// for backward compatibility; if found, uses that path. Otherwise uses dataDir/sessions/.
func sessionStorePath(dataDir, name, workDir string) string {
	var filename string
	if workDir == "" {
		filename = name + ".json"
	} else {
		abs, err := filepath.Abs(workDir)
		if err != nil {
			abs = workDir
		}
		h := sha256.Sum256([]byte(abs))
		short := hex.EncodeToString(h[:4])
		filename = fmt.Sprintf("%s_%s.json", name, short)
	}

	// Check legacy path in dataDir (without sessions/ subdirectory) for backward compatibility.
	// Also check for the older .sessions.json naming convention.
	for _, legacy := range []string{
		filepath.Join(dataDir, filename),
		filepath.Join(dataDir, strings.TrimSuffix(filename, ".json")+".sessions.json"),
	} {
		if _, err := os.Stat(legacy); err == nil {
			slog.Info("session: using legacy file in dataDir", "path", legacy)
			return legacy
		}
	}

	return filepath.Join(dataDir, "sessions", filename)
}

func projectStatePath(dataDir, projectName string) string {
	replacer := strings.NewReplacer(
		"\\", "_",
		"/", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	name := strings.TrimSpace(projectName)
	name = replacer.Replace(name)
	if name == "" {
		name = "project"
	}
	return filepath.Join(dataDir, "projects", name+".state.json")
}

func applyProjectStateOverride(projectName string, agent core.Agent, configuredWorkDir string, store *core.ProjectStateStore) string {
	effectiveWorkDir := configuredWorkDir
	if store == nil {
		return effectiveWorkDir
	}

	switcher, ok := agent.(core.WorkDirSwitcher)
	if !ok {
		return effectiveWorkDir
	}

	override := store.WorkDirOverride()
	if override == "" {
		return effectiveWorkDir
	}
	if abs, err := filepath.Abs(override); err == nil {
		override = abs
	}

	info, err := os.Stat(override)
	if err != nil || !info.IsDir() {
		slog.Warn("project_state: ignoring invalid work_dir override", "project", projectName, "work_dir", override)
		return effectiveWorkDir
	}

	switcher.SetWorkDir(override)
	slog.Info("project_state: applied work_dir override", "project", projectName, "work_dir", override)
	return override
}

// resolveClaudeProjectDir returns the Claude Code project directory for a given
// work directory, or "" if it doesn't exist.
func resolveClaudeProjectDir(workDir string) string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	// Claude Code encodes paths by replacing os.PathSeparator with "-"
	// e.g. /home/leigh/workspace/cc-connect -> -home-leigh-workspace-cc-connect
	encoded := strings.ReplaceAll(workDir, string(os.PathSeparator), "-")
	dir := filepath.Join(homeDir, ".claude", "projects", encoded)
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return ""
	}
	return dir
}

// resolveConfigPath determines which config file to use.
// Priority: explicit flag → ./config.toml → ~/.cc-connect/config.toml
func resolveConfigPath(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if _, err := os.Stat("config.toml"); err == nil {
		return "config.toml"
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(ccconnect.DataDir(home), "config.toml")
	}
	return "config.toml"
}

func printUsage() {
	v := version
	if v == "" || v == "dev" {
		v = "dev"
	}

	// 检查是否有新版本可用并显示提示
	updateHint := getUpdateHintIfAvailable()

	fmt.Fprintf(os.Stderr, `
  bothouse %s%s

  Bridge your messaging platforms to local AI coding agents.
  Supports: Claude Code, Codex, Cursor, Gemini CLI, Qoder CLI, OpenCode
  Platforms: Feishu, TuiTui, Telegram, Slack, DingTalk, Discord, LINE, WeChat Work, Weixin, QQ, QQ Bot

  bothouse: https://github.com/zuiho-kai/bothouse (docs/GETTING_STARTED.md)

Usage:
  bothouse [flags]
  bothouse <command> [args]

Flags:
  --config <path>    Path to config file (default: ./config.toml or ~/.bothouse/config.toml)
  --headless         Run without a desktop tray icon
  --force            Kill any existing instance with the same config before starting
  --version          Print version and exit
  --help             Show this help message

Commands:
  setup              Configure bots (bothouse setup wizard; first run opens it in the browser)
    apply            One-shot config from JSON (for AI agents): setup apply -h lists every field
    clis             Local CLIs and whether they are logged in
    matrix           Third-party API providers × CLIs
    personas         Example personas

  web                Open the web admin (with no bots configured yet: the setup wizard)

  daemon             Manage bothouse as a background service (systemd/launchd/schtasks)
    install          Install and start the daemon service
    uninstall        Remove the daemon service
    start            Start the daemon
    stop             Stop the daemon
    restart          Restart the daemon
    status           Show daemon status
    logs             View daemon logs (-f to follow, -n N for last N lines)

  send               Send a message to an active session via internal API
                     (-m <text> | --stdin, -p <project>, -s <session>)

  cron               Manage scheduled tasks
    add              Create a scheduled task (-c <expr> --prompt <text>)
    list             List scheduled tasks
    exec             Trigger a scheduled task immediately
    del              Delete a scheduled task by ID

  sessions           Browse session history
    list             List all sessions (pipe-friendly)
    show <id>        Show session messages (-n N for last N)
  session new        Reset this agent session after the current turn (--after-turn)

  agent-sid          Print the agent session ID for the current session

  relay              Cross-project message relay
    send             Send a message to another project and get the response

  provider           Manage API providers for projects
    add              Add a provider (--project, --name, --api-key, ...)
    list             List providers (--project)
    remove           Remove a provider (--project, --name)
    import           Import providers from cc-switch

  feishu             Setup Feishu/Lark bot credentials
    setup            Smart setup (QR create or bind when --app is provided)
    new              Force QR onboarding to create a new bot
    bind             Bind existing app_id/app_secret

  tuitui             Access TuiTui history, posts, and attachments
    messages         Read chat history
    search           Search chat history
    post             Post a channel message
    download         Download a message attachment

  weixin             Setup Weixin personal (ilink) via QR or token
    setup            QR login, or bind when --token is provided
    new              Force QR login
    bind             Bind existing ilink bot token

  config             Manage configuration
    example          Print a complete annotated config.toml example
    format           Format the config file (alias: fmt)
    path             Print the resolved config file path

  update             Check for updates and upgrade the binary (--pre for beta)
  check-update       Check if a newer version is available
  config-example     (deprecated: use 'config example' instead)

Examples:
  bothouse                          Start (no config yet: opens the setup wizard)
  bothouse setup apply --json r.json  Configure bots from a JSON request
  bothouse --config /path/to.toml   Start with a specific config file
  bothouse daemon install           Install as a system service
  bothouse daemon logs -f           Follow daemon logs
  bothouse send -m "hello"          Send a message to the active session
  bothouse cron list                List all scheduled tasks
  bothouse feishu setup             Setup Feishu/Lark bot credentials
  bothouse weixin setup             Setup Weixin (ilink) with QR or --token
  bothouse yuanbao setup            Setup Yuanbao bot with --token app_key:app_secret
  bothouse update                   Update to the latest version
  bothouse config format            Format the config file
  bothouse config example > c.toml  Save example config to a file

`, v, updateHint)
}

func setupLogger(level string, w io.Writer) {
	var logLevel slog.Level
	switch level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}
	if w == nil {
		w = os.Stdout
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{
		Level: logLevel,
	})))
}

// reloadConfig re-reads config.toml and applies hot-reloadable settings
// (display, providers, commands) to the given engine.
// platformOptsByType keys a project's platform options by platform type.
func platformOptsByType(ps []config.PlatformConfig) map[string]map[string]any {
	out := make(map[string]map[string]any, len(ps))
	for _, p := range ps {
		out[p.Type] = p.Options
	}
	return out
}

// started is the project's platform options as the engine was built with; options a platform
// cannot take while running are reported in result.RestartKeys.
// projectTeamStatus is the team status setup (SetTeam) of proj: what config.toml says, or, when it
// sets no team_status_dir, the defaults of a team made by the setup wizard
// (core.WizardTeamDefaults), so that team's lead gets the team board and workspaces on install and
// on upgrade without editing config.toml (#587). A single role is its own lead.
func projectTeamStatus(dataDir string, proj config.ProjectConfig) (dir, name string, inject bool) {
	if proj.TeamStatusDir != "" {
		return proj.TeamStatusDir, proj.TeamName, proj.TeamStatusInject
	}
	dir, wizardName, lead, ok := core.WizardTeamDefaults(dataDir, proj.Name)
	if !ok {
		return "", proj.TeamName, proj.TeamStatusInject
	}
	name = proj.TeamName
	if name == "" {
		name = wizardName
	}
	return dir, name, lead || proj.TeamStatusInject
}

func reloadConfig(configPath, projName string, engine *core.Engine, started map[string]map[string]any) (*core.ConfigReloadResult, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, fmt.Errorf("reload config: %w", err)
	}

	result := &core.ConfigReloadResult{}

	// Re-apply process-global hot-reloadable settings.
	core.SetLocalGatePort(cfg.Gate.Port)
	if globalAPIServer != nil {
		globalAPIServer.SetMaxAttachmentSize(resolveMaxAttachmentSize(cfg))
	}

	// Find the matching project
	var proj *config.ProjectConfig
	for i := range cfg.Projects {
		if cfg.Projects[i].Name == projName {
			proj = &cfg.Projects[i]
			break
		}
	}
	if proj == nil {
		return nil, fmt.Errorf("project %q not found in config", projName)
	}

	// Reload display config (includes legacy quiet → display mapping)
	mode, tm, tool, tmlen, toollen, showCtx, showFooter, hideAgentFooter := config.EffectiveDisplay(cfg, proj)
	historyMaxLen := config.EffectiveHistoryMaxLen(cfg, proj)
	engine.SetDisplayConfig(core.DisplayCfg{
		Mode:             mode,
		CardMode:         config.EffectiveCardMode(cfg, proj),
		ThinkingMessages: tm,
		ThinkingMaxLen:   tmlen,
		ToolMaxLen:       toollen,
		ToolMessages:     tool,
		HistoryMaxLen:    &historyMaxLen,
		HideAgentFooter:  hideAgentFooter,
	})
	result.DisplayUpdated = true

	// Wire show_context_indicator and reply_footer from display config
	engine.SetShowContextIndicator(showCtx)
	showWorkdir := true
	if proj.ShowWorkdirIndicator != nil {
		showWorkdir = *proj.ShowWorkdirIndicator
	}
	engine.SetShowWorkdirIndicator(showWorkdir)
	engine.SetShowQuotaIndicator(proj.ShowQuotaIndicator == nil || *proj.ShowQuotaIndicator)
	engine.SetShowQuotaStatus(proj.ShowQuotaStatus == nil || *proj.ShowQuotaStatus)
	engine.SetSubagentPolicyEnabled(proj.InjectSubagentPolicy == nil || *proj.InjectSubagentPolicy)
	engine.SetAgentIdentityEnabled(proj.AgentIdentityEnabled())
	engine.SetReplyFooterEnabled(showFooter)

	// Reload auto-compress settings
	if proj.AutoCompress.Enabled != nil && *proj.AutoCompress.Enabled {
		minGap := 30 * time.Minute
		if proj.AutoCompress.MinGapMins != nil {
			minGap = time.Duration(*proj.AutoCompress.MinGapMins) * time.Minute
		}
		maxTokens := derefInt(proj.AutoCompress.MaxTokens)
		if maxTokens <= 0 {
			maxTokens = 12000
		}
		engine.SetAutoCompressConfig(true, maxTokens, minGap)
	} else {
		engine.SetAutoCompressConfig(false, 0, 0)
	}
	wireColdCacheFresh(engine, *proj)
	wireImageFresh(engine, *proj)
	engine.SetSessionModels(proj.SessionModels)
	engine.SetSessionInstructions(proj.SessionInstructions)
	engine.SetGate(proj.GateURL, proj.GateTimeoutMs, proj.GateFallback)
	engine.SetGateLocal(proj.GateLocalEnabled())
	engine.SetGateBurstWindow(proj.GateBurstWindowMs)
	engine.SetModelTiers(proj.ChatModel, proj.TaskModel, proj.ChatEffort, proj.TaskEffort, proj.ModelTierStickyMins)
	engine.SetTeam(projectTeamStatus(cfg.DataDir, *proj))
	engine.SetChannelBoard(proj.ChannelBoard)
	engine.SetMemoryIndex(proj.MemoryIndex)
	engine.SetTeamBoard(proj.TeamBoardEnabled())
	engine.SetTeamWorkspaces(proj.TeamWorkspacesEnabled())
	engine.SetDispatchMode(proj.DispatchMode)
	engine.SetVoiceDesk(proj.VoiceDesk)
	resetIdle, defaulted := resolveResetOnIdle(proj.ResetOnIdleMins)
	engine.SetResetOnIdle(resetIdle)
	if defaulted {
		slog.Info("project: reset_on_idle_mins not set, applying default — set reset_on_idle_mins = 0 to opt out, see docs/usage.md",
			"project", proj.Name, "default_minutes", defaultResetOnIdleMins)
	}
	if proj.AgentSessionIdleTimeoutMins != nil {
		mins := *proj.AgentSessionIdleTimeoutMins
		if mins <= 0 {
			engine.SetAgentSessionIdleTimeout(0)
		} else {
			engine.SetAgentSessionIdleTimeout(time.Duration(mins) * time.Minute)
		}
	} else {
		// A reload may remove this option after timers were scheduled; reset
		// explicitly so those stale idle-close timers cannot fire later.
		engine.SetAgentSessionIdleTimeout(0)
	}

	// Reload instant reply
	if cfg.InstantReply.Enabled != nil && *cfg.InstantReply.Enabled {
		engine.SetInstantReply(core.InstantReplyCfg{
			Enabled: true,
			Content: cfg.InstantReply.Content,
		})
	} else {
		engine.SetInstantReply(core.InstantReplyCfg{})
	}

	// Reload sender injection
	engine.SetInjectSender(proj.InjectSender != nil && *proj.InjectSender)

	// Reload attachment send-back switch
	engine.SetAttachmentSendEnabled(cfg.AttachmentSend != "off")

	// Reload filter_external_sessions
	engine.SetFilterExternalSessions(proj.FilterExternalSessions != nil && *proj.FilterExternalSessions)

	// Reload providers
	if ps, ok := engine.GetAgent().(core.ProviderSwitcher); ok {
		providers := make([]core.ProviderConfig, len(proj.Agent.Providers))
		for i, p := range proj.Agent.Providers {
			providers[i] = configProviderToCore(p)
		}
		ps.SetProviders(providers)
		result.ProvidersUpdated = len(providers)

		if active, _ := proj.Agent.Options["provider"].(string); active != "" {
			ps.SetActiveProvider(active)
		}
	}

	// Reload custom commands
	engine.ClearCommands("config")
	for _, c := range cfg.Commands {
		engine.AddCommand(c.Name, c.Description, c.Prompt, c.Exec, c.WorkDir, "config")
	}
	result.CommandsUpdated = len(cfg.Commands)

	// Reload aliases
	engine.ClearAliases()
	for _, a := range cfg.Aliases {
		engine.AddAlias(a.Name, a.Command)
	}

	// Reload banned words
	engine.SetBannedWords(cfg.BannedWords)

	// Reload disabled commands
	engine.SetDisabledCommands(proj.DisabledCommands)

	// Reload admin allowlist
	engine.SetAdminFrom(proj.AdminFrom)

	// Reload per-user role-based policies
	if proj.Users != nil {
		engine.SetUserRoles(buildUserRoleManager(proj.Users))
	} else {
		engine.SetUserRoles(nil)
	}

	slog.Info("config reloaded", "project", projName)
	// platform options the setup wizard rewrites on running roles (allow_bots, team_lead_bot, …)
	result.RestartKeys = engine.ReloadPlatformOptions(platformOptsByType(proj.Platforms), started)
	return result, nil
}

func buildUserRoleManager(uc *config.UsersConfig) *core.UserRoleManager {
	var roles []core.RoleInput
	for name, rc := range uc.Roles {
		var rlCfg *core.RateLimitCfg
		if rc.RateLimit != nil {
			maxMsg, windowSecs := 20, 60
			if rc.RateLimit.MaxMessages != nil {
				maxMsg = *rc.RateLimit.MaxMessages
			}
			if rc.RateLimit.WindowSecs != nil {
				windowSecs = *rc.RateLimit.WindowSecs
			}
			rlCfg = &core.RateLimitCfg{
				MaxMessages: maxMsg,
				Window:      time.Duration(windowSecs) * time.Second,
			}
		}
		roles = append(roles, core.RoleInput{
			Name:             name,
			UserIDs:          rc.UserIDs,
			DisabledCommands: rc.DisabledCommands,
			RateLimit:        rlCfg,
		})
	}
	defaultRole := "member"
	if uc.DefaultRole != "" {
		defaultRole = uc.DefaultRole
	}
	urm := core.NewUserRoleManager()
	urm.Configure(defaultRole, roles)
	return urm
}

func configProviderToCore(p config.ProviderConfig) core.ProviderConfig {
	c := core.ProviderConfig{
		Name: p.Name, APIKey: p.APIKey, BaseURL: p.BaseURL,
		Model: p.Model, Models: convertProviderModels(p.Models),
		Thinking: p.Thinking, Env: p.Env, APIFormat: p.APIFormat,
	}
	if p.Codex != nil {
		c.CodexWireAPI = p.Codex.WireAPI
		c.CodexHTTPHeaders = p.Codex.HTTPHeaders
	}
	return c
}

func convertProviderModels(ms []config.ProviderModelConfig) []core.ModelOption {
	if len(ms) == 0 {
		return nil
	}
	opts := make([]core.ModelOption, len(ms))
	for i, m := range ms {
		opts[i] = core.ModelOption{Name: m.Model, Alias: m.Alias}
	}
	return opts
}

func buildAgentOptions(dataDir string, proj config.ProjectConfig) map[string]any {
	opts := make(map[string]any, len(proj.Agent.Options)+2)
	for k, v := range proj.Agent.Options {
		opts[k] = v
	}
	opts["cc_data_dir"] = dataDir
	opts["cc_project"] = proj.Name
	return opts
}

func wireAgentProviders(agent core.Agent, agentCfg config.AgentConfig) providerWiringResult {
	result := providerWiringResult{canStartInitialRefresh: true}
	active, _ := agentCfg.Options["provider"].(string)
	result.explicitProviderRequested = active != ""

	ps, ok := agent.(core.ProviderSwitcher)
	if !ok || len(agentCfg.Providers) == 0 {
		return result
	}

	providers := make([]core.ProviderConfig, len(agentCfg.Providers))
	for i, p := range agentCfg.Providers {
		providers[i] = configProviderToCore(p)
	}
	ps.SetProviders(providers)
	if result.explicitProviderRequested {
		result.activeProviderApplied = ps.SetActiveProvider(active)
		result.canStartInitialRefresh = result.activeProviderApplied
	}
	return result
}

func startInitialRefreshIfReady(agent core.Agent, result providerWiringResult) {
	if !result.canStartInitialRefresh {
		return
	}
	if starter, ok := agent.(initialModelRefreshStarter); ok {
		starter.StartInitialModelRefresh()
	}
}

func configProviderToGlobal(p config.ProviderConfig) core.GlobalProviderInfo {
	info := core.GlobalProviderInfo{
		Name:        p.Name,
		APIKey:      p.APIKey,
		BaseURL:     p.BaseURL,
		Model:       p.Model,
		Thinking:    p.Thinking,
		Env:         p.Env,
		AgentTypes:  p.AgentTypes,
		Endpoints:   p.Endpoints,
		AgentModels: p.AgentModels,
	}
	for _, m := range p.Models {
		info.Models = append(info.Models, struct {
			Model string `json:"model"`
			Alias string `json:"alias,omitempty"`
		}{Model: m.Model, Alias: m.Alias})
	}
	if len(p.AgentModelLists) > 0 {
		info.AgentModelLists = make(map[string][]core.GlobalModelEntry, len(p.AgentModelLists))
		for at, ml := range p.AgentModelLists {
			entries := make([]core.GlobalModelEntry, len(ml))
			for i, m := range ml {
				entries[i] = core.GlobalModelEntry{Model: m.Model, Alias: m.Alias}
			}
			info.AgentModelLists[at] = entries
		}
	}
	if p.Codex != nil {
		info.Codex = &core.GlobalCodexConfig{
			WireAPI:     p.Codex.WireAPI,
			HTTPHeaders: p.Codex.HTTPHeaders,
		}
	}
	return info
}

func globalProviderToConfig(info core.GlobalProviderInfo) config.ProviderConfig {
	p := config.ProviderConfig{
		Name:        info.Name,
		APIKey:      info.APIKey,
		BaseURL:     info.BaseURL,
		Model:       info.Model,
		Thinking:    info.Thinking,
		Env:         info.Env,
		AgentTypes:  info.AgentTypes,
		Endpoints:   info.Endpoints,
		AgentModels: info.AgentModels,
	}
	for _, m := range info.Models {
		p.Models = append(p.Models, config.ProviderModelConfig{Model: m.Model, Alias: m.Alias})
	}
	if len(info.AgentModelLists) > 0 {
		p.AgentModelLists = make(map[string][]config.ProviderModelConfig, len(info.AgentModelLists))
		for at, ml := range info.AgentModelLists {
			entries := make([]config.ProviderModelConfig, len(ml))
			for i, m := range ml {
				entries[i] = config.ProviderModelConfig{Model: m.Model, Alias: m.Alias}
			}
			p.AgentModelLists[at] = entries
		}
	}
	if info.Codex != nil {
		p.Codex = &config.CodexProviderConfig{
			WireAPI:     info.Codex.WireAPI,
			HTTPHeaders: info.Codex.HTTPHeaders,
		}
	}
	return p
}

func convertCoreModels(ms []core.ModelOption) []config.ProviderModelConfig {
	if len(ms) == 0 {
		return nil
	}
	out := make([]config.ProviderModelConfig, len(ms))
	for i, m := range ms {
		out[i] = config.ProviderModelConfig{Model: m.Name, Alias: m.Alias}
	}
	return out
}

func buildHeartbeatConfig(hc config.HeartbeatConfig) core.HeartbeatConfig {
	cfg := core.HeartbeatConfig{
		IntervalMins: 30,
		OnlyWhenIdle: true,
		Silent:       true,
		TimeoutMins:  30,
		SessionKey:   hc.SessionKey,
		Prompt:       hc.Prompt,
	}
	if hc.Enabled != nil {
		cfg.Enabled = *hc.Enabled
	}
	if hc.IntervalMins != nil {
		cfg.IntervalMins = *hc.IntervalMins
	}
	if hc.OnlyWhenIdle != nil {
		cfg.OnlyWhenIdle = *hc.OnlyWhenIdle
	}
	if hc.Silent != nil {
		cfg.Silent = *hc.Silent
	}
	if hc.TimeoutMins != nil {
		cfg.TimeoutMins = *hc.TimeoutMins
	}
	return cfg
}

func derefInt(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

// wireImageFresh applies [projects.image_fresh] (maomao fork).
func wireImageFresh(engine *core.Engine, proj config.ProjectConfig) {
	c := proj.ImageFresh
	if c.Enabled == nil || !*c.Enabled {
		engine.SetImageFresh(false, 0)
		return
	}
	mb := core.DefaultImageFreshMB // source: see its comment in core/backfill.go
	if c.MaxMB != nil && *c.MaxMB > 0 {
		mb = *c.MaxMB
	}
	engine.SetImageFresh(true, int(mb*1e6))
}

// coldCacheFreshSettings resolves [projects.cold_cache_fresh] (maomao fork).
// On unless enabled = false; defaults 60 min idle / 80000 tokens come from the
// maomao fork settings the user chose on 2026-10-14 (~/.cc-connect/config.toml
// [projects.cold_cache_fresh]: enabled=true, idle_mins=60, min_tokens=80000).
func coldCacheFreshSettings(c config.ColdCacheFreshConfig) (enabled bool, idleMins, minTokens int) {
	if c.Enabled != nil && !*c.Enabled {
		return false, 0, 0
	}
	idleMins, minTokens = 60, 80000 // source: see comment above (user, 2026-10-14)
	if c.IdleMins != nil && *c.IdleMins > 0 {
		idleMins = *c.IdleMins
	}
	if c.MinTokens != nil && *c.MinTokens > 0 {
		minTokens = *c.MinTokens
	}
	return true, idleMins, minTokens
}

// wireColdCacheFresh applies [projects.cold_cache_fresh] (maomao fork).
func wireColdCacheFresh(engine *core.Engine, proj config.ProjectConfig) {
	enabled, idle, minTokens := coldCacheFreshSettings(proj.ColdCacheFresh)
	if !enabled {
		engine.SetColdCacheFresh(false, 0, 0)
		return
	}
	if t := proj.AgentSessionIdleTimeoutMins; t != nil && *t > idle {
		slog.Warn("cold_cache_fresh: idle_mins is below agent_session_idle_timeout_mins; a still-running process is reused without the check",
			"project", proj.Name, "idle_mins", idle, "agent_session_idle_timeout_mins", *t)
	}
	engine.SetColdCacheFresh(true, time.Duration(idle)*time.Minute, minTokens)
}

// pluginUsageLogSources holds sources of agents compiled in by build tag.
var pluginUsageLogSources []core.UsageLogSource

// usageLogSources lists the CLI session logs the usage page reads.
func usageLogSources(projects []config.ProjectConfig) []core.UsageLogSource {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	claudeDir := filepath.Join(home, ".claude")
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		claudeDir = d
	}
	codexHome := filepath.Join(home, ".codex")
	if d := os.Getenv("CODEX_HOME"); d != "" {
		codexHome = d
	}
	return append([]core.UsageLogSource{
		core.ClaudeCodeUsageSource{Dir: filepath.Join(claudeDir, "projects")},
		core.CodexUsageSource{Home: codexHome},
		&core.DSHUsageSource{Homes: dshUsageHomes(home, projects)},
	}, pluginUsageLogSources...)
}

// dshUsageHomes: $DSH_HOME (else ~/.dsh, DSH's default) plus every DSH_HOME a role sets in its agent env.
func dshUsageHomes(home string, projects []config.ProjectConfig) []string {
	def := os.Getenv("DSH_HOME")
	if def == "" {
		def = filepath.Join(home, ".dsh")
	}
	homes := []string{def}
	for _, p := range projects {
		if h := core.DSHHomeFromOptions(p.Agent.Options); h != "" {
			homes = append(homes, expandHome(h))
		}
	}
	return homes
}
