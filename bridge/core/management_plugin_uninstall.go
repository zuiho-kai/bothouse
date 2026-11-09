package core

// 插件卸载 (#1377): removing a bundle this profile installed, through DSH's own pnpm runner.
//
// `dsh plugin --profile web remove -- <name>` is pnpm's remove forwarded verbatim (the CLI help
// says so), but it is not what this route runs: that command takes the profile's package.json.lock
// itself, so starting it while this handler holds the same lock leaves the lock holder waiting on
// a child that waits on the holder. The removal instead runs DSH's `runProfilePnpm` — the function
// `dsh plugin` calls while it holds that lock — in a child process inside this handler's own hold
// (plugin_uninstall_helper.mjs, embedded below). `runProfilePnpm` takes no lock: the refusal
// checks, pnpm's write into package.json/node_modules, DSH's reconcile of dsh.profile.bundles and
// the post-check below then share one critical section, so no other writer can commit a dependency
// or bundle list between the check and the write.
//
// What DSH's remove does *not* do is refuse the three kinds of package that must not be removed
// through a panel button, so they are checked here, before pnpm runs:
//
//   - a layer that comes from the DSH installation (`@deepseek-ai/dsh-base` is not even in the
//     profile's dependencies; `@deepseek-ai/dsh-web-app` is linked in from the install directory),
//   - a package another installed package still depends on (pnpm removes the target silently and
//     the dependent package then fails at load with MODULE_NOT_FOUND),
//   - a name this profile does not have.
//
// The reverse-dependency check reads `node_modules/*/package.json` instead of asking pnpm: `pnpm
// why` answers `[]` for a link: package, so it cannot be trusted here.

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// pluginUninstallHelperScript is the removal half: it resolves runProfilePnpm from the installation
// the profile belongs to and calls it with `remove -- <name>`. It runs inside this handler's lock
// hold and must not take the lock, which is why it is not `dsh plugin remove`.
//
//go:embed plugin_uninstall_helper.mjs
var pluginUninstallHelperScript []byte

// pluginUninstallTimeout bounds the removal: it deletes files from the profile, it does not
// download anything.
// 来源：方案实测 `dsh plugin remove` 整体约 0.35s（notes/plugin-uninstall-plan-20261109.md 一.1），
// 这里留足冷缓存与杀毒软件扫描的余量；不沿用安装那份 5 分钟。
const pluginUninstallTimeout = 30 * time.Second

// pluginUninstallWaitDelay bounds how long Wait keeps reading after the removal's child is gone: a
// pnpm grandchild can hold the pipes open. 来源：core/media.go:95 用同样的 5 秒。
const pluginUninstallWaitDelay = 5 * time.Second

// pluginUninstallTailBytes bounds what the bridge keeps of the child's output: only a failure
// classification reads it, and DSH writes the full log itself.
// 来源：沿用 install 的 64KB 尾部（core/management_plugins.go:359）。
const pluginUninstallTailBytes = 64 * 1024

// pluginUninstallRun is what one finished removal child reported. The exit status is only an
// input to the answer: whether the package is gone is read from the profile afterwards.
type pluginUninstallRun struct {
	exitCode int
	// output is the tail of everything the helper printed (its own lines and pnpm's).
	output string
	// timedOut says this bridge ended the run, not that pnpm returned.
	timedOut bool
}

// pluginUninstallRemoval runs the removal while the caller holds the profile lock. It is a var so
// the tests can stand in for Node: the Go jobs may have no Node at all, and the point of the tests
// is what the handler does with the profile, not that a fake command ran.
var pluginUninstallRemoval = runPluginUninstallRemoval

// pluginUninstallError carries the HTTP status and the classifier kind the page has text for.
type pluginUninstallError struct {
	status int
	kind   string
	msg    string
	// inUse names the packages that still depend on the target; only set for in-use.
	inUse []string
}

func (e *pluginUninstallError) Error() string { return e.msg }

// handlePluginsUninstall removes one dependency from this profile.
func (m *ManagementServer) handlePluginsUninstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	var req struct {
		Name string `json:"name"`
		// Confirm must equal Name. The page sends it only after the person typed the package name
		// into the dialog; a truthy flag would be one click, which is what the step exists to stop.
		// 来源：方案 §二.2，与 install 的 confirm_source 同一个套路。
		Confirm string `json:"confirm"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || strings.HasPrefix(name, "-") || strings.ContainsAny(name, " \t\n") {
		uninstallError(w, &pluginUninstallError{
			status: http.StatusBadRequest,
			kind:   "invalid-name",
			msg:    "包名不对：填 profile 依赖里的完整包名，不带版本、不带空格。",
		})
		return
	}
	if req.Confirm != name {
		uninstallError(w, &pluginUninstallError{
			status: http.StatusBadRequest,
			kind:   "confirm-mismatch",
			msg:    "包名不对，再输一次。",
		})
		return
	}
	plan, planErr := planPluginUninstall()
	if planErr != nil {
		uninstallError(w, planErr)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), pluginUninstallTimeout)
	defer cancel()

	var state DSHPluginsState
	var run pluginUninstallRun
	lockErr := withPluginProfileLock(filepath.Join(plan.dir, "package.json"), func() error {
		if err := pluginUninstallPrecheck(plan.dir, plan.anchor, name); err != nil {
			return err
		}
		var runErr error
		run, runErr = pluginUninstallRemoval(ctx, plan, name)
		if runErr != nil {
			return runErr
		}
		// A run this bridge ended is never success, whatever it managed to write before the kill.
		if !run.timedOut {
			gone, err := pluginUninstallPersisted(plan.dir, name)
			if err != nil {
				return err
			}
			if gone {
				// Read the list while the lock still says nobody else has written the profile, so
				// the rows the page paints are the rows the post-check just read.
				state = m.pluginState()
				return nil
			}
		}
		// The answer is written after the lock is released: the page needs a reason, and holding
		// the profile through a socket write would keep the next writer waiting on this request.
		return errPluginUninstallIncomplete
	})
	if lockErr != nil {
		var se *pluginUninstallError
		switch {
		case errors.As(lockErr, &se):
			uninstallError(w, se)
		case errors.Is(lockErr, errPluginUninstallIncomplete):
			uninstallError(w, pluginUninstallFailure(run))
		default:
			mgmtError(w, http.StatusConflict, lockErr.Error())
		}
		return
	}

	mgmtJSON(w, http.StatusOK, map[string]any{
		"uninstalled": true,
		"state":       state,
		// DSH reads dsh.profile.bundles at start; a removed layer keeps loading until restart.
		// 来源：方案 §一.4。
		"restart_required": true,
	})
}

// errPluginUninstallNoNode is the refusal for a machine where DSH's plugin manager cannot be
// loaded: the removal is a Node script, and there is no Node to run it.
var errPluginUninstallNoNode = &pluginUninstallError{
	status: http.StatusConflict,
	kind:   "unknown",
	msg:    "卸载要用这台电脑上的 Node 跑 DSH 的插件管理器，但 PATH 里没有 node。装一个 Node（22.12 以上）再试。",
}

// errPluginUninstallIncomplete says the removal ran but the profile on disk does not show it
// finished. The reason is read from the run afterwards; it is an error, not a success.
var errPluginUninstallIncomplete = errors.New("the removal did not finish")

// pluginUninstallPlan is everything a removal needs from outside the profile lock: the profile, the
// installation whose plugin manager runs it, and the Node that can load that installation.
type pluginUninstallPlan struct {
	dir string
	// anchor is the installation's package.json. `createRequire` resolves
	// @deepseek-ai/dsh-plugin-manager/operations from its directory.
	anchor string
	// node runs the helper. Empty means this machine has no Node the helper could run on, which is
	// refused with a sentence rather than a spawn error.
	node string
	// exposeInternals is how the Desktop app's own binary is started as Node: its CLI launcher
	// passes this flag, and the app reads its packages out of app.asar.
	exposeInternals bool
	// pnpm is the app's bundled pnpm.cjs, empty to let runProfilePnpm find `pnpm` on PATH.
	pnpm string
}

// planPluginUninstall picks the installation and the runner. It runs before the lock: a machine
// without DSH or without a Node must be told so without taking the profile's writer lock.
func planPluginUninstall() (pluginUninstallPlan, *pluginUninstallError) {
	plan := pluginUninstallPlan{dir: dshProfileDir()}
	if anchor := dshInstallAnchor(); anchor != "" {
		plan.anchor = anchor
		node, err := exec.LookPath("node")
		if err != nil {
			return plan, errPluginUninstallNoNode
		}
		plan.node = node
		return plan, nil
	}
	// A desktop-only install keeps its packages inside app.asar, which the Node the app ships
	// cannot open (measured: existsSync is false there); only the app's own binary reads it. So the
	// anchor is derived from the app's layout — the launcher in runtime/cli/bin/dsh loads
	// app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host — and cannot be stat'ed from here.
	app := dshDesktopApp()
	if app == "" {
		return plan, &pluginUninstallError{
			status: http.StatusConflict,
			kind:   "unknown",
			msg:    "这台电脑还没装 DSH：先 npm i -g @deepseek-ai/dsh",
		}
	}
	plan.anchor = filepath.Join(dshDesktopResources(app), "app.asar", "dsh", "package.json")
	plan.node = dshDesktopExe(app)
	plan.exposeInternals = true
	// The app's own pnpm, found without dshDesktopRuntimeBins: that helper also demands a bundled
	// Node, and here the Node is the app binary itself. A runtime without pnpm.cjs leaves plan.pnpm
	// empty, and the helper then falls back to `pnpm` on PATH.
	if p := filepath.Join(dshDesktopResources(app), "runtime", "primary-runtime", "dependencies", "pnpm", "bin", "pnpm.cjs"); fileExists(p) {
		plan.pnpm = p
	}
	return plan, nil
}

// runPluginUninstallRemoval runs the embedded helper: DSH's own `runProfilePnpm` with
// `remove -- <name>`, which takes no lock and therefore can run inside the caller's hold.
func runPluginUninstallRemoval(ctx context.Context, plan pluginUninstallPlan, name string) (pluginUninstallRun, error) {
	var run pluginUninstallRun
	args := []string{"--input-type=module", "-"}
	if plan.exposeInternals {
		args = append([]string{"--expose-internals"}, args...)
	}
	cmd := exec.CommandContext(ctx, plan.node, args...)
	// The script arrives on stdin, so no temp file is written and no path is handed to a shell.
	cmd.Stdin = bytes.NewReader(pluginUninstallHelperScript)
	env := []string{
		"BOTHOUSE_UNINSTALL_DIR=" + plan.dir,
		"BOTHOUSE_UNINSTALL_ANCHOR=" + plan.anchor,
		"BOTHOUSE_UNINSTALL_PROFILE=" + DSHProfile,
		"BOTHOUSE_UNINSTALL_NAME=" + name,
	}
	if plan.exposeInternals {
		env = append(env, "ELECTRON_RUN_AS_NODE=1")
	}
	// The pair goes together: `node --expose-internals pnpm.cjs` is what the desktop host passes.
	// With no bundled pnpm the helper leaves `pnpm` to PATH and needs no explicit command.
	if plan.exposeInternals && plan.pnpm != "" {
		env = append(env,
			"BOTHOUSE_UNINSTALL_PNPM_NODE="+plan.node,
			"BOTHOUSE_UNINSTALL_PNPM="+plan.pnpm,
		)
	}
	cmd.Env = MergeEnv(os.Environ(), env)
	// The bridge kills the whole group on timeout: pnpm and anything pnpm started die with it.
	ownProcessGroup(cmd)
	cmd.WaitDelay = pluginUninstallWaitDelay
	tail := &pluginUninstallTail{}
	cmd.Stdout, cmd.Stderr = tail, tail
	runErr := cmd.Run()
	run.output = tail.String()
	// The timeout is checked before the exit status: a run this bridge ended leaves an ExitError
	// behind (the group was killed), and reporting its status as pnpm's answer would be a lie.
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		run.timedOut = true
		run.exitCode = -1
		return run, nil
	}
	if exit := (*exec.ExitError)(nil); errors.As(runErr, &exit) {
		run.exitCode = exit.ExitCode()
		return run, nil
	}
	if runErr != nil {
		return run, &pluginUninstallError{
			status: http.StatusConflict,
			kind:   "unknown",
			msg:    "没能启动卸载进程：" + runErr.Error(),
		}
	}
	return run, nil
}

// pluginUninstallFailure turns a finished run into the sentence the page shows. The child's own
// words never reach the page; its exit status and the error code pnpm prints pick the sentence.
func pluginUninstallFailure(run pluginUninstallRun) *pluginUninstallError {
	fail := func(status int, kind, msg string) *pluginUninstallError {
		return &pluginUninstallError{status: status, kind: kind, msg: msg}
	}
	if run.timedOut {
		return fail(http.StatusConflict, "timeout", "卸载超时了，已经把它停掉。刷新看看它还在不在；还在就到终端里再跑一次。")
	}
	// 来源：方案 §二.2 把 ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS 归到 not-removable。
	if strings.Contains(run.output, "ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS") {
		return fail(http.StatusForbidden, "not-removable", "这一层不是这份 profile 装的，不能在这里卸载。")
	}
	// DSH's run record still names a live process: the profile is busy, not broken.
	// 来源：dsh-plugin-manager/lib/types/operations.js 的 activeRecordedRun。
	if strings.Contains(run.output, "is still running in this profile") {
		return fail(http.StatusConflict, "unknown", "这份 profile 里还有上一次安装或卸载留下的进程没退，等它结束再试一次。")
	}
	if strings.Contains(run.output, "does not expose @deepseek-ai/dsh-plugin-manager/operations") {
		return fail(http.StatusConflict, "unknown", "这份 DSH 没带插件管理器（版本太旧或安装不完整）。先升级 DSH，再到终端里卸载。")
	}
	if strings.Contains(run.output, "could not start pnpm") {
		return fail(http.StatusConflict, "unknown", "找不到 pnpm：DSH 的插件管理器要它来改 profile。先装 pnpm 再试一次。")
	}
	if run.exitCode == 0 {
		return fail(http.StatusConflict, "unknown", "DSH 说做完了，但 profile 里还列着它。刷新看看；还在就到 DSH 的插件页或终端里再试一次。")
	}
	return fail(http.StatusConflict, "unknown", "没卸成，DSH 没有说明原因。到 DSH 的插件页或终端里再试一次。")
}

// pluginUninstallPersisted answers "does the profile on disk show this package gone?". That answer,
// not the child's exit status, is what `uninstalled: true` means: pnpm can exit 0 and leave the
// manifest listing the package, and the page would then mark a row that is still installed.
func pluginUninstallPersisted(dir, name string) (bool, error) {
	manifest, raw, err := readPluginManifest(dir)
	if err != nil {
		return false, &pluginUninstallError{status: http.StatusConflict, kind: "manifest", msg: err.Error()}
	}
	// A manifest that vanished mid-run is not "gone": there is nothing left for DSH to load.
	if raw == nil {
		return false, nil
	}
	if _, ok := manifest.Dependencies[name]; ok {
		return false, nil
	}
	// DSH's reconcile drops the bundle entry; one left behind keeps the layer loading after restart.
	return !slices.Contains(manifest.DSH.Profile.Bundles, name), nil
}

// pluginUninstallTail keeps the last bytes the child printed. pnpm writes to both descriptors, so
// the writes come from two goroutines and need the lock; the cut can split a rune, and the only
// reader looks for ASCII error codes and sentences.
type pluginUninstallTail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *pluginUninstallTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > pluginUninstallTailBytes {
		t.buf = t.buf[len(t.buf)-pluginUninstallTailBytes:]
	}
	return len(p), nil
}

func (t *pluginUninstallTail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

// pluginUninstallPrecheck answers "may this name be removed from this profile?" and returns nil
// when it may. It runs with the profile lock held, before any process is started, and it takes the
// installation anchor the caller resolved so the checks see the same installation the removal will.
func pluginUninstallPrecheck(dir, anchor, name string) error {
	manifest, _, err := readPluginManifest(dir)
	if err != nil {
		return &pluginUninstallError{status: http.StatusConflict, kind: "manifest", msg: err.Error()}
	}
	installRoot := ""
	if anchor != "" {
		installRoot = filepath.Dir(anchor)
	}
	pkgDir := resolveDSHBundle(name, anchor, dir)
	shipped := installRoot != "" && strings.HasPrefix(pkgDir, installRoot+string(filepath.Separator))

	// (a) built-in layers. dsh-base is not in the profile's dependencies at all, so the name is
	// checked before "not installed": refusing it as missing would name the wrong reason.
	if name == "@deepseek-ai/dsh-base" {
		return &pluginUninstallError{
			status: http.StatusForbidden,
			kind:   "not-removable",
			msg:    "dsh-base 是 DSH 的面板本体，卸掉就没有界面可用了。",
		}
	}
	if shipped {
		return &pluginUninstallError{
			status: http.StatusForbidden,
			kind:   "not-removable",
			msg:    "这一层随 DSH 一起安装，不能在这里卸载。",
		}
	}
	source, ok := manifest.Dependencies[name]
	if !ok {
		return &pluginUninstallError{
			status: http.StatusNotFound,
			kind:   "not-installed",
			msg:    "这份 profile 里没有这个包。",
		}
	}
	// (b) a layer linked in from the installation directory: removing it deletes the profile's
	// reference, and DSH starts one layer short. 来源：方案一.3 的实测。
	if strings.HasPrefix(source, "link:") && installRoot != "" {
		target := strings.TrimPrefix(source, "link:")
		if resolved, err := filepath.EvalSymlinks(target); err == nil {
			target = resolved
		}
		if strings.HasPrefix(target, installRoot+string(filepath.Separator)) {
			return &pluginUninstallError{
				status: http.StatusForbidden,
				kind:   "not-removable",
				msg:    "这一层从 DSH 安装目录链接进来，随 DSH 一起安装，不能在这里卸载。",
			}
		}
	}
	// (c) something still depends on it. pnpm removes the target and says nothing; the dependent
	// package then dies at load with MODULE_NOT_FOUND.
	if who := pluginReverseDeps(dir, name); len(who) > 0 {
		return &pluginUninstallError{
			status: http.StatusConflict,
			kind:   "in-use",
			msg:    strings.Join(who, "、") + " 还在用它，先卸载 " + strings.Join(who, "、") + "。",
			inUse:  who,
		}
	}
	return nil
}

// pluginReverseDeps lists the installed packages in the profile that name `name` in their own
// dependency fields. It reads the same tree pnpm writes (`node_modules/<pkg>` and
// `node_modules/@<scope>/<pkg>`), so it sees link: packages that `pnpm why` answers `[]` for.
func pluginReverseDeps(dir, name string) []string {
	root := filepath.Join(dir, "node_modules")
	// pnpm installs a dependency as a symlink into its store, and a `link:` dependency as a symlink
	// at the source directory; both are the common case here, so a directory test has to follow the
	// link. `DirEntry.IsDir` does not (it reports the link itself), which would skip every real
	// package and make this check silently useless — the real-entry run found exactly that.
	isPkgDir := func(path string) bool {
		info, err := os.Stat(path)
		return err == nil && info.IsDir()
	}
	var dirs []string
	if entries, err := os.ReadDir(root); err == nil {
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			p := filepath.Join(root, name)
			if strings.HasPrefix(name, "@") {
				if scoped, err := os.ReadDir(p); err == nil {
					for _, inner := range scoped {
						if child := filepath.Join(p, inner.Name()); !strings.HasPrefix(inner.Name(), ".") && isPkgDir(child) {
							dirs = append(dirs, child)
						}
					}
				}
				continue
			}
			if isPkgDir(p) {
				dirs = append(dirs, p)
			}
		}
	}
	sort.Strings(dirs)
	var who []string
	seen := map[string]bool{}
	for _, pkgDir := range dirs {
		raw, err := os.ReadFile(filepath.Join(pkgDir, "package.json"))
		if err != nil {
			continue
		}
		var pkg struct {
			Name                 string            `json:"name"`
			Dependencies         map[string]string `json:"dependencies"`
			PeerDependencies     map[string]string `json:"peerDependencies"`
			OptionalDependencies map[string]string `json:"optionalDependencies"`
		}
		if err := json.Unmarshal(raw, &pkg); err != nil || pkg.Name == "" || pkg.Name == name {
			continue
		}
		if _, ok := pkg.Dependencies[name]; !ok {
			if _, ok := pkg.PeerDependencies[name]; !ok {
				if _, ok := pkg.OptionalDependencies[name]; !ok {
					continue
				}
			}
		}
		if !seen[pkg.Name] {
			seen[pkg.Name] = true
			who = append(who, pkg.Name)
		}
	}
	return who
}

// uninstallError writes the readable sentence plus the kind the page translates, and the blocking
// package names for in-use so the page can say who.
func uninstallError(w http.ResponseWriter, e *pluginUninstallError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	body := map[string]any{"ok": false, "error": e.msg, "kind": e.kind}
	if len(e.inUse) > 0 {
		body["in_use_by"] = e.inUse
	}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("management api: write uninstall error JSON failed", "error", err)
	}
}
