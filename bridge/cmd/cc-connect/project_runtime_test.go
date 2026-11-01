package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// ── fakes: an agent and a platform that do nothing; platform option fail_start makes Start fail ─────

type hotFakeAgent struct{}

func (hotFakeAgent) Name() string { return "hotfake" }
func (hotFakeAgent) StartSession(context.Context, string) (core.AgentSession, error) {
	return nil, errors.New("not used")
}
func (hotFakeAgent) ListSessions(context.Context) ([]core.AgentSessionInfo, error) { return nil, nil }
func (hotFakeAgent) Stop() error                                                   { return nil }

type hotFakePlatform struct {
	project   string
	failStart bool
	mu        sync.Mutex
	started   bool
	stopped   bool
}

func (p *hotFakePlatform) Name() string { return "hotfake" }
func (p *hotFakePlatform) Start(core.MessageHandler) error {
	if p.failStart {
		return errors.New("listen tcp :8099: bind: address already in use")
	}
	p.mu.Lock()
	p.started = true
	p.mu.Unlock()
	return nil
}
func (p *hotFakePlatform) Reply(context.Context, any, string) error { return nil }
func (p *hotFakePlatform) Send(context.Context, any, string) error  { return nil }
func (p *hotFakePlatform) Stop() error {
	p.mu.Lock()
	p.stopped = true
	p.mu.Unlock()
	return nil
}

var (
	hotFakeMu        sync.Mutex
	hotFakePlatforms []*hotFakePlatform
	hotFakeOnce      sync.Once
)

func registerHotFakes() {
	hotFakeOnce.Do(func() {
		core.RegisterAgent("hotfake", func(map[string]any) (core.Agent, error) { return hotFakeAgent{}, nil })
		core.RegisterPlatform("hotfake", func(opts map[string]any) (core.Platform, error) {
			fail, _ := opts["fail_start"].(bool)
			proj, _ := opts["cc_project"].(string)
			p := &hotFakePlatform{project: proj, failStart: fail}
			hotFakeMu.Lock()
			hotFakePlatforms = append(hotFakePlatforms, p)
			hotFakeMu.Unlock()
			return p, nil
		})
	})
}

func hotFakePlatformsOf(project string) []*hotFakePlatform {
	hotFakeMu.Lock()
	defer hotFakeMu.Unlock()
	var out []*hotFakePlatform
	for _, p := range hotFakePlatforms {
		if p.project == project {
			out = append(out, p)
		}
	}
	return out
}

// hotProject: one [[projects]] block. agentType "" = hotfake.
func hotProject(name, agentType string, failStart bool) string {
	if agentType == "" {
		agentType = "hotfake"
	}
	return fmt.Sprintf(`
[[projects]]
name = %q
reset_on_idle_mins = 0
[projects.agent]
type = %q
[projects.agent.options]
work_dir = "/tmp"
[[projects.platforms]]
type = "hotfake"
[projects.platforms.options]
fail_start = %v
`, name, agentType, failStart)
}

// newHotRuntime: a runtime as startup leaves it, with `running` already started from the config
// that holds it, and a management server to register with (not listening).
func newHotRuntime(t *testing.T, running string) (*projectRuntime, string) {
	t.Helper()
	registerHotFakes()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	cfgPath := filepath.Join(dir, "config.toml")
	head := fmt.Sprintf("data_dir = %q\n", filepath.Join(dir, "data"))
	writeHotConfig(t, cfgPath, head+hotProject(running, "", false))

	rt := newProjectRuntime(cfgPath, rootCLIOptions{})
	rt.readyTimeout = func() time.Duration { return time.Second }
	rt.mgmtSrv = core.NewManagementServer(0, "test-token", nil)
	rt.hbSched = core.NewHeartbeatScheduler(filepath.Join(dir, "data"))
	cfg, err := rt.loadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	b, err := buildProject(cfg, cfgPath, rootCLIOptions{}, cfg.Projects[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := b.engine.Start(); err != nil {
		t.Fatal(err)
	}
	rt.addRunning(running, b.engine)
	rt.registerManagement(running, b.engine)
	rt.setReady(true)
	t.Cleanup(func() {
		for _, e := range rt.stopAccepting() {
			_ = e.Stop()
		}
	})
	return rt, head
}

func writeHotConfig(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestHotLoadStartsAddedProject(t *testing.T) {
	rt, head := newHotRuntime(t, "hot-old")
	old := rt.engines["hot-old"]
	writeHotConfig(t, rt.configPath, head+hotProject("hot-old", "", false)+hotProject("hot-new", "", false))

	res := rt.HotLoad()
	if res.Error != "" || len(res.Failed) != 0 {
		t.Fatalf("unexpected failure: %+v", res)
	}
	if len(res.Added) != 1 || res.Added[0] != "hot-new" {
		t.Fatalf("added = %v, want [hot-new]", res.Added)
	}
	if rt.engines["hot-old"] != old {
		t.Fatal("the running project's engine was replaced")
	}
	if rt.engines["hot-new"] == nil {
		t.Fatal("hot-new is not recorded as running")
	}
	ps := hotFakePlatformsOf("hot-new")
	if len(ps) != 1 || !ps[0].started || ps[0].stopped {
		t.Fatalf("hot-new platform not started cleanly: %+v", ps)
	}
	if len(rt.stopAccepting()) != 2 {
		t.Fatal("shutdown would not stop the hot-loaded engine")
	}
}

func TestHotLoadFailedProjectLeavesNothingRunning(t *testing.T) {
	rt, head := newHotRuntime(t, "hotf-old")
	writeHotConfig(t, rt.configPath, head+hotProject("hotf-old", "", false)+hotProject("hotf-bad", "", true))

	res := rt.HotLoad()
	if len(res.Added) != 0 {
		t.Fatalf("added = %v, want none", res.Added)
	}
	if !strings.Contains(res.Failed["hotf-bad"], "address already in use") {
		t.Fatalf("failed = %v, want the start error for hotf-bad", res.Failed)
	}
	if _, ok := rt.engines["hotf-bad"]; ok {
		t.Fatal("failed project is recorded as running")
	}
	for _, p := range hotFakePlatformsOf("hotf-bad") {
		if !p.stopped {
			t.Fatal("failed project's platform was not stopped")
		}
	}
	if rt.engines["hotf-old"] == nil {
		t.Fatal("the running project was dropped")
	}
}

func TestHotLoadSkipsRunningProject(t *testing.T) {
	rt, _ := newHotRuntime(t, "hots-old")
	old := rt.engines["hots-old"]
	before := len(hotFakePlatformsOf("hots-old"))

	res := rt.HotLoad() // config unchanged: the only project is already running
	if len(res.Added) != 0 || len(res.Failed) != 0 || res.Error != "" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if rt.engines["hots-old"] != old {
		t.Fatal("running engine was replaced")
	}
	if got := len(hotFakePlatformsOf("hots-old")); got != before {
		t.Fatalf("a second platform was built for the running project (%d → %d)", before, got)
	}
}

func TestHotLoadOneFailsOtherComesOnline(t *testing.T) {
	rt, head := newHotRuntime(t, "hotm-old")
	writeHotConfig(t, rt.configPath, head+hotProject("hotm-old", "", false)+
		hotProject("hotm-bad", "no-such-agent", false)+hotProject("hotm-good", "", false))

	res := rt.HotLoad()
	if len(res.Added) != 1 || res.Added[0] != "hotm-good" {
		t.Fatalf("added = %v, want [hotm-good]", res.Added)
	}
	if !strings.Contains(res.Failed["hotm-bad"], "no-such-agent") {
		t.Fatalf("failed = %v, want the agent error for hotm-bad", res.Failed)
	}
	if rt.engines["hotm-good"] == nil {
		t.Fatal("hotm-good is not running")
	}
	if _, ok := rt.engines["hotm-bad"]; ok {
		t.Fatal("hotm-bad is recorded as running")
	}
}

func TestHotRemoveStopsProjectOthersKeepRunning(t *testing.T) {
	rt, head := newHotRuntime(t, "hotr-keep")
	keep := rt.engines["hotr-keep"]
	writeHotConfig(t, rt.configPath, head+hotProject("hotr-keep", "", false)+hotProject("hotr-gone", "", false))
	if res := rt.HotLoad(); len(res.Added) != 1 {
		t.Fatalf("setup: hot load = %+v", res)
	}
	writeHotConfig(t, rt.configPath, head+hotProject("hotr-keep", "", false))

	if err := rt.HotRemove("hotr-gone"); err != nil {
		t.Fatalf("hot remove: %v", err)
	}
	if _, ok := rt.engines["hotr-gone"]; ok {
		t.Fatal("removed project is still recorded as running")
	}
	for _, p := range hotFakePlatformsOf("hotr-gone") {
		if !p.stopped {
			t.Fatal("removed project's platform was not stopped")
		}
	}
	if rt.engines["hotr-keep"] != keep {
		t.Fatal("the other project's engine was replaced")
	}
	for _, p := range hotFakePlatformsOf("hotr-keep") {
		if p.stopped {
			t.Fatal("the other project's platform was stopped")
		}
	}
	if all := rt.stopAccepting(); len(all) != 1 || all[0] != keep {
		t.Fatalf("shutdown list = %d engines, want only the kept one", len(all))
	}
	rt.setReady(true)

	// the same name can be added back later
	writeHotConfig(t, rt.configPath, head+hotProject("hotr-keep", "", false)+hotProject("hotr-gone", "", false))
	if res := rt.HotLoad(); len(res.Added) != 1 || res.Added[0] != "hotr-gone" {
		t.Fatalf("re-adding the removed name: %+v", res)
	}
}

func TestHotRemoveUnknownOrNotReady(t *testing.T) {
	rt, _ := newHotRuntime(t, "hotr-only")
	if err := rt.HotRemove("hotr-missing"); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("unknown project: err = %v", err)
	}
	rt.setReady(false)
	if err := rt.HotRemove("hotr-only"); err == nil || !strings.Contains(err.Error(), "starting or stopping") {
		t.Fatalf("not ready: err = %v", err)
	}
	if rt.engines["hotr-only"] == nil {
		t.Fatal("project dropped while the service was not ready")
	}
	rt.setReady(true)
}

// #812: a platform marked disabled (`module disable`) is not created; a project whose platforms
// are all disabled does not start and is not a hot-load failure.
func TestDisabledPlatformsNotStarted(t *testing.T) {
	rt, head := newHotRuntime(t, "hotd-old")
	off := strings.Replace(hotProject("hotd-off", "", false), "[[projects.platforms]]\n", "[[projects.platforms]]\ndisabled = true\n", 1)
	writeHotConfig(t, rt.configPath, head+hotProject("hotd-old", "", false)+off)

	res := rt.HotLoad()
	if len(res.Added) != 0 || len(res.Failed) != 0 || res.Error != "" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if got := hotFakePlatformsOf("hotd-off"); len(got) != 0 {
		t.Fatalf("a disabled platform was created: %+v", got)
	}
	cfg, err := rt.loadConfig(rt.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := buildProject(cfg, rt.configPath, rootCLIOptions{}, cfg.Projects[1]); !errors.Is(err, errSkipProject) {
		t.Fatalf("buildProject of an all-disabled project = %v, want errSkipProject", err)
	}

	// one of two disabled: only the other one is built
	two := hotProject("hotd-two", "", false) + "[[projects.platforms]]\ntype = \"hotfake\"\ndisabled = true\n"
	writeHotConfig(t, rt.configPath, head+hotProject("hotd-old", "", false)+two)
	if res := rt.HotLoad(); len(res.Added) != 1 {
		t.Fatalf("hot load = %+v, want hotd-two added", res)
	}
	if got := hotFakePlatformsOf("hotd-two"); len(got) != 1 {
		t.Fatalf("hotd-two built %d platforms, want 1", len(got))
	}
}
