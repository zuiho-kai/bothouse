package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// projectRuntime holds the running projects and the process-wide services each project engine is
// registered with. Startup fills it; HotLoad uses it to start projects added to config.toml later
// without a restart. A service that is not enabled stays nil and is skipped.
type projectRuntime struct {
	mu         sync.Mutex
	ready      bool // startup finished and shutdown not begun: HotLoad may run
	configPath string
	rootOpts   rootCLIOptions
	engines    map[string]*core.Engine
	all        []*core.Engine // every started engine in start order (shutdown stops them all)

	cronSched  *core.CronScheduler
	timerSched *core.TimerScheduler
	hbSched    *core.HeartbeatScheduler
	bridgeSrv  *core.BridgeServer
	webhookSrv *core.WebhookServer
	mgmtSrv    *core.ManagementServer
	apiSrv     *core.APIServer
	relayMgr   *core.RelayManager
	dirHistory *core.DirHistory

	// seams for tests
	loadConfig   func(path string) (*config.Config, error)
	build        func(cfg *config.Config, configPath string, rootOpts rootCLIOptions, proj config.ProjectConfig) (builtProject, error)
	readyTimeout func() time.Duration
}

func newProjectRuntime(configPath string, rootOpts rootCLIOptions) *projectRuntime {
	return &projectRuntime{
		configPath:   configPath,
		rootOpts:     rootOpts,
		engines:      map[string]*core.Engine{},
		loadConfig:   config.Load,
		build:        buildProject,
		readyTimeout: core.PlatformReadyTimeout,
	}
}

// addRunning records an engine built at startup.
func (rt *projectRuntime) addRunning(name string, e *core.Engine) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.all = append(rt.all, e)
	rt.engines[name] = e
}

func (rt *projectRuntime) setReady(ready bool) {
	rt.mu.Lock()
	rt.ready = ready
	rt.mu.Unlock()
}

// stopAccepting ends hot loading (shutdown) and returns every running engine, hot-loaded ones included.
func (rt *projectRuntime) stopAccepting() []*core.Engine {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.ready = false
	return append([]*core.Engine(nil), rt.all...)
}

// ── per-service registration, shared by startup and HotLoad ─────

func (rt *projectRuntime) registerCron(name string, e *core.Engine) {
	if rt.cronSched == nil {
		return
	}
	rt.cronSched.RegisterEngine(name, e)
	e.SetCronScheduler(rt.cronSched)
}

func (rt *projectRuntime) registerTimer(name string, e *core.Engine) {
	if rt.timerSched == nil {
		return
	}
	rt.timerSched.RegisterEngine(name, e)
	e.SetTimerScheduler(rt.timerSched)
}

// registerHeartbeat: running = the scheduler already started (hot loading), so the entry starts now.
func (rt *projectRuntime) registerHeartbeat(proj config.ProjectConfig, e *core.Engine, workDir string, running bool) {
	if rt.hbSched == nil {
		return
	}
	hbCfg := buildHeartbeatConfig(proj.Heartbeat)
	if hbCfg.Enabled {
		if running {
			rt.hbSched.RegisterAndStart(proj.Name, hbCfg, e, workDir)
		} else {
			rt.hbSched.Register(proj.Name, hbCfg, e, workDir)
		}
	}
	e.SetHeartbeatScheduler(rt.hbSched)
}

func (rt *projectRuntime) registerBridge(name string, e *core.Engine) {
	if rt.bridgeSrv == nil {
		return
	}
	bp := rt.bridgeSrv.NewPlatform(name)
	rt.bridgeSrv.RegisterEngine(name, e, bp)
	e.AddPlatform(bp)
}

func (rt *projectRuntime) registerWebhook(name string, e *core.Engine) {
	if rt.webhookSrv == nil {
		return
	}
	rt.webhookSrv.RegisterEngine(name, e)
}

func (rt *projectRuntime) registerManagement(name string, e *core.Engine) {
	if rt.mgmtSrv == nil {
		return
	}
	rt.mgmtSrv.RegisterEngine(name, e)
}

func (rt *projectRuntime) registerAPI(name string, e *core.Engine, workDir string) {
	if rt.apiSrv == nil {
		return
	}
	rt.apiSrv.RegisterEngine(name, e)
	e.SetRelayManager(rt.relayMgr)
	e.SetDirHistory(rt.dirHistory)

	// Ensure initial work_dir is in history
	if workDir != "" {
		if !rt.dirHistory.Contains(name, workDir) {
			rt.dirHistory.Add(name, workDir)
		}
	}
}

// wireProject registers a started hot-loaded engine with every running service, in startup's order.
func (rt *projectRuntime) wireProject(proj config.ProjectConfig, e *core.Engine, workDir string) {
	rt.registerCron(proj.Name, e)
	rt.registerTimer(proj.Name, e)
	rt.registerHeartbeat(proj, e, workDir, true)
	rt.registerBridge(proj.Name, e)
	rt.registerWebhook(proj.Name, e)
	rt.registerManagement(proj.Name, e)
	rt.registerAPI(proj.Name, e, workDir)
}

// ── hot loading ─────

// HotLoad re-reads config.toml and starts every project that is in it but not running. A project
// that is already running is left as it is (same name = skipped, even if its settings changed).
// Each new project is built, started and connected first and only then registered with the
// services, so a failure leaves nothing of it behind and does not touch the others.
func (rt *projectRuntime) HotLoad() core.HotLoadResult {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	res := core.HotLoadResult{Added: []string{}}
	if !rt.ready {
		res.Error = "the service is starting or stopping"
		return res
	}
	cfg, err := rt.loadConfig(rt.configPath)
	if err != nil {
		res.Error = fmt.Sprintf("load config: %v", err)
		return res
	}
	for _, proj := range cfg.Projects {
		if _, running := rt.engines[proj.Name]; running {
			continue
		}
		if err := rt.startProject(cfg, proj); err != nil {
			slog.Error("hot load: project not started", "project", proj.Name, "error", err)
			if res.Failed == nil {
				res.Failed = map[string]string{}
			}
			res.Failed[proj.Name] = err.Error()
			continue
		}
		slog.Info("hot load: project started", "project", proj.Name)
		res.Added = append(res.Added, proj.Name)
	}
	return res
}

// startProject: caller holds rt.mu.
func (rt *projectRuntime) startProject(cfg *config.Config, proj config.ProjectConfig) error {
	if proj.RunAsUser != "" {
		one := *cfg
		one.Projects = []config.ProjectConfig{proj}
		if err := runRunAsUserStartupChecks(context.Background(), &one); err != nil {
			return fmt.Errorf("run_as_user: %w", err)
		}
	}
	b, err := rt.build(cfg, rt.configPath, rt.rootOpts, proj)
	if err != nil {
		switch {
		case b.engine != nil:
			_ = b.engine.Stop()
		case b.agent != nil:
			_ = b.agent.Stop()
		}
		if errors.Is(err, errSkipProject) {
			return errors.New("multi-workspace base_dir could not be created")
		}
		return err
	}
	if err := b.engine.Start(); err != nil {
		_ = b.engine.Stop()
		return err
	}
	if err := b.engine.WaitPlatformsReady(rt.readyTimeout()); err != nil {
		_ = b.engine.Stop()
		return err
	}
	rt.wireProject(proj, b.engine, b.workDir)
	rt.engines[proj.Name] = b.engine
	rt.all = append(rt.all, b.engine)
	return nil
}
