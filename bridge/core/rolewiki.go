package core

// Role wikis (user 2026-10-22 「每个角色单独一个wiki……他们自己建几个就开几个wiki，这个应该也是一个默认程序。
// 夜间反思也要，这个是rsi」): every role gets <data_dir>/wikis/<project>/, kept by bridge/contrib/wiki/rolewiki.py
// with the role's own model. The wizard installs the engine into <data_dir>/rolewiki, creates one wiki per role,
// adds three global [[hooks]] (message.received / message.sent record the session, agent.closed distills it) and
// sets memory_index to the role's MEMORY.md. cc-connect runs "rolewiki.py tick" every 30 minutes (idle sessions,
// and once a day after 03:00 the nightly reflection) — no launchd/systemd/Task Scheduler, no channel needed.

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// RoleWikiConfigPath is config.toml for the engine when WizardEnv.ConfigPath is empty (set by main).
var RoleWikiConfigPath string

// RoleWikiFS holds bridge/contrib/wiki (set by main from package ccconnect). nil = not built in.
var RoleWikiFS fs.FS

// RoleWikiDir is where the engine is installed; RoleWikisDir holds the wikis.
func RoleWikiDir(dataDir string) string  { return filepath.Join(dataDir, "rolewiki") }
func RoleWikisDir(dataDir string) string { return filepath.Join(dataDir, "wikis") }

// RoleWikiPath is one role's wiki (the same name sanitising as rolewiki.py wiki_dir).
func RoleWikiPath(dataDir, project string) string {
	var b strings.Builder
	for _, r := range project {
		if r == '_' || r == '.' || r == '-' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r > 127 {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	return filepath.Join(RoleWikisDir(dataDir), b.String())
}

// InstallRoleWiki writes the embedded engine into RoleWikiDir (replacing older copies) and its settings.json.
func InstallRoleWiki(dataDir, configPath string) (string, error) {
	if RoleWikiFS == nil {
		return "", errors.New("the role wiki engine is not built into this binary")
	}
	dir := RoleWikiDir(dataDir)
	err := fs.WalkDir(RoleWikiFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasPrefix(path.Base(p), "test_") {
			return err
		}
		rel := strings.TrimPrefix(p, "contrib/wiki/")
		b, err := fs.ReadFile(RoleWikiFS, p)
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return AtomicWriteFile(dst, b, 0o755)
	})
	if err != nil {
		return "", err
	}
	exe, _ := os.Executable()
	return dir, writeJSONFile(filepath.Join(dir, "settings.json"), map[string]string{"config": configPath, "cc_connect": exe}, 0o644)
}

func roleWikiScript(dataDir string) string { return filepath.Join(RoleWikiDir(dataDir), "rolewiki.py") }

func roleWikiCommand(python, dataDir string, args ...string) string {
	cmd := hookQuote(python) + " -I " + hookQuote(roleWikiScript(dataDir))
	for _, a := range args {
		cmd += " " + a
	}
	return cmd
}

// RoleWikiHooks are the global hooks: every role's messages go into its session record; a closed agent session
// is distilled into that role's wiki (rolewiki.py hook detaches the model pass).
func RoleWikiHooks(python, dataDir string) []HookConfig {
	c := roleWikiCommand(python, dataDir, "hook")
	return []HookConfig{
		{Event: string(HookEventMessageReceived), Type: "command", Command: c},
		{Event: string(HookEventMessageSent), Type: "command", Command: c},
		{Event: string(HookEventAgentClosed), Type: "command", Command: c},
	}
}

// WizardRoleWikiStore is an optional part of WizardStore: adds the hooks and memory_index to config.toml.
type WizardRoleWikiStore interface {
	EnsureRoleWiki(hooks []HookConfig, memoryIndex map[string]string) (changed int, err error)
}

// applyWizardRoleWikis gives every role of this run its wiki. Failures are reported as steps; the bots work without.
func applyWizardRoleWikis(res *WizardResult, env WizardEnv, lang string, roles []plannedRole) {
	store, ok := env.Store.(WizardRoleWikiStore)
	if !ok || RoleWikiFS == nil {
		return
	}
	python, err := FindPython()
	if err != nil {
		addStep(res, "wiki", err, "")
		return
	}
	cfgPath := env.ConfigPath
	if cfgPath == "" {
		cfgPath = RoleWikiConfigPath
	}
	if _, err := InstallRoleWiki(env.DataDir, cfgPath); err != nil {
		addStep(res, "wiki", err, "")
		return
	}
	wl := "zh"
	if !strings.HasPrefix(lang, "zh") {
		wl = "en"
	}
	mem := map[string]string{}
	for _, r := range roles {
		out, err := exec.Command(python, "-I", roleWikiScript(env.DataDir), "ensure", r.project, "--lang", wl).CombinedOutput()
		if err != nil {
			addStep(res, "wiki", fmt.Errorf("%s: %v: %s", r.project, err, strings.TrimSpace(string(out))), "")
			continue
		}
		w := RoleWikiPath(env.DataDir, r.project)
		mem[r.project] = filepath.Join(w, "MEMORY.md")
		addStep(res, "wiki", nil, stepRoleWiki(lang, r.project, w))
	}
	if _, err := store.EnsureRoleWiki(RoleWikiHooks(python, env.DataDir), mem); err != nil {
		addStep(res, "wiki", err, "")
	}
}

func stepRoleWiki(lang, project, dir string) string {
	return tr3(lang, project+" 的 wiki："+dir+"（会话结束自动整理，每晚反思）",
		project+" の wiki："+dir+"（セッション終了時に自動整理、毎晩ふりかえり）",
		project+"'s wiki: "+dir+" (distilled when sessions end, reflected on nightly)")
}

// roleWikiTickEvery: 来源：作者本机 wiki 整理定时任务每 1800 秒一次（每 30 分钟收一次空闲会话）。
const roleWikiTickEvery = 30 * time.Minute

// StartRoleWikiTicker refreshes the installed engine from this binary and runs "rolewiki.py tick" every
// roleWikiTickEvery while ctx lives, one run at a time. Does nothing when the wizard never installed it.
func StartRoleWikiTicker(ctx context.Context, dataDir, configPath string) {
	if _, err := os.Stat(roleWikiScript(dataDir)); err != nil || RoleWikiFS == nil {
		return
	}
	if _, err := InstallRoleWiki(dataDir, configPath); err != nil {
		slog.Warn("rolewiki: refresh failed", "error", err)
	}
	python, err := FindPython()
	if err != nil {
		slog.Warn("rolewiki: no python, role wikis are not kept", "error", err)
		return
	}
	var running atomic.Bool
	run := func() {
		if !running.CompareAndSwap(false, true) {
			return
		}
		defer running.Store(false)
		out, err := exec.CommandContext(ctx, python, "-I", roleWikiScript(dataDir), "tick").CombinedOutput()
		if err != nil {
			slog.Warn("rolewiki: tick failed", "error", err, "output", strings.TrimSpace(string(out)))
		}
	}
	go func() {
		t := time.NewTicker(roleWikiTickEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				go run()
			}
		}
	}()
}
